#!/usr/bin/env node

import fs from "node:fs";

function parseArgs(argv) {
  const args = { writers: [], allowedSharedContainerKinds: [], requirePass: false, forbidProductionMutation: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--analysis") args.analysis = argv[++index];
    else if (arg === "--writer") args.writers.push(argv[++index]);
    else if (arg === "--executor") args.executor = argv[++index];
    else if (arg === "--project-regression") args.projectRegression = argv[++index];
    else if (arg === "--allow-shared-container-kind") args.allowedSharedContainerKinds.push(argv[++index]);
    else if (arg === "--require-pass") args.requirePass = true;
    else if (arg === "--forbid-production-mutation") args.forbidProductionMutation = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return "Usage: node .codex/scripts/validators/validate-integration-execution-contract.mjs --analysis <analysis.json> --writer <writer-result.json> [--writer ...] --executor <executor-result.json> [--project-regression <executor-result.json>] [--allow-shared-container-kind <kind> ...] [--require-pass] [--forbid-production-mutation]";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function integer(value) {
  return Number.isInteger(value) && value >= 0;
}

function sameSet(left, right) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function requireTelemetry(value, label, errors) {
  if (!Array.isArray(value?.tokenEstimateInputs?.readFiles) || !Array.isArray(value?.tokenEstimateInputs?.writtenFiles)) {
    errors.push(`${label}: canonical tokenEstimateInputs readFiles/writtenFiles are required`);
  }
}

function containerKind(value) {
  const raw = typeof value === "string" ? value : value?.type;
  return String(raw ?? "").trim().toLowerCase();
}

function requiredContainerKinds(analysis) {
  return (analysis.containerRequirements ?? [])
    .map(containerKind)
    .filter((value) => value && value !== "inmemory" && value !== "none");
}

function validateExecutionResult(value, label, errors, requirePass) {
  requireTelemetry(value, label, errors);
  if (value.executionMethod !== "dotnet test") errors.push(`${label}: executionMethod must be dotnet test`);
  for (const field of ["totalTests", "passedTests", "failedTests", "skippedTests"]) {
    if (!integer(value[field])) errors.push(`${label}: ${field} must be a non-negative integer`);
  }
  if (integer(value.totalTests) && integer(value.passedTests) && integer(value.failedTests) && integer(value.skippedTests)
      && value.totalTests !== value.passedTests + value.failedTests + value.skippedTests) {
    errors.push(`${label}: totalTests must equal passedTests + failedTests + skippedTests`);
  }
  if (requirePass) {
    if (value.buildResult !== "success") errors.push(`${label}: buildResult must be success`);
    if (value.testResult !== "passed") errors.push(`${label}: testResult must be passed`);
    if (value.failedTests !== 0) errors.push(`${label}: failedTests must be 0`);
    if (value.skippedTests !== 0) errors.push(`${label}: skippedTests must be 0`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.analysis) throw new Error("--analysis is required");
  if (args.writers.length === 0) throw new Error("at least one --writer is required");
  if (!args.executor) throw new Error("--executor is required");

  const errors = [];
  const analysis = readJson(args.analysis);
  const writers = args.writers.map((filePath) => ({ filePath, value: readJson(filePath) }));
  const executor = readJson(args.executor);
  requireTelemetry(analysis, "analysis", errors);
  if (String(analysis.projectContext?.testFramework ?? "").toLowerCase() !== "xunit") {
    errors.push("analysis: projectContext.testFramework must be xunit");
  }

  const writerTestFiles = [];
  let expectedCaseCount = 0;
  for (const { filePath, value: writer } of writers) {
    requireTelemetry(writer, filePath, errors);
    if (!integer(writer.testCaseCount)) errors.push(`${filePath}: testCaseCount must be a non-negative integer`);
    else expectedCaseCount += writer.testCaseCount;
    if (!Array.isArray(writer.testFilePaths)) errors.push(`${filePath}: testFilePaths must be an array`);
    else writerTestFiles.push(...writer.testFilePaths);
    if (writer.assignmentRole === "infrastructure" && (writer.testCaseCount !== 0 || (writer.testFilePaths?.length ?? 0) !== 0)) {
      errors.push(`${filePath}: infrastructure assignment must have zero test cases and no test files`);
    }
  }

  validateExecutionResult(executor, "executor", errors, args.requirePass);
  if (typeof executor.executorResultFilePath !== "string" || executor.executorResultFilePath.trim() === "") {
    errors.push("executor: executorResultFilePath is required");
  }
  if (!integer(executor.fixRounds)) errors.push("executor: fixRounds must be a non-negative integer");
  if (integer(executor.totalTests) && executor.totalTests !== expectedCaseCount) {
    errors.push(`executor: totalTests ${executor.totalTests} does not match Writer testCaseCount ${expectedCaseCount}`);
  }
  if (!sameSet(executor.testFilePaths ?? [], writerTestFiles)) errors.push("executor: testFilePaths do not match Writer artifact union");

  const requiredKinds = requiredContainerKinds(analysis);
  const reportedRequired = (executor.requiredContainerKinds ?? []).map(containerKind).filter(Boolean);
  const startedKinds = (executor.startedContainerKinds ?? []).map(containerKind).filter(Boolean);
  const allowedSharedKinds = args.allowedSharedContainerKinds.map(containerKind).filter(Boolean);
  if (!sameSet(reportedRequired, requiredKinds)) errors.push("executor: requiredContainerKinds do not match analysis.containerRequirements");
  const missingRequiredKinds = requiredKinds.filter((kind) => !startedKinds.includes(kind));
  const unexpectedStartedKinds = startedKinds.filter((kind) => !requiredKinds.includes(kind) && !allowedSharedKinds.includes(kind));
  if (missingRequiredKinds.length > 0) {
    errors.push(`executor: startedContainerKinds missing required containers: ${missingRequiredKinds.join(", ")}`);
  }
  if (unexpectedStartedKinds.length > 0) {
    errors.push(`executor: startedContainerKinds include unapproved shared containers: ${unexpectedStartedKinds.join(", ")}`);
  }
  if (requiredKinds.length > 0 || startedKinds.length > 0) {
    if (executor.dockerStatus !== "available") errors.push("executor: dockerStatus must be available when containers are started or required");
  } else if (!new Set(["available", "skipped"]).has(executor.dockerStatus)) {
    errors.push("executor: dockerStatus must be available or skipped when no container is required");
  }
  if (!Array.isArray(executor.productionBugFixes)) errors.push("executor: productionBugFixes must be an array");
  if (args.forbidProductionMutation && (executor.productionBugFixes?.length ?? 0) > 0) {
    errors.push("executor: production mutation is forbidden for this formal attempt");
  }

  if (args.projectRegression) {
    const regression = readJson(args.projectRegression);
    validateExecutionResult(regression, "project-regression", errors, true);
    if (regression.regressionScope !== "test-project") errors.push("project-regression: regressionScope must be test-project");
  }

  if (errors.length > 0) throw new Error(`Integration execution contract failed:\n- ${errors.join("\n- ")}`);
  process.stdout.write(`${JSON.stringify({
    status: "valid",
    writerArtifactCount: writers.length,
    expectedCaseCount,
    executedCaseCount: executor.totalTests,
    requiredContainerKinds: requiredKinds,
    allowedSharedContainerKinds: [...new Set(allowedSharedKinds)].sort(),
    startedContainerKinds: [...new Set(startedKinds)].sort(),
    executionMethod: executor.executionMethod,
    projectRegressionVerified: Boolean(args.projectRegression),
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`validate-integration-execution-contract error: ${error.message}\n`);
  process.exitCode = 1;
}
