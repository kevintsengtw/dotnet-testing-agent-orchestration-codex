#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { link as usageReportLink } from './usage-observer.mjs';

export const ASPIRE_SECTION_HEADINGS = [
  '測試檔案連結', '執行結果摘要', 'Docker + Aspire 環境狀態', '品質審查摘要',
  '改善建議', '使用的 Skills 組合', 'Executor 修正紀錄', '各階段耗時摘要 + Timing Evidence',
];
const phases = ['analyzer', 'writer', 'executor', 'reviewer'];
const artifactDirectories = { analyzer: 'analysis', writer: 'writer-result', executor: 'executor-result', reviewer: 'reviewer-result' };
const exceptionDecision = 'completed_with_known_environment_exception';
const array = value => Array.isArray(value) ? value : [];
const text = value => value === null || value === undefined || value === '' ? '未提供'
  : String(value).replaceAll(/\r?\n/gu, ' ').replaceAll('|', '\\|');
const items = value => value === undefined || value === null ? '未提供'
  : array(value).length ? array(value).map(item => text(typeof item === 'object' ? JSON.stringify(item) : item)).join('<br>') : '無';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const within = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

function physicalPath(file) {
  let ancestor = path.resolve(file);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  return path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, path.resolve(file)));
}

function context(workspaceRoot, statePath) {
  if (!path.isAbsolute(workspaceRoot ?? '') || !path.isAbsolute(statePath ?? '')) throw new Error('workspace-root 與 run-state 必須為絕對路徑');
  const workspace = fs.realpathSync(workspaceRoot), state = fs.realpathSync(statePath);
  if (!within(workspace, state) || path.basename(state) !== 'run-state.json' || path.basename(path.dirname(state)) !== '.orchestrator') {
    throw new Error('run-state 必須位於本 workspace 的 .orchestrator');
  }
  return { workspace, statePath: state, root: path.dirname(state) };
}

function artifactPath(root, value, directory) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('canonical artifact 路徑未提供');
  const file = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  const allowed = path.join(root, directory);
  if (!within(allowed, file) || !within(allowed, fs.realpathSync(file))) throw new Error('canonical artifact 越出本次 phase 目錄');
  if (!fs.statSync(file).isFile()) throw new Error('canonical artifact 必須是檔案');
  return fs.realpathSync(file);
}

function readTarget(root, state, target, phase) {
  const assignments = array(state.phases?.[phase]?.assignments).filter(a => a.target === target);
  const paths = [...new Set(assignments.filter(a => a.artifact).map(a => artifactPath(root, a.artifact, artifactDirectories[phase])))];
  if (paths.length > 1) throw new Error(`${phase} canonical artifact 不唯一`);
  if (!paths.length) {
    const rejected = assignments.find(a => a.failure), failure = rejected?.failure ?? null;
    let rejectedPath = assignments.find(a => a.observedArtifactPath)?.observedArtifactPath;
    rejectedPath = rejectedPath ? artifactPath(root, rejectedPath, artifactDirectories[phase]) : null;
    let rejectedArtifact = null;
    if (phase === 'reviewer' && failure?.kind === 'reviewer-scenario-contract'
      && failure.evidencePath && rejected.expectedArtifactPath) {
      const file = artifactPath(root, failure.evidencePath, 'reviewer-result');
      if (file !== artifactPath(root, rejected.expectedArtifactPath, 'reviewer-result')) throw new Error('Reviewer 拒絕證據未對應本次 expected artifact');
      if (digest(file) !== failure.evidenceSha256) throw new Error('Reviewer 拒絕證據 SHA-256 不符');
      rejectedPath = file;
      try {
        const review = readJson(file);
        if (['fail', 'blocked'].includes(review?.gateDecision) && typeof review.overallRating === 'string'
          && review.overallRating.trim() && Number.isInteger(review.score) && review.score >= 0 && review.score <= 100
          && Array.isArray(review.issues)) rejectedArtifact = review;
      } catch { /* 無法解析的拒絕檔案只交付原始連結與 failure，不冒充審查資料。 */ }
    }
    return { path: null, artifact: null, dispatched: assignments.length > 0, rejectedPath, rejectedArtifact, failure };
  }
  return { path: paths[0], artifact: readJson(paths[0]), dispatched: true };
}

