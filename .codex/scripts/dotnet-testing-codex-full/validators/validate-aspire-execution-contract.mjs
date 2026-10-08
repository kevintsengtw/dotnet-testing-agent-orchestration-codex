#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const KNOWN_ENVIRONMENT_TERMINAL = "completed_with_known_environment_exception";
const KNOWN_ENVIRONMENT_CODE = "windows_docker_desktop_mssql_127_0_0_1_tds_prelogin";
const EXCLUDED_FAILURE_CATEGORIES = [
  "dockerUnavailable", "imagePull", "containerStartup", "license", "password", "configuration",
  "appHost", "build", "nonMssqlResource", "artifact", "isolation", "readScope", "timing",
  "scenario", "endpoint", "writerTopology", "integrity", "productionMutation", "insufficientEvidence",
];

function parseArgs(argv) {
  const args = { writers: [], requirePass: false, forbidProductionMutation: false, requireSingleWriter: false, allowKnownEnvironmentException: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--analysis") args.analysis = argv[++index];
    else if (arg === "--writer") args.writers.push(argv[++index]);
    else if (arg === "--executor") args.executor = argv[++index];
    else if (arg === "--project-regression") args.projectRegression = argv[++index];
    else if (arg === "--require-pass") args.requirePass = true;
    else if (arg === "--forbid-production-mutation") args.forbidProductionMutation = true;
    else if (arg === "--require-single-writer") args.requireSingleWriter = true;
    else if (arg === "--allow-known-environment-exception") args.allowKnownEnvironmentException = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return "Usage: node .codex/scripts/dotnet-testing-codex-full/validators/validate-aspire-execution-contract.mjs --analysis <analysis.json> --writer <writer-result.json> [--writer ...] --executor <executor-result.json> [--project-regression <executor-result.json>] [--require-pass] [--allow-known-environment-exception] [--forbid-production-mutation] [--require-single-writer]";
}

function readJson(value) { return JSON.parse(fs.readFileSync(value, "utf8")); }
function integer(value) { return Number.isInteger(value) && value >= 0; }
function telemetry(value, label, errors) {
  if (!Array.isArray(value?.tokenEstimateInputs?.readFiles) || !Array.isArray(value?.tokenEstimateInputs?.writtenFiles)) errors.push(`${label}: canonical tokenEstimateInputs readFiles/writtenFiles are required`);
}
function normalized(value) { return path.resolve(value).toLowerCase(); }
function samePaths(left, right) { return JSON.stringify([...new Set(left.map(normalized))].sort()) === JSON.stringify([...new Set(right.map(normalized))].sort()); }
function ready(value) { return new Set(["ready", "running", "healthy"]).has(value); }

function validateReadiness(analysis, executor, requiredResources, errors) {
  const entries = executor.resourceReadinessEvidence;
  if (!Array.isArray(entries)) {
    errors.push("executor: resourceReadinessEvidence must be an array");
    return;
  }
  const projectPath = analysis.projectContext?.testProjectPath;
  let projectRoot;
  if (typeof projectPath === "string" && path.isAbsolute(projectPath) && fs.existsSync(projectPath) && fs.statSync(projectPath).isFile() && path.extname(projectPath).toLowerCase() === ".csproj") {
    projectRoot = fs.realpathSync(path.dirname(projectPath));
  } else {
    errors.push("analysis: absolute existing projectContext.testProjectPath is required for readiness provenance");
  }
  for (const name of requiredResources) {
    const matches = entries.filter((entry) => entry?.name === name);
    if (matches.length !== 1) {
      errors.push(`executor: expected exactly one readiness evidence for resource ${name}`);
      continue;
    }
    const entry = matches[0], verification = entry.verification;
    if (!ready(entry.status)) errors.push(`executor: resource ${name} must be ready, healthy, or running with successful verification`);
    if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
      errors.push(`executor: resource ${name} requires successful health-check, protocol, or initialization verification; status alone is insufficient`);
      continue;
    }
    if (!new Set(["health-check", "protocol", "initialization"]).has(verification.method)) errors.push(`executor: resource ${name} has invalid readiness verification method`);
    if (verification.method === "initialization") {
      const resource = (analysis.resourceCatalog ?? []).find((value) => value.name === name);
      if (name === analysis.targetServiceName || !/database/i.test(resource?.type ?? "")) errors.push(`executor: resource ${name} initialization verification is only valid for a logical database resource`);
    }
    if (verification.succeeded !== true) errors.push(`executor: resource ${name} readiness verification must have succeeded`);
    if (typeof verification.observation !== "string" || verification.observation.trim() === "") errors.push(`executor: resource ${name} readiness verification observation is required`);
    const sourcePath = verification.sourcePath;
    if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath) || !fs.existsSync(sourcePath) || path.extname(sourcePath).toLowerCase() !== ".cs") {
      errors.push(`executor: resource ${name} readiness sourcePath must be an absolute existing test source file`);
      continue;
    }
    if (!projectRoot) continue;
    const realSource = fs.realpathSync(sourcePath), relativeSource = path.relative(projectRoot, realSource);
    if (relativeSource === "" || relativeSource === ".." || relativeSource.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSource)) {
      errors.push(`executor: resource ${name} readiness sourcePath must remain inside the assigned test project`);
      continue;
    }
    if (!fs.statSync(realSource).isFile()) {
      errors.push(`executor: resource ${name} readiness sourcePath must be a file`);
      continue;
    }
    const actualHash = createHash("sha256").update(fs.readFileSync(realSource)).digest("hex");
    if (verification.sourceSha256 !== actualHash) errors.push(`executor: resource ${name} readiness source SHA-256 mismatch`);
  }
}

