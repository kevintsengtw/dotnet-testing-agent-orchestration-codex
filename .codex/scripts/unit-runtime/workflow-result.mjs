import { normalizeUnitArtifacts } from "./artifact-normalizer.mjs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function display(value, fallback) {
  return value === null || value === undefined ? fallback : String(value);
}

const phaseNames = ["analyzer", "writer", "executor", "reviewer"];

function array(value) {
  return Array.isArray(value) ? value : [];
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function sameDigest(filePath, seal) {
  if (!seal || typeof seal.sha256 !== "string" || !Number.isInteger(seal.size)) return false;
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath);
  return content.byteLength === seal.size
    && crypto.createHash("sha256").update(content).digest("hex") === seal.sha256;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveSealedArtifact(phase, orchestratorRoot, directory, target, suffix) {
  if (phase?.lifecycle !== "completed" || !phase.artifactSeal) return null;
  const candidates = [
    phase.artifact,
    orchestratorRoot ? path.join(orchestratorRoot, directory, `${target}.${suffix}.json`) : null,
  ].filter(Boolean).map((item) => path.resolve(item));
  return candidates.find((candidate) => (
    (!orchestratorRoot || isWithin(orchestratorRoot, candidate))
    && sameDigest(candidate, phase.artifactSeal)
  )) ?? null;
}

function normalizeTerminalExecution(evidence) {
  const counts = evidence.test?.counts ?? evidence.test ?? {};
  const metric = (value) => value && typeof value === "object"
    ? { ...value, percent: value.percent ?? null, threshold: value.threshold ?? null, met: value.met ?? null }
    : null;
  const notApplicable = evidence.coverage?.status === "not_applicable";
  return {
    build: { status: evidence.build?.status ?? "unavailable", warnings: evidence.build?.warnings ?? null },
    test: {
      status: evidence.test?.status ?? "unavailable",
      total: counts.total ?? null,
      passed: counts.passed ?? null,
      failed: counts.failed ?? null,
      skipped: counts.skipped ?? null,
    },
    coverage: notApplicable
      ? { status: "not_applicable", scope: null, line: null, branch: null, goalMet: null }
      : {
        status: evidence.coverage?.status === "unavailable"
          ? "unavailable"
          : (evidence.coverage ? "available" : "unavailable"),
        scope: evidence.coverage?.scope ?? null,
        line: metric(evidence.coverage?.line),
        branch: metric(evidence.coverage?.branch),
        goalMet: evidence.coverage?.goalMet ?? null,
      },
    attempt: evidence.attempt ?? null,
    evidencePaths: evidence.evidencePaths ?? null,
  };
}

function readTerminalExecution(targetState, target, orchestratorRoot) {
  const usesRepair = targetState.executorRepair?.lifecycle === "completed";
  const phase = usesRepair ? targetState.executorRepair : targetState.executor;
  const executorPath = resolveSealedArtifact(
    phase,
    orchestratorRoot,
    usesRepair ? "executor-repair-result" : "executor-result",
    target,
    usesRepair ? "executor-repair-result" : "executor-result",
  );
  if (!executorPath) return null;
  const executor = JSON.parse(fs.readFileSync(executorPath, "utf8"));
  if (typeof executor.finalExecutionEvidencePath !== "string" || !executor.finalExecutionEvidencePath.trim()) return null;
  const basename = path.basename(executor.finalExecutionEvidencePath);
  if (!/^attempt-\d+\.execution\.json$/iu.test(basename)) return null;
  const candidates = [
    path.resolve(executor.finalExecutionEvidencePath),
    orchestratorRoot ? path.join(orchestratorRoot, "execution-evidence", target, basename) : null,
  ].filter(Boolean);
  const evidencePath = candidates.find((candidate) => fs.existsSync(candidate)
    && (!orchestratorRoot || isWithin(orchestratorRoot, candidate)));
  if (!evidencePath) return null;
  return normalizeTerminalExecution(JSON.parse(fs.readFileSync(evidencePath, "utf8")));
}

function firstTimestamp(values) {
  return values.filter((value) => typeof value === "string" && value.length > 0)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
}

function lastTimestamp(values) {
  return values.filter((value) => typeof value === "string" && value.length > 0)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function normalizeTiming(runState, requiredPhaseNames = phaseNames) {
  if (!runState || typeof runState !== "object" || Array.isArray(runState)) {
    return {
      status: "unavailable",
      source: "run-state",
      reason: "run-state artifact 未提供",
      phases: Object.fromEntries(phaseNames.map((name) => [name, {
        durationMs: null, startAt: null, endAt: null, assignments: [], criticalAssignmentId: null,
      }])),
      overall: { startAt: null, endAt: null, durationMs: null },
    };
  }
  const phases = {};
  for (const name of phaseNames) {
    const phase = runState.phases?.[name] ?? {};
    const assignments = array(phase.assignments).map((assignment) => ({
      assignmentId: assignment.assignmentId ?? null,
      target: assignment.target ?? null,
      dispatchIssuedAt: assignment.dispatchIssuedAt ?? null,
      dispatchAcceptedAt: assignment.dispatchAcceptedAt ?? null,
      artifactReadyAt: assignment.artifactReadyAt ?? null,
      completedAt: assignment.completedAt ?? null,
      dispatchAcceptLatencyMs: finite(assignment.dispatchAcceptLatencyMs),
      produceSpanMs: finite(assignment.produceSpanMs),
      timingNote: assignment.timingNote ?? null,
    }));
    const critical = [...assignments]
      .filter((assignment) => Number.isFinite(assignment.produceSpanMs))
      .sort((left, right) => right.produceSpanMs - left.produceSpanMs)[0] ?? null;
    phases[name] = {
      durationMs: finite(runState.phaseDurations?.[name]?.durationMs),
      startAt: runState.phaseDurations?.[name]?.startAt
        ?? firstTimestamp(assignments.map((assignment) => assignment.dispatchIssuedAt)),
      endAt: runState.phaseDurations?.[name]?.endAt ?? phase.completedAt
        ?? lastTimestamp(assignments.map((assignment) => assignment.completedAt)),
      assignments,
      criticalAssignmentId: critical?.assignmentId ?? null,
    };
  }
  const complete = requiredPhaseNames.every((name) => Number.isFinite(phases[name].durationMs))
    && Number.isFinite(runState.overallWallClock?.durationMs);
  return {
    status: complete ? "available" : "incomplete",
    source: "run-state",
    reason: complete ? null : "run-state timing 欄位不完整",
    phases,
    overall: {
      startAt: runState.overallWallClock?.start ?? null,
      endAt: runState.overallWallClock?.end ?? null,
      durationMs: finite(runState.overallWallClock?.durationMs),
    },
  };
}

function normalizeProfiling(runState) {
  const profiling = runState?.profilingSummary;
  if (!profiling || typeof profiling !== "object" || Array.isArray(profiling)) {
    return {
      status: "unavailable", timingSource: "run-state", bottleneck: null,
      bottleneckBreakdown: {}, rootCauseCandidate: null, deferredOptimization: null,
      reason: "run-state profilingSummary 未提供",
    };
  }
  return {
    status: "available",
    timingSource: profiling.timingSource ?? "run-state",
    bottleneck: profiling.bottleneck ?? null,
    bottleneckBreakdown: profiling.bottleneckBreakdown ?? {},
    rootCauseCandidate: profiling.rootCauseCandidate ?? null,
    deferredOptimization: profiling.deferredOptimization ?? null,
    notes: profiling.notes ?? null,
    reason: null,
  };
}

function confidence(values) {
  const ranks = { unavailable: 0, low: 1, medium: 2, high: 3 };
  if (values.length === 0) return "unavailable";
  return values.sort((left, right) => (ranks[left] ?? 0) - (ranks[right] ?? 0))[0];
}

function normalizeTokenEstimate(tokenEstimate) {
  if (!tokenEstimate || typeof tokenEstimate !== "object" || Array.isArray(tokenEstimate)) {
    return {
      status: "unavailable", reason: "token estimate artifact 未提供", method: null,
      measurementScope: "subagent-visible-context", phases: {},
      summary: { input: null, output: null, total: null, confidence: "unavailable", range: null },
    };
  }
  const estimateKind = tokenEstimate.summary?.estimateKind;
  if (estimateKind !== "estimated") {
    return {
      status: "unavailable",
      reason: tokenEstimate.summary?.reason ?? "estimator failed or insufficient tokenEstimateInputs",
      method: tokenEstimate.estimator?.method ?? null,
      measurementScope: tokenEstimate.summary?.measurementScope ?? "subagent-visible-context",
      phases: {},
      summary: { input: null, output: null, total: null, confidence: "unavailable", range: null },
    };
  }
  const phases = {};
  for (const name of phaseNames) {
    const assignments = array(tokenEstimate.phases?.[name]?.assignments);
    phases[name] = {
      assignments: assignments.length,
      input: assignments.reduce((sum, item) => sum + (finite(item.inputEstimate?.subtotal) ?? 0), 0),
      output: assignments.reduce((sum, item) => sum + (finite(item.outputEstimate?.subtotal) ?? 0), 0),
      total: assignments.reduce((sum, item) => sum + (finite(item.totalEstimatedTokens) ?? 0), 0),
      confidence: confidence(assignments.map((item) => item.confidence ?? "unavailable")),
    };
  }
  return {
    status: "available",
    reason: null,
    method: tokenEstimate.estimator?.method ?? null,
    measurementScope: tokenEstimate.summary?.measurementScope ?? "subagent-visible-context",
    phases,
    summary: {
      input: finite(tokenEstimate.summary?.inputTokensEstimated),
      output: finite(tokenEstimate.summary?.outputTokensEstimated),
      total: finite(tokenEstimate.summary?.totalTokensEstimated),
      confidence: tokenEstimate.summary?.confidence ?? "unavailable",
      range: tokenEstimate.summary?.range ?? null,
    },
  };
}

export function buildUnitWorkflowResult(artifacts, options = {}) {
  const normalized = normalizeUnitArtifacts(artifacts);
  const runState = options.runState ?? artifacts.runState ?? null;
  const tokenEstimate = options.tokenEstimate ?? artifacts.tokenEstimate ?? null;
  const targetState = options.workflowState?.targets?.[normalized.core.target] ?? null;
  return {
    schemaVersion: 2,
    decision: normalized.decision,
    target: normalized.core.target,
    scenarios: normalized.core.scenario,
    testFiles: normalized.core.files,
    testFilesStatus: "available",
    execution: {
      build: {
        status: normalized.core.build,
        warnings: artifacts.execution?.build?.warnings ?? null,
      },
      test: normalized.core.test,
      coverage: normalized.coverage,
      attempt: artifacts.execution?.attempt ?? null,
      evidencePaths: artifacts.execution?.evidencePaths ?? null,
    },
    coverageDecision: targetState?.coverageDecision ?? normalized.coverageDecision,
    coverageDecisionHistory: targetState?.coverageDecisionHistory ?? [normalized.coverageDecision],
    releaseEligible: targetState?.releaseEligible ?? normalized.coverageDecision.releaseEligible,
    review: {
      qualityDecision: normalized.core.quality,
      grade: artifacts.review?.overallScore ?? artifacts.review?.grade ?? null,
      score: artifacts.review?.score ?? null,
      issues: normalized.issues,
      missingTestCases: normalized.missingTestCases,
      observations: array(artifacts.review?.observations),
    },
    timing: normalizeTiming(runState),
    profiling: normalizeProfiling(runState),
    estimatedTokenUsage: normalizeTokenEstimate(tokenEstimate),
  };
}

export function buildUnitTerminalWorkflowResult(workflowState, target, options = {}) {
  if (!workflowState || workflowState.workflow !== "unit") {
    throw new Error("terminal projection requires a Unit workflow-state artifact");
  }
  const decision = workflowState.terminalDecision;
  if (!new Set(["failed", "blocked"]).has(decision)
      || workflowState.lifecycle !== decision
      || workflowState.lastAction?.type !== "terminal"
      || workflowState.lastAction?.decision !== decision) {
    throw new Error("workflow-state must contain a consistent failed or blocked terminal decision");
  }
  const targetState = workflowState.targets?.[target];
  if (!targetState || targetState.lifecycle !== decision) {
    throw new Error(`workflow-state target ${target} does not match terminal decision ${decision}`);
  }
  const terminalLifecycle = decision === "failed" ? "failed" : "stopped";
  const terminalPhases = phaseNames.filter((name) => targetState[name]?.lifecycle === terminalLifecycle);
  if (terminalPhases.length !== 1) {
    throw new Error("workflow-state target must contain exactly one terminal phase");
  }
  const terminalPhase = terminalPhases[0];
  const terminalIndex = phaseNames.indexOf(terminalPhase);
  const terminalState = targetState[terminalPhase];
  const failureKind = terminalState.failure?.kind ?? terminalState.resultStatus ?? decision;
  const failureMessage = terminalState.failure?.message
    ?? `${terminalPhase} ended with ${terminalState.resultStatus ?? decision}`;
  const runState = options.runState ?? null;
  const executorWasDispatched = targetState.executor?.lifecycle !== "pending";
  const retainedExecution = readTerminalExecution(targetState, target, options.orchestratorRoot ?? null);
  return {
    schemaVersion: 2,
    decision,
    target,
    terminal: { phase: terminalPhase, failureKind, failureMessage },
    scenarios: { effective: null, implemented: null, missing: null },
    testFiles: [],
    testFilesStatus: "unavailable",
    execution: retainedExecution ?? {
      build: { status: executorWasDispatched ? "unavailable" : "not_run", warnings: null },
      test: {
        status: executorWasDispatched ? "unavailable" : "not_run",
        total: null, passed: null, failed: null, skipped: null,
      },
      coverage: {
        status: executorWasDispatched ? "unavailable" : "not_applicable",
        scope: null,
        line: null,
        branch: null,
        goalMet: null,
      },
      attempt: null,
      evidencePaths: null,
    },
    coverageDecision: targetState.coverageDecision ?? {
      status: decision === "blocked" ? "blocked" : "unavailable",
      reason: failureMessage,
      repairable: [],
      uncoverable: [],
      releaseEligible: false,
      repairRound: targetState.coverageRepairRound ?? 0,
      maxRepairRounds: targetState.maxCoverageRepairRounds ?? 1,
    },
    coverageDecisionHistory: targetState.coverageDecisionHistory ?? [],
    releaseEligible: false,
    review: {
      qualityDecision: targetState.reviewer?.lifecycle === "pending" ? "not_run" : decision,
      grade: null,
      score: null,
      issues: [failureMessage],
      missingTestCases: [],
      observations: [],
    },
    timing: normalizeTiming(runState, phaseNames.slice(0, terminalIndex + 1)),
    profiling: normalizeProfiling(runState),
    estimatedTokenUsage: normalizeTokenEstimate(options.tokenEstimate ?? null),
  };
}

function cell(value, fallback = "unavailable") {
  return display(value, fallback).replaceAll("|", "\\|").replaceAll(/\r?\n/gu, " ");
}

function structuredValue(value) {
  if (value === null) return "null";
  if (value === undefined) return "unavailable";
  if (Array.isArray(value)) return `[${value.map(structuredValue).join(", ")}]`;
  if (typeof value === "object") {
    const fields = Object.entries(value).map(([key, item]) => `${key}=${structuredValue(item)}`);
    return fields.length > 0 ? `{${fields.join("; ")}}` : "{}";
  }
  return String(value).replaceAll(/\r?\n/gu, " ");
}

function reviewItems(items, separator) {
  return items.length > 0
    ? items.map((item) => {
      const rendered = structuredValue(item);
      return item !== null && typeof item === "object" && !Array.isArray(item)
        ? rendered.slice(1, -1)
        : rendered;
    }).join(separator)
    : "none";
}

function number(value) {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "unavailable";
}

function duration(value) {
  if (!Number.isFinite(value)) return "unavailable";
  const minutes = Math.floor(value / 60000);
  const seconds = ((value % 60000) / 1000).toFixed(3).replace(/\.000$/u, "");
  return `${minutes} 分 ${seconds} 秒（${number(value)} ms）`;
}

function renderTiming(result) {
  const rows = phaseNames.map((name, index) => {
    const phase = result.timing.phases[name];
    return `| 階段 ${index + 1} ${name[0].toUpperCase()}${name.slice(1)} | ${duration(phase.durationMs)} |`;
  });
  rows.push(`| **整體 wall-clock** | **${duration(result.timing.overall.durationMs)}** |`);
  return [
    "## 各階段耗時", "",
    `Timing status: ${result.timing.status}${result.timing.reason ? `（${result.timing.reason}）` : ""}`, "",
    "| 階段 | 耗時 |", "|---|---:|", ...rows, "",
  ];
}

function renderTimingEvidence(result) {
  const rows = [];
  for (const name of phaseNames) {
    const phase = result.timing.phases[name];
    if (phase.assignments.length === 0) {
      rows.push(`| ${name} | unavailable | ${cell(phase.startAt)} | unavailable | ${cell(phase.endAt)} | unavailable |`);
      continue;
    }
    for (const assignment of phase.assignments) {
      const critical = assignment.assignmentId === phase.criticalAssignmentId ? "critical path" : assignment.timingNote;
      rows.push(`| ${name} | ${cell(assignment.assignmentId)} | ${cell(assignment.dispatchIssuedAt)} | ${cell(assignment.artifactReadyAt)} | ${cell(assignment.completedAt)} | ${cell(critical)} |`);
    }
  }
  return [
    "## Timing Evidence", "",
    "Source: `.orchestrator/run-state.json`", "",
    "| Phase | Assignment | Dispatch issued | Artifact ready | Completed | Critical path / note |",
    "|---|---|---|---|---|---|", ...rows, "",
  ];
}

function renderProfiling(result) {
  const profiling = result.profiling;
  const breakdown = profiling.bottleneckBreakdown ?? {};
  return [
    "## Profiling Summary", "",
    "| Field | Value |", "|---|---|",
    `| status | ${cell(profiling.status)} |`,
    `| timingSource | ${cell(profiling.timingSource)} |`,
    `| bottleneck | ${cell(profiling.bottleneck)} |`,
    `| assignmentId | ${cell(breakdown.assignmentId)} |`,
    `| dispatchAcceptLatencyMs | ${number(breakdown.dispatchAcceptLatencyMs)} |`,
    `| produceSpanMs | ${number(breakdown.produceSpanMs)} |`,
    `| redispatchWaitMs | ${number(breakdown.redispatchWaitMs)} |`,
    `| skillLoadMs | ${number(breakdown.skillLoadMs)} |`,
    `| rootCauseCandidate | ${cell(profiling.rootCauseCandidate, profiling.reason ?? "unavailable")} |`,
    `| deferredOptimization | ${cell(profiling.deferredOptimization)} |`, "",
  ];
}

function renderTokenEstimate(result) {
  const token = result.estimatedTokenUsage;
  const output = ["## Estimated Token Usage", ""];
  if (token.status !== "available") {
    return [...output,
      "| Field | Value |", "|---|---|",
      "| status | unavailable |",
      `| reason | ${cell(token.reason)} |`,
      `| measurement scope | ${cell(token.measurementScope)} |`, "",
      "此區塊是 visible-context 估算，非 billing truth，也不參與 correctness gate。", "",
    ];
  }
  output.push(
    "| Phase | Assignments | Input estimate | Output estimate | Total estimate | Confidence |",
    "|---|---:|---:|---:|---:|---|",
    ...phaseNames.map((name) => {
      const phase = token.phases[name];
      return `| ${name} | ${phase.assignments} | ${number(phase.input)} | ${number(phase.output)} | ${number(phase.total)} | ${cell(phase.confidence)} |`;
    }),
    `| **Total** | ${phaseNames.reduce((sum, name) => sum + token.phases[name].assignments, 0)} | **${number(token.summary.input)}** | **${number(token.summary.output)}** | **${number(token.summary.total)}** | ${cell(token.summary.confidence)} |`,
    "",
    `Measurement scope: ${cell(token.measurementScope)}；method: ${cell(token.method)}。`,
    "此區塊是 visible-context 估算，非 billing truth，也不參與 correctness gate。", "",
  );
  return output;
}

function renderScenarioCoverage(result) {
  return [
    "## 情境覆蓋", "",
    "| Effective scenarios | Implemented | Missing |", "|---:|---:|---:|",
    `| ${number(result.scenarios.effective)} | ${number(result.scenarios.implemented)} | ${number(result.scenarios.missing)} |`, "",
  ];
}

function renderDelivery(result) {
  const attempt = result.execution.attempt ?? {};
  const evidence = result.execution.evidencePaths;
  const evidenceRows = evidence && typeof evidence === "object" && !Array.isArray(evidence)
    ? Object.entries(evidence) : array(evidence).map((item, index) => [`evidence-${index + 1}`, item]);
  return [
    "## 修正、異常與交付", "",
    "| Field | Value |", "|---|---|",
    `| executionAttempt | ${number(attempt.executionAttempt)} |`,
    `| fixRound | ${number(attempt.fixRound)} |`,
    `| maxFixRounds | ${number(attempt.maxFixRounds)} |`,
    `| repairEligible | ${cell(attempt.repairEligible)} |`,
    `| buildWarnings | ${cell(result.execution.build.warnings)} |`,
    `| Reviewer issues | ${cell(reviewItems(result.review.issues, "；"))} |`,
    `| Missing test cases | ${cell(reviewItems(result.review.missingTestCases, "；"))} |`,
    "",
    "### 交付產物", "",
    ...(result.testFiles.length > 0
      ? result.testFiles.map((file) => `- Test file: \`${file}\``)
      : [`- Test file: ${result.testFilesStatus === "unavailable" ? "unavailable" : "none"}`]),
    ...evidenceRows.map(([kind, file]) => `- ${kind}: \`${file}\``),
    "",
  ];
}

export function renderUnitWorkflowResult(result) {
  const test = result.execution.test;
  const coverage = result.execution.coverage;
  const testSummary = test.status === "not_run"
    ? "not run"
    : (test.status === "unavailable"
      ? "unavailable"
      : `${display(test.passed, "unavailable")} passed, ${display(test.failed, "unavailable")} failed, ${display(test.skipped, "unavailable")} skipped`);
  const coverageSummary = coverage.status === "not_applicable"
    ? "not applicable"
    : (coverage.status === "unavailable"
      ? "unavailable"
      : `line ${display(coverage.line?.percent, "unavailable")}% (≥${display(coverage.line?.threshold, "unavailable")}%); branch ${display(coverage.branch?.percent, "unavailable")}% (≥${display(coverage.branch?.threshold, "unavailable")}%)`);
  const files = result.testFiles.length > 0
    ? result.testFiles.join("<br>")
    : (result.testFilesStatus === "unavailable" ? "unavailable" : "none");
  const issues = reviewItems(result.review.issues, "; ");
  const missing = reviewItems(result.review.missingTestCases, "; ");
  const coverageGaps = [...(result.coverageDecision.repairable ?? []), ...(result.coverageDecision.uncoverable ?? [])]
    .map((gap) => `${gap.id}: ${gap.reason}`)
    .join("; ") || "none";

  return [
    "# Unit workflow result",
    "",
    `Decision: ${result.decision}`,
    "",
    "## 測試結果總覽",
    "",
    "| Target | Test files | Build | Test | Coverage | Quality |",
    "|---|---|---|---|---|---|",
    `| ${result.target} | ${files} | ${result.execution.build.status} | ${testSummary} | ${coverageSummary} | ${result.review.qualityDecision} |`,
    "",
    ...renderScenarioCoverage(result),
    "## Reviewer 結論",
    "",
    `Grade: ${display(result.review.grade, "unavailable")}`,
    "",
    `Score: ${display(result.review.score, "unavailable")}`,
    "",
    `Coverage decision: ${result.coverageDecision.status}`,
    "",
    `Coverage reason: ${result.coverageDecision.reason}`,
    "",
    `Coverage repair round: ${display(result.coverageDecision.repairRound, 0)}/${display(result.coverageDecision.maxRepairRounds, 1)}`,
    "",
    `Coverage gaps: ${coverageGaps}`,
    "",
    `Release eligible: ${result.releaseEligible === true ? "yes" : "no"}`,
    "",
    `Issues: ${issues}`,
    "",
    `Missing test cases: ${missing}`,
    "",
    ...renderDelivery(result),
    ...renderTiming(result),
    ...renderTimingEvidence(result),
    ...renderProfiling(result),
    ...renderTokenEstimate(result),
  ].join("\n");
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--input") result.input = argv[++index];
    else if (key === "--target") result.target = argv[++index];
    else if (key === "--analysis") result.analysis = argv[++index];
    else if (key === "--writer") result.writer = argv[++index];
    else if (key === "--execution") result.execution = argv[++index];
    else if (key === "--review") result.review = argv[++index];
    else if (key === "--workflow-state") result.workflowState = argv[++index];
    else if (key === "--decision-state") result.decisionState = argv[++index];
    else if (key === "--run-state") result.runState = argv[++index];
    else if (key === "--token-estimate") result.tokenEstimate = argv[++index];
    else if (key === "--test-project") result.testProject = argv[++index];
    else if (key === "--json-output") result.jsonOutput = argv[++index];
    else if (key === "--markdown-output") result.markdownOutput = argv[++index];
    else throw new Error(`unknown argument: ${key}`);
  }
  return result;
}

function writeNew(filePath, content) {
  const output = path.resolve(filePath);
  if (fs.existsSync(output)) throw new Error(`workflow result already exists: ${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, content);
  return output;
}

function readJsonIfFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function finalizationEvidence(args) {
  const explicitRunState = args.runState ? path.resolve(args.runState) : null;
  const explicitTokenEstimate = args.tokenEstimate ? path.resolve(args.tokenEstimate) : null;
  if (!args.testProject) {
    return {
      runState: readJsonIfFile(explicitRunState),
      tokenEstimate: readJsonIfFile(explicitTokenEstimate),
      orchestratorRoot: null,
    };
  }

  const testProjectPath = path.resolve(args.testProject);
  const testProjectDir = fs.existsSync(testProjectPath) && fs.statSync(testProjectPath).isDirectory()
    ? testProjectPath : path.dirname(testProjectPath);
  const orchestratorDir = path.join(testProjectDir, ".orchestrator");
  const runStatePath = explicitRunState ?? path.join(orchestratorDir, "run-state.json");
  const tokenEstimatePath = explicitTokenEstimate ?? path.join(orchestratorDir, "token-usage-estimate.json");
  let tokenEstimate = readJsonIfFile(explicitTokenEstimate);
  if (!explicitTokenEstimate) {
    const estimator = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "estimate-token-usage.mjs");
    const estimation = spawnSync(process.execPath, [
      estimator,
      "--test-project", testProjectPath,
      "--orchestrator-contract", ".codex/skills/dotnet-testing-orchestrator-unit/SKILL.md",
    ], { cwd: process.cwd(), encoding: "utf8" });
    tokenEstimate = readJsonIfFile(tokenEstimatePath);
    if (estimation.status !== 0 || !tokenEstimate) {
      const reason = estimation.stderr?.trim() || estimation.stdout?.trim()
        || "estimator 未產生 token-usage-estimate.json";
      tokenEstimate = {
        estimator: { method: "chars-heuristic" },
        summary: {
          measurementScope: "subagent-visible-context",
          estimateKind: "unavailable",
          reason,
        },
      };
    }
  }
  return { runState: readJsonIfFile(runStatePath), tokenEstimate, orchestratorRoot: orchestratorDir };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const name of ["jsonOutput", "markdownOutput"]) {
    if (!args[name]) throw new Error(`--${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  const componentNames = ["analysis", "writer", "execution", "review"];
  const usesComponents = componentNames.some((name) => args[name]);
  const usesTerminalState = Boolean(args.workflowState);
  if (!args.input && !usesTerminalState && (!args.target || componentNames.some((name) => !args[name]))) {
    throw new Error("use --input, --workflow-state, or provide --target, --analysis, --writer, --execution and --review");
  }
  if (usesTerminalState && !args.target) throw new Error("--workflow-state requires --target");
  if ([Boolean(args.input), usesComponents, usesTerminalState].filter(Boolean).length > 1) {
    throw new Error("--input, --workflow-state and component artifacts are mutually exclusive");
  }
  const evidence = finalizationEvidence(args);
  let result;
  if (usesTerminalState) {
    const workflowState = JSON.parse(fs.readFileSync(path.resolve(args.workflowState), "utf8"));
    result = buildUnitTerminalWorkflowResult(workflowState, args.target, {
      ...evidence,
      orchestratorRoot: evidence.orchestratorRoot ?? path.dirname(path.resolve(args.workflowState)),
    });
  } else {
    const artifacts = args.input
      ? JSON.parse(fs.readFileSync(path.resolve(args.input), "utf8"))
      : {
        target: args.target,
        ...Object.fromEntries(componentNames.map((name) => [
          name,
          JSON.parse(fs.readFileSync(path.resolve(args[name]), "utf8")),
        ])),
      };
    result = buildUnitWorkflowResult(artifacts, {
      ...evidence,
      workflowState: readJsonIfFile(args.decisionState ? path.resolve(args.decisionState) : null),
    });
  }
  for (const output of [args.jsonOutput, args.markdownOutput].map((item) => path.resolve(item))) {
    if (fs.existsSync(output)) throw new Error(`workflow result already exists: ${output}`);
  }
  const jsonOutput = writeNew(args.jsonOutput, `${JSON.stringify(result, null, 2)}\n`);
  const markdownOutput = writeNew(args.markdownOutput, renderUnitWorkflowResult(result));
  process.stdout.write(`${JSON.stringify({ decision: result.decision, jsonOutput, markdownOutput })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(`unit workflow result error: ${error.message}`);
    process.exitCode = 1;
  }
}