function reviewSummary(review) {
  const status = { pass: '審查通過', pass_with_warnings: '審查通過，保留警告', fail: '審查不通過', blocked: '審查受阻' }[review.gateDecision]
    ?? '審查狀態未提供';
  return `${status}（${text(review.gateDecision)}），評級 ${text(review.overallRating)}，分數 ${text(review.score)}`;
}

function verifyException(root, state, targets) {
  if (state.terminalDecision !== exceptionDecision) return;
  const qualified = state.knownEnvironmentException;
  if (state.lifecycle !== exceptionDecision || qualified?.status !== 'qualified' || !Number.isInteger(qualified.failedTests) || qualified.failedTests < 1) {
    throw new Error('環境例外必須保留 qualified 狀態與原始 failedTests');
  }
  const executionPath = artifactPath(root, qualified.executorArtifactPath, 'executor-result');
  const reviewPath = artifactPath(root, qualified.reviewerArtifactPath, 'reviewer-result');
  const target = targets.find(t => t.evidence.executor.path === executionPath && t.evidence.reviewer.path === reviewPath);
  if (!target) throw new Error('環境例外 paths 未對應本次 canonical artifacts');
  const execution = target.evidence.executor.artifact, review = target.evidence.reviewer.artifact;
  if (execution.testResult !== 'failed' || execution.failedTests !== qualified.failedTests
    || execution.knownEnvironmentException?.exceptionCode !== qualified.exceptionCode
    || review.knownEnvironmentExceptionReview?.status !== 'accepted') throw new Error('環境例外與 Executor／Reviewer truth 不一致');
  const validation = readJson(artifactPath(root, qualified.validationArtifactPath, ''));
  if (validation.status !== 'valid' || validation.knownEnvironmentExceptionQualified !== true || validation.terminalDecision !== exceptionDecision) {
    throw new Error('環境例外缺少本次機器資格驗證');
  }
}

export function buildAspireWorkflowResult(state, { workspaceRoot, statePath }) {
  const ctx = context(workspaceRoot, statePath);
  if (state?.workflow !== 'aspire' || !state.terminalDecision || !state.overallWallClock?.end || !state.profilingSummary) {
    throw new Error('Aspire renderer 需要已收尾的 aspire run-state');
  }
  const names = array(state.targets).length ? state.targets : [state.target];
  if (names.some(n => typeof n !== 'string' || !n.trim()) || new Set(names).size !== names.length) throw new Error('targets 必須明確且唯一');
  const targets = names.map(target => ({ target, evidence: Object.fromEntries(phases.map(phase => [phase, readTarget(ctx.root, state, target, phase)])) }));
  for (const target of targets) {
    const writer = target.evidence.writer.artifact;
    if (writer && (writer.writerTopology !== 'single' || writer.assignmentRole !== 'full')) throw new Error('Writer 必須是 single/full');
    if (['completed', 'pass', 'pass_with_warnings', exceptionDecision].includes(state.terminalDecision)
      && phases.some(phase => !target.evidence[phase].artifact)) throw new Error('完成結果缺少四角色 canonical artifacts');
  }
  verifyException(ctx.root, state, targets);
  return { schemaVersion: 1, workflow: 'aspire', decision: state.terminalDecision, lifecycle: state.lifecycle ?? null,
    runStatePath: ctx.statePath, targets, timing: { phases: state.phases, durations: state.phaseDurations, overall: state.overallWallClock },
    profiling: state.profilingSummary, knownEnvironmentException: state.knownEnvironmentException ?? null };
}

function duration(ms) {
  if (!Number.isInteger(ms) || ms < 0) return '未提供';
  return `${Math.floor(ms / 60000)} 分 ${((ms % 60000) / 1000).toFixed(3)} 秒`;
}

function heading(index) { return [`## ${index + 1}. ${ASPIRE_SECTION_HEADINGS[index]}`, '']; }
function targetHeading(target) { return [`### ${text(target.target)}`, '']; }
function table(entries) { return ['| 欄位 | 值 |', '| --- | --- |', ...entries.map(([name, value]) => `| ${name} | ${text(value)} |`), '']; }
function artifactLinks(target) {
  return phases.flatMap(phase => {
    const e = target.evidence[phase];
    return [`- ${phase}：${e.path ? `[canonical artifact](<${e.path.replaceAll('\\', '/')}>)` : e.dispatched ? '未提供合格 artifact' : '未派發'}`,
      ...(e.rejectedPath ? [`  原始拒絕檔案：[rejected artifact](<${e.rejectedPath.replaceAll('\\', '/')}>)`] : []),
      ...(e.failure?.evidencePath ? [`  拒絕證據：[gate evidence](<${e.failure.evidencePath.replaceAll('\\', '/')}>)`] : [])];
  });
}

