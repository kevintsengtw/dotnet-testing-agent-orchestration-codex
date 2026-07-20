#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const EFFECTIVE = new Set(["accepted", "accepted_with_normalization", "accepted_with_limitation"]);
const SCENARIO_STATUSES = new Set([...EFFECTIVE, "merged", "rejected"]);
const COVERAGE_STATUSES = new Set(["implemented", "blocked", "limitation"]);
const GATE_DECISIONS = new Set(["pass", "pass_with_warnings", "fail", "blocked"]);
const TOPOLOGIES = new Set(["two-step-control", "single"]);
const ASSIGNMENT_ROLES = new Set(["full", "infrastructure", "tests"]);

function parseArgs(argv) {
  const args = { writers: [], requireReviewPass: false, requireSingleWriter: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--analysis") args.analysis = argv[++index];
    else if (arg === "--writer") args.writers.push(argv[++index]);
    else if (arg === "--reviewer") args.reviewer = argv[++index];
    else if (arg === "--require-review-pass") args.requireReviewPass = true;
    else if (arg === "--require-single-writer") args.requireSingleWriter = true;
    else if (arg === "--analysis-only") args.analysisOnly = true;
    else if (arg === "--infrastructure-only") args.infrastructureOnly = true;
    else if (arg === "--static-only") args.staticOnly = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return "Usage: node .codex/scripts/validators/validate-aspire-scenario-contract.mjs [--static-only] [--analysis <analysis.json> --analysis-only] [--analysis <analysis.json> --writer <writer-result.json> --infrastructure-only] [--analysis <analysis.json> --writer <writer-result.json> ... --reviewer <reviewer-result.json> --require-review-pass --require-single-writer]";
}

function readJson(value) { return JSON.parse(fs.readFileSync(value, "utf8")); }
function sameSet(left, right) { return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort()); }
function telemetry(value, label, errors) {
  if (!Array.isArray(value?.tokenEstimateInputs?.readFiles) || !Array.isArray(value?.tokenEstimateInputs?.writtenFiles)) errors.push(`${label}: canonical tokenEstimateInputs readFiles/writtenFiles are required`);
}
function identifier(value) {
  return typeof value === "string" && value.trim() !== "" && !/[\s.\-+()\/\\:[\]{}]/u.test(value) && !/^\d/u.test(value);
}

