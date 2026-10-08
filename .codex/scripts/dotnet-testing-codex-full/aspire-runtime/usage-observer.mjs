import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OWNER, uuid, hash, readJson, collect, activeRootTurn, databaseIn, discover, runIdentity, evaluateSnapshot, errorDetail } from './usage-session.mjs';
import { atomicWrite, writeReport, reportLink, renderHtml } from './usage-report.mjs';

const self = fileURLToPath(import.meta.url);
const intervalMs = 2000;
const maximumMs = 2 * 60 * 60 * 1000;
const now = () => new Date().toISOString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function within(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function locate({ workspaceRoot, runStatePath }) {
  if (!path.isAbsolute(workspaceRoot ?? '') || !path.isAbsolute(runStatePath ?? '')) throw new Error('workspace-root 與 run-state 必須為絕對路徑');
  const workspace = fs.realpathSync(workspaceRoot), statePath = fs.realpathSync(runStatePath);
  if (!within(workspace, statePath) || path.basename(path.dirname(statePath)) !== '.orchestrator' || path.basename(statePath) !== 'run-state.json') throw new Error('run-state 必須位於本 workspace 的測試 .orchestrator 內');
  const state = readJson(statePath), identity = runIdentity(state);
  const runIdentifier = state.runIdentifier ?? `${OWNER}-${identity.slice(0, 20)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(runIdentifier)) throw new Error('runIdentifier 不能作為安全的目錄名稱');
  const directory = path.join(path.dirname(statePath), 'usage', runIdentifier);
  return { state, statePath, workspace, runIdentifier, directory, identity };
}

function checkBinding(binding, directory) {
  if (binding.workflow !== OWNER || path.resolve(binding.directory) !== path.resolve(directory)) throw new Error('用量 binding owner 或目錄不符');
  const located = locate({ workspaceRoot: binding.workspaceRoot, runStatePath: binding.runStatePath });
  if (binding.runIdentity !== located.identity || path.resolve(directory) !== located.directory) throw new Error('用量 binding 不屬於目前 run');
  if (fs.realpathSync(directory) !== path.resolve(directory)) throw new Error('用量目錄不能使用連結');
  return located.state;
}

export function sample(binding) {
  const state = checkBinding(binding, binding.directory);
  const relations = discover({ databasePath: binding.databasePath, rootThreadId: binding.scope.rootThreadId });
  const captures = [binding.scope.rootThreadId, ...relations.edges.map(e => e.childThreadId)].map(threadId =>
    collect({ sessionsRoot: binding.sessionsRoot, threadId, workspaceRoot: binding.workspaceRoot }));
  return { snapshot: evaluateSnapshot(binding, state, relations, captures), relations, captures };
}

export async function observe(bindingPath, { sampleFn = sample, sleepFn = sleep, clock = Date.now, maxMs = maximumMs, interval = intervalMs } = {}) {
  const binding = readJson(bindingPath), directory = path.dirname(bindingPath);
  checkBinding(binding, directory);
  const lock = path.join(directory, 'observer.lock.json');
  // Exclusive claim remains as provenance after exit; no implicit recovery or second observer.
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), startedAtUtc: now() }) + '\n', { flag: 'wx' });
  const observer = { pid: process.pid, host: os.hostname(), startedAtUtc: now(), deadlineAtUtc: new Date(clock() + maxMs).toISOString() };
  const deadline = clock() + maxMs;
  let stableSamples = 0, previous = null, last = null, diagnostics = [], diagnosticDetails = [];
  while (clock() < deadline) {
    try {
      const value = sampleFn(binding);
      last = value.snapshot;
      diagnostics = last.issues;
      diagnosticDetails = (last.taskErrors ?? []).map(error => ({ reader: 'session-task', ...error }));
      stableSamples = last.ready || last.settledIncomplete ? (previous === last.fingerprint ? stableSamples + 1 : 1) : 0;
      previous = last.fingerprint;
      const settled = stableSamples >= 3;
      const status = last.interrupted ? 'interrupted' : settled ? last.ready ? 'observed-complete' : 'incomplete' : last.ready ? 'observing' : 'pending';
      // Snapshots contain only allowlisted metadata and usage records.
      atomicWrite(path.join(directory, 'captures.json'), { relations: value.relations, captures: value.captures });
      writeReport(directory, binding, { status, snapshot: last, diagnostics, diagnosticDetails, stableSamples, observer });
      if (settled || last.interrupted) return status;
    } catch (error) {
      stableSamples = 0; previous = null; diagnostics = [error.message];
      diagnosticDetails = error.diagnostics ?? [errorDetail('observer', error)];
      // A partial append / not-yet-persisted child can settle on the next sample.
      writeReport(directory, binding, { status: 'observing', snapshot: last, diagnostics, diagnosticDetails, stableSamples, observer });
    }
    await sleepFn(interval);
  }
  writeReport(directory, binding, { status: 'incomplete', snapshot: last,
    diagnostics: [...diagnostics, '已達收集期限；保留已觀察資料，未宣告完整用量。'], diagnosticDetails, stableSamples, observer });
  return 'incomplete';
}

export async function start({ workspaceRoot, runStatePath }, { environment = process.env, launch = launchObserver } = {}) {
  const located = locate({ workspaceRoot, runStatePath });
  const { statePath, workspace, directory, identity, runIdentifier } = located;
  const bindingPath = path.join(directory, 'binding.json');
  if (fs.existsSync(directory)) {
    const existing = readJson(bindingPath);
    checkBinding(existing, directory);
    if (existing.scope?.rootThreadId !== environment.CODEX_THREAD_ID) throw new Error('既有用量 binding 與目前 thread 不符');
    if (existing.scope && activeRootTurn(collect({ sessionsRoot: existing.sessionsRoot, threadId: existing.scope.rootThreadId, workspaceRoot: workspace })) !== existing.scope.rootTurnIds[0]) throw new Error('既有用量 binding 與目前 root turn 不符');
    return link({ workspaceRoot, runStatePath });
  }
  const parent = path.dirname(directory);
  fs.mkdirSync(parent, { recursive: true });
  if (fs.realpathSync(parent) !== path.resolve(parent)) throw new Error('用量父目錄不能使用連結');
  fs.mkdirSync(directory);
  const binding = { schemaVersion: 1, workflow: OWNER, runIdentifier, runIdentity: identity, directory,
    workspaceRoot: workspace, runStatePath: statePath, createdAtUtc: now(), scope: null };
  let diagnostic = null, diagnosticDetails = [];
  try {
    const rootThreadId = environment.CODEX_THREAD_ID;
    if (!uuid.test(rootThreadId ?? '')) throw new Error('缺少 CODEX_THREAD_ID，無法綁定目前主代理');
    const codexHome = path.resolve(environment.CODEX_HOME || path.join(os.homedir(), '.codex'));
    binding.sessionsRoot = path.join(codexHome, 'sessions');
    const capture = collect({ sessionsRoot: binding.sessionsRoot, threadId: rootThreadId, workspaceRoot: workspace });
    binding.scope = { workflowId: runIdentifier, rootThreadId, rootTurnIds: [activeRootTurn(capture)] };
    binding.databasePath = databaseIn(codexHome);
    discover({ databasePath: binding.databasePath, rootThreadId });
  } catch (error) { diagnostic = error.message; diagnosticDetails = error.diagnostics ?? [errorDetail('startup', error)]; }
  fs.writeFileSync(bindingPath, JSON.stringify(binding, null, 2) + '\n', { flag: 'wx' });
  writeReport(directory, binding, { status: diagnostic ? 'unsupported' : 'pending', diagnostics: diagnostic ? [diagnostic] : [], diagnosticDetails });
  if (!diagnostic) {
    try {
      const child = await launch(bindingPath);
      atomicWrite(path.join(directory, 'launch.json'), { pid: child.pid, host: os.hostname(), launchedAtUtc: now() });
    } catch (error) { writeReport(directory, binding, { status: 'failed', diagnostics: [`背景程序啟動失敗：${error.message}`] }); }
  }
  return link({ workspaceRoot, runStatePath });
}

export function launchObserver(bindingPath, { spawnFn = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let stderrFd;
    const release = () => { if (stderrFd !== undefined) { fs.closeSync(stderrFd); stderrFd = undefined; } };
    try {
      const binding = readJson(bindingPath), directory = path.dirname(bindingPath);
      checkBinding(binding, directory);
      stderrFd = fs.openSync(path.join(directory, 'observer.stderr.log'), 'wx');
      const child = spawnFn(process.execPath, [self, 'observe', '--binding', bindingPath], {
        cwd: binding.workspaceRoot, detached: true, windowsHide: true, stdio: ['ignore', 'ignore', stderrFd],
      });
      child.once('error', error => { release(); reject(error); });
      child.once('spawn', () => { release(); child.unref(); resolve({ pid: child.pid }); });
    } catch (error) { release(); reject(error); }
  });
}

export function recordObserverFailure(bindingPath, error) {
  // Best effort only; stderr still carries the failure if this write is unavailable.
  try {
    const binding = readJson(bindingPath), directory = path.dirname(bindingPath);
    checkBinding(binding, directory);
    fs.writeFileSync(path.join(directory, 'observer-exit.json'), JSON.stringify({
      pid: process.pid, exitedAtUtc: now(), exitCode: 1,
      code: typeof error.code === 'string' ? error.code : null, message: String(error.message ?? error).slice(0, 4000),
    }, null, 2) + '\n', { flag: 'wx' });
  } catch { /* Do not replace the original error or overwrite earlier evidence. */ }
}

export function link({ workspaceRoot, runStatePath }) {
  const { directory } = locate({ workspaceRoot, runStatePath });
  const binding = readJson(path.join(directory, 'binding.json'));
  const state = checkBinding(binding, directory);
  let status = readJson(path.join(directory, 'status.json'));
  if (['pending', 'observing'].includes(status.measurementStatus)
    || (status.measurementStatus === 'failed' && status.label === '用量收集程序已停止')) {
    const launchPath = path.join(directory, 'launch.json');
    const observer = status.observer ?? (fs.existsSync(launchPath) ? readJson(launchPath) : null);
    if (observer?.host === os.hostname() && !alive(observer.pid)) {
      const previous = readJson(path.join(directory, 'report.json'));
      const end = Date.parse(state.overallWallClock?.end);
      const closed = Number.isFinite(end) && end >= Date.parse(state.overallWallClock.start)
        && ['blocked', 'failed', 'completed', 'pass', 'pass_with_warnings', 'completed_with_known_environment_exception'].includes(state.terminalDecision);
      const decision = closed ? state.terminalDecision : null;
      if (status.measurementStatus === 'failed' && previous.workflowTerminalDecision === decision) return reportLink(directory, status);
      const diagnostics = previous.diagnostics.map(message => message.replace(/^最後一次觀測：/, ''))
        .filter(message => !['背景程序已停止，未完成收集。', '已保存程序失敗紀錄。', '未保存可確認的程序退出原因。'].includes(message))
        .filter(message => !closed || message !== 'workflow-not-closed')
        .map(message => `最後一次觀測：${message}`);
      let exit = null;
      try {
        const saved = readJson(path.join(directory, 'observer-exit.json'));
        if (saved.pid === observer.pid && saved.exitCode === 1 && Number.isFinite(Date.parse(saved.exitedAtUtc))
          && typeof saved.message === 'string' && (saved.code === null || typeof saved.code === 'string')) {
          exit = { reader: 'observer-exit', exitCode: saved.exitCode, code: saved.code, message: saved.message.slice(0, 4000) };
        }
      } catch { /* Abrupt termination can leave no exit record; its cause stays unknown. */ }
      // Preserve the last observed data; delivery must not erase partial evidence.
      const stopped = { ...previous, measurementStatus: 'failed', label: '用量收集程序已停止', updatedAtUtc: now(), usage: null,
        workflowTerminalDecision: decision,
        diagnostics: [...diagnostics, '背景程序已停止，未完成收集。', exit ? '已保存程序失敗紀錄。' : '未保存可確認的程序退出原因。'],
        diagnosticDetails: [...(previous.diagnosticDetails ?? []).filter(detail => detail.reader !== 'observer-exit'), ...(exit ? [exit] : [])] };
      atomicWrite(path.join(directory, 'report.json'), stopped);
      const html = renderHtml(stopped);
      atomicWrite(path.join(directory, 'report.html'), html);
      status = { ...status, measurementStatus: 'failed', label: stopped.label, updatedAtUtc: stopped.updatedAtUtc,
        diagnostics: stopped.diagnostics, diagnosticDetails: stopped.diagnosticDetails,
        htmlSha256: hash(html), reportSha256: hash(JSON.stringify(stopped, null, 2) + '\n') };
      atomicWrite(path.join(directory, 'status.json'), status);
    }
  }
  return reportLink(directory, status);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--workspace-root', '--run-state', '--binding'].includes(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i])) throw new Error('用量工具參數無效或重複');
    options[args[i]] = args[i + 1];
  }
  const workspaceRoot = options['--workspace-root'], runStatePath = options['--run-state'];
  if (command === 'observe') {
    if (!options['--binding'] || Object.keys(options).length !== 1) throw new Error('observe 需要 --binding');
    const binding = readJson(options['--binding']);
    if (fs.realpathSync(self) !== fs.realpathSync(path.join(binding.workspaceRoot, '.codex/scripts/dotnet-testing-codex-full', `${OWNER}-runtime`, 'usage-observer.mjs'))) throw new Error('runtime 與 binding workspace 不符');
    try { await observe(options['--binding']); }
    catch (error) { recordObserverFailure(options['--binding'], error); throw error; }
  } else if (['start', 'link'].includes(command)) {
    if (Object.keys(options).length !== 2 || !workspaceRoot || !runStatePath) throw new Error('start/link 需要 --workspace-root 與 --run-state');
    if (fs.realpathSync(self) !== fs.realpathSync(path.join(workspaceRoot, '.codex/scripts/dotnet-testing-codex-full', `${OWNER}-runtime`, 'usage-observer.mjs'))) throw new Error('runtime 與 workspace 不符');
    console.log(JSON.stringify(command === 'start' ? await start({ workspaceRoot, runStatePath }) : link({ workspaceRoot, runStatePath })));
  } else throw new Error('用量工具只支援 start、observe、link');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
