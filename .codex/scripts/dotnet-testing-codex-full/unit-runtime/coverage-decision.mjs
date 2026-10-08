const decisions = new Set(["pass", "needs_repair", "best_effort", "fail", "blocked"]);

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateGap(gap, label) {
  if (!gap || typeof gap !== "object" || Array.isArray(gap)) throw new Error(`${label} gap must be an object`);
  for (const field of ["id", "metric", "reason", "action"]) {
    if (!nonEmpty(gap[field])) throw new Error(`${label} gap requires ${field}`);
  }
  if (!new Set(["line", "branch", "mixed"]).has(gap.metric)) throw new Error(`${label} gap metric is invalid`);
  if (!gap.evidence || typeof gap.evidence !== "object" || Array.isArray(gap.evidence)
      || Object.keys(gap.evidence).length === 0) {
    throw new Error(`${label} gap evidence must be a non-empty JSON object (not a string or array)`);
  }
}

function requireDecision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("coverageDecision is required");
  if (!decisions.has(value.status)) throw new Error(`unsupported coverageDecision status: ${value.status}`);
  if (!Array.isArray(value.repairable) || !Array.isArray(value.uncoverable)) {
    throw new Error("coverageDecision repairable and uncoverable must be arrays");
  }
  if (!nonEmpty(value.reason)) throw new Error("coverageDecision requires a non-empty reason");
  value.repairable.forEach((gap) => validateGap(gap, "repairable"));
  value.uncoverable.forEach((gap) => validateGap(gap, "uncoverable"));
  return value;
}

function validateMeasuredCoverage(coverage) {
  if (coverage?.status !== "available") throw new Error("coverage evidence is unavailable");
  if (!coverage.scope || !nonEmpty(coverage.scope.targetClass) || !nonEmpty(coverage.scope.targetSource)
      || !Array.isArray(coverage.scope.matchedClasses) || coverage.scope.matchedClasses.length === 0) {
    throw new Error("coverage evidence requires target scope");
  }
  for (const metric of ["line", "branch"]) {
    const value = coverage[metric];
    if (!value || !Number.isFinite(value.percent) || !Number.isFinite(value.threshold)
        || typeof value.met !== "boolean") throw new Error(`coverage ${metric} metric is invalid`);
    if (value.met !== (value.percent >= value.threshold)) throw new Error(`coverage ${metric} threshold result is inconsistent`);
  }
  if (coverage.goalMet !== (coverage.line.met && coverage.branch.met)) {
    throw new Error("coverage goal result is inconsistent");
  }
}

export function executionFailureKind(execution) {
  const kind = execution?.status;
  if (!["build_failed", "test_failed", "environment_failed"].includes(kind)) return null;
  const build = execution.build;
  const test = execution.test;
  const nonzero = (value) => Number.isInteger(value) && value !== 0;
  const consistent = (kind === "build_failed" || (kind === "environment_failed" && execution.environmentFailureStage === "restore"))
    ? build?.status === "failed" && nonzero(build.exitCode)
      && test?.status === "not_run" && test.counts == null
      && execution.coverage?.status === "not_applicable"
      && execution.coverage.line == null && execution.coverage.branch == null
    : build?.status === "passed" && test?.status === "failed"
      && (nonzero(test.exitCode) || test.counts?.failed > 0)
      && (kind !== "environment_failed" || (nonzero(test.exitCode) && test.counts?.failed === 0));
  if (!consistent) throw new Error("inconsistent execution failure evidence");
  return kind;
}