function validateAnalysis(analysis, errors) {
  telemetry(analysis, "analysis", errors);
  if (JSON.stringify(analysis.requiredSkills) !== JSON.stringify(["aspire-testing"])) errors.push("analysis.requiredSkills must equal [\"aspire-testing\"]");
  if (typeof analysis.targetServiceName !== "string" || analysis.targetServiceName.trim() === "") errors.push("analysis.targetServiceName is required");
  if (Object.hasOwn(analysis, "sourceCodeContext")) errors.push("analysis.sourceCodeContext is forbidden in compact formal artifacts");
  if (!Array.isArray(analysis.sourceFileIndex) || analysis.sourceFileIndex.length === 0) errors.push("analysis.sourceFileIndex must be non-empty");
  for (const source of analysis.sourceFileIndex ?? []) if (!path.isAbsolute(source?.path ?? "")) errors.push("analysis.sourceFileIndex paths must be absolute");

  const resourceIds = new Set();
  if (!Array.isArray(analysis.resourceCatalog) || analysis.resourceCatalog.length === 0) errors.push("analysis.resourceCatalog must be non-empty");
  for (const resource of analysis.resourceCatalog ?? []) {
    if (!/^RES-\d{3}$/.test(resource?.resourceId ?? "")) errors.push(`invalid resourceId: ${resource?.resourceId ?? "missing"}`);
    else if (resourceIds.has(resource.resourceId)) errors.push(`duplicate resourceId: ${resource.resourceId}`);
    else resourceIds.add(resource.resourceId);
    for (const field of ["name", "type"]) if (typeof resource?.[field] !== "string" || resource[field].trim() === "") errors.push(`${resource?.resourceId ?? "resource"}.${field} is required`);
    if (typeof resource?.requiredForTarget !== "boolean") errors.push(`${resource?.resourceId ?? "resource"}.requiredForTarget must be boolean`);
    if (!Array.isArray(resource?.evidence) || resource.evidence.length === 0) errors.push(`${resource?.resourceId ?? "resource"}.evidence is required`);
  }

  const endpointIds = new Set();
  if (!Array.isArray(analysis.endpointCatalog) || analysis.endpointCatalog.length === 0) errors.push("analysis.endpointCatalog must be non-empty");
  for (const endpoint of analysis.endpointCatalog ?? []) {
    if (!/^END-\d{3}$/.test(endpoint?.endpointId ?? "")) errors.push(`invalid endpointId: ${endpoint?.endpointId ?? "missing"}`);
    else if (endpointIds.has(endpoint.endpointId)) errors.push(`duplicate endpointId: ${endpoint.endpointId}`);
    else endpointIds.add(endpoint.endpointId);
    for (const field of ["controller", "action", "httpMethod", "route", "serviceName"]) if (typeof endpoint?.[field] !== "string" || endpoint[field].trim() === "") errors.push(`${endpoint?.endpointId ?? "endpoint"}.${field} is required`);
    if (endpoint?.serviceName !== analysis.targetServiceName) errors.push(`${endpoint?.endpointId ?? "endpoint"}.serviceName must match targetServiceName`);
    if (!Array.isArray(endpoint?.resourceIds)) errors.push(`${endpoint?.endpointId ?? "endpoint"}.resourceIds must be an array`);
    if (!Array.isArray(endpoint?.evidence) || endpoint.evidence.length === 0) errors.push(`${endpoint?.endpointId ?? "endpoint"}.evidence is required`);
    for (const resourceId of endpoint?.resourceIds ?? []) if (!resourceIds.has(resourceId)) errors.push(`${endpoint.endpointId}: unknown resourceId ${resourceId}`);
  }
  const endpointReferences = (analysis.endpointsToTest ?? []).map((value) => value?.endpointId).filter(Boolean);
  if (!sameSet(endpointReferences, [...endpointIds])) errors.push("endpointsToTest endpoint IDs must exactly match endpointCatalog");

  if (!analysis.userProvidedScenarioInput || typeof analysis.userProvidedScenarioInput.present !== "boolean") errors.push("analysis.userProvidedScenarioInput.present is required");
  const scenarioIds = new Set();
  const effective = [];
  if (!Array.isArray(analysis.scenarioCatalog)) errors.push("analysis.scenarioCatalog must be an array");
  for (const scenario of analysis.scenarioCatalog ?? []) {
    const id = scenario?.scenarioId ?? "";
    if (!/^(USR|GEN)-\d{3}$/.test(id)) errors.push(`invalid scenarioId: ${id || "missing"}`);
    else if (scenarioIds.has(id)) errors.push(`duplicate scenarioId: ${id}`);
    else scenarioIds.add(id);
    if (!endpointIds.has(scenario?.endpointId)) errors.push(`${id}: endpointId is outside endpointCatalog`);
    if (!new Set(["user", "analyzer"]).has(scenario?.source)) errors.push(`${id}: invalid source`);
    if (!SCENARIO_STATUSES.has(scenario?.status)) errors.push(`${id}: invalid status`);
    if (!identifier(scenario?.normalizedName)) errors.push(`${id}: normalizedName must be a valid C# identifier`);
    if (typeof scenario?.scenarioType !== "string" || scenario.scenarioType.trim() === "") errors.push(`${id}: scenarioType is required`);
    if (!Array.isArray(scenario?.evidence) || scenario.evidence.length === 0) errors.push(`${id}: evidence is required`);
    if (EFFECTIVE.has(scenario?.status)) effective.push(scenario);
  }
  for (const scenario of (analysis.scenarioCatalog ?? []).filter((value) => value?.status === "merged")) {
    const target = (analysis.scenarioCatalog ?? []).find((value) => value?.scenarioId === scenario.mergedIntoScenarioId);
    if (!target || !EFFECTIVE.has(target.status)) errors.push(`${scenario.scenarioId}: mergedIntoScenarioId must reference an effective scenario`);
  }
  if (analysis.scenarioCount !== effective.length) errors.push("analysis.scenarioCount must equal effective scenario count");
  if (JSON.stringify(analysis.suggestedTestScenarios ?? []) !== JSON.stringify(effective.map((value) => value.normalizedName))) errors.push("suggestedTestScenarios must match effective scenario order");
  if (analysis.scenarioReviewSummary?.effective !== effective.length) errors.push("scenarioReviewSummary.effective must match effective scenario count");
  return { endpointIds, effective };
}

