import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Unit owns this implementation. Only persisted, explicit request identities count.
export const OWNER = 'tunit';
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const counters = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'total_tokens', 'reasoning_output_tokens', 'cache_write_input_tokens'];
export const requiredCounters = counters.slice(0, 4);
export const hash = value => createHash('sha256').update(value).digest('hex');
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

function usageFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of counters) if (Object.hasOwn(value, key)) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error(`用量欄位無效：${key}`);
    result[key] = value[key];
  }
  if (requiredCounters.every(k => Object.hasOwn(result, k)) &&
      (result.input_tokens + result.output_tokens !== result.total_tokens || result.cached_input_tokens > result.input_tokens)) {
    throw new Error('用量加總或快取輸入不一致');
  }
  if (Number.isSafeInteger(result.reasoning_output_tokens) && Number.isSafeInteger(result.output_tokens) &&
      result.reasoning_output_tokens > result.output_tokens) throw new Error('推理用量大於輸出');
  return result;
}

export function extractSession(text, expectedId, { workspaceRoot } = {}) {
  if (!uuid.test(expectedId)) throw new Error('必須提供明確的 thread UUID');
  const events = [];
  let metadata = null;
  let incompleteTail = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let record;
    try { record = JSON.parse(lines[i]); }
    catch {
      if (i === lines.length - 1 && !text.endsWith('\n')) { incompleteTail = true; break; }
      throw new Error(`Session 第 ${i + 1} 行 JSON 無效`);
    }
    const p = record.payload ?? {};
    if (record.type === 'session_meta') {
      if (metadata || p.id !== expectedId) throw new Error('Session 身分不符或重複');
      if (workspaceRoot && (!p.cwd || fs.realpathSync(p.cwd) !== fs.realpathSync(workspaceRoot))) throw new Error('Session workspace 不符');
      metadata = { id: p.id, cliVersion: p.cli_version ?? null, source: typeof p.source === 'string' ? p.source : null,
        forkedFromId: p.forked_from_id ?? null, parentThreadId: p.source?.subagent?.thread_spawn?.parent_thread_id ?? null,
        agentPath: p.source?.subagent?.thread_spawn?.agent_path ?? null };
    }
    // Never persist prompts, tool payloads, conversation, environment values or cumulative usage.
    if (record.type === 'turn_context') events.push({ type: 'turn_context', turnId: p.turn_id ?? null,
      model: p.model ?? null, effort: p.effort ?? null, serviceTier: p.service_tier ?? null });
    if (record.type === 'token_usage_record') events.push({ type: 'token_usage_record', threadId: p.thread_id ?? null,
      turnId: p.turn_id ?? null, rootTurnId: p.root_turn_id ?? null, responseId: p.response_id ?? null, usage: usageFields(p.usage) });
    if (record.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted'].includes(p.type)) {
      events.push({ type: p.type, turnId: p.turn_id ?? null });
    }
  }
  if (!metadata) throw new Error('缺少 Session metadata');
  return { metadata, events, incompleteTail };
}

function exactFiles(root, id) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) return exactFiles(file, id);
    return entry.isFile() && entry.name.endsWith(`-${id}.jsonl`) ? [file] : [];
  });
}

export function collect({ sessionsRoot, threadId, workspaceRoot }) {
  if (!uuid.test(threadId)) throw new Error('必須提供明確的 thread UUID，不推測最新 Session');
  const files = exactFiles(sessionsRoot, threadId);
  if (files.length !== 1) throw new Error(`符合 thread 的 Session 檔案數必須為 1，目前為 ${files.length}`);
  const bytes = fs.readFileSync(files[0]);
  return { schemaVersion: 1, sourceFile: path.basename(files[0]), sourceSha256: hash(bytes),
    ...extractSession(bytes.toString('utf8'), threadId, { workspaceRoot }) };
}

export function activeRootTurn(capture) {
  if (capture.metadata.parentThreadId || !['cli', 'vscode'].includes(capture.metadata.source)) throw new Error('不支援的主代理 Session 來源');
  const events = capture.events;
  const start = events.findLastIndex(e => e.type === 'task_started');
  const turnId = events[start]?.turnId;
  if (!uuid.test(turnId ?? '') || events.slice(start + 1).some(e =>
    ['task_complete', 'turn_aborted'].includes(e.type) && (!e.turnId || e.turnId === turnId))) throw new Error('找不到明確且仍在執行的 root turn');
  if (capture.incompleteTail) throw new Error('Session 尾行尚未完整');
  return turnId;
}

