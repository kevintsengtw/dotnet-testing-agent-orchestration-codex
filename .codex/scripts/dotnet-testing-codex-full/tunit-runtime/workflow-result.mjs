#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { link as usageReportLink, validateWorkspace } from "./usage-observer.mjs";

export const TUNIT_SECTION_HEADINGS = [
  "測試結果總覽",
  "情境覆蓋",
  "Reviewer 結論",
  "修正、異常與交付",
  "各階段耗時",
  "Timing Evidence",
  "Profiling Summary",
];

const PHASES = ["analyzer", "writer", "executor", "reviewer"];
const ACCEPTED_SCENARIOS = new Set(["accepted", "accepted_with_normalization", "accepted_with_limitation"]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function integer(value) {
  return Number.isInteger(value) ? value : null;
}

function text(value, fallback = "未取得") {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  return String(value).replaceAll(/\r?\n/gu, " ").replaceAll("|", "\\|");
}

function list(value, fallback = "無") {
  const values = array(value).map((item) => text(item, "")).filter(Boolean);
  return values.length > 0 ? values.join(", ") : fallback;
}

function item(value) {
  if (value === null || value === undefined) return "未取得";
  if (typeof value !== "object") return text(value);
  const preferred = [value.id, value.severity, value.title, value.description, value.recommendation]
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== "");
  if (preferred.length > 0) return preferred.map((part) => text(part)).join("；");
  return text(JSON.stringify(value));
}

function items(value) {
  const values = array(value);
  return values.length > 0 ? values.map(item).join("<br>") : "無";
}

function duration(durationMs) {
  if (!Number.isInteger(durationMs) || durationMs < 0) return "未取得";
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = ((durationMs % 60_000) / 1000).toFixed(3).replace(/\.000$/u, "");
  return `${minutes} 分 ${seconds} 秒（${durationMs.toLocaleString("en-US")} ms）`;
}

function resolveArtifactPath(statePath, artifactPath) {
  return path.isAbsolute(artifactPath)
    ? path.normalize(artifactPath)
    : path.resolve(path.dirname(path.resolve(statePath)), artifactPath);
}

