import { normalizeUnitArtifacts } from "./artifact-normalizer.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { link as usageReportLink } from "./usage-observer.mjs";

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

function strings(value) {
  return [...new Set(array(value)
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim()))];
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function comparablePath(value) {
  return String(value ?? "").replaceAll("\\", "/").toLowerCase();
}

function observedTechnicalSkills(analysis) {
  const paths = array(analysis?.declaredAccess?.readFiles)
    .map((item) => typeof item === "string" ? item : item?.path);
  return [...new Set(strings(paths).flatMap((file) => {
    const match = file.match(/(?:^|[\\/])(?:\.agents|\.codex)[\\/]skills[\\/](dotnet-testing-[^\\/]+)[\\/]SKILL\.md$/iu);
    return match ? [match[1].replace(/^dotnet-testing-/u, "")] : [];
  }))].sort();
}

function summarizeRoleArtifacts({ analysis = null, writer = null, review = null } = {}, declarations = null) {
  const catalog = array(analysis?.scenarioCatalog);
  const effectiveStatuses = new Set(["accepted", "accepted_with_normalization", "accepted_with_limitation"]);
  const userScenarios = catalog.filter((scenario) => scenario?.source === "user"
    || String(scenario?.scenarioId ?? "").startsWith("USR-"));
  const effectiveUserScenarios = userScenarios.filter((scenario) => effectiveStatuses.has(scenario?.status));
  const statusCount = (status) => userScenarios.filter((scenario) => scenario?.status === status).length;
  const testClasses = array(writer?.testClasses);
  const writerFiles = strings(writer?.testFilePaths);
  const classFiles = testClasses.flatMap((testClass) => strings([testClass?.filePath]));
  const files = [...new Set(writerFiles.length > 0 ? writerFiles : classFiles)];
  const fileDetails = files.map((file) => {
    const matchingClasses = testClasses.filter((testClass) =>
      comparablePath(testClass?.filePath) === comparablePath(file));
    const methods = [...new Set(matchingClasses.flatMap((testClass) => strings(testClass?.methodsCovered)))];
    const measured = array(declarations?.files).find((entry) => comparablePath(entry.path) === comparablePath(file));
    const count = measured?.status === "available" ? nonNegativeInteger(measured.count) : null;
    return {
      path: file,
      methodsCovered: methods.length > 0 ? methods : files.length === 1 ? strings(analysis?.methodsToTest) : [],
      testCaseCount: count,
    };
  });
  const methodsFromFiles = fileDetails.flatMap((file) => file.methodsCovered);
  const methodsCovered = [...new Set(methodsFromFiles.length > 0
    ? methodsFromFiles : strings(analysis?.methodsToTest))];
  const fileCountTotal = fileDetails.length > 0 && fileDetails.every((file) => file.testCaseCount !== null)
    ? fileDetails.reduce((sum, file) => sum + file.testCaseCount, 0) : null;
  const testCaseCount = fileCountTotal;
  const coverage = review?.userScenarioCoverage;
  const writerCoverage = new Map(array(writer?.scenarioCoverage)
    .map((item) => [item?.scenarioId, item]));
  const derivedCoverageComplete = effectiveUserScenarios.length > 0 && writer
    ? effectiveUserScenarios.every((scenario) => writerCoverage.get(scenario.scenarioId)?.status === "implemented")
    : null;
  const rejected = userScenarios.filter((scenario) => scenario?.status === "rejected").map((scenario) => ({
    scenarioId: scenario.scenarioId ?? null,
    originalContent: scenario.originalContent ?? null,
    reasonCode: scenario.reasonCode ?? scenario.rejectionReason?.code ?? null,
    reason: scenario.reason ?? scenario.rejectionReason?.reason ?? null,
    evidence: scenario.evidence ?? scenario.rejectionReason?.evidence ?? null,
  }));
  const warningSeverities = new Set(["warning", "error", "critical", "blocking", "blocker"]);
  const improvements = [
    ...array(review?.issues).filter((issue) => issue && typeof issue === "object"
      && warningSeverities.has(String(issue.severity ?? "").toLowerCase())),
    ...array(review?.warnings),
    ...array(review?.suggestions),
  ];
  return {
    files,
    summary: {
      methodsCovered,
      testCaseCount,
      fileDetails,
      analysisScenarioCount: analysis ? catalog.filter((scenario) => effectiveStatuses.has(scenario?.status)).length : null,
    },
    skills: {
      writer: strings(writer?.skillsLoaded),
      analyzerObserved: observedTechnicalSkills(analysis),
    },
    userScenarios: {
      provided: userScenarios.length,
      accepted: statusCount("accepted"),
      normalized: statusCount("accepted_with_normalization"),
      limited: statusCount("accepted_with_limitation"),
      merged: statusCount("merged"),
      rejected: statusCount("rejected"),
      analyzerSupplemented: catalog.filter((scenario) => effectiveStatuses.has(scenario?.status)
        && (scenario?.source === "generated" || String(scenario?.scenarioId ?? "").startsWith("GEN-"))).length,
      coverage: typeof coverage?.coverageComplete === "boolean"
        ? (coverage.coverageComplete ? "complete" : "incomplete")
        : (derivedCoverageComplete === null ? "unavailable" : derivedCoverageComplete ? "complete" : "incomplete"),
      missingScenarioIds: strings(coverage?.missingScenarioIds),
      dataMismatchScenarioIds: strings(coverage?.dataMismatchScenarioIds),
    },
    rejectedUserScenarios: rejected,
    improvements,
  };
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
  if (!new Set(["completed", "failed"]).has(phase?.lifecycle) || !phase.artifactSeal) return null;
  const candidates = [
    phase.artifact,
    orchestratorRoot ? path.join(orchestratorRoot, directory, `${target}.${suffix}.json`) : null,
  ].filter(Boolean).map((item) => path.resolve(item));
  return candidates.find((candidate) => (
    (!orchestratorRoot || isWithin(orchestratorRoot, candidate))
    && sameDigest(candidate, phase.artifactSeal)
  )) ?? null;
}