export function renderAspirePhase(state, { workspaceRoot, statePath, phase }) {
  const ctx = context(workspaceRoot, statePath), index = phases.indexOf(phase), info = state.phases?.[phase];
  if (state.workflow !== 'aspire' || index < 0 || !info?.completedAt || !array(info.assignments).length) throw new Error('phase renderer requires an actual closed Aspire phase');
  const span = Date.parse(info.completedAt) - Math.min(...info.assignments.map(a => Date.parse(a.dispatchIssuedAt)));
  if (!Number.isInteger(span) || span < 0) throw new Error('phase duration lacks run-state boundaries');
  const seconds = Math.round(span / 1000), elapsed = `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  if (['blocked', 'failed'].includes(info.status)) {
    const failure = info.failure ?? info.assignments.find(a => a.failure)?.failure;
    if (!failure?.kind || !failure.message) throw new Error('blocked phase requires original failure truth');
    const reviews = phase === 'reviewer' ? [...new Set(info.assignments.map(a => a.target))].flatMap(target => {
      const evidence = readTarget(ctx.root, state, target, phase);
      const review = evidence.rejectedArtifact;
      return review ? [`${info.assignments.length > 1 ? `${text(target)}：` : ''}${reviewSummary(review)}（原始拒絕證據，未通過 gate）`] : [];
    }) : [];
    return `⚠ 階段 ${index + 1} 中止（${elapsed}）— ${text(failure.kind)}：${text(failure.message)}${reviews.length ? `；${reviews.join('；')}` : ''}`;
  }
  if (info.status !== 'completed') throw new Error('phase renderer requires completed or blocked/failed status');
  const targetNames = [...new Set(info.assignments.map(a => a.target))];
  const targets = targetNames.map(target => readTarget(ctx.root, state, target, phase));
  if (targets.some(t => !t.artifact)) throw new Error('completed phase lacks accepted canonical artifacts');
  const artifacts = targets.map(t => t.artifact), sum = field => {
    if (artifacts.some(a => !Number.isInteger(a[field]) || a[field] < 0)) throw new Error(`phase summary lacks ${field}`);
    return artifacts.reduce((n, a) => n + a[field], 0);
  };
  const prefix = `✅ 階段 ${index + 1} 完成（${elapsed}）`;
  if (phase === 'analyzer') return `${prefix} — 識別出 ${artifacts.reduce((n, a) => n + array(a.resourceCatalog).length, 0)} 個 Resource、${artifacts.reduce((n, a) => n + array(a.endpointCatalog).length, 0)} 個端點、${sum('scenarioCount')} 個測試情境，需要 [${[...new Set(artifacts.flatMap(a => array(a.requiredSkills)))].join('、')}]`;
  if (phase === 'writer') return `${prefix} — 已建立測試檔案，共 ${sum('testCaseCount')} 個測試案例`;
  if (phase === 'executor') {
    const sentence = `${elapsed}）— dotnet test：${sum('passedTests')} passed / ${sum('failedTests')} failed / ${sum('skippedTests')} skipped，修正 ${sum('fixRounds')} 次`;
    return `${artifacts.some(a => a.testResult !== 'passed') ? '⚠' : '✅'} 階段 3 完成（${sentence}`;
  }
  const reviewSummaries = artifacts.map((artifact, targetIndex) => {
    const summary = reviewSummary(artifact);
    return artifacts.length > 1 ? `${text(targetNames[targetIndex])}：${summary}` : summary;
  }).join('；');
  return artifacts.some(a => ['fail', 'blocked'].includes(a.gateDecision))
    ? `⚠ 階段 4 完成（${elapsed}）— 審查不通過；原因：${artifacts.map(a => text(a.gateDecision)).join('、')}；${reviewSummaries}`
    : `${prefix} — ${reviewSummaries}`;
}

export function renderAspireWorkflowResult(result) {
  const lines = ['# Aspire workflow result', '', `Terminal decision：\`${text(result.decision)}\`。`, ''];
  lines.push(...heading(0));
  for (const target of result.targets) {
    const writer = target.evidence.writer.artifact;
    lines.push(...targetHeading(target), ...[...new Set([...array(writer?.testFilePaths), ...array(writer?.infrastructureFiles)])]
      .map(file => `- [${path.basename(file)}](<${file.replaceAll('\\', '/')}>)`), ...artifactLinks(target), '');
    if (!writer) lines.push('測試檔案：未提供。', '');
  }
  lines.push(`run-state：[run-state.json](<${result.runStatePath.replaceAll('\\', '/')}>)`, '', ...heading(1));
  lines.push(`Terminal decision：\`${text(result.decision)}\``, '');
  for (const t of result.targets) for (const phase of phases) {
    const failure = t.evidence[phase].failure;
    if (failure) lines.push(`中止原因：${text(failure.kind)}；${text(failure.message)}`, '');
  }
  lines.push('| 目標 | Total | Passed | Failed | Skipped | testResult | executionMethod | --blame-hang-timeout |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const t of result.targets) {
    const e = t.evidence.executor.artifact;
    lines.push(`| ${text(t.target)} | ${[e?.totalTests, e?.passedTests, e?.failedTests, e?.skippedTests, e?.testResult, e?.executionMethod, e?.blameHangTimeout].map(text).join(' | ')} |`);
  }
  lines.push('', ...heading(2));
  for (const t of result.targets) {
    const e = t.evidence.executor.artifact, exception = e?.knownEnvironmentException;
    lines.push(...targetHeading(t), ...table([['dockerStatus', e?.dockerStatus], ['aspireWorkloadStatus', e?.aspireWorkloadStatus],
      ['targetServiceName', e?.targetServiceName], ['Resource readiness', e ? items(e.resourceReadinessEvidence) : null]]));
    lines.push('使用 `Aspire.AppHost.Sdk`／NuGet SDK 時，依既定契約可免安裝 Aspire workload；實際環境狀態以上述 Executor evidence 為準。', '');
    if (exception) {
      lines.push(...table([['exceptionCode', exception.exceptionCode], ['未通過 assertions', items(exception.failedAssertions)],
        ['failedTestDetails', items(e.failedTestDetails)], ['MSSQL', JSON.stringify(exception.mssql)],
        ['MSSQL 相依資源', items(exception.mssqlDependentResources)], ['非 MSSQL 資源', items(exception.nonMssqlResources)],
        ['API 相依阻擋', JSON.stringify(exception.bookingApi)]]));
      lines.push(...array(exception.evidenceFiles).map(file => `- [raw evidence](<${String(file).replaceAll('\\', '/')}>)`), '');
    }
  }
  lines.push(...heading(3));
  for (const t of result.targets) {
    const evidence = t.evidence.reviewer, r = evidence.artifact ?? evidence.rejectedArtifact;
    if (evidence.rejectedArtifact) lines.push('原始拒絕證據，未通過 gate；以下照錄 Reviewer 判定，不代表已接受 artifact。', '');
    lines.push(...targetHeading(t), ...table([['overallRating', r?.overallRating], ['score', r?.score], ['gateDecision', r?.gateDecision],
      ['關鍵發現', r ? items(r.issues) : null], ['endpointAcceptance', r?.endpointAcceptance ? JSON.stringify(r.endpointAcceptance) : null],
      ['scenarioAcceptance', r?.scenarioAcceptance ? JSON.stringify(r.scenarioAcceptance) : null],
      ['knownEnvironmentExceptionReview', r?.knownEnvironmentExceptionReview ? JSON.stringify(r.knownEnvironmentExceptionReview) : null]]));
  }
  lines.push(...heading(4));
  for (const t of result.targets) {
    const evidence = t.evidence.reviewer, r = evidence.artifact ?? evidence.rejectedArtifact;
    if (evidence.rejectedArtifact) lines.push('以下改善建議來自原始拒絕證據，未通過 gate。', '');
    lines.push(...targetHeading(t), ...table([['issues', r ? items(r.issues) : null], ['missingTestCases', r ? items(r.missingTestCases) : null]]));
  }
  lines.push(...heading(5));
  for (const t of result.targets) lines.push(`${text(t.target)}：${t.evidence.writer.artifact ? items(t.evidence.writer.artifact.skillsLoaded) : '未提供'}`, '');
  lines.push(...heading(6));
  for (const t of result.targets) {
    const e = t.evidence.executor.artifact;
    lines.push(...targetHeading(t), ...table([['fixRounds', e?.fixRounds], ['fixHistory', e ? items(e.fixHistory) : null],
      ['addedPackages', e ? items(e.addedPackages) : null], ['production／AppHost 修改紀錄', e ? items(e.productionBugFixes) : null]]));
    if (array(e?.productionBugFixes).length) lines.push('契約違反：Executor 記錄了 production／AppHost 修改。', '');
  }
  lines.push(...heading(7), '### 各階段耗時', '', '| 階段 | 耗時 |', '| --- | --- |');
  phases.forEach((phase, index) => lines.push(`| 階段 ${index + 1} ${phase[0].toUpperCase() + phase.slice(1)} | ${duration(result.timing.durations?.[phase]?.durationMs)} |`));
  lines.push(`| **總計** | **${duration(result.timing.overall.durationMs)}** |`, '', '### Timing Evidence', '',
    '| Phase | Source | dispatchIssuedAt | artifactReadyAt | completedAt | Notes |', '| --- | --- | --- | --- | --- | --- |');
  for (const phase of phases) {
    const assignments = array(result.timing.phases?.[phase]?.assignments);
    const phaseLabel = phase[0].toUpperCase() + phase.slice(1);
    if (!assignments.length) lines.push(`| ${phaseLabel} | \`.orchestrator/run-state.json\` | 未派發 | 未派發 | 未派發 | 未派發 |`);
    for (const a of assignments) lines.push(`| ${phaseLabel} | \`.orchestrator/run-state.json\` | ${text(a.dispatchIssuedAt)} | ${text(a.artifactReadyAt)} | ${text(a.completedAt)} | ${text(a.target)}／${text(a.assignmentId)}；${text(a.timingNote)} |`);
  }
  const profiling = result.profiling, breakdown = profiling.bottleneckBreakdown ?? {};
  const profilingEntries = [['timingSource', profiling.timingSource], ['bottleneck', profiling.bottleneck],
    ...['phaseDurationMs', 'assignmentId', 'dispatchAcceptLatencyMs', 'produceSpanMs', 'redispatchWaitMs', 'observability'].map(name => [name, breakdown[name]]),
    ['rootCauseCandidate', profiling.rootCauseCandidate], ['deferredOptimization', profiling.deferredOptimization]];
  lines.push('', '### Profiling Summary', '', '| Field | Value |', '|---|---|',
    ...profilingEntries.map(([name, value]) => `| ${name} | ${text(value)} |`), '', '### HTML token-usage report', '');
  const delivery = result.usageDelivery;
  if (!delivery || delivery.status === 'unavailable') lines.push(`HTML token-usage report：未產生（${text(delivery?.reason)}）`, '');
  else lines.push(delivery.markdown, '', '可複製網址：', '', '```text', delivery.fileUrl, '```', '',
    `目前狀態：\`${text(delivery.status)}\`（${text(delivery.label)}）。`, '', `工具回傳 note：${delivery.note}`, '');
  return lines.join('\n');
}