function aspireMajor(analysis) {
  const match = String(analysis.appHostInfo?.aspireVersion ?? "").match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function validateResult(value, label, errors, requirePass) {
  telemetry(value, label, errors);
  if (value.executionMethod !== "dotnet test") errors.push(`${label}: executionMethod must be dotnet test`);
  for (const field of ["totalTests", "passedTests", "failedTests", "skippedTests"]) if (!integer(value[field])) errors.push(`${label}: ${field} must be a non-negative integer`);
  if (integer(value.totalTests) && value.totalTests !== value.passedTests + value.failedTests + value.skippedTests) errors.push(`${label}: totalTests accounting mismatch`);
  if (requirePass) {
    if (value.buildResult !== "success") errors.push(`${label}: buildResult must be success`);
    if (value.testResult !== "passed") errors.push(`${label}: testResult must be passed`);
    if (value.failedTests !== 0 || value.skippedTests !== 0) errors.push(`${label}: failedTests and skippedTests must be 0`);
  }
}

function validateKnownEnvironmentException(analysis, executor, errors) {
  const exception = executor.knownEnvironmentException;
  if (!exception || typeof exception !== "object") {
    errors.push("executor: knownEnvironmentException is required when the known environment exception is used");
    return false;
  }
  if (!new Set(["candidate", "qualified"]).has(exception.status)) errors.push("executor: knownEnvironmentException.status must be candidate or qualified");
  if (exception.terminalDecision !== KNOWN_ENVIRONMENT_TERMINAL) errors.push(`executor: knownEnvironmentException.terminalDecision must be ${KNOWN_ENVIRONMENT_TERMINAL}`);
  if (exception.exceptionCode !== KNOWN_ENVIRONMENT_CODE) errors.push(`executor: knownEnvironmentException.exceptionCode must be ${KNOWN_ENVIRONMENT_CODE}`);
  if (String(exception.hostOs).toLowerCase() !== "windows") errors.push("executor: knownEnvironmentException.hostOs must be windows");
  if (exception.endpointHost !== "127.0.0.1") errors.push("executor: knownEnvironmentException.endpointHost must be 127.0.0.1");
  if (executor.buildResult !== "success") errors.push("executor: known environment exception requires a successful build");
  if (executor.testResult !== "failed" || !Number.isInteger(executor.failedTests) || executor.failedTests < 1) errors.push("executor: known environment exception must preserve a failed testResult and failedTests > 0");
  if (exception.failedTests !== executor.failedTests) errors.push("executor: knownEnvironmentException.failedTests must equal executor.failedTests");
  if (!Array.isArray(exception.failedAssertions) || exception.failedAssertions.length === 0) errors.push("executor: knownEnvironmentException.failedAssertions must preserve the failed MSSQL assertions");
  if (!Array.isArray(exception.evidenceFiles) || exception.evidenceFiles.length === 0) errors.push("executor: knownEnvironmentException.evidenceFiles must be non-empty");
  for (const evidencePath of exception.evidenceFiles ?? []) {
    if (!path.isAbsolute(evidencePath) || !fs.existsSync(evidencePath)) errors.push(`executor: known environment evidence file is missing or not absolute: ${evidencePath}`);
  }
  const mssql = exception.mssql ?? {};
  for (const field of ["containerStarted", "containerInternalReady", "imagePulled", "licenseAccepted", "passwordConfigurationValid", "tcpListenerReachable", "tdsPreLoginFailed"]) {
    if (mssql[field] !== true) errors.push(`executor: knownEnvironmentException.mssql.${field} must be true`);
  }
  if (mssql.readinessSignature !== "tds-prelogin-or-sql-readiness") errors.push("executor: MSSQL readinessSignature must be tds-prelogin-or-sql-readiness");
  if (!Array.isArray(exception.unrelatedFailures) || exception.unrelatedFailures.length !== 0) errors.push("executor: knownEnvironmentException.unrelatedFailures must be an empty array");
  for (const field of EXCLUDED_FAILURE_CATEGORIES) {
    if (exception.excludedFailureCategories?.[field] !== true) errors.push(`executor: knownEnvironmentException.excludedFailureCategories.${field} must be true`);
  }

  const sqlFamily = (analysis.resourceCatalog ?? []).filter((resource) => /sql(?:[-_\s]*)server|mssql/i.test(`${resource?.type ?? ""} ${resource?.name ?? ""}`));
  const mssqlResources = sqlFamily.filter((resource) => !/database/i.test(`${resource?.type ?? ""}`));
  const mssqlDependentResources = sqlFamily.filter((resource) => /database/i.test(`${resource?.type ?? ""}`));
  if (mssqlResources.length !== 1) errors.push("analysis: known environment exception requires exactly one identifiable MSSQL container resource");
  else if (exception.mssql?.resourceName !== mssqlResources[0].name) errors.push("executor: knownEnvironmentException.mssql.resourceName must match the analyzed MSSQL container resource");
  const dependentEvidence = new Map((exception.mssqlDependentResources ?? []).map((resource) => [resource?.name, resource]));
  for (const resource of mssqlDependentResources) {
    const evidence = dependentEvidence.get(resource.name);
    if (!evidence || !new Set(["blocked", "not-ready"]).has(evidence.status) || evidence.blockedOnlyByMssql !== true) {
      errors.push(`executor: MSSQL dependent resource ${resource.name} must be blocked only by MSSQL`);
    }
  }

  const nonMssqlRequired = (analysis.resourceCatalog ?? []).filter((resource) => resource.requiredForTarget === true
    && !sqlFamily.includes(resource) && resource.name !== analysis.targetServiceName);
  const nonMssqlEvidence = new Map((exception.nonMssqlResources ?? []).map((resource) => [resource?.name, resource?.status]));
  for (const resource of nonMssqlRequired) if (!ready(nonMssqlEvidence.get(resource.name))) errors.push(`executor: non-MSSQL resource ${resource.name} must independently pass`);
  const bookingApi = exception.bookingApi ?? {};
  if (bookingApi.resourceName !== analysis.targetServiceName) errors.push("executor: knownEnvironmentException.bookingApi.resourceName must match targetServiceName");
  if (ready(bookingApi.status)) {
    // A healthy API is acceptable; its failure was not part of the exception.
  } else if (bookingApi.status !== "blocked" || bookingApi.blockedOnlyByMssql !== true) {
    errors.push("executor: an unhealthy booking API must be blocked only by its declared MSSQL dependency");
  }
  return errors.length === 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return process.stdout.write(`${usage()}\n`);
  if (!args.analysis || args.writers.length === 0 || !args.executor) throw new Error("--analysis, --writer, and --executor are required");
  const analysis = readJson(args.analysis);
  const writers = args.writers.map((filePath) => ({ filePath, value: readJson(filePath) }));
  const executor = readJson(args.executor);
  const errors = [];
  telemetry(analysis, "analysis", errors);
  if (String(analysis.projectContext?.testFramework ?? "").toLowerCase() !== "xunit") errors.push("analysis: projectContext.testFramework must be xunit");
  if (args.requireSingleWriter && writers.length !== 1) errors.push("formal single-writer execution requires exactly one writer artifact");

  let expectedCases = 0;
  const testFiles = [];
  for (const { filePath, value } of writers) {
    telemetry(value, filePath, errors);
    if (!integer(value.testCaseCount)) errors.push(`${filePath}: testCaseCount must be a non-negative integer`);
    else expectedCases += value.testCaseCount;
    if (!Array.isArray(value.testFilePaths)) errors.push(`${filePath}: testFilePaths must be an array`);
    else testFiles.push(...value.testFilePaths);
    if (args.requireSingleWriter && (value.writerTopology !== "single" || value.assignmentRole !== "full")) errors.push(`${filePath}: formal topology must be single/full`);
  }

  const hasKnownEnvironmentException = executor.knownEnvironmentException !== undefined;
  if (hasKnownEnvironmentException && !args.allowKnownEnvironmentException) errors.push("executor: known environment exception requires --allow-known-environment-exception");
  validateResult(executor, "executor", errors, args.requirePass && !hasKnownEnvironmentException);
  if (hasKnownEnvironmentException && args.allowKnownEnvironmentException) validateKnownEnvironmentException(analysis, executor, errors);
  if (!integer(executor.fixRounds)) errors.push("executor: fixRounds must be a non-negative integer");
  if (executor.totalTests !== expectedCases) errors.push(`executor: totalTests ${executor.totalTests} does not match Writer testCaseCount ${expectedCases}`);
  if (!samePaths(executor.testFilePaths ?? [], testFiles)) errors.push("executor: testFilePaths do not match Writer artifacts");
  if (!samePaths(executor.writerResultFilePaths ?? [], args.writers)) errors.push("executor: writerResultFilePaths do not match assigned Writer artifacts");
  if (executor.dockerStatus !== "available") errors.push("executor: dockerStatus must be available");
  if (typeof executor.aspireWorkloadStatus !== "string" || executor.aspireWorkloadStatus.trim() === "") errors.push("executor: aspireWorkloadStatus is required");
  if (executor.targetServiceName !== analysis.targetServiceName) errors.push("executor: targetServiceName must match analysis");
  const major = aspireMajor(analysis);
  if (!major) errors.push("analysis: appHostInfo.aspireVersion must begin with a major version");
  const expectedHang = major >= 13 ? "15m" : "10m";
  if (executor.blameHangTimeout !== expectedHang) errors.push(`executor: blameHangTimeout must be ${expectedHang}`);
  if (executor.usesDistributedApplicationTestingBuilder !== true) errors.push("executor: DistributedApplicationTestingBuilder evidence is required");
  if (executor.usesWebApplicationFactory !== false) errors.push("executor: WebApplicationFactory must be false");
  if (executor.usesProgrammaticTestcontainers !== false) errors.push("executor: programmatic Testcontainers must be false");

  const requiredResources = new Set((analysis.resourceCatalog ?? []).filter((value) => value.requiredForTarget === true).map((value) => value.name));
  requiredResources.add(analysis.targetServiceName);
  if (!hasKnownEnvironmentException) {
    validateReadiness(analysis, executor, requiredResources, errors);
  }
  if (!Array.isArray(executor.productionBugFixes)) errors.push("executor: productionBugFixes must be an array");
  if (args.forbidProductionMutation && (executor.productionBugFixes?.length ?? 0) > 0) errors.push("executor: production mutation is forbidden");

  if (args.projectRegression) {
    const regression = readJson(args.projectRegression);
    validateResult(regression, "project-regression", errors, true);
    if (regression.regressionScope !== "test-project") errors.push("project-regression: regressionScope must be test-project");
  }
  if (errors.length > 0) throw new Error(`Aspire execution contract failed:\n- ${errors.join("\n- ")}`);
  const terminalDecision = hasKnownEnvironmentException ? KNOWN_ENVIRONMENT_TERMINAL : "completed";
  process.stdout.write(`${JSON.stringify({ status: "valid", terminalDecision, knownEnvironmentExceptionQualified: hasKnownEnvironmentException, writerArtifactCount: writers.length, expectedCaseCount: expectedCases, executedCaseCount: executor.totalTests, failedTests: executor.failedTests, targetServiceName: analysis.targetServiceName, blameHangTimeout: expectedHang, requiredResources: [...requiredResources].sort(), projectRegressionVerified: Boolean(args.projectRegression) }, null, 2)}\n`);
}

try { main(); } catch (error) {
  process.stderr.write(`validate-aspire-execution-contract error: ${error.message}\n`);
  process.exitCode = 1;
}
