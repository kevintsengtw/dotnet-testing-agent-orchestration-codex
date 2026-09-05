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
    throw new Error(`${label} gap requires concrete evidence`);
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

export function validateCoverageDecision({
  execution,
  reviewerDecision,
  repairRound = 0,
  maxRepairRounds = 1,
}) {
  if (!Number.isInteger(repairRound) || repairRound < 0) throw new Error("repairRound must be a non-negative integer");
  if (!Number.isInteger(maxRepairRounds) || maxRepairRounds !== 1) throw new Error("maxRepairRounds must be exactly 1");
  const decision = requireDecision(reviewerDecision);

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