function readJson(filePath, description) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${description} must be readable JSON: ${filePath} (${error.message})`);
  }
}

function targetAssignments(runState, phaseName, target) {
  return array(runState.phases?.[phaseName]?.assignments).filter((assignment) => assignment?.target === target);
}

function readTargetArtifact(statePath, runState, phaseName, target) {
  const assignments = targetAssignments(runState, phaseName, target);
  if (assignments.length === 0) return { artifact: null, path: null, assignment: null };
  if (assignments.length !== 1) {
    throw new Error(`${phaseName} must contain exactly one assignment for ${target}`);
  }
  const assignment = assignments[0];
  if (assignment.artifact === null || assignment.artifact === undefined) {
    return { artifact: null, path: null, assignment };
  }
  if (typeof assignment.artifact !== "string" || assignment.artifact.trim() === "") {
    throw new Error(`${phaseName} artifact path must be a non-empty string for ${target}`);
  }
  const artifactPath = resolveArtifactPath(statePath, assignment.artifact);
  return {
    artifact: readJson(artifactPath, `${phaseName} artifact`),
    path: assignment.artifact,
    assignment,
  };
}

function observedPhaseDuration(runState, phaseName) {
  const finalized = runState.phaseDurations?.[phaseName]?.durationMs;
  if (Number.isInteger(finalized) && finalized >= 0) return finalized;
  const phase = runState.phases?.[phaseName];
  const completedAt = Date.parse(phase?.completedAt);
  const issued = array(phase?.assignments).map((assignment) => Date.parse(assignment?.dispatchIssuedAt));
  if (Number.isNaN(completedAt) || issued.length === 0 || issued.some(Number.isNaN)) return null;
  const value = completedAt - Math.min(...issued);
  return value >= 0 ? value : null;
}

function buildTiming(runState) {
  return {
    overall: {
      start: runState.overallWallClock?.start ?? null,
      end: runState.overallWallClock?.end ?? null,
      durationMs: integer(runState.overallWallClock?.durationMs),
    },
    phases: Object.fromEntries(PHASES.map((phaseName) => {
      const phase = runState.phases?.[phaseName] ?? {};
      return [phaseName, {
        durationMs: observedPhaseDuration(runState, phaseName),
        completedAt: phase.completedAt ?? null,
        assignments: array(phase.assignments).map((assignment) => ({
          assignmentId: assignment.assignmentId ?? null,
          target: assignment.target ?? null,
          dispatchIssuedAt: assignment.dispatchIssuedAt ?? null,
          artifactReadyAt: assignment.artifactReadyAt ?? null,
          completedAt: assignment.completedAt ?? null,
          timingNote: assignment.timingNote ?? null,
        })),
      }];
    })),
  };
}

function buildTarget(statePath, runState, target) {
  const evidence = Object.fromEntries(PHASES.map((phaseName) => [
    phaseName,
    readTargetArtifact(statePath, runState, phaseName, target),
  ]));
  const analysis = evidence.analyzer.artifact;
  const writer = evidence.writer.artifact;
  const execution = evidence.executor.artifact;
  const review = evidence.reviewer.artifact;
  const effectiveScenarios = array(analysis?.scenarioCatalog).filter((scenario) => ACCEPTED_SCENARIOS.has(scenario?.status));
  const implementedIds = new Set(array(writer?.scenarioCoverage)
    .filter((entry) => entry?.status === "implemented")
    .map((entry) => entry.scenarioId));
  const userCoverage = review?.userScenarioCoverage ?? {};
  return {
    target,
    methods: array(analysis?.methodsToTest),
    dependencies: [...new Set(array(analysis?.targetClasses)
      .flatMap((targetClass) => array(targetClass?.dependencies))
      .map((dependency) => dependency?.type)
      .filter(Boolean))],
    tests: {
      files: array(writer?.testFilePaths),
      methodCount: integer(writer?.testMethodCount),
      caseCount: integer(writer?.testCaseCount),
    },
    scenarios: {
      effective: effectiveScenarios.length,
      implemented: effectiveScenarios.filter((scenario) => implementedIds.has(scenario.scenarioId)).length,
      missingIds: effectiveScenarios.filter((scenario) => !implementedIds.has(scenario.scenarioId)).map((scenario) => scenario.scenarioId),
      userProvided: integer(userCoverage.providedScenarioCount),
      userEffective: integer(userCoverage.effectiveScenarioCount),
      userImplemented: integer(userCoverage.implementedScenarioCount),
      userMissingIds: array(userCoverage.missingScenarioIds),
      userDataMismatchIds: array(userCoverage.dataMismatchScenarioIds),
      userCoverageComplete: typeof userCoverage.coverageComplete === "boolean" ? userCoverage.coverageComplete : null,
    },
    execution: {
      executionMethod: execution?.executionMethod ?? null,
      engineMode: execution?.engineMode ?? null,
      total: integer(execution?.totalTests),
      passed: integer(execution?.passedTests),
      failed: integer(execution?.failedTests),
      skipped: integer(execution?.skippedTests),
      fixRounds: integer(execution?.fixRounds),
      fixHistory: array(execution?.fixHistory),
      attempts: integer(execution?.executionAttempts),
    },
    review: {
      score: review?.overallScore ?? null,
      gateDecision: review?.gateDecision ?? null,
      summary: review?.summary ?? null,
      issues: array(review?.issues),
      missingTestCases: array(review?.missingTestCases),
      positives: array(review?.positives),
    },
    skills: array(writer?.skillsLoaded),
    artifacts: Object.fromEntries(PHASES.map((phaseName) => [phaseName, evidence[phaseName].path])),
  };
}

export function buildTunitWorkflowResult(runState, options = {}) {
  if (!runState || runState.workflow !== "tunit") throw new Error("TUnit workflow result requires workflow=tunit run-state");
  if (typeof options.statePath !== "string" || !options.statePath.trim()) throw new Error("statePath is required");
  if (typeof runState.terminalDecision !== "string" || !runState.terminalCloseout || !runState.profilingSummary) {
    throw new Error("TUnit workflow result requires deterministic finalize truth");
  }
  const targets = array(runState.targets).length > 0 ? runState.targets : [runState.target].filter(Boolean);
  if (targets.length === 0) throw new Error("TUnit workflow result requires at least one target");
  return {
    schemaVersion: 1,
    workflow: "tunit",
    decision: runState.terminalDecision ?? null,
    lifecycle: runState.terminalCloseout?.lifecycle ?? null,
    targetOrder: targets,
    targets: targets.map((target) => buildTarget(options.statePath, runState, target)),
    timing: buildTiming(runState),
    profiling: runState.profilingSummary ?? null,
    terminalCloseout: runState.terminalCloseout ?? null,
  };
}

function renderOverview(result) {
  const rows = result.targets.map((target) => `| ${text(target.target)} | ${list(target.tests.files)} | ${list(target.methods)} | ${target.tests.methodCount ?? "未取得"} | ${target.tests.caseCount ?? "未取得"} | ${text(target.execution.executionMethod)} / ${text(target.execution.engineMode)} | ${text(target.review.score)} |`);
  const executionRows = result.targets.map((target) => `| ${text(target.target)} | ${target.execution.total ?? "未取得"} | ${target.execution.passed ?? "未取得"} | ${target.execution.failed ?? "未取得"} | ${target.execution.skipped ?? "未取得"} | ${text(target.review.gateDecision)} |`);
  return [
    "## 測試結果總覽", "",
    "| Target | 測試檔案 | 方法範圍 | 測試方法數 | 執行案例數 | 執行方式 / Engine | Reviewer 評分 |",
    "|---|---|---|---:|---:|---|---|", ...rows, "",
    "| Target | Total | Passed | Failed | Skipped | Gate decision |",
    "|---|---:|---:|---:|---:|---|", ...executionRows, "",
  ];
}

function renderScenarios(result) {
  return [
    "## 情境覆蓋", "",
    "| Target | Effective scenarios | Implemented | Missing | User provided | User effective | User implemented | User coverage complete |",
    "|---|---:|---:|---:|---:|---:|---:|---|",
    ...result.targets.map((target) => `| ${text(target.target)} | ${target.scenarios.effective} | ${target.scenarios.implemented} | ${target.scenarios.missingIds.length} | ${target.scenarios.userProvided ?? "未取得"} | ${target.scenarios.userEffective ?? "未取得"} | ${target.scenarios.userImplemented ?? "未取得"} | ${text(target.scenarios.userCoverageComplete)} |`),
    "",
    ...result.targets.flatMap((target) => [
      `${text(target.target)} missing scenario IDs: ${list(target.scenarios.missingIds)}`,
      `${text(target.target)} user missing IDs: ${list(target.scenarios.userMissingIds)}`,
      `${text(target.target)} user data mismatch IDs: ${list(target.scenarios.userDataMismatchIds)}`,
      "",
    ]),
  ];
}

function renderReview(result) {
  return [
    "## Reviewer 結論", "",
    "| Target | Gate decision | Summary | Issues | Missing test cases |",
    "|---|---|---|---|---|",
    ...result.targets.map((target) => `| ${text(target.target)} | ${text(target.review.gateDecision)} | ${text(target.review.summary)} | ${items(target.review.issues)} | ${items(target.review.missingTestCases)} |`),
    "",
  ];
}

function renderDelivery(result) {
  return [
    "## 修正、異常與交付", "",
    "### 使用的技術組合", "",
    "| Target | Loaded skills |", "|---|---|",
    ...result.targets.map((target) => `| ${text(target.target)} | ${list(target.skills)} |`), "",
    "### Executor 修正紀錄", "",
    "| Target | Fix rounds | Attempts | Fix history |", "|---|---:|---:|---|",
    ...result.targets.map((target) => `| ${text(target.target)} | ${target.execution.fixRounds ?? "未取得"} | ${target.execution.attempts ?? "未取得"} | ${items(target.execution.fixHistory)} |`), "",
    "### 交付產物", "",
    ...result.targets.flatMap((target) => [
      `- ${text(target.target)} test files: ${list(target.tests.files)}`,
      ...Object.entries(target.artifacts).map(([phaseName, artifactPath]) => `- ${text(target.target)} ${phaseName}: ${artifactPath ? `\`${artifactPath}\`` : "未產生"}`),
    ]), "",
  ];
}

function renderTiming(result) {
  return [
    "## 各階段耗時", "",
    "| 階段 | 耗時 |", "|---|---:|",
    ...PHASES.map((phaseName, index) => `| 階段 ${index + 1} ${phaseName[0].toUpperCase()}${phaseName.slice(1)} | ${duration(result.timing.phases[phaseName].durationMs)} |`),
    `| **整體 wall-clock** | **${duration(result.timing.overall.durationMs)}** |`, "",
  ];
}

function renderTimingEvidence(result) {
  const rows = PHASES.flatMap((phaseName) => {
    const assignments = result.timing.phases[phaseName].assignments;
    return assignments.length > 0
      ? assignments.map((assignment) => `| ${phaseName} | ${text(assignment.target)} | ${text(assignment.assignmentId)} | ${text(assignment.dispatchIssuedAt)} | ${text(assignment.artifactReadyAt)} | ${text(assignment.completedAt)} | ${text(assignment.timingNote, "")} |`)
      : [`| ${phaseName} | 未派發 | 未派發 | 未派發 | 未派發 | 未派發 | 未派發 |`];
  });
  return [
    "## Timing Evidence", "", "Source: `.orchestrator/run-state.json`", "",
    "| Phase | Target | Assignment | Dispatch issued | Artifact ready | Completed | Note |",
    "|---|---|---|---|---|---|---|", ...rows, "",
  ];
}

function renderProfiling(result) {
  const profiling = result.profiling ?? {};
  const breakdown = profiling.bottleneckBreakdown ?? {};
  return [
    "## Profiling Summary", "",
    "| Field | Value |", "|---|---|",
    `| timingSource | ${text(profiling.timingSource)} |`,
    `| bottleneck | ${text(profiling.bottleneck)} |`,
    `| phaseDurationMs | ${breakdown.phaseDurationMs ?? "未取得"} |`,
    `| assignmentId | ${text(breakdown.assignmentId)} |`,
    `| dispatchAcceptLatencyMs | ${breakdown.dispatchAcceptLatencyMs ?? "未取得"} |`,
    `| produceSpanMs | ${breakdown.produceSpanMs ?? "未取得"} |`,
    `| redispatchWaitMs | ${breakdown.redispatchWaitMs ?? "未取得"} |`,
    `| observability | ${text(breakdown.observability)} |`,
    `| rootCauseCandidate | ${text(profiling.rootCauseCandidate)} |`,
    `| deferredOptimization | ${text(profiling.deferredOptimization)} |`, "",
  ];
}

function renderUsageDelivery(delivery) {
  if (!delivery) return [];
  if (delivery.status === "unavailable") return [
    "### HTML token-usage report", "",
    `HTML token-usage report：未產生（${text(delivery.reason)}）`, "",
  ];
  return [
    "### HTML token-usage report", "",
    delivery.markdown, "",
    "可複製網址：", "",
    "```text", delivery.fileUrl, "```", "",
    `目前狀態：\`${text(delivery.status)}\`（${text(delivery.label)}）。`, "",
    `工具回傳 note：${delivery.note}`, "",
  ];
}

