#!/usr/bin/env node

import fs from "node:fs";

const EFFECTIVE_STATUSES = new Set(["accepted", "accepted_with_normalization", "accepted_with_limitation"]);
const SCENARIO_STATUSES = new Set([...EFFECTIVE_STATUSES, "merged", "rejected"]);
const COVERAGE_STATUSES = new Set(["implemented", "blocked", "limitation"]);
const GATE_DECISIONS = new Set(["pass", "pass_with_warnings", "fail", "blocked"]);
const TOPOLOGIES = new Set(["legacy-auto-single", "legacy-auto-two-step", "two-step-control", "single"]);
const ASSIGNMENT_ROLES = new Set(["full", "infrastructure", "tests"]);

function parseArgs(argv) {
  const args = { writers: [], requireReviewPass: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--analysis") args.analysis = argv[++index];
    else if (arg === "--writer") args.writers.push(argv[++index]);
    else if (arg === "--reviewer") args.reviewer = argv[++index];
    else if (arg === "--require-review-pass") args.requireReviewPass = true;
    else if (arg === "--static-only") args.staticOnly = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return "Usage: node .codex/scripts/validators/validate-integration-scenario-contract.mjs [--static-only] [--analysis <analysis.json> --writer <writer-result.json> ... --reviewer <reviewer-result.json> --require-review-pass]";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sameSet(left, right) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function requireTelemetry(value, label, errors) {
  if (!Array.isArray(value?.tokenEstimateInputs?.readFiles) || !Array.isArray(value?.tokenEstimateInputs?.writtenFiles)) {
    errors.push(`${label}: canonical tokenEstimateInputs readFiles/writtenFiles are required`);
  }
}

function validIdentifier(value) {
  return typeof value === "string"
    && value.trim() !== ""
    && !/[\s.\-+()\/\\:[\]{}]/u.test(value)
    && !/^\d/u.test(value);
}

function validateAnalysis(analysis, errors) {
  requireTelemetry(analysis, "analysis", errors);
  if (!Array.isArray(analysis.endpointCatalog) || analysis.endpointCatalog.length === 0) {
    errors.push("analysis.endpointCatalog must be a non-empty array");
    return { endpointIds: new Set(), effective: [] };
  }
  const endpointIds = new Set();
  for (const endpoint of analysis.endpointCatalog) {
    if (!/^END-\d{3}$/.test(endpoint?.endpointId ?? "")) errors.push(`invalid endpointId: ${endpoint?.endpointId ?? "missing"}`);
    else if (endpointIds.has(endpoint.endpointId)) errors.push(`duplicate endpointId: ${endpoint.endpointId}`);
    else endpointIds.add(endpoint.endpointId);
    for (const field of ["controller", "action", "httpMethod", "route"]) {
      if (typeof endpoint?.[field] !== "string" || endpoint[field].trim() === "") errors.push(`${endpoint?.endpointId ?? "endpoint"}.${field} is required`);
    }
  }
  const endpointReferences = (analysis.endpointsToTest ?? []).map((item) => item?.endpointId).filter(Boolean);
  if (!sameSet(endpointReferences, [...endpointIds])) errors.push("endpointsToTest endpoint IDs must exactly match endpointCatalog");

  if (!analysis.userProvidedScenarioInput || typeof analysis.userProvidedScenarioInput.present !== "boolean") {
    errors.push("analysis.userProvidedScenarioInput.present is required");
  } else if (analysis.userProvidedScenarioInput.present
      && (typeof analysis.userProvidedScenarioInput.rawContent !== "string" || analysis.userProvidedScenarioInput.rawContent.trim() === "")) {
    errors.push("analysis.userProvidedScenarioInput.rawContent is required when present");
  }
  if (!Array.isArray(analysis.scenarioCatalog)) {
    errors.push("analysis.scenarioCatalog must be an array");
    return { endpointIds, effective: [] };
  }

  const scenarioIds = new Set();
  const effective = [];
  for (const scenario of analysis.scenarioCatalog) {
    const id = scenario?.scenarioId ?? "";
    if (!/^(USR|GEN)-\d{3}$/.test(id)) errors.push(`invalid scenarioId: ${id || "missing"}`);
    else if (scenarioIds.has(id)) errors.push(`duplicate scenarioId: ${id}`);
    else scenarioIds.add(id);
    if (!endpointIds.has(scenario?.endpointId)) errors.push(`${id || "scenario"}: endpointId is outside endpointCatalog`);
    if (!new Set(["user", "analyzer"]).has(scenario?.source)) errors.push(`${id || "scenario"}: invalid source`);
    if ((id.startsWith("USR-") && scenario?.source !== "user") || (id.startsWith("GEN-") && scenario?.source !== "analyzer")) {
      errors.push(`${id || "scenario"}: scenarioId prefix does not match source`);
    }
    if (!SCENARIO_STATUSES.has(scenario?.status)) errors.push(`${id || "scenario"}: invalid status`);
    if (!validIdentifier(scenario?.normalizedName)) errors.push(`${id || "scenario"}: normalizedName must be a valid C# identifier`);
    if (typeof scenario?.scenarioType !== "string" || scenario.scenarioType.trim() === "") errors.push(`${id || "scenario"}: scenarioType is required`);
    if (!Array.isArray(scenario?.evidence) || scenario.evidence.length === 0) errors.push(`${id || "scenario"}: evidence is required`);
    if (new Set(["rejected", "accepted_with_limitation"]).has(scenario?.status)
        && (typeof scenario.reason !== "string" || scenario.reason.trim() === "")) {
      errors.push(`${id || "scenario"}: ${scenario.status} requires a reason`);
    }
    if (EFFECTIVE_STATUSES.has(scenario?.status)) effective.push(scenario);
  }
  for (const scenario of analysis.scenarioCatalog.filter((item) => item?.status === "merged")) {
    const target = analysis.scenarioCatalog.find((item) => item?.scenarioId === scenario.mergedIntoScenarioId);
    if (!target || !EFFECTIVE_STATUSES.has(target.status)) errors.push(`${scenario.scenarioId}: mergedIntoScenarioId must reference an effective scenario`);
  }
  const expectedNames = effective.map((item) => item.normalizedName);
  if (JSON.stringify(analysis.suggestedTestScenarios ?? []) !== JSON.stringify(expectedNames)) {
    errors.push("suggestedTestScenarios must match effective scenarioCatalog order");
  }
  if (analysis.scenarioCount !== effective.length) errors.push("scenarioCount must equal effective scenarioCatalog count");
  const summary = analysis.scenarioReviewSummary;
  const mergedCount = analysis.scenarioCatalog.filter((item) => item?.status === "merged").length;
  const rejectedCount = analysis.scenarioCatalog.filter((item) => item?.status === "rejected").length;
  if (!summary
      || summary.total !== analysis.scenarioCatalog.length
      || summary.effective !== effective.length
      || summary.merged !== mergedCount
      || summary.rejected !== rejectedCount) {
    errors.push("scenarioReviewSummary counts do not match scenarioCatalog");
  }
  return { endpointIds, effective };
}

function validateWriters(writerPaths, endpointIds, effective, errors) {
  const scenarioClaims = new Map();
  const endpointClaims = new Map();
  for (const writerPath of writerPaths) {
    const writer = readJson(writerPath);
    requireTelemetry(writer, writerPath, errors);
    if (!TOPOLOGIES.has(writer.writerTopology)) errors.push(`${writerPath}: invalid writerTopology`);
    if (!ASSIGNMENT_ROLES.has(writer.assignmentRole)) errors.push(`${writerPath}: invalid assignmentRole`);
    if (writer.writerTopology === "single" && writer.assignmentRole !== "full") errors.push(`${writerPath}: single topology requires full assignmentRole`);
    if (writer.writerTopology === "two-step-control" && !new Set(["infrastructure", "tests"]).has(writer.assignmentRole)) {
      errors.push(`${writerPath}: two-step-control requires infrastructure or tests assignmentRole`);
    }
    if (typeof writer.writerResultFilePath !== "string" || writer.writerResultFilePath.trim() === "") errors.push(`${writerPath}: writerResultFilePath is required`);
    if (!Array.isArray(writer.scenarioCoverage)) errors.push(`${writerPath}: scenarioCoverage is required`);
    for (const coverage of writer.scenarioCoverage ?? []) {
      if (!effective.some((item) => item.scenarioId === coverage?.scenarioId)) {
        errors.push(`${writerPath}: unexpected scenario coverage ${coverage?.scenarioId ?? "missing"}`);
        continue;
      }
      if (!COVERAGE_STATUSES.has(coverage.status)) errors.push(`${writerPath}: invalid coverage status for ${coverage.scenarioId}`);
      if (coverage.status !== "implemented" && (typeof coverage.note !== "string" || coverage.note.trim() === "")) {
        errors.push(`${writerPath}: ${coverage.scenarioId} requires a limitation note`);
      }
      if (coverage.status === "implemented"
          && (!Array.isArray(coverage.testEvidence) || coverage.testEvidence.length === 0)) {
        errors.push(`${writerPath}: ${coverage.scenarioId} requires testEvidence`);
      }
      const claims = scenarioClaims.get(coverage.scenarioId) ?? [];
      claims.push({ writerPath, coverage });
      scenarioClaims.set(coverage.scenarioId, claims);
    }
    if (!Array.isArray(writer.endpointCoverage)) errors.push(`${writerPath}: endpointCoverage is required`);
    for (const coverage of writer.endpointCoverage ?? []) {
      if (!endpointIds.has(coverage?.endpointId)) errors.push(`${writerPath}: unexpected endpoint coverage ${coverage?.endpointId ?? "missing"}`);
      if (!COVERAGE_STATUSES.has(coverage?.status)) errors.push(`${writerPath}: invalid endpoint coverage status for ${coverage?.endpointId ?? "missing"}`);
      const claims = endpointClaims.get(coverage.endpointId) ?? [];
      claims.push({ writerPath, coverage });
      endpointClaims.set(coverage.endpointId, claims);
    }
    if (writer.assignmentRole === "infrastructure" && ((writer.scenarioCoverage?.length ?? 0) > 0 || (writer.endpointCoverage?.length ?? 0) > 0)) {
      errors.push(`${writerPath}: infrastructure assignment cannot claim endpoint or scenario coverage`);
    }
  }
  for (const scenario of effective) {
    const claims = scenarioClaims.get(scenario.scenarioId) ?? [];
    if (claims.length !== 1) errors.push(`${scenario.scenarioId}: expected exactly one Writer claim, got ${claims.length}`);
  }
  for (const endpointId of endpointIds) {
    const implemented = (endpointClaims.get(endpointId) ?? []).filter((claim) => claim.coverage?.status === "implemented");
    if (implemented.length !== 1) errors.push(`${endpointId}: expected exactly one implemented Writer endpoint claim, got ${implemented.length}`);
  }
  return { scenarioClaims, endpointClaims };
}

function validateReviewer(reviewerPath, reviewer, endpointIds, effective, scenarioClaims, errors, requireReviewPass) {
  requireTelemetry(reviewer, reviewerPath, errors);
  const decision = String(reviewer.gateDecision ?? "").toLowerCase();
  if (!GATE_DECISIONS.has(decision)) errors.push(`${reviewerPath}: invalid gateDecision`);
  const acceptance = reviewer.scenarioAcceptance;
  if (!acceptance) {
    errors.push(`${reviewerPath}: scenarioAcceptance is required`);
    return;
  }
  const effectiveIds = effective.map((item) => item.scenarioId);
  const implementedIds = effectiveIds.filter((id) => (scenarioClaims.get(id) ?? []).some((claim) => claim.coverage.status === "implemented"));
  const missingIds = effectiveIds.filter((id) => !implementedIds.includes(id));
  if (!sameSet(acceptance.implementedScenarioIds ?? [], implementedIds)) errors.push(`${reviewerPath}: implementedScenarioIds mismatch`);
  if (!sameSet(acceptance.missingScenarioIds ?? [], missingIds)) errors.push(`${reviewerPath}: missingScenarioIds mismatch`);
  if (acceptance.effectiveScenarioCount !== effective.length) errors.push(`${reviewerPath}: effectiveScenarioCount mismatch`);
  const expectedComplete = missingIds.length === 0 && (acceptance.mismatchScenarioIds?.length ?? 0) === 0;
  if (!Array.isArray(acceptance.mismatchScenarioIds)) errors.push(`${reviewerPath}: mismatchScenarioIds must be an array`);
  if (acceptance.coverageComplete !== expectedComplete) errors.push(`${reviewerPath}: coverageComplete mismatch`);

  const endpointCoverage = reviewer.endpointCoverage;
  if (!endpointCoverage) errors.push(`${reviewerPath}: endpointCoverage is required`);
  else {
    if (!sameSet(endpointCoverage.coveredEndpointIds ?? [], [...endpointIds])) errors.push(`${reviewerPath}: coveredEndpointIds mismatch`);
    if ((endpointCoverage.missingEndpointIds?.length ?? 0) !== 0) errors.push(`${reviewerPath}: missingEndpointIds must be empty`);
  }
  if (requireReviewPass) {
    if (!new Set(["pass", "pass_with_warnings"]).has(decision)) errors.push(`${reviewerPath}: review gate rejected decision ${decision || "missing"}`);
    if (!expectedComplete) errors.push(`${reviewerPath}: review acceptance requires complete scenario coverage`);
  }
}

function validateStaticContract(errors) {
  const contracts = {
    analyzer: ".codex/agents/dotnet-testing-advanced-integration-analyzer.toml",
    writer: ".codex/agents/dotnet-testing-advanced-integration-writer.toml",
    reviewer: ".codex/agents/dotnet-testing-advanced-integration-reviewer.toml",
    orchestrator: ".codex/skills/dotnet-testing-orchestrator-integration/SKILL.md",
  };
  const markers = {
    analyzer: ["endpointCatalog", "scenarioCatalog", "scenarioReviewSummary", "userProvidedScenarioInput"],
    writer: ["scenarioCoverage", "endpointCoverage", "writerTopology", "assignmentRole"],
    reviewer: ["scenarioAcceptance", "gateDecision", "coveredEndpointIds", "missingEndpointIds"],
    orchestrator: ["validate-integration-scenario-contract.mjs", "--require-review-pass", "scenarioCatalog", "scenarioCoverage"],
  };
  for (const [role, filePath] of Object.entries(contracts)) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const marker of markers[role]) {
      if (!content.includes(marker)) errors.push(`${filePath}: missing static marker ${marker}`);
    }
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}
const errors = [];
validateStaticContract(errors);
if (!args.staticOnly && args.analysis) {
  const analysis = readJson(args.analysis);
  const { endpointIds, effective } = validateAnalysis(analysis, errors);
  if (args.writers.length === 0) errors.push("at least one --writer is required with --analysis");
  const { scenarioClaims } = validateWriters(args.writers, endpointIds, effective, errors);
  if (args.reviewer) validateReviewer(args.reviewer, readJson(args.reviewer), endpointIds, effective, scenarioClaims, errors, args.requireReviewPass);
  else if (args.requireReviewPass) errors.push("--require-review-pass requires --reviewer");
} else if (!args.staticOnly && (args.writers.length > 0 || args.reviewer || args.requireReviewPass)) {
  errors.push("--analysis is required for artifact validation");
}
if (errors.length > 0) {
  process.stderr.write(`validate-integration-scenario-contract error:\n- ${errors.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("PASS: integration scenario contract validation passed.\n");
}