// mode=ro and parameterized queries. Python is only a local SQLite reader, never an installer.
const sqliteProgram = String.raw`
import json, sqlite3, sys, uuid
from pathlib import Path
database, root = sys.argv[1:]
uuid.UUID(root)
connection = sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True)
try:
    row = connection.execute('SELECT id,cli_version FROM threads WHERE id=?', (root,)).fetchone()
    if not row: raise ValueError('Exact root ID missing')
    pending, seen, edges = [root], {root}, []
    while pending:
        parent = pending.pop()
        for child, status in connection.execute('SELECT child_thread_id,status FROM thread_spawn_edges WHERE parent_thread_id=?', (parent,)):
            uuid.UUID(child)
            if child in seen: raise ValueError('Duplicate or cyclic relationship')
            seen.add(child)
            pending.append(child)
            edges.append({'parentThreadId': parent, 'childThreadId': child, 'status': status})
    print(json.dumps({'rootThreadId': root, 'cliVersion': row[1], 'edges': edges, 'source': 'codex-state-db-read-only'}))
finally:
    connection.close()
`;

function nativeRelations(DatabaseSync, databasePath, rootThreadId) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const root = database.prepare('SELECT id,cli_version FROM threads WHERE id=?').get(rootThreadId);
    if (!root) throw new Error('Exact root ID missing');
    const query = database.prepare('SELECT child_thread_id,status FROM thread_spawn_edges WHERE parent_thread_id=?');
    const pending = [rootThreadId], seen = new Set(pending), edges = [];
    while (pending.length) {
      const parent = pending.pop();
      for (const child of query.all(parent)) {
        if (!uuid.test(child.child_thread_id) || seen.has(child.child_thread_id)) throw new Error('Invalid, duplicate or cyclic thread relationship');
        seen.add(child.child_thread_id); pending.push(child.child_thread_id);
        edges.push({ parentThreadId: parent, childThreadId: child.child_thread_id, status: child.status });
      }
    }
    return { rootThreadId, cliVersion: root.cli_version, edges, source: 'codex-state-db-read-only' };
  } finally { database.close(); }
}

export function errorDetail(reader, error) {
  return { reader, code: error.code ?? null, exitCode: error.status ?? null, signal: error.signal ?? null,
    message: String(error.message ?? error).slice(0, 4000), stderr: error.stderr?.toString().slice(0, 8000) ?? null };
}

export function discover({ databasePath, rootThreadId }, {
  loadSqlite = () => createRequire(import.meta.url)('node:sqlite'), runPython = execFileSync,
} = {}) {
  if (!uuid.test(rootThreadId)) throw new Error('資料庫查詢需要明確的 root UUID');
  if (!fs.statSync(databasePath).isFile()) throw new Error('缺少 Codex state 資料庫');
  const attempts = [];
  // Prefer the running Node process: no Python launcher or child-process permission is needed.
  try {
    const { DatabaseSync } = loadSqlite();
    return { ...nativeRelations(DatabaseSync, databasePath, rootThreadId), lookup: { reader: 'node:sqlite', failedAttempts: attempts } };
  } catch (error) { attempts.push(errorDetail('node:sqlite', error)); }
  // Older Node or an unavailable native reader may use an existing Python, without installing anything.
  for (const executable of ['python', 'python3']) {
    try {
      const result = JSON.parse(runPython(executable, ['-B', '-c', sqliteProgram, databasePath, rootThreadId], {
        encoding: 'utf8', timeout: 10000, maxBuffer: 4_000_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      }));
      if (result.rootThreadId !== rootThreadId || !Array.isArray(result.edges)) throw new Error('SQLite reader result identity mismatch');
      return { ...result, lookup: { reader: executable, failedAttempts: attempts } };
    } catch (error) {
      attempts.push(errorDetail(executable, error));
    }
  }
  const error = new Error('SQLite 唯讀關係查詢失敗；各讀取方式的原始錯誤已保留於 diagnosticDetails。');
  error.diagnostics = attempts;
  throw error;
}

export function databaseIn(codexHome) {
  const files = fs.readdirSync(codexHome).filter(name => /^state_\d+\.sqlite$/.test(name));
  if (files.length !== 1) throw new Error('Codex state 資料庫不唯一或不存在；不推測版本');
  return path.join(codexHome, files[0]);
}