export function writeAspireWorkflowResult({ workspaceRoot, statePath, jsonOutput, markdownOutput }) {
  const ctx = context(workspaceRoot, statePath);
  const stateBytes = fs.readFileSync(ctx.statePath), state = readJson(ctx.statePath);
  if (state.presentation !== undefined && state.presentation.status !== 'pending') throw new Error('presentation 必須尚未完成；不得覆寫既有結果');
  const outputRoot = path.join(ctx.root, 'workflow-result');
  const outputs = [jsonOutput, markdownOutput];
  if (outputs.some(file => typeof file !== 'string' || !path.isAbsolute(file))) throw new Error('輸出必須位於本次 workflow-result 目錄');
  const normalizedOutputs = outputs.map(file => {
    const resolved = physicalPath(file);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  });
  if (new Set(normalizedOutputs).size !== 2) throw new Error('兩個輸出路徑必須不同');
  for (const file of outputs) {
    if (!path.isAbsolute(file ?? '') || !within(outputRoot, path.resolve(file)) || !within(outputRoot, physicalPath(file))) throw new Error('輸出必須位於本次 workflow-result 目錄');
    if (fs.existsSync(file)) throw new Error('輸出已存在；不得覆寫');
  }
  const result = buildAspireWorkflowResult(state, { workspaceRoot, statePath: ctx.statePath });
  try { result.usageDelivery = usageReportLink({ workspaceRoot, runStatePath: ctx.statePath }); }
  catch (error) { result.usageDelivery = { status: 'unavailable', reason: error.message }; }
  const markdown = renderAspireWorkflowResult(result);
  if (!fs.readFileSync(ctx.statePath).equals(stateBytes)) throw new Error('render 期間 run-state 已變更');
  for (const file of outputs) fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(jsonOutput, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(markdownOutput, markdown, { flag: 'wx' });
  state.presentation = { status: 'completed', renderer: 'aspire-runtime/workflow-result.mjs', renderedAt: new Date().toISOString(),
    terminalDecision: state.terminalDecision, jsonOutput, jsonSha256: digest(jsonOutput), markdownOutput, markdownSha256: digest(markdownOutput) };
  fs.writeFileSync(ctx.statePath, JSON.stringify(state, null, 2) + '\n');
  return markdown;
}

export function deliverAspireWorkflowResult({ workspaceRoot, statePath }) {
  const ctx = context(workspaceRoot, statePath);
  const stateBytes = fs.readFileSync(ctx.statePath), state = readJson(ctx.statePath);
  if (state.workflow !== 'aspire') throw new Error('deliver 只接受 Aspire run-state');
  const validator = path.join(ctx.workspace, '.codex/scripts/dotnet-testing-codex-full/run-state.mjs');
  if (!within(ctx.workspace, fs.realpathSync(validator))) throw new Error('receipt validator 必須位於本 workspace');
  const validation = spawnSync(process.execPath, [validator, 'validate', '--path', ctx.statePath,
    '--require-complete-timing', '--require-presentation'], { cwd: ctx.workspace, encoding: 'utf8' });
  if (validation.error || validation.status !== 0) {
    throw new Error(`deliver receipt validation 失敗：${validation.error?.message ?? validation.stderr + validation.stdout}`);
  }
  const receipt = state.presentation;
  const jsonFile = artifactPath(ctx.root, receipt.jsonOutput, 'workflow-result');
  const markdownFile = artifactPath(ctx.root, receipt.markdownOutput, 'workflow-result');
  const markdown = fs.readFileSync(markdownFile);
  if (!fs.readFileSync(ctx.statePath).equals(stateBytes) || digest(jsonFile) !== receipt.jsonSha256
    || createHash('sha256').update(markdown).digest('hex') !== receipt.markdownSha256) {
    throw new Error('deliver 驗證期間 receipt 或輸出已變更');
  }
  return markdown.toString('utf8');
}

function main() {
  const args = {};
  const argv = process.argv.slice(2), mode = ['phase', 'deliver'].includes(argv[0]) ? argv.shift() : 'final';
  const names = { '--workspace-root': 'workspaceRoot', '--run-state': 'statePath', '--json-output': 'jsonOutput', '--markdown-output': 'markdownOutput', '--phase': 'phase' };
  for (let index = 0; index < argv.length; index += 2) {
    const name = names[argv[index]];
    if (!name || !argv[index + 1] || Object.hasOwn(args, name)) throw new Error('Aspire renderer 參數無效或重複');
    args[name] = argv[index + 1];
  }
  if (fs.realpathSync(fileURLToPath(import.meta.url)) !== fs.realpathSync(path.join(args.workspaceRoot ?? '', '.codex/scripts/dotnet-testing-codex-full/aspire-runtime/workflow-result.mjs'))) {
    throw new Error('Aspire renderer 與 session workspace 必須一致');
  }
  if (mode === 'deliver') {
    if (Object.keys(args).some(name => !['workspaceRoot', 'statePath'].includes(name))) throw new Error('deliver 只接受 workspace-root 與 run-state');
    process.stdout.write(deliverAspireWorkflowResult(args));
  } else process.stdout.write((mode === 'phase' ? renderAspirePhase(readJson(args.statePath), args) : writeAspireWorkflowResult(args)) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
