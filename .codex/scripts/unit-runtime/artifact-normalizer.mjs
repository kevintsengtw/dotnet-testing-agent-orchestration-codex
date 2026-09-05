import { validateCoverageDecision } from "./coverage-decision.mjs";

const effectiveStatuses = new Set([
  "accepted",
  "accepted_with_normalization",
  "accepted_with_limitation",
]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function requireCount(value, name, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function normalizeExecution(execution, decision) {
  const build = requireObject(execution.build, "execution.build");
  const test = requireObject(execution.test, "execution.test");
  const coverage = requireObject(execution.coverage, "execution.coverage");

  if (decision === "blocked") {
    if (build.status !== "not_run" || test.status !== "not_run") {
      throw new Error("blocked execution must use not_run build and test status");
    }
    const countFields = ["total", "passed", "failed", "skipped"];
    const hasNestedCounts = Object.hasOwn(test, "counts");
    const nestedCountsInvalid = hasNestedCounts && test.counts !== null;
    const topLevelCountsInvalid = hasNestedCounts
      ? countFields.some((field) => Object.hasOwn(test, field) && test[field] !== null)
      : countFields.some((field) => test[field] !== null);
    if (nestedCountsInvalid || topLevelCountsInvalid) {
      throw new Error("blocked execution test counts must be null");
    }
    if (coverage.status !== "not_applicable" || coverage.line !== null || coverage.branch !== null) {
      throw new Error("blocked execution coverage must be not_applicable with null values");
    }
    return {
      build: "not_run",
      test: { status: "not_run", total: null, passed: null, failed: null, skipped: null },
      coverage: { status: "not_applicable", scope: null, line: null, branch: null, goalMet: null },
    };
  }

  if (build.status === "passed" && build.exitCode !== 0) {
    throw new Error("build passed contradicts a non-zero exit code");
  }
  if (test.status === "passed" && test.exitCode !== 0) {
    throw new Error("test passed contradicts a non-zero exit code");
  }

  const rawCounts = test.counts ?? test;
  const counts = {
    total: requireCount(rawCounts.total, "execution.test.total"),
    passed: requireCount(rawCounts.passed, "execution.test.passed"),
    failed: requireCount(rawCounts.failed, "execution.test.failed"),
    skipped: requireCount(rawCounts.skipped, "execution.test.skipped"),
  };
  if (counts.total !== counts.passed + counts.failed + counts.skipped) {
    throw new Error("execution test counts are inconsistent");
  }
  if (test.status === "passed" && counts.failed !== 0) {
    throw new Error("test passed contradicts failed test cases");
  }

  const metric = (value) => value && typeof value === "object"
    ? { percent: value.percent, threshold: value.threshold ?? null, met: value.met ?? null }
    : { percent: value ?? null, threshold: null, met: null };
  return {
    build: build.status,
    test: { status: test.status, ...counts },
    coverage: {
      status: coverage.status ?? "available",
      scope: coverage.scope ?? null,
      line: metric(coverage.line),
      branch: metric(coverage.branch),
      goalMet: coverage.goalMet ?? null,
    },
  };
}

export function normalizeUnitArtifacts(input) {
  requireObject(input, "artifacts");
  const analysis = requireObject(input.analysis, "analysis");
  const writer = requireObject(input.writer, "writer");
  const review = requireObject(input.review, "review");
  const executionInput = requireObject(input.execution, "execution");
  if (typeof input.target !== "string" || input.target.trim() === "") throw new Error("target is required");

  const effective = array(analysis.scenarioCatalog).filter((scenario) => effectiveStatuses.has(scenario?.status));
  const effectiveIds = new Set(effective.map((scenario) => scenario.scenarioId));
  if (effectiveIds.size !== effective.length) throw new Error("scenario IDs must be unique");

  const coverageEntries = array(writer.scenarioCoverage);
  const coverageById = new Map();
  for (const coverage of coverageEntries) {
    if (!effectiveIds.has(coverage?.scenarioId)) throw new Error(`unexpected scenario coverage: ${coverage?.scenarioId}`);
    if (coverageById.has(coverage.scenarioId)) throw new Error(`duplicate scenario coverage: ${coverage.scenarioId}`);
    coverageById.set(coverage.scenarioId, coverage);
  }
  for (const scenario of effective) {
    if (!coverageById.has(scenario.scenarioId)) throw new Error(`scenario coverage missing: ${scenario.scenarioId}`);
  }

  const implemented = effective.filter((scenario) => coverageById.get(scenario.scenarioId)?.status === "implemented");
  const missing = effective.length - implemented.length;
  const blocked = writer.status === "blocked" || review.qualityDecision === "blocked";
  let decision = blocked ? "blocked" : "completed";
  if (decision === "completed" && missing > 0) throw new Error("completed artifacts contain non-implemented scenarios");
  if (decision === "completed" && review.qualityDecision !== "pass") {
    throw new Error("completed artifacts require a passing quality decision");
  }

  const execution = normalizeExecution(executionInput, decision);
  const coverageDecision = validateCoverageDecision({
    execution: decision === "blocked" && !executionInput.status
      ? { ...executionInput, status: "blocked" }
      : executionInput,
    reviewerDecision: review.coverageDecision,
    repairRound: Number.isInteger(review.coverageDecision?.repairRound) ? review.coverageDecision.repairRound : 0,
    maxRepairRounds: 1,
  });
  if (coverageDecision.terminalDecision === "failed") decision = "failed";
  const files = [...new Set(array(writer.testFilePaths).map(String))].sort();
  if (decision === "completed" && files.length === 0) throw new Error("completed writer requires test files");
  if (decision === "blocked" && files.length !== 0) throw new Error("blocked writer cannot claim test files");

  return {
    schemaVersion: 1,
    decision,
    core: {
      target: input.target,
      scenario: { effective: effective.length, implemented: implemented.length, missing },
      files,
      build: execution.build,
      test: execution.test,
      quality: review.qualityDecision,
    },
    coverage: execution.coverage,
    coverageDecision,
    issues: array(review.issues),
    missingTestCases: array(review.missingTestCases),
  };
}