export function summarizeScope(scope, relations, captures) {
  if (!scope.workflowId || !uuid.test(scope.rootThreadId) || !scope.rootTurnIds?.length ||
      scope.rootTurnIds.some(id => !uuid.test(id))) throw new Error('需要明確的 workflow、root thread 與 root turns');
  if (relations.rootThreadId !== scope.rootThreadId) throw new Error('Root 關係不符');
  const turns = new Set(scope.rootTurnIds);
  const parents = new Map();
  for (const edge of relations.edges) {
    if (!uuid.test(edge.childThreadId) || !uuid.test(edge.parentThreadId) || edge.childThreadId === scope.rootThreadId || parents.has(edge.childThreadId)) throw new Error('代理關係無效或重複');
    parents.set(edge.childThreadId, edge.parentThreadId);
  }
  const belongs = id => {
    const seen = new Set();
    while (id !== scope.rootThreadId) {
      if (seen.has(id)) throw new Error('代理關係循環');
      seen.add(id);
      if (!parents.has(id)) return false;
      id = parents.get(id);
    }
    return true;
  };
  for (const id of parents.keys()) if (!belongs(id)) throw new Error('代理關係未連到 root');
  const threads = new Map();
  const requests = new Map();
  const unresolved = [];
  for (const capture of captures) {
    const id = capture.metadata.id;
    if (threads.has(id) || !belongs(id)) throw new Error('重複或無關的 capture');
    if (id !== scope.rootThreadId && capture.metadata.parentThreadId !== parents.get(id)) throw new Error('Parent metadata 不符');
    if (id === scope.rootThreadId && capture.metadata.parentThreadId) throw new Error('Root capture 不能是子代理');
    threads.set(id, capture);
    for (const r of capture.events.filter(e => e.type === 'token_usage_record')) {
      if (r.threadId !== id || !r.responseId || !uuid.test(r.turnId ?? '')) throw new Error('請求身分缺漏或衝突');
      const value = { threadId: id, turnId: r.turnId, rootTurnId: r.rootTurnId, responseId: r.responseId, usage: usageFields(r.usage) };
      const old = requests.get(r.responseId);
      if (old && JSON.stringify(old) !== JSON.stringify(value)) throw new Error('Response ID 對應不同請求');
      requests.set(r.responseId, value);
    }
  }
  if (!threads.has(scope.rootThreadId)) throw new Error('缺少 Root capture');
  const selected = [], excluded = [];
  for (const r of requests.values()) {
    if (!uuid.test(r.rootTurnId ?? '') || (r.threadId === scope.rootThreadId && r.rootTurnId !== r.turnId)) { unresolved.push(r.responseId); continue; }
    (turns.has(r.rootTurnId) ? selected : excluded).push(r);
  }
  selected.sort((a, b) => a.responseId.localeCompare(b.responseId));
  const turnPairs = new Map(scope.rootTurnIds.map(id => [`${scope.rootThreadId}:${id}`, [scope.rootThreadId, id]]));
  for (const r of selected) turnPairs.set(`${r.threadId}:${r.turnId}`, [r.threadId, r.turnId]);
  const completion = [...turnPairs.values()].map(([threadId, turnId]) => {
    const events = threads.get(threadId)?.events ?? [];
    const start = events.findIndex(e => e.type === 'task_started' && e.turnId === turnId);
    return { threadId, turnId, started: start >= 0,
      completed: start >= 0 && events.slice(start + 1).some(e => e.type === 'task_complete' && e.turnId === turnId),
      interrupted: events.some(e => e.type === 'turn_aborted' && (!e.turnId || e.turnId === turnId)) };
  });
  const observedTotals = Object.fromEntries(counters.map(k => {
    const sum = selected.length && selected.every(r => Number.isSafeInteger(r.usage?.[k])) ? selected.reduce((n, r) => n + r.usage[k], 0) : null;
    if (sum !== null && !Number.isSafeInteger(sum)) throw new Error('用量加總超出安全整數範圍');
    return [k, sum];
  }));
  return { schemaVersion: 1, workflowId: scope.workflowId, rootThreadId: scope.rootThreadId, rootTurnIds: [...turns],
    selectedRequests: selected, excludedRequestIds: excluded.map(r => r.responseId), unresolvedRequestIds: unresolved,
    missingCaptureIds: [...parents.keys()].filter(id => !threads.has(id)), incompleteCaptureIds: captures.filter(c => c.incompleteTail).map(c => c.metadata.id),
    observedTotals, completion, allObservedTurnsCompleted: completion.every(c => c.started && c.completed && !c.interrupted) };
}

