#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { writers: [], requirePass: false, forbidProductionMutation: false, requireSingleWriter: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--analysis") args.analysis = argv[++index];
    else if (arg === "--writer") args.writers.push(argv[++index]);
    else if (arg === "--executor") args.executor = argv[++index];
    else if (arg === "--project-regression") args.projectRegression = argv[++index];
    else if (arg === "--require-pass") args.requirePass = true;
    else if (arg === "--forbid-production-mutation") args.forbidProductionMutation = true;
    else if (arg === "--require-single-writer") args.requireSingleWriter = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return "Usage: node .codex/scripts/validators/validate-aspire-execution-contract.mjs --analysis <analysis.json> --writer <writer-result.json> [--writer ...] --executor <executor-result.json> [--project-regression <executor-result.json>] [--require-pass] [--forbid-production-mutation] [--require-single-writer]";
}

function readJson(value) { return JSON.parse(fs.readFileSync(value, "utf8")); }
function integer(value) { return Number.isInteger(value) && value >= 0; }
function telemetry(value, label, errors) {
  if (!Array.isArray(value?.tokenEstimateInputs?.readFiles) || !Array.isArray(value?.tokenEstimateInputs?.writtenFiles)) errors.push(`${label}: canonical tokenEstimateInputs readFiles/writtenFiles are required`);
}
function normalized(value) { return path.resolve(value).toLowerCase(); }
function samePaths(left, right) { return JSON.stringify([...new Set(left.map(normalized))].sort()) === JSON.stringify([...new Set(right.map(normalized))].sort()); }

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

  validateResult(executor, "executor", errors, args.requirePass);
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
  const readyResources = new Set((executor.resourceReadinessEvidence ?? []).filter((value) => new Set(["ready", "running", "healthy"]).has(value?.status)).map((value) => value.name));
  for (const name of requiredResources) if (!readyResources.has(name)) errors.push(`executor: missing readiness evidence for resource ${name}`);
  if (!Array.isArray(executor.productionBugFixes)) errors.push("executor: productionBugFixes must be an array");
  if (args.forbidProductionMutation && (executor.productionBugFixes?.length ?? 0) > 0) errors.push("executor: production mutation is forbidden");

  if (args.projectRegression) {
    const regression = readJson(args.projectRegression);
    validateResult(regression, "project-regression", errors, true);
    if (regression.regressionScope !== "test-project") errors.push("project-regression: regressionScope must be test-project");
  }
  if (errors.length > 0) throw new Error(`Aspire execution contract failed:\n- ${errors.join("\n- ")}`);
  process.stdout.write(`${JSON.stringify({ status: "valid", writerArtifactCount: writers.length, expectedCaseCount: expectedCases, executedCaseCount: executor.totalTests, targetServiceName: analysis.targetServiceName, blameHangTimeout: expectedHang, requiredResources: [...requiredResources].sort(), projectRegressionVerified: Boolean(args.projectRegression) }, null, 2)}\n`);
}

try { main(); } catch (error) {
  process.stderr.write(`validate-aspire-execution-contract error: ${error.message}\n`);
  process.exitCode = 1;
}
