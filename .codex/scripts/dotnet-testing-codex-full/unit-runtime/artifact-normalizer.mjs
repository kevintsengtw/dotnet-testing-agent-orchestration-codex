import { executionFailureKind, validateCoverageDecision, deriveCoverageDecision } from "./coverage-decision.mjs";

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

  if (executionFailureKind(execution) && execution.build?.status === "failed") {
    return {
      build: "failed",
      test: { status: "not_run", total: null, passed: null, failed: null, skipped: null },
      coverage: { status: "not_applicable", scope: null, line: null, branch: null, goalMet: null },
    };
  }

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
  const blocked = writer.status === "blocked" || (!review.runtimeDerived && review.qualityDecision === "blocked");
  const executionFailure = executionFailureKind(executionInput);
  if (!review.runtimeDerived && executionFailure && !["fail", "blocked"].includes(review.qualityDecision)) {
    throw new Error("execution failure requires a non-passing quality decision");
  }
  let decision = executionFailure ? "failed" : blocked ? "blocked" : "completed";
  if (!review.runtimeDerived && decision === "completed" && missing > 0) throw new Error("completed artifacts contain non-implemented scenarios");
  if (!review.runtimeDerived && decision === "completed" && review.qualityDecision !== "pass") {
    throw new Error("completed artifacts require a passing quality decision");
  }

  const execution = normalizeExecution(executionInput, decision);
  const coverageDecision = review.runtimeDerived ? review.coverageDecision : validateCoverageDecision({
    execution: decision === "blocked" && !executionInput.status
      ? { ...executionInput, status: "blocked" }
      : executionInput,
    reviewerDecision: review.coverageDecision,
    repairRound: Number.isInteger(review.coverageDecision?.repairRound) ? review.coverageDecision.repairRound : 0,
    maxRepairRounds: 1,
  });
  if (review.runtimeDerived) decision = review.gateDecision === "fail" ? "failed" : review.gateDecision === "blocked" ? "blocked" : "completed";
  if (coverageDecision.terminalDecision === "failed") decision = "failed";
  const files = [...new Set(array(writer.testFilePaths).map(String))].sort();
  if (decision === "completed" && files.length === 0) throw new Error("completed writer requires test files");
  if (decision === "blocked" && writer.status === "blocked" && files.length !== 0) throw new Error("blocked writer cannot claim test files");

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