export function runIdentity(state) {
  if (state.workflow !== OWNER || !state.target || !Number.isFinite(Date.parse(state.overallWallClock?.start))) throw new Error('run-state owner、target 或起點不符');
  return hash(JSON.stringify([state.workflow, state.runIdentifier ?? null, state.target, state.targets ?? [], state.overallWallClock.start]));
}

export function assignmentRoles(state, captures = []) {
  const roles = {};
  for (const role of ['analyzer', 'writer', 'executor', 'reviewer']) {
    for (const assignment of state.phases?.[role]?.assignments ?? []) {
      if (!assignment.agentId) throw new Error(`Assignment 缺少明確 agentId：${role}/${assignment.assignmentId ?? '未取得'}`);
      const matches = captures.filter(c => c.metadata.agentPath === assignment.agentId);
      const id = uuid.test(assignment.agentId) ? assignment.agentId : matches.length === 1 ? matches[0].metadata.id : null;
      if (!id || (roles[id] && roles[id] !== role)) throw new Error('Assignment agentId 無法唯一對應本回合的 thread 或跨角色重複');
      roles[id] = role;
    }
  }
  return roles;
}

export function evaluateSnapshot(binding, state, relations, captures) {
  if (binding.runIdentity !== runIdentity(state)) throw new Error('本次 run-state 已被替換');
  const summary = summarizeScope(binding.scope, relations, captures);
  const selectedThreads = new Set(summary.selectedRequests.map(r => r.threadId));
  const roles = assignmentRoles(state, captures.filter(c => selectedThreads.has(c.metadata.id)));
  const issues = [];
  for (const key of ['missingCaptureIds', 'incompleteCaptureIds', 'unresolvedRequestIds']) if (summary[key].length) issues.push(key);
  if (!summary.allObservedTurnsCompleted) issues.push('turns-not-completed');
  const lifecycle = { pass: 'completed', pass_with_warnings: 'completed', fail: 'failed', failed: 'failed', blocked: 'blocked' };
  if (!state.overallWallClock?.end || !Object.hasOwn(lifecycle, state.terminalDecision)
    || state.terminalCloseout?.lifecycle !== lifecycle[state.terminalDecision]) issues.push('workflow-not-closed');
  if (!summary.selectedRequests.length || requiredCounters.some(k => summary.observedTotals[k] === null)) issues.push('request-usage-incomplete');
  for (const id of Object.keys(roles)) if (!selectedThreads.has(id)) issues.push(`assignment-usage-missing:${id}`);
  for (const id of selectedThreads) if (id !== binding.scope.rootThreadId && !roles[id]) issues.push(`unassigned-thread:${id}`);
  if (['pass', 'pass_with_warnings'].includes(state.terminalDecision)) {
    for (const role of ['analyzer', 'writer', 'executor', 'reviewer']) if (!Object.values(roles).includes(role)) issues.push(`role-missing:${role}`);
  }
  const settings = captures.flatMap(c => c.events.filter(e => e.type === 'turn_context' && summary.completion.some(t => t.threadId === c.metadata.id && t.turnId === e.turnId)).map(e => ({ threadId: c.metadata.id, ...e })));
  // Attribute each request to its preceding context in the same turn, preserving missing settings.
  const requestSettings = summary.selectedRequests.map(request => {
    const events = captures.find(c => c.metadata.id === request.threadId)?.events ?? [];
    const index = events.findIndex(e => e.type === 'token_usage_record' && e.responseId === request.responseId);
    const context = index < 0 ? null : events.slice(0, index).findLast(e => e.type === 'turn_context' && e.turnId === request.turnId);
    return { responseId: request.responseId, model: context?.model ?? null, effort: context?.effort ?? null, serviceTier: context?.serviceTier ?? null };
  });
  const agentPaths = Object.fromEntries(captures.map(c => [c.metadata.id, c.metadata.agentPath ?? null]));
  const fingerprint = hash(JSON.stringify({ summary, roles, settings, requestSettings, agentPaths, terminalDecision: state.terminalDecision }));
  return { summary, roles, settings, requestSettings, agentPaths, issues, ready: issues.length === 0, fingerprint, lookup: relations.lookup ?? null,
    interrupted: summary.completion.some(c => c.interrupted), terminalDecision: state.terminalDecision ?? null };
}