function readSealedRoleArtifact(targetState, orchestratorRoot, target, role) {
  const definitions = {
    analyzer: ["analysis", "analysis"],
    writer: ["writer-result", "writer-result"],
    writerRepair: ["writer-repair-result", "writer-repair-result"],
    reviewer: ["reviewer-result", "reviewer-result"],
    reviewerRepair: ["reviewer-repair-result", "reviewer-repair-result"],
  };
  const [directory, suffix] = definitions[role];
  const artifactPath = resolveSealedArtifact(targetState[role], orchestratorRoot, directory, target, suffix);
  return artifactPath ? JSON.parse(fs.readFileSync(artifactPath, "utf8")) : null;
}

function readTerminalRoleArtifacts(targetState, target, orchestratorRoot) {
  if (!orchestratorRoot) return {};
  const writerRole = targetState.writerRepair?.artifactSeal ? "writerRepair" : "writer";
  const reviewerRole = targetState.reviewerRepair?.artifactSeal ? "reviewerRepair" : "reviewer";
  return {
    analysis: readSealedRoleArtifact(targetState, orchestratorRoot, target, "analyzer"),
    writer: readSealedRoleArtifact(targetState, orchestratorRoot, target, writerRole),
    review: readSealedRoleArtifact(targetState, orchestratorRoot, target, reviewerRole),
  };
}

function readSealedExecutorResult(targetState, target, orchestratorRoot) {
  if (!orchestratorRoot) return null;
  const usesRepair = targetState.executorRepair?.lifecycle === "completed";
  const role = usesRepair ? "executorRepair" : "executor";
  const directory = usesRepair ? "executor-repair-result" : "executor-result";
  const suffix = usesRepair ? "executor-repair-result" : "executor-result";
  const artifactPath = resolveSealedArtifact(targetState[role], orchestratorRoot, directory, target, suffix);
  return artifactPath ? JSON.parse(fs.readFileSync(artifactPath, "utf8")) : null;
}

function normalizeRepairHistory(executorResult) {
  return array(executorResult?.repairHistory).map((entry) => ({
    attempt: nonNegativeInteger(entry?.attempt),
    classification: typeof entry?.classification === "string" ? entry.classification : "unspecified",
    summary: typeof entry?.summary === "string" ? entry.summary : null,
    filesChanged: strings(entry?.filesChanged),
    evidence: entry?.evidence ?? null,
    outcome: entry?.outcome ?? entry?.approvalResult ?? null,
  }));
}