// Declaration counts are not data-expanded TRX execution counts.
export function countTestDeclarations(source) {
  const unavailable = (reason) => ({ status: "unavailable", count: null, reason });
  if (/^\s*#(?:if|elif|else|endif)\b/m.test(source)) return unavailable("條件編譯的測試宣告無法可靠辨識");
  if (/\busing\s+\w+\s*=/.test(source)) return unavailable("屬性別名需要語意解析");
  let clean = "";
  for (let i = 0; i < source.length;) {
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i); i = end < 0 ? source.length : end; clean += " ";
    } else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) return unavailable("未結束的註解");
      i = end + 2; clean += " ";
    } else if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      const raw = quote === '"' ? source.slice(i).match(/^"{3,}/)?.[0] : null;
      if (raw) {
        const end = source.indexOf(raw, i + raw.length);
        if (end < 0) return unavailable("未結束的 raw string");
        i = end + raw.length; clean += " "; continue;
      }
      const verbatim = source[i - 1] === "@" || source.slice(Math.max(0, i - 2), i) === "@$";
      let ended = false; i++;
      while (i < source.length) {
        if (!verbatim && source[i] === "\\") { i += 2; continue; }
        if (source[i] === quote) {
          if (verbatim && source[i + 1] === quote) { i += 2; continue; }
          i++; ended = true; break;
        }
        i++;
      }
      if (!ended) return unavailable("未結束的字串");
      clean += " ";
    } else { clean += source[i++]; }
  }
  let count = 0;
  const groups = [...clean.matchAll(/(?:\[[^\[\]]*\]\s*)+/g)];
  for (const group of groups) {
    const attributes = group[0];
    if (!/(?:\[|,)\s*(?:(?:global::)?Xunit\.)?(?:Fact|Theory)(?:Attribute)?\b/.test(attributes)) continue;
    const tail = clean.slice(group.index + attributes.length);
    const header = tail.match(/^\s*([^;{}=]+?)\(/)?.[1];
    if (!header || /\b(?:class|struct|record|interface)\b/.test(header)) return unavailable("測試屬性未對應可辨識的方法宣告");
    count++;
  }
  return { status: "available", count, reason: null };
}

export function buildGateDisplay({ role, document, execution, durationMs, declarations }) {
  const phase = role.replace(/Repair$/, "");
  const number = (value, reason, source) => Number.isFinite(value) && value >= 0
    ? { value, text: String(value), reason: null, source }
    : { value: null, text: "未取得", reason, source };
  const display = { role, phase, status: document.status,
    duration: number(durationMs, "run-state 尚未提供已 derive 的階段耗時", `run-state.phases.${phase}.durationMs`) };
  if (display.duration.value !== null) display.duration.text = `${durationMs} ms`;
  if (phase === "analyzer") {
    display.methodCount = number(Array.isArray(document.methodsToTest) ? new Set(document.methodsToTest).size : null, "Analyzer 未提供方法清單", "analysis.methodsToTest");
    display.dependencyCount = number(Array.isArray(document.dependencies) ? document.dependencies.length : null, "Analyzer 未提供依賴清單", "analysis.dependencies");
    display.techniques = { value: document.requiredTechniques ?? null,
      text: Array.isArray(document.requiredTechniques) ? document.requiredTechniques.join("、") || "無" : "未取得",
      reason: Array.isArray(document.requiredTechniques) ? null : "Analyzer 未提供技術清單", source: "analysis.requiredTechniques" };
  } else if (phase === "writer") {
    display.declarationCount = number(declarations?.count, declarations?.reason ?? "未取得測試宣告數", "writer gate.testDeclarations");
  } else if (phase === "executor") {
    for (const name of ["passed", "failed", "skipped"]) display[name] = number(execution?.test?.counts?.[name], "Executor 未提供實際測試結果", `execution.test.counts.${name}`);
    display.fixRounds = number(execution?.attempt?.fixRound, "Executor 未提供修正次數", "execution.attempt.fixRound");
    display.buildStatus = execution?.build?.status ?? "未取得";
    display.testStatus = execution?.test?.status ?? "未取得";
  } else if (phase === "reviewer") {
    display.gateDecision = { value: document.gateDecision ?? null, text: document.gateDecision ?? "未取得",
      reason: document.gateDecision ? null : "Reviewer 未提供 gateDecision", source: "reviewer.gateDecision" };
  }
  display.reason = document.runtimeReason ?? document.blockers ?? document.failure?.message ?? document.coverageDecision?.reason ?? "未取得原因";
  return display;
}

export function deriveScenarioCoverage(analysis,writer,review) {
 const effective=array(analysis.scenarioCatalog).filter(s=>effectiveStatuses.has(s.status));
 const implemented=new Set(array(writer.scenarioCoverage).filter(s=>s.status==="implemented").map(s=>s.scenarioId));
 const users=effective.filter(s=>s.source==="user").map(s=>s.scenarioId);
 const dataMismatchScenarioIds=review.dataMismatchScenarioIds??review.userScenarioCoverage?.dataMismatchScenarioIds??[];
 const missingEffectiveScenarioIds=effective.filter(s=>!implemented.has(s.scenarioId)).map(s=>s.scenarioId);
 return {acceptedScenarioIds:users,implementedScenarioIds:users.filter(id=>implemented.has(id)),missingScenarioIds:users.filter(id=>!implemented.has(id)),
 dataMismatchScenarioIds,rejectedScenarioIdsExcluded:array(analysis.scenarioCatalog).filter(s=>s.source==="user"&&s.status==="rejected").map(s=>s.scenarioId),
 coverageComplete:users.every(id=>implemented.has(id))&&dataMismatchScenarioIds.length===0,missingEffectiveScenarioIds};
}
export function deriveReviewerProjection({analysis,writer,execution,review,repairRound=0,maxRepairRounds=1}) {
 const userScenarioCoverage=deriveScenarioCoverage(analysis,writer,review);
 const quality=review.qualityDecision;
 const semanticErrors=[];
 if(!["pass","fail","blocked"].includes(quality)) semanticErrors.push("qualityDecision must be pass/fail/blocked");
 const concreteIssue=issue=>typeof issue==="string"?issue.trim().length>0:issue&&typeof issue==="object"&&Object.values(issue).some(v=>typeof v==="string"&&v.trim());
 if(quality!=="pass"&&(!Array.isArray(review.issues)||!review.issues.length||!review.issues.every(concreteIssue))) semanticErrors.push("non-pass qualityDecision requires concrete issues");
 if(!Array.isArray(userScenarioCoverage.dataMismatchScenarioIds)) semanticErrors.push("dataMismatchScenarioIds must be an array");
 const coverageDecision=deriveCoverageDecision({execution,reviewerDecision:review.coverageDecision,repairRound,maxRepairRounds});
 const failure=executionFailureKind(execution);
 const scenarioFailed=userScenarioCoverage.missingEffectiveScenarioIds.length>0||userScenarioCoverage.dataMismatchScenarioIds.length>0;
 const otherFailure=failure||quality==="fail"||scenarioFailed||semanticErrors.length;
 const gateDecision=failure||quality==="fail"||scenarioFailed||["fail","needs_repair"].includes(coverageDecision.status)||semanticErrors.length?"fail"
   :quality==="blocked"||execution.status==="blocked"||coverageDecision.status==="blocked"?"blocked":"pass";
 const inconsistencies=[];
 for(const [field,provided,derived] of [["gateDecision",review.gateDecision,gateDecision],["coverageDecision.status",review.coverageDecision?.status,coverageDecision.status]])
   if(provided!==undefined&&provided!==derived)inconsistencies.push({field,provided,derived});
 return {...review,runtimeDerived:true,qualityDecision:quality,dataMismatchScenarioIds:userScenarioCoverage.dataMismatchScenarioIds,userScenarioCoverage,coverageDecision,gateDecision,semanticErrors,inconsistencies,
   runtimeReason:semanticErrors.length?semanticErrors.join("; "):scenarioFailed?"Scenario missing or data mismatch":quality!=="pass"?JSON.stringify(review.issues):coverageDecision.reason,
   runtimeOutcome:coverageDecision.status==="needs_repair"&&!otherFailure&&quality==="pass"?"needs_repair":gateDecision==="fail"?"fail":gateDecision==="blocked"?"blocked":coverageDecision.status};
}