export function validateCoverageDecision({
  execution,
  reviewerDecision,
  repairRound = 0,
  maxRepairRounds = 1,
}) {
  if (!Number.isInteger(repairRound) || repairRound < 0) throw new Error("repairRound must be a non-negative integer");
  if (!Number.isInteger(maxRepairRounds) || maxRepairRounds !== 1) throw new Error("maxRepairRounds must be exactly 1");
  const decision = requireDecision(reviewerDecision);
  const executionFailure = executionFailureKind(execution);
  if (executionFailure) {
    if (!["blocked", "fail"].includes(decision.status)
        || decision.repairable.length > 0 || decision.uncoverable.length > 0) {
      throw new Error("execution failure requires fail/blocked without Coverage repair or gaps");
    }
    return { ...decision, status: "fail", executionFailure, releaseEligible: false,
      terminalDecision: "failed", repairRound, maxRepairRounds };
  }

  if (execution?.status === "blocked") {
    if (execution.build?.status !== "not_run" || execution.test?.status !== "not_run"
        || execution.coverage?.status !== "not_applicable" || decision.status !== "blocked") {
      throw new Error("blocked execution requires blocked/not_applicable Coverage decision");
    }
    if (decision.repairable.length > 0 || decision.uncoverable.length > 0) {
      throw new Error("blocked Coverage decision cannot request repair or best effort");
    }
    return { ...decision, releaseEligible: false, terminalDecision: "blocked", repairRound, maxRepairRounds };
  }

  if (execution?.build?.status !== "passed" || execution?.test?.status !== "passed") {
    throw new Error("Coverage decision requires successful build and test evidence");
  }
  validateMeasuredCoverage(execution.coverage);
  const met = execution.coverage.goalMet;
  if (met) {
    if (decision.status !== "pass" || decision.repairable.length > 0 || decision.uncoverable.length > 0) {
      throw new Error("coverage goal met requires pass without gaps");
    }
    return { ...decision, releaseEligible: true, terminalDecision: "completed", repairRound, maxRepairRounds };
  }

  if (decision.status === "pass") throw new Error("coverage goal is unmet and cannot pass");
  if (decision.status === "needs_repair") {
    if (repairRound >= maxRepairRounds) throw new Error("Coverage repair budget exhausted");
    if (decision.repairable.length === 0) throw new Error("needs_repair requires a repairable gap");
    return {
      ...decision, releaseEligible: false, terminalDecision: null,
      nextAction: "writer_repair", repairRound: repairRound + 1, maxRepairRounds,
    };
  }
  if (decision.status === "best_effort") {
    if (decision.repairable.length > 0 || decision.uncoverable.length === 0) {
      throw new Error("best_effort requires only concrete uncoverable gaps");
    }
    return { ...decision, releaseEligible: false, terminalDecision: "completed", repairRound, maxRepairRounds };
  }
  if (decision.status === "fail") {
    if (decision.repairable.length + decision.uncoverable.length === 0) {
      throw new Error("fail requires concrete Coverage gap evidence");
    }
    return { ...decision, releaseEligible: false, terminalDecision: "failed", repairRound, maxRepairRounds };
  }
  throw new Error(`coverage goal is unmet and decision ${decision.status} is invalid`);
}

export function deriveCoverageDecision({execution,reviewerDecision={},repairRound=0,maxRepairRounds=1}) {
  const failure=executionFailureKind(execution);
  const repairable=Array.isArray(reviewerDecision.repairable)?reviewerDecision.repairable:[];
  const uncoverable=Array.isArray(reviewerDecision.uncoverable)?reviewerDecision.uncoverable:[];
  let status,reason;
  if(failure){status="fail";reason=`Execution failed: ${failure}`;}
  else if(execution.status==="blocked"){status="blocked";reason="Execution was blocked";}
  else if(execution.coverage?.status!=="available"){status="blocked";reason=execution.coverage?.reason??"Coverage evidence unavailable";}
  else {
    validateMeasuredCoverage(execution.coverage);
    if(execution.coverage.goalMet){status="pass";reason="Coverage goal met";}
    else if(repairable.length){status=repairRound<maxRepairRounds?"needs_repair":"fail";reason=status==="fail"?"Coverage repair budget exhausted":reviewerDecision.reason??"Repairable Coverage gaps";}
    else if(uncoverable.length){status="best_effort";reason=reviewerDecision.reason??"Only uncoverable gaps remain";}
    else throw new Error("Coverage 未達標，需要缺口分類：提供 repairable 或 uncoverable");
  }
  return {status,reason,repairable:status==="pass"?[]:repairable,uncoverable:status==="pass"?[]:uncoverable,
    repairRound:status==="needs_repair"?repairRound+1:repairRound,maxRepairRounds,releaseEligible:status==="pass",
    terminalDecision:status==="needs_repair"?null:status==="fail"?"failed":status==="blocked"?"blocked":"completed",
    ...(failure?{executionFailure:failure}:{}),...(status==="needs_repair"?{nextAction:"writer_repair"}:{})};
}