function normalizeTerminalExecution(evidence) {
  const counts = evidence.test?.counts ?? evidence.test ?? {};
  const metric = (value) => value && typeof value === "object"
    ? { ...value, percent: value.percent ?? null, threshold: value.threshold ?? null, met: value.met ?? null }
    : null;
  const notApplicable = evidence.coverage?.status === "not_applicable";
  return {
    build: {
      status: evidence.build?.status ?? "unavailable",
      exitCode: evidence.build?.exitCode ?? null,
      warnings: evidence.build?.warnings ?? null,
    },
    test: {
      status: evidence.test?.status ?? "unavailable",
      exitCode: evidence.test?.exitCode ?? null,
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
        classCoverage: evidence.coverage?.classCoverage ?? null,
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
  return {
    ...normalizeTerminalExecution(JSON.parse(fs.readFileSync(evidencePath, "utf8"))),
    repairHistory: normalizeRepairHistory(executor),
  };
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

export function buildUnitWorkflowResult(artifacts, options = {}) {
  const storedProjection = options.workflowState?.targets?.[artifacts.target]?.coverageDecision?.reviewerProjection;
  if(storedProjection) artifacts = {...artifacts,review:storedProjection};
  const normalized = normalizeUnitArtifacts(artifacts);
  const runState = options.runState ?? artifacts.runState ?? null;
  const targetState = options.workflowState?.targets?.[normalized.core.target] ?? null;
  const executorResult = targetState
    ? readSealedExecutorResult(targetState, normalized.core.target, options.orchestratorRoot ?? null)
    : null;
  const presentation = summarizeRoleArtifacts(artifacts, targetState?.writerRepair?.testDeclarations ?? targetState?.writer?.testDeclarations);
  return {
    schemaVersion: 2,
    decision: normalized.decision,
    target: normalized.core.target,
    scenarios: normalized.core.scenario,
    testFiles: normalized.core.files,
    testFilesStatus: "available",
    summary: presentation.summary,
    skills: presentation.skills,
    userScenarios: presentation.userScenarios,
    rejectedUserScenarios: presentation.rejectedUserScenarios,
    execution: {
      build: {
        status: normalized.core.build,
        warnings: artifacts.execution?.build?.warnings ?? null,
      },
      test: normalized.core.test,
      coverage: { ...normalized.coverage, classCoverage: artifacts.execution?.coverage?.classCoverage ?? null },
      attempt: artifacts.execution?.attempt ?? null,
      evidencePaths: artifacts.execution?.evidencePaths ?? null,
      repairHistory: normalizeRepairHistory(executorResult),
    },
    coverageDecision: targetState?.coverageDecision ?? normalized.coverageDecision,
    coverageDecisionHistory: targetState?.coverageDecisionHistory ?? [normalized.coverageDecision],
    releaseEligible: normalized.decision === "completed"
      && (targetState?.releaseEligible ?? targetState?.coverageDecision?.releaseEligible ?? normalized.coverageDecision.releaseEligible),
    review: {
      qualityDecision: normalized.core.quality,
      grade: artifacts.review?.grade ?? null,
      score: artifacts.review?.overallScore ?? artifacts.review?.score ?? null,
      issues: normalized.issues,
      missingTestCases: normalized.missingTestCases,
      observations: array(artifacts.review?.observations),
      improvements: presentation.improvements,
    },
    timing: normalizeTiming(runState),
    profiling: normalizeProfiling(runState),
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
  const terminalPhases = phaseNames.filter((name) => targetState[name]?.lifecycle === terminalLifecycle
    || (decision === "blocked" && targetState[name]?.resultStatus === "blocked" && name.startsWith("reviewer")));
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
  const orchestratorRoot = options.orchestratorRoot ?? null;
  const retainedExecution = readTerminalExecution(targetState, target, orchestratorRoot);
  const retainedArtifacts = readTerminalRoleArtifacts(targetState, target, orchestratorRoot);
  const presentation = summarizeRoleArtifacts(retainedArtifacts, targetState?.writerRepair?.testDeclarations ?? targetState?.writer?.testDeclarations);
  const retainedCatalog = array(retainedArtifacts.analysis?.scenarioCatalog)
    .filter((scenario) => new Set(["accepted", "accepted_with_normalization", "accepted_with_limitation"])
      .has(scenario?.status));
  const retainedCoverage = new Map(array(retainedArtifacts.writer?.scenarioCoverage)
    .map((coverage) => [coverage?.scenarioId, coverage]));
  const retainedImplemented = retainedCatalog.filter((scenario) =>
    retainedCoverage.get(scenario.scenarioId)?.status === "implemented").length;
  const retainedReview = targetState.coverageDecision?.reviewerProjection ?? retainedArtifacts.review;
  return {
    schemaVersion: 2,
    decision,
    target,
    terminal: { phase: terminalPhase, failureKind, failureMessage },
    scenarios: retainedArtifacts.analysis ? {
      effective: retainedCatalog.length,
      implemented: retainedArtifacts.writer ? retainedImplemented : null,
      missing: retainedArtifacts.writer ? retainedCatalog.length - retainedImplemented : null,
    } : { effective: null, implemented: null, missing: null },
    testFiles: presentation.files,
    testFilesStatus: retainedArtifacts.writer ? "available" : "unavailable",
    summary: presentation.summary,
    skills: presentation.skills,
    userScenarios: presentation.userScenarios,
    rejectedUserScenarios: presentation.rejectedUserScenarios,
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
      repairHistory: [],
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
      qualityDecision: retainedReview?.qualityDecision ?? retainedReview?.gateDecision
        ?? (targetState.reviewer?.lifecycle === "pending" ? "not_run" : decision),
      grade: retainedReview?.grade ?? null,
      score: retainedReview?.overallScore ?? retainedReview?.score ?? null,
      issues: retainedReview ? array(retainedReview.issues) : [failureMessage],
      missingTestCases: retainedReview ? array(retainedReview.missingTestCases) : [],
      observations: array(retainedReview?.observations),
      improvements: presentation.improvements,
    },
    timing: normalizeTiming(runState, phaseNames.slice(0, terminalIndex + 1)),
    profiling: normalizeProfiling(runState),
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
  const values = array(items);
  return values.length > 0
    ? values.map((item) => {
      const rendered = structuredValue(item);
      return item !== null && typeof item === "object" && !Array.isArray(item)
        ? rendered.slice(1, -1)
        : rendered;
    }).join(separator)
    : "無";
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

function buildCancelledTargetResult(target, targetState, options = {}) {
  const orchestratorRoot = options.orchestratorRoot ?? null;
  const retainedArtifacts = readTerminalRoleArtifacts(targetState, target, orchestratorRoot);
  const retainedExecution = readTerminalExecution(targetState, target, orchestratorRoot);
  const presentation = summarizeRoleArtifacts(retainedArtifacts, targetState?.writerRepair?.testDeclarations ?? targetState?.writer?.testDeclarations);
  const retainedCatalog = array(retainedArtifacts.analysis?.scenarioCatalog)
    .filter((scenario) => new Set(["accepted", "accepted_with_normalization", "accepted_with_limitation"])
      .has(scenario?.status));
  const retainedCoverage = new Map(array(retainedArtifacts.writer?.scenarioCoverage)
    .map((coverage) => [coverage?.scenarioId, coverage]));
  const retainedImplemented = retainedCatalog.filter((scenario) =>
    retainedCoverage.get(scenario.scenarioId)?.status === "implemented").length;
  const message = targetState.cancellation?.message ?? "Workflow ended before this target could finish";
  return {
    schemaVersion: 2,
    decision: "cancelled",
    target,
    terminal: { phase: null, failureKind: targetState.cancellation?.kind ?? "peer_target_terminal", failureMessage: message },
    scenarios: retainedArtifacts.analysis ? {
      effective: retainedCatalog.length,
      implemented: retainedArtifacts.writer ? retainedImplemented : null,
      missing: retainedArtifacts.writer ? retainedCatalog.length - retainedImplemented : null,
    } : { effective: null, implemented: null, missing: null },
    testFiles: presentation.files,
    testFilesStatus: retainedArtifacts.writer ? "available" : "unavailable",
    summary: presentation.summary,
    skills: presentation.skills,
    userScenarios: presentation.userScenarios,
    rejectedUserScenarios: presentation.rejectedUserScenarios,
    execution: retainedExecution ?? {
      build: { status: "not_run", warnings: null },
      test: { status: "not_run", total: null, passed: null, failed: null, skipped: null },
      coverage: { status: "not_applicable", scope: null, line: null, branch: null, goalMet: null },
      attempt: null,
      evidencePaths: null,
      repairHistory: [],
    },
    coverageDecision: {
      status: "cancelled", reason: message, repairable: [], uncoverable: [],
      releaseEligible: false, repairRound: 0, maxRepairRounds: targetState.maxCoverageRepairRounds ?? 1,
    },
    coverageDecisionHistory: targetState.coverageDecisionHistory ?? [],
    releaseEligible: false,
    review: {
      qualityDecision: retainedArtifacts.review?.qualityDecision ?? retainedArtifacts.review?.gateDecision ?? "not_run",
      grade: retainedArtifacts.review?.grade ?? null,
      score: retainedArtifacts.review?.overallScore ?? retainedArtifacts.review?.score ?? null,
      issues: retainedArtifacts.review ? array(retainedArtifacts.review.issues) : [message],
      missingTestCases: retainedArtifacts.review ? array(retainedArtifacts.review.missingTestCases) : [],
      observations: array(retainedArtifacts.review?.observations),
      improvements: presentation.improvements,
    },
    timing: normalizeTiming(options.runState ?? null),
    profiling: normalizeProfiling(options.runState ?? null),
  };
}

export function buildUnitAggregateWorkflowResult(workflowState, options = {}) {
  if (!workflowState || workflowState.workflow !== "unit"
      || !new Set(["completed", "failed", "blocked"]).has(workflowState.terminalDecision)
      || workflowState.lifecycle !== workflowState.terminalDecision
      || workflowState.lastAction?.type !== "terminal"
      || workflowState.lastAction?.decision !== workflowState.terminalDecision) {
    throw new Error("aggregate projection requires consistent terminal Unit workflow-state truth");
  }
  const entries = Object.entries(workflowState.targets ?? {});
  if (entries.length === 0) throw new Error("aggregate projection requires at least one target");
  const orchestratorRoot = options.orchestratorRoot ?? null;
  const results = entries.map(([target, targetState]) => {
    const hasFourRoleChain = phaseNames.every((name) => targetState[name]?.lifecycle === "completed");
    if (new Set(["completed", "blocked"]).has(targetState.lifecycle) && hasFourRoleChain) {
      const roleArtifacts = readTerminalRoleArtifacts(targetState, target, orchestratorRoot);
      const execution = readTerminalExecution(targetState, target, orchestratorRoot);
      if (!roleArtifacts.analysis || !roleArtifacts.writer || !roleArtifacts.review || !execution) {
        throw new Error(`aggregate projection requires sealed four-role artifacts for ${target}`);
      }
      return buildUnitWorkflowResult({ target, ...roleArtifacts, execution }, {
        ...options, workflowState, orchestratorRoot,
      });
    }
    if (new Set(["failed", "blocked"]).has(targetState.lifecycle)) {
      return buildUnitTerminalWorkflowResult(workflowState, target, options);
    }
    if (targetState.lifecycle === "cancelled") return buildCancelledTargetResult(target, targetState, options);
    throw new Error(`aggregate projection rejects non-terminal target ${target}: ${targetState.lifecycle ?? "missing"}`);
  });
  const timing = normalizeTiming(options.runState ?? null);
  const profiling = normalizeProfiling(options.runState ?? null);
  return {
    schemaVersion: 3,
    decision: workflowState.terminalDecision,
    target: entries.map(([target]) => target).join(", "),
    targetOrder: entries.map(([target]) => target),
    targets: results,
    releaseEligible: results.every((result) => result.releaseEligible === true),
    summary: {
      analysisScenarioCount: results.every((result) => Number.isInteger(result.summary.analysisScenarioCount))
        ? results.reduce((sum, result) => sum + result.summary.analysisScenarioCount, 0) : null,
    },
    skills: {
      analyzerObserved: [...new Set(results.flatMap((result) => result.skills.analyzerObserved))].sort(),
    },
    timing,
    profiling,
  };
}

function renderScenarioCoverage(result) {
  const output = [
    "## 情境覆蓋", "",
    "| Effective scenarios | Implemented | Missing |", "|---:|---:|---:|",
    `| ${number(result.scenarios.effective)} | ${number(result.scenarios.implemented)} | ${number(result.scenarios.missing)} |`, "",
  ];
  if (result.userScenarios.provided > 0) {
    output.push(
      "### 使用者情境處理摘要", "",
      "| Target | Provided | Accepted | Normalized | Limited | Merged | Rejected | Analyzer supplemented | Coverage |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---|",
      `| ${cell(result.target)} | ${result.userScenarios.provided} | ${result.userScenarios.accepted} | ${result.userScenarios.normalized} | ${result.userScenarios.limited} | ${result.userScenarios.merged} | ${result.userScenarios.rejected} | ${result.userScenarios.analyzerSupplemented} | ${cell(result.userScenarios.coverage)} |`, "",
    );
    if (result.rejectedUserScenarios.length > 0) {
      output.push(
        "### 被拒絕的使用者情境", "",
        "| Scenario | 原始內容 | Reason code | 具體理由 | Evidence |",
        "|---|---|---|---|---|",
        ...result.rejectedUserScenarios.map((scenario) => `| ${cell(scenario.scenarioId, "未取得")} | ${cell(scenario.originalContent, "未取得")} | ${cell(scenario.reasonCode, "未取得")} | ${cell(scenario.reason, "未取得")} | ${cell(scenario.evidence == null ? "未取得" : structuredValue(scenario.evidence))} |`),
        "",
      );
    }
    if (result.userScenarios.missingScenarioIds.length > 0
        || result.userScenarios.dataMismatchScenarioIds.length > 0) {
      output.push(
        `Missing scenario IDs: ${result.userScenarios.missingScenarioIds.join(", ") || "無"}`,
        "",
        `Data mismatch scenario IDs: ${result.userScenarios.dataMismatchScenarioIds.join(", ") || "無"}`,
        "",
      );
    }
  }
  return output;
}

function renderDelivery(result) {
  const attempt = result.execution.attempt && typeof result.execution.attempt === "object"
    ? result.execution.attempt : { executionAttempt: finite(result.execution.attempt) };
  const evidence = result.execution.evidencePaths;
  const evidenceRows = evidence && typeof evidence === "object" && !Array.isArray(evidence)
    ? Object.entries(evidence) : array(evidence).map((item, index) => [`evidence-${index + 1}`, item]);
  const fixRound = nonNegativeInteger(attempt.fixRound);
  const repairHistory = array(result.execution.repairHistory);
  const repairSummary = repairHistory.length > 0
    ? repairHistory.map((entry) => {
      const parts = [
        `attempt ${entry.attempt ?? "未取得"}`,
        entry.classification,
        entry.summary,
        entry.filesChanged.length > 0 ? `files=${entry.filesChanged.join(", ")}` : null,
        entry.outcome == null ? null : `outcome=${structuredValue(entry.outcome)}`,
      ].filter((item) => item !== null && item !== undefined && item !== "");
      return parts.join("；");
    }).join("<br>")
    : (fixRound === 0 ? "無修正" : "修正內容未提供");
  return [
    "## 修正、異常與交付", "",
    "### 使用的技術組合", "",
    "| Target | Loaded skills |", "|---|---|",
    `| ${cell(result.target)} | ${cell(result.skills.writer.join(", ") || "無")} |`, "",
    "### Analyzer 技術型 Skill 讀取", "",
    "| Target | Observed technical skills |", "|---|---|",
    `| ${cell(result.target)} | ${cell(result.skills.analyzerObserved.join(", ") || "無")} |`, "",
    "### Executor 修正紀錄", "",
    "| Target | Fix rounds | 修正內容 |", "|---|---:|---|",
    `| ${cell(result.target)} | ${fixRound === null ? "未取得" : fixRound} | ${cell(repairSummary)} |`, "",
    "### 執行診斷", "",
    "| Field | Value |", "|---|---|",
    `| executionAttempt | ${number(attempt.executionAttempt)} |`,
    `| fixRound | ${number(attempt.fixRound)} |`,
    `| maxFixRounds | ${number(attempt.maxFixRounds)} |`,
    `| repairEligible | ${cell(attempt.repairEligible)} |`,
    `| buildWarnings | ${cell(result.execution.build.warnings)} |`,
    "",
    "### 交付產物", "",
    ...(result.testFiles.length > 0
      ? result.testFiles.map((file) => `- Test file: \`${file}\``)
      : [`- Test file: ${result.testFilesStatus === "unavailable" ? "未取得" : "無"}`]),
    ...evidenceRows.map(([kind, file]) => `- ${kind}: \`${file}\``),
    "",
  ];
}

function renderUsageDelivery(delivery) {
  if (!delivery) return [];
  if (delivery.status === "unavailable") return [
    "### HTML token-usage report", "",
    `HTML token-usage report：未產生（${cell(delivery.reason)}）`, "",
  ];
  return [
    "### HTML token-usage report", "",
    delivery.markdown, "",
    "可複製網址：", "",
    "```text", delivery.fileUrl, "```", "",
    `目前狀態：\`${cell(delivery.status)}\`（${cell(delivery.label)}）。`, "",
    `工具回傳 note：${delivery.note}`, "",
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
  const rating = result.review.grade !== null && result.review.score !== null
    ? `${result.review.grade} (${result.review.score})`
    : (result.review.grade ?? result.review.score ?? result.review.qualityDecision ?? "未取得");
  const issues = reviewItems(result.review.issues, "；");
  const missing = reviewItems(result.review.missingTestCases, "；");
  const improvements = reviewItems(result.review.improvements, "；");
  const coverageGaps = [...(result.coverageDecision.repairable ?? []), ...(result.coverageDecision.uncoverable ?? [])]
    .map((gap) => `${gap.id}: ${gap.reason}`)
    .join("; ") || "無";
  const fileDetails = array(result.summary.fileDetails);
  const overviewRows = fileDetails.length > 0
    ? fileDetails.map((file, index) => {
      const methods = file.methodsCovered.length > 0 ? file.methodsCovered.join(", ") : "未取得";
      const count = Number.isInteger(file.testCaseCount)
        ? file.testCaseCount
        : fileDetails.length === 1 && Number.isInteger(result.summary.testCaseCount)
          ? result.summary.testCaseCount : "未取得";
      return `| ${index === 0 ? cell(result.target) : ""} | ${cell(file.path)} | ${cell(methods)} | ${count} | ${index === 0 ? `build ${cell(result.execution.build.status)} / test ${cell(test.status)}` : ""} | ${index === 0 ? cell(rating) : ""} |`;
    })
    : [`| ${cell(result.target)} | ${result.testFilesStatus === "unavailable" ? "未取得" : "無"} | ${result.summary.methodsCovered.length > 0 ? cell(result.summary.methodsCovered.join(", ")) : "未取得"} | ${Number.isInteger(result.summary.testCaseCount) ? result.summary.testCaseCount : "未取得"} | build ${cell(result.execution.build.status)} / test ${cell(test.status)} | ${cell(rating)} |`];

  return [
    "# Unit workflow result",
    "",
    `Decision: ${result.decision}`,
    "",
    "## 測試結果總覽",
    "",
    "| Target | 測試檔案 | 負責方法範圍 | 測試宣告數 | Build/Test 結果 | Reviewer 評分 |",
    "|---|---|---|---:|---|---|",
    ...overviewRows,
    "",
    "| Target | TRX 實際執行數 |", "|---|---:|",
    `| ${cell(result.target)} | ${Number.isInteger(test.total) ? test.total : "未取得"} |`,
    "",
    `執行案例：${testSummary}；Coverage：${coverageSummary}。`,
    ...(coverage.scope?.kind === "methods" ? [`Coverage（方法範圍，正式判定）：${coverageSummary}。`, `Coverage（類別，僅供參考）：Line ${display(coverage.classCoverage?.line?.percent, "unavailable")}%；Branch ${display(coverage.classCoverage?.branch?.percent, "unavailable")}%。`] : []),
    "",
    ...renderScenarioCoverage(result),
    "## Reviewer 結論",
    "",
    "| Target | Issues | Missing test cases | Warning 以上改善建議 |",
    "|---|---|---|---|",
    `| ${cell(result.target)} | ${cell(issues, "無")} | ${cell(missing, "無")} | ${cell(improvements, "無")} |`,
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
    ...renderDelivery(result),
    ...renderTiming(result),
    ...renderTimingEvidence(result),
    ...renderProfiling(result),
    ...renderUsageDelivery(result.usageDelivery),
  ].join("\n");
}

export function renderUnitAggregateWorkflowResult(result) {
  if (!Array.isArray(result?.targets) || result.targets.length === 0) {
    throw new Error("aggregate renderer requires target results");
  }
  const overviewRows = [];
  const executionRows = [];
  const scenarioRows = [];
  const userScenarioRows = [];
  const rejectedRows = [];
  const reviewerRows = [];
  const decisionRows = [];
  const skillRows = [];
  const analyzerSkillRows = [];
  const repairRows = [];
  const diagnosticRows = [];
  const deliveryRows = [];

  for (const target of result.targets) {
    const test = target.execution.test;
    const coverage = target.execution.coverage;
    const rating = target.review.grade !== null && target.review.score !== null
      ? `${target.review.grade} (${target.review.score})`
      : (target.review.grade ?? target.review.score ?? target.review.qualityDecision ?? "未取得");
    const details = array(target.summary.fileDetails);
    if (details.length > 0) {
      overviewRows.push(...details.map((file, index) => {
        const methods = file.methodsCovered.length > 0 ? file.methodsCovered.join(", ") : "未取得";
        const count = Number.isInteger(file.testCaseCount) ? file.testCaseCount
          : details.length === 1 && Number.isInteger(target.summary.testCaseCount)
            ? target.summary.testCaseCount : "未取得";
        return `| ${index === 0 ? cell(target.target) : ""} | ${cell(file.path)} | ${cell(methods)} | ${count} | ${index === 0 ? `build ${cell(target.execution.build.status)} / test ${cell(test.status)}` : ""} | ${index === 0 ? cell(rating) : ""} |`;
      }));
    } else {
      overviewRows.push(`| ${cell(target.target)} | ${target.testFilesStatus === "unavailable" ? "未取得" : "無"} | ${target.summary.methodsCovered.length > 0 ? cell(target.summary.methodsCovered.join(", ")) : "未取得"} | ${Number.isInteger(target.summary.testCaseCount) ? target.summary.testCaseCount : "未取得"} | build ${cell(target.execution.build.status)} / test ${cell(test.status)} | ${cell(rating)} |`);
    }
    const testSummary = test.status === "not_run" ? "not run"
      : test.status === "unavailable" ? "unavailable"
        : `${display(test.passed, "unavailable")} passed, ${display(test.failed, "unavailable")} failed, ${display(test.skipped, "unavailable")} skipped`;
    const coverageSummary = coverage.status === "not_applicable" ? "not applicable"
      : coverage.status === "unavailable" ? "unavailable"
        : `line ${display(coverage.line?.percent, "unavailable")}% (≥${display(coverage.line?.threshold, "unavailable")}%); branch ${display(coverage.branch?.percent, "unavailable")}% (≥${display(coverage.branch?.threshold, "unavailable")}%)`;
    executionRows.push(`| ${cell(target.target)} | ${cell(testSummary)} | ${cell(coverageSummary)}${coverage.scope?.kind === "methods" ? `（方法範圍，正式判定）；類別（僅供參考）Line ${display(coverage.classCoverage?.line?.percent, "unavailable")}% / Branch ${display(coverage.classCoverage?.branch?.percent, "unavailable")}%` : ""} |`);
    scenarioRows.push(`| ${cell(target.target)} | ${number(target.scenarios.effective)} | ${number(target.scenarios.implemented)} | ${number(target.scenarios.missing)} |`);
    if (target.userScenarios.provided > 0) {
      userScenarioRows.push(`| ${cell(target.target)} | ${target.userScenarios.provided} | ${target.userScenarios.accepted} | ${target.userScenarios.normalized} | ${target.userScenarios.limited} | ${target.userScenarios.merged} | ${target.userScenarios.rejected} | ${target.userScenarios.analyzerSupplemented} | ${cell(target.userScenarios.coverage)} |`);
    }
    rejectedRows.push(...target.rejectedUserScenarios.map((scenario) =>
      `| ${cell(target.target)} | ${cell(scenario.scenarioId, "未取得")} | ${cell(scenario.originalContent, "未取得")} | ${cell(scenario.reasonCode, "未取得")} | ${cell(scenario.reason, "未取得")} | ${cell(scenario.evidence == null ? "未取得" : structuredValue(scenario.evidence))} |`));
    reviewerRows.push(`| ${cell(target.target)} | ${cell(reviewItems(target.review.issues, "；"), "無")} | ${cell(reviewItems(target.review.missingTestCases, "；"), "無")} | ${cell(reviewItems(target.review.improvements, "；"), "無")} |`);
    const gaps = [...(target.coverageDecision.repairable ?? []), ...(target.coverageDecision.uncoverable ?? [])]
      .map((gap) => `${gap.id}: ${gap.reason}`).join("; ") || "無";
    decisionRows.push(`| ${cell(target.target)} | ${cell(target.coverageDecision.status)} | ${cell(target.coverageDecision.reason)} | ${display(target.coverageDecision.repairRound, 0)}/${display(target.coverageDecision.maxRepairRounds, 1)} | ${cell(gaps)} | ${target.releaseEligible === true ? "yes" : "no"} |`);
    skillRows.push(`| ${cell(target.target)} | ${cell(target.skills.writer.join(", ") || "無")} |`);
    analyzerSkillRows.push(`| ${cell(target.target)} | ${cell(target.skills.analyzerObserved.join(", ") || "無")} |`);
    const attempt = target.execution.attempt && typeof target.execution.attempt === "object"
      ? target.execution.attempt : { executionAttempt: finite(target.execution.attempt) };
    const fixRound = nonNegativeInteger(attempt.fixRound);
    const repairs = array(target.execution.repairHistory);
    const repairText = repairs.length > 0
      ? repairs.map((entry) => [
        `attempt ${entry.attempt ?? "未取得"}`, entry.classification, entry.summary,
        entry.filesChanged.length > 0 ? `files=${entry.filesChanged.join(", ")}` : null,
        entry.outcome == null ? null : `outcome=${structuredValue(entry.outcome)}`,
      ].filter(Boolean).join("；")).join("<br>")
      : (fixRound === 0 ? "無修正" : "修正內容未提供");
    repairRows.push(`| ${cell(target.target)} | ${fixRound === null ? "未取得" : fixRound} | ${cell(repairText)} |`);
    diagnosticRows.push(`| ${cell(target.target)} | ${number(attempt.executionAttempt)} | ${number(attempt.fixRound)} | ${number(attempt.maxFixRounds)} | ${cell(attempt.repairEligible)} | ${cell(target.execution.build.warnings)} |`);
    deliveryRows.push(...(target.testFiles.length > 0
      ? target.testFiles.map((file) => `- ${target.target} test file: \`${file}\``)
      : [`- ${target.target} test file: ${target.testFilesStatus === "unavailable" ? "未取得" : "無"}`]));
    const evidence = target.execution.evidencePaths;
    const evidenceRows = evidence && typeof evidence === "object" && !Array.isArray(evidence)
      ? Object.entries(evidence) : array(evidence).map((item, index) => [`evidence-${index + 1}`, item]);
    deliveryRows.push(...evidenceRows.map(([kind, file]) => `- ${target.target} ${kind}: \`${file}\``));
  }

  const timingEvidenceRows = [];
  for (const name of phaseNames) {
    const phase = result.timing.phases[name];
    if (phase.assignments.length === 0) {
      timingEvidenceRows.push(`| ${name} | unavailable | unavailable | ${cell(phase.startAt)} | unavailable | ${cell(phase.endAt)} | unavailable |`);
    } else {
      for (const assignment of phase.assignments) {
        const critical = assignment.assignmentId === phase.criticalAssignmentId ? "critical path" : assignment.timingNote;
        timingEvidenceRows.push(`| ${name} | ${cell(assignment.target)} | ${cell(assignment.assignmentId)} | ${cell(assignment.dispatchIssuedAt)} | ${cell(assignment.artifactReadyAt)} | ${cell(assignment.completedAt)} | ${cell(critical)} |`);
      }
    }
  }

  return [
    "# Unit workflow result", "", `Decision: ${result.decision}`, "",
    "## 測試結果總覽", "",
    "| Target | 測試檔案 | 負責方法範圍 | 測試宣告數 | Build/Test 結果 | Reviewer 評分 |",
    "|---|---|---|---:|---|---|", ...overviewRows, "",
    "| Target | TRX 實際執行數 |", "|---|---:|",
    ...result.targets.map((item) => `| ${cell(item.target)} | ${Number.isInteger(item.execution.test.total) ? item.execution.test.total : "未取得"} |`), "",
    "| Target | 執行案例 | Coverage |", "|---|---|---|", ...executionRows, "",
    "## 情境覆蓋", "", "| Target | Effective scenarios | Implemented | Missing |", "|---|---:|---:|---:|", ...scenarioRows, "",
    ...(userScenarioRows.length > 0 ? [
      "### 使用者情境處理摘要", "",
      "| Target | Provided | Accepted | Normalized | Limited | Merged | Rejected | Analyzer supplemented | Coverage |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---|", ...userScenarioRows, "",
    ] : []),
    ...(rejectedRows.length > 0 ? [
      "### 被拒絕的使用者情境", "", "| Target | Scenario | 原始內容 | Reason code | 具體理由 | Evidence |",
      "|---|---|---|---|---|---|", ...rejectedRows, "",
    ] : []),
    "## Reviewer 結論", "", "| Target | Issues | Missing test cases | Warning 以上改善建議 |",
    "|---|---|---|---|", ...reviewerRows, "",
    "| Target | Coverage decision | Reason | Repair round | Gaps | Release eligible |",
    "|---|---|---|---:|---|---|", ...decisionRows, "",
    `Release eligible: ${result.releaseEligible === true ? "yes" : "no"}`, "",
    "## 修正、異常與交付", "", "### 使用的技術組合", "", "| Target | Loaded skills |", "|---|---|", ...skillRows, "",
    "### Analyzer 技術型 Skill 讀取", "", "| Target | Observed technical skills |", "|---|---|", ...analyzerSkillRows, "",
    "### Executor 修正紀錄", "", "| Target | Fix rounds | 修正內容 |", "|---|---:|---|", ...repairRows, "",
    "### 執行診斷", "", "| Target | executionAttempt | fixRound | maxFixRounds | repairEligible | buildWarnings |",
    "|---|---:|---:|---:|---|---|", ...diagnosticRows, "", "### 交付產物", "", ...deliveryRows,
    "",
    ...renderTiming(result),
    "## Timing Evidence", "", "Source: `.orchestrator/run-state.json`", "",
    "| Phase | Target | Assignment | Dispatch issued | Artifact ready | Completed | Critical path / note |",
    "|---|---|---|---|---|---|---|", ...timingEvidenceRows, "",
    ...renderProfiling(result),
    ...renderUsageDelivery(result.usageDelivery),
  ].join("\n");
}

function parseArgs(argv) {
  const result = { mode: "legacy" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "final") result.mode = "final";
    else if (key === "--input") result.input = argv[++index];
    else if (key === "--target") result.target = argv[++index];
    else if (key === "--analysis") result.analysis = argv[++index];
    else if (key === "--writer") result.writer = argv[++index];
    else if (key === "--execution") result.execution = argv[++index];
    else if (key === "--review") result.review = argv[++index];
    else if (key === "--workflow-state") result.workflowState = argv[++index];
    else if (key === "--decision-state") result.decisionState = argv[++index];
    else if (key === "--run-state") result.runState = argv[++index];
    else if (key === "--workspace-root") result.workspaceRoot = argv[++index];
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

function recordPresentation(statePath, jsonOutput, markdownOutput, terminalDecision) {
  const runState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (runState.workflow !== "unit") throw new Error("presentation receipt requires workflow=unit");
  if (runState.terminalDecision !== terminalDecision) {
    throw new Error("run-state terminalDecision does not match rendered Unit result");
  }
  if (runState.presentation?.status === "completed") {
    throw new Error("Unit canonical presentation is already completed");
  }
  if (runState.presentation?.status !== "pending") {
    throw new Error("Unit presentation state must be pending before rendering");
  }
  const digest = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  runState.presentation = {
    status: "completed",
    renderer: "unit-runtime/workflow-result.mjs",
    renderedAt: new Date().toISOString(),
    terminalDecision,
    jsonOutput,
    jsonSha256: digest(jsonOutput),
    markdownOutput,
    markdownSha256: digest(markdownOutput),
  };
  fs.writeFileSync(statePath, `${JSON.stringify(runState, null, 2)}\n`);
}

function readJsonIfFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function finalizationEvidence(args) {
  const explicitRunState = args.runState ? path.resolve(args.runState) : null;
  if (!args.testProject) {
    return {
      runState: readJsonIfFile(explicitRunState),
      orchestratorRoot: null,
    };
  }

  const testProjectPath = path.resolve(args.testProject);
  const testProjectDir = fs.existsSync(testProjectPath) && fs.statSync(testProjectPath).isDirectory()
    ? testProjectPath : path.dirname(testProjectPath);
  const orchestratorDir = path.join(testProjectDir, ".orchestrator");
  const runStatePath = explicitRunState ?? path.join(orchestratorDir, "run-state.json");
  return { runState: readJsonIfFile(runStatePath), orchestratorRoot: orchestratorDir };
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
  if ([Boolean(args.input), usesComponents, usesTerminalState].filter(Boolean).length > 1) {
    throw new Error("--input, --workflow-state and component artifacts are mutually exclusive");
  }
  const evidence = finalizationEvidence(args);
  if (args.mode === "final") {
    if (!args.runState) throw new Error("final mode requires --run-state");
    if (!evidence.runState || evidence.runState.workflow !== "unit") {
      throw new Error("final mode requires workflow=unit run-state");
    }
    if (typeof evidence.runState.terminalDecision !== "string"
        || !evidence.runState.terminalCloseout
        || !evidence.runState.profilingSummary) {
      throw new Error("final mode requires deterministic closeout and finalize truth");
    }
  }
  let result;
  if (usesTerminalState) {
    const workflowState = JSON.parse(fs.readFileSync(path.resolve(args.workflowState), "utf8"));
    const options = {
      ...evidence,
      orchestratorRoot: evidence.orchestratorRoot ?? path.dirname(path.resolve(args.workflowState)),
    };
    result = args.target
      ? buildUnitTerminalWorkflowResult(workflowState, args.target, options)
      : buildUnitAggregateWorkflowResult(workflowState, options);
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
  if (args.mode === "final" && args.workspaceRoot) {
    try {
      result.usageDelivery = usageReportLink({ workspaceRoot: args.workspaceRoot, runStatePath: path.resolve(args.runState) });
    } catch (error) {
      result.usageDelivery = { status: "unavailable", reason: error.message };
    }
  }
  for (const output of [args.jsonOutput, args.markdownOutput].map((item) => path.resolve(item))) {
    if (fs.existsSync(output)) throw new Error(`workflow result already exists: ${output}`);
  }
  const markdown = Array.isArray(result.targets)
    ? renderUnitAggregateWorkflowResult(result) : renderUnitWorkflowResult(result);
  const jsonOutput = writeNew(args.jsonOutput, `${JSON.stringify(result, null, 2)}\n`);
  const markdownOutput = writeNew(args.markdownOutput, markdown);
  if (args.mode === "final") {
    recordPresentation(path.resolve(args.runState), jsonOutput, markdownOutput, result.decision);
    process.stdout.write(`${markdown}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({
    decision: result.decision,
    ...(Array.isArray(result.targets) ? { targetCount: result.targets.length } : {}),
    jsonOutput,
    markdownOutput,
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(`unit workflow result error: ${error.message}`);
    process.exitCode = 1;
  }
}