export function renderTunitWorkflowResult(result) {
  return [
    "# TUnit workflow result", "",
    `Decision: ${text(result.decision)}`, "",
    `Lifecycle: ${text(result.lifecycle)}`, "",
    ...renderOverview(result),
    ...renderScenarios(result),
    ...renderReview(result),
    ...renderDelivery(result),
    ...renderTiming(result),
    ...renderTimingEvidence(result),
    ...renderProfiling(result),
    ...renderUsageDelivery(result.usageDelivery),
  ].join("\n");
}

export function renderTunitPhaseCompletion(runState, phaseName, artifact) {
  if (!PHASES.includes(phaseName)) throw new Error(`unknown TUnit phase: ${phaseName}`);
  const elapsed = duration(observedPhaseDuration(runState, phaseName));
  const artifacts = Array.isArray(artifact) ? artifact.filter(Boolean) : [artifact].filter(Boolean);
  const phaseNumber = PHASES.indexOf(phaseName) + 1;
  const phaseStatus = runState.phases?.[phaseName]?.status ?? "unknown";
  if (phaseStatus !== "completed") {
    const marker = phaseStatus === "blocked" ? "⛔" : "❌";
    const label = phaseStatus === "blocked" ? "已阻擋" : phaseStatus === "failed" ? "失敗" : `狀態異常（${phaseStatus}）`;
    return `${marker} 階段 ${phaseNumber} ${label}（${elapsed}）— run-state status: ${phaseStatus}`;
  }
  if (artifacts.length === 0) {
    return `❌ 階段 ${phaseNumber} 完成（${elapsed}）— canonical artifact 未取得`;
  }
  if (phaseName === "analyzer") {
    const dependencies = [...new Set(artifacts.flatMap((entry) => array(entry?.targetClasses)).flatMap((targetClass) => array(targetClass?.dependencies)).map((entry) => entry?.type).filter(Boolean))];
    const methods = artifacts.reduce((sum, entry) => sum + (integer(entry?.methodCount) ?? array(entry?.methodsToTest).length), 0);
    const skills = [...new Set(artifacts.flatMap((entry) => array(entry?.requiredSkills)))];
    return `✅ 階段 1 完成（${elapsed}）— 識別出 ${methods} 個方法、${dependencies.length} 個依賴，需要 [${list(skills)}]`;
  }
  if (phaseName === "writer") {
    const counts = artifacts.map((entry) => integer(entry?.testCaseCount));
    const total = counts.length > 0 && counts.every((value) => value !== null) ? counts.reduce((sum, value) => sum + value, 0) : "未取得";
    return `✅ 階段 2 完成（${elapsed}）— 已建立測試檔案，共 ${total} 個測試案例`;
  }
  if (phaseName === "executor") {
    const passed = artifacts.map((entry) => integer(entry?.passedTests));
    const failed = artifacts.map((entry) => integer(entry?.failedTests));
    const rounds = artifacts.map((entry) => integer(entry?.fixRounds));
    const passedTotal = passed.length > 0 && passed.every((value) => value !== null) ? passed.reduce((sum, value) => sum + value, 0) : "未取得";
    const failedTotal = failed.length > 0 && failed.every((value) => value !== null) ? failed.reduce((sum, value) => sum + value, 0) : "未取得";
    const roundTotal = rounds.length > 0 && rounds.every((value) => value !== null) ? rounds.reduce((sum, value) => sum + value, 0) : "未取得";
    if (artifacts.some((entry) => entry?.buildResult !== "success")) {
      return `❌ 階段 3 完成（${elapsed}）— 建置失敗，測試未執行`;
    }
    if (artifacts.some((entry) => entry?.testResult !== "passed") || failedTotal !== 0) {
      return `❌ 階段 3 完成（${elapsed}）— ${failedTotal} 個測試案例失敗，${passedTotal} 個通過，修正 ${roundTotal} 次`;
    }
    return `✅ 階段 3 完成（${elapsed}）— ${passedTotal} 個測試案例通過，修正 ${roundTotal} 次`;
  }
  const decisions = [...new Set(artifacts.map((entry) => entry?.gateDecision).filter(Boolean))];
  const decisionText = list(decisions, "未取得");
  if (decisions.includes("blocked")) return `⛔ 階段 4 完成（${elapsed}）— Reviewer gateDecision: ${decisionText}`;
  if (decisions.length === 0 || decisions.includes("fail")) return `❌ 階段 4 完成（${elapsed}）— Reviewer gateDecision: ${decisionText}`;
  return `✅ 階段 4 完成（${elapsed}）— Reviewer gateDecision: ${decisionText}`;
}