function validateWriters(writers, endpointIds, effective, errors, requireSingleWriter, infrastructureOnly = false) {
  if (requireSingleWriter && writers.length !== 1) errors.push("formal single-writer gate requires exactly one writer artifact");
  if (infrastructureOnly && writers.length !== 1) errors.push("infrastructure-only gate requires exactly one writer artifact");
  const scenarioClaims = new Map();
  const endpointClaims = new Map();
  let cases = 0;
  for (const [index, writer] of writers.entries()) {
    const label = `writer[${index}]`;
    telemetry(writer, label, errors);
    if (!TOPOLOGIES.has(writer.writerTopology)) errors.push(`${label}: invalid writerTopology`);
    if (!ASSIGNMENT_ROLES.has(writer.assignmentRole)) errors.push(`${label}: invalid assignmentRole`);
    if (requireSingleWriter && (writer.writerTopology !== "single" || writer.assignmentRole !== "full")) errors.push(`${label}: formal topology must be single/full`);
    if (typeof writer.writerResultFilePath !== "string" || !path.isAbsolute(writer.writerResultFilePath)) errors.push(`${label}: writerResultFilePath must be absolute`);
    if (!Array.isArray(writer.testFilePaths)) errors.push(`${label}: testFilePaths must be an array`);
    else for (const filePath of writer.testFilePaths) if (!path.isAbsolute(filePath)) errors.push(`${label}: testFilePaths must be absolute`);
    if (!Array.isArray(writer.testClasses)) errors.push(`${label}: testClasses must be an array`);
    else for (const testClass of writer.testClasses) if (!path.isAbsolute(testClass?.filePath ?? "")) errors.push(`${label}: testClasses.filePath must be absolute`);
    for (const filePath of writer.infrastructureFiles ?? []) if (!path.isAbsolute(filePath)) errors.push(`${label}: infrastructureFiles must be absolute`);
    if (!Number.isInteger(writer.testCaseCount) || writer.testCaseCount < 0) errors.push(`${label}: testCaseCount must be non-negative`);
    else cases += writer.testCaseCount;
    if (writer.assignmentRole === "infrastructure" && ((writer.scenarioCoverage?.length ?? 0) > 0 || (writer.endpointCoverage?.length ?? 0) > 0 || writer.testCaseCount !== 0)) errors.push(`${label}: infrastructure assignment cannot claim coverage or cases`);
    for (const coverage of writer.endpointCoverage ?? []) {
      if (!endpointIds.has(coverage?.endpointId)) errors.push(`${label}: unknown endpointId ${coverage?.endpointId}`);
      if (!COVERAGE_STATUSES.has(coverage?.status)) errors.push(`${label}: invalid endpoint coverage status`);
      const claims = endpointClaims.get(coverage?.endpointId) ?? [];
      claims.push(coverage);
      endpointClaims.set(coverage?.endpointId, claims);
    }
    for (const coverage of writer.scenarioCoverage ?? []) {
      const scenario = effective.find((value) => value.scenarioId === coverage?.scenarioId);
      if (!scenario) errors.push(`${label}: scenario ${coverage?.scenarioId} is not effective`);
      if (!COVERAGE_STATUSES.has(coverage?.status)) errors.push(`${label}: invalid scenario coverage status`);
      if ((coverage?.status === "blocked" || coverage?.status === "limitation") && (typeof coverage.reason !== "string" || coverage.reason.trim() === "")) errors.push(`${label}: ${coverage.status} requires reason`);
      if (coverage?.status === "implemented" && (!Array.isArray(coverage.testEvidence) || coverage.testEvidence.length === 0)) errors.push(`${label}: implemented scenario requires testEvidence`);
      if (scenarioClaims.has(coverage?.scenarioId)) errors.push(`duplicate scenario claim: ${coverage?.scenarioId}`);
      else scenarioClaims.set(coverage?.scenarioId, coverage);
    }
  }
  const topologies = new Set(writers.map((writer) => writer.writerTopology));
  if (infrastructureOnly) {
    const writer = writers[0];
    if (writer?.writerTopology !== "two-step-control" || writer?.assignmentRole !== "infrastructure") errors.push("infrastructure-only gate requires two-step-control/infrastructure");
    return { scenarioClaims, cases };
  }
  if (topologies.size !== 1) errors.push("Writer artifacts must use one consistent topology");
  if (topologies.has("single") && (writers.length !== 1 || writers[0]?.assignmentRole !== "full")) errors.push("single topology requires exactly one full assignment");
  if (topologies.has("two-step-control")) {
    const roles = writers.map((writer) => writer.assignmentRole).sort();
    if (JSON.stringify(roles) !== JSON.stringify(["infrastructure", "tests"])) errors.push("two-step-control requires exactly infrastructure and tests assignments");
  }
  for (const endpointId of endpointIds) {
    const implemented = (endpointClaims.get(endpointId) ?? []).filter((coverage) => coverage.status === "implemented");
    if (implemented.length !== 1) errors.push(`${endpointId}: expected exactly one implemented Writer endpoint claim, got ${implemented.length}`);
  }
  if (!sameSet([...scenarioClaims.keys()], effective.map((value) => value.scenarioId))) errors.push("Writer scenario coverage must exactly match effective scenarios");
  return { scenarioClaims, cases };
}

