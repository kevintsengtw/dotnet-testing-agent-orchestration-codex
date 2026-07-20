#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const result = { analysis: "", writers: [], executor: "", requirePass: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--analysis") result.analysis = argv[++index];
    else if (arg === "--writer") result.writers.push(argv[++index]);
    else if (arg === "--executor") result.executor = argv[++index];
    else if (arg === "--require-pass") result.requirePass = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function usage() {
  return "Usage: node .codex/scripts/validators/validate-tunit-execution-contract.mjs --analysis <analysis.json> --writer <writer-result.json> [--writer <writer-result.json> ...] --executor <executor-result.json> [--require-pass]";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function requireTelemetry(artifact, label, errors) {
  const telemetry = artifact?.tokenEstimateInputs;
  if (!telemetry || !Array.isArray(telemetry.readFiles) || !Array.isArray(telemetry.writtenFiles)) {
    errors.push(`${label}: tokenEstimateInputs readFiles/writtenFiles are required`);
  }
}

function integer(value) {
  return Number.isInteger(value) && value >= 0;
}

function sameSet(left, right) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
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

  const framework = analysis.testFramework ?? analysis.projectContext?.testFramework;
  if (String(framework).toLowerCase() !== "tunit") {
    errors.push(`analysis: testFramework must be tunit, got ${framework ?? "missing"}`);
  }
  requireTelemetry(analysis, "analysis", errors);

  let expectedMethodCount = 0;
  let expectedCaseCount = 0;
  const writerTestFiles = [];
  for (const { filePath, value: writer } of writers) {
    requireTelemetry(writer, filePath, errors);
    if (!integer(writer.testMethodCount)) errors.push(`${filePath}: testMethodCount must be a non-negative integer`);
    if (!integer(writer.testCaseCount)) errors.push(`${filePath}: testCaseCount must be a non-negative integer`);
    if (!Array.isArray(writer.testFilePaths) || writer.testFilePaths.length === 0) {
      errors.push(`${filePath}: testFilePaths must be a non-empty array`);
    } else {
      writerTestFiles.push(...writer.testFilePaths);
    }
    expectedMethodCount += integer(writer.testMethodCount) ? writer.testMethodCount : 0;
    expectedCaseCount += integer(writer.testCaseCount) ? writer.testCaseCount : 0;
  }

  requireTelemetry(executor, "executor", errors);
  if (executor.executionMethod !== "dotnet run") {
    errors.push(`executor: executionMethod must be dotnet run, got ${executor.executionMethod ?? "missing"}`);
  }
  if (executor.engineMode !== "SourceGenerated"
      && (typeof executor.engineModeEvidence !== "string" || executor.engineModeEvidence.trim() === "")) {
    errors.push("executor: SourceGenerated engineMode or non-empty engineModeEvidence is required");
  }
  for (const field of ["totalTests", "passedTests", "failedTests", "skippedTests"]) {
    if (!integer(executor[field])) errors.push(`executor: ${field} must be a non-negative integer`);
  }
  if (integer(executor.totalTests)
      && integer(executor.passedTests)
      && integer(executor.failedTests)
      && integer(executor.skippedTests)
      && executor.totalTests !== executor.passedTests + executor.failedTests + executor.skippedTests) {
    errors.push("executor: totalTests must equal passedTests + failedTests + skippedTests");
  }
  if (integer(executor.totalTests) && executor.totalTests !== expectedCaseCount) {
    errors.push(`executor: totalTests ${executor.totalTests} does not match Writer testCaseCount ${expectedCaseCount}`);
  }
  if (integer(executor.totalTests) && executor.totalTests < expectedMethodCount) {
    errors.push(`executor: totalTests ${executor.totalTests} cannot be lower than Writer testMethodCount ${expectedMethodCount}`);
  }
  if (Array.isArray(executor.testFilePaths) && !sameSet(executor.testFilePaths, writerTestFiles)) {
    errors.push("executor: testFilePaths do not match Writer artifact union");
  }

  if (args.requirePass) {
    if (executor.buildResult !== "success") errors.push(`executor: buildResult must be success, got ${executor.buildResult ?? "missing"}`);
    if (executor.testResult !== "passed") errors.push(`executor: testResult must be passed, got ${executor.testResult ?? "missing"}`);
    if (executor.failedTests !== 0) errors.push(`executor: failedTests must be 0, got ${executor.failedTests}`);
    if (executor.skippedTests !== 0) errors.push(`executor: skippedTests must be 0, got ${executor.skippedTests}`);
  }

  if (errors.length > 0) throw new Error(`TUnit execution contract failed:\n- ${errors.join("\n- ")}`);
  process.stdout.write(`${JSON.stringify({
    status: "valid",
    writerArtifactCount: writers.length,
    expectedMethodCount,
    expectedCaseCount,
    executedCaseCount: executor.totalTests,
    executionMethod: executor.executionMethod,
    engineMode: executor.engineMode ?? "evidence-only",
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`validate-tunit-execution-contract error: ${error.message}\n`);
  process.exitCode = 1;
}