function writeNew(filePath, content) {
  const output = path.resolve(filePath);
  if (fs.existsSync(output)) throw new Error(`TUnit workflow result already exists: ${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, content);
}

function recordPresentation(statePath, jsonOutput, markdownOutput, terminalDecision) {
  const runState = readJson(statePath, "run-state");
  if (runState.workflow !== "tunit") throw new Error("presentation receipt requires workflow=tunit");
  if (runState.terminalDecision !== terminalDecision) {
    throw new Error("run-state terminalDecision changed while rendering");
  }
  if (runState.presentation?.status === "completed") {
    throw new Error("TUnit canonical presentation is already completed");
  }
  if (runState.presentation !== undefined && runState.presentation?.status !== "pending") {
    throw new Error("TUnit presentation state must be pending before rendering");
  }
  const digest = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  runState.presentation = {
    status: "completed",
    renderer: "tunit-runtime/workflow-result.mjs",
    renderedAt: new Date().toISOString(),
    terminalDecision,
    jsonOutput,
    jsonSha256: digest(jsonOutput),
    markdownOutput,
    markdownSha256: digest(markdownOutput),
  };
  fs.writeFileSync(statePath, `${JSON.stringify(runState, null, 2)}\n`);
}

function parseArgs(argv) {
  const result = { mode: "final" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "phase" || arg === "final") result.mode = arg;
    else if (arg === "--run-state") result.runState = argv[++index];
    else if (arg === "--phase") result.phase = argv[++index];
    else if (arg === "--json-output") result.jsonOutput = argv[++index];
    else if (arg === "--markdown-output") result.markdownOutput = argv[++index];
    else if (arg === "--workspace-root") result.workspaceRoot = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.runState) throw new Error("--run-state is required");
  const statePath = path.resolve(args.runState);
  if (args.workspaceRoot) validateWorkspace({ workspaceRoot: args.workspaceRoot, runStatePath: statePath });
  const runState = readJson(statePath, "run-state");
  if (args.mode === "phase") {
    if (!PHASES.includes(args.phase)) throw new Error("phase mode requires --phase analyzer|writer|executor|reviewer");
    const artifacts = array(runState.phases?.[args.phase]?.assignments).map((assignment) => (
      assignment?.artifact
        ? readJson(resolveArtifactPath(statePath, assignment.artifact), `${args.phase} artifact`)
        : null
    ));
    process.stdout.write(`${renderTunitPhaseCompletion(runState, args.phase, artifacts)}\n`);
    return;
  }
  if (!args.jsonOutput || !args.markdownOutput) throw new Error("final mode requires --json-output and --markdown-output");
  const result = buildTunitWorkflowResult(runState, { statePath });
  for (const output of [args.jsonOutput, args.markdownOutput].map((filePath) => path.resolve(filePath))) {
    if (fs.existsSync(output)) throw new Error(`TUnit workflow result already exists: ${output}`);
  }
  try {
    if (!args.workspaceRoot) throw new Error("未提供 canonical workspace-root；歷史現場沒有用量 binding。");
    result.usageDelivery = usageReportLink({ workspaceRoot: args.workspaceRoot, runStatePath: statePath });
  } catch (error) {
    result.usageDelivery = { status: "unavailable", reason: error.message };
  }
  const markdown = renderTunitWorkflowResult(result);
  const jsonOutput = path.resolve(args.jsonOutput);
  const markdownOutput = path.resolve(args.markdownOutput);
  writeNew(jsonOutput, `${JSON.stringify(result, null, 2)}\n`);
  writeNew(markdownOutput, markdown);
  recordPresentation(statePath, jsonOutput, markdownOutput, result.decision);
  process.stdout.write(`${markdown}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(`tunit workflow result error: ${error.message}`);
    process.exitCode = 1;
  }
}