function validateReviewer(reviewer, endpointIds, effective, scenarioClaims, errors, requireReviewPass) {
  telemetry(reviewer, "reviewer", errors);
  if (!GATE_DECISIONS.has(reviewer.gateDecision)) errors.push("reviewer.gateDecision is invalid");
  if (typeof reviewer.overallRating !== "string" || reviewer.overallRating.trim() === "") errors.push("reviewer.overallRating is required");
  if (!Number.isInteger(reviewer.score) || reviewer.score < 0 || reviewer.score > 100) errors.push("reviewer.score must be an integer from 0 to 100");
  if (requireReviewPass && !new Set(["pass", "pass_with_warnings"]).has(reviewer.gateDecision)) errors.push("reviewer gateDecision must pass");
  const acceptance = reviewer.scenarioAcceptance;
  const implementedIds = effective.map((value) => value.scenarioId).filter((id) => scenarioClaims.get(id)?.status === "implemented");
  const missingIds = effective.map((value) => value.scenarioId).filter((id) => !implementedIds.includes(id));
  if (!sameSet(acceptance?.acceptedScenarioIds ?? [], implementedIds)) errors.push("reviewer acceptedScenarioIds must match implemented scenarios");
  if (!sameSet(acceptance?.missingScenarioIds ?? [], missingIds)) errors.push("reviewer missingScenarioIds must match Writer coverage");
  if ((acceptance?.mismatchScenarioIds?.length ?? 0) > 0 || (acceptance?.duplicateScenarioIds?.length ?? 0) > 0) errors.push("reviewer scenario acceptance has mismatch or duplicate IDs");
  if (!sameSet(reviewer.endpointAcceptance?.coveredEndpointIds ?? [], [...endpointIds])) errors.push("reviewer coveredEndpointIds must match endpointCatalog");
  if ((reviewer.endpointAcceptance?.missingEndpointIds?.length ?? 0) > 0) errors.push("reviewer has missing endpoints");
  if (requireReviewPass && missingIds.length > 0) errors.push("reviewer pass requires complete implemented scenario coverage");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return process.stdout.write(`${usage()}\n`);
  if (args.staticOnly) return process.stdout.write("PASS: Aspire scenario validator static contract loaded.\n");
  if (!args.analysis) throw new Error("--analysis is required");
  if (!args.analysisOnly && args.writers.length === 0) throw new Error("at least one --writer is required unless --analysis-only is used");
  if (args.analysisOnly && (args.writers.length > 0 || args.reviewer || args.requireReviewPass || args.requireSingleWriter)) throw new Error("--analysis-only cannot be combined with Writer or Reviewer gates");
  if (args.infrastructureOnly && (args.reviewer || args.requireReviewPass || args.requireSingleWriter || args.analysisOnly)) throw new Error("--infrastructure-only cannot be combined with Reviewer, single-writer, or analysis-only gates");
  const errors = [];
  const analysis = readJson(args.analysis);
  const writers = args.writers.map(readJson);
  const { endpointIds, effective } = validateAnalysis(analysis, errors);
  if (args.analysisOnly) {
    if (errors.length > 0) throw new Error(`Aspire analysis contract failed:\n- ${errors.join("\n- ")}`);
    return process.stdout.write(`${JSON.stringify({ status: "valid", endpointCount: endpointIds.size, effectiveScenarioCount: effective.length, analysisOnly: true }, null, 2)}\n`);
  }
  const { scenarioClaims, cases } = validateWriters(writers, endpointIds, effective, errors, args.requireSingleWriter, args.infrastructureOnly);
  if (args.reviewer) validateReviewer(readJson(args.reviewer), endpointIds, effective, scenarioClaims, errors, args.requireReviewPass);
  else if (args.requireReviewPass) errors.push("--reviewer is required with --require-review-pass");
  if (errors.length > 0) throw new Error(`Aspire scenario contract failed:\n- ${errors.join("\n- ")}`);
  process.stdout.write(`${JSON.stringify({ status: "valid", endpointCount: endpointIds.size, effectiveScenarioCount: effective.length, writerArtifactCount: writers.length, expectedCaseCount: cases, infrastructureOnly: args.infrastructureOnly, reviewerVerified: Boolean(args.reviewer) }, null, 2)}\n`);
}

try { main(); } catch (error) {
  process.stderr.write(`validate-aspire-scenario-contract error: ${error.message}\n`);
  process.exitCode = 1;
}
