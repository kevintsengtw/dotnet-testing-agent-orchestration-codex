#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const result = { analysis: "", writers: [], executor: "", reviewer: "", requirePass: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--analysis") result.analysis = argv[++index];
    else if (arg === "--writer") result.writers.push(argv[++index]);
    else if (arg === "--executor") result.executor = argv[++index];
    else if (arg === "--reviewer") result.reviewer = argv[++index];
    else if (arg === "--require-pass") result.requirePass = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function usage() {
  return "Usage: node .codex/scripts/dotnet-testing-codex-full/validators/validate-tunit-execution-contract.mjs --analysis <analysis.json> --writer <writer-result.json> [--writer <writer-result.json> ...] --executor <executor-result.json> [--reviewer <reviewer-result.json>] [--require-pass]";
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

function normalizeDiagnosticEntry(entry) {
  return {
    code: typeof entry?.code === "string" ? entry.code : "",
    level: typeof entry?.level === "string" ? entry.level : "",
    warningLevel: Number.isInteger(entry?.warningLevel) ? entry.warningLevel : null,
    message: typeof entry?.message === "string" ? entry.message : "",
  };
}

function normalizeDiagnosticEntries(entries) {
  return Array.isArray(entries)
    ? entries.map(normalizeDiagnosticEntry).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    : [];
}

function validateDiagnosticGroup(group, label, errors) {
  if (!group || typeof group !== "object") {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!integer(group.warningCount)) errors.push(`${label}.warningCount must be a non-negative integer`);
  if (!integer(group.errorCount)) errors.push(`${label}.errorCount must be a non-negative integer`);
  if (!Array.isArray(group.entries)) {
    errors.push(`${label}.entries must be an array`);
    return;
  }
  const normalized = normalizeDiagnosticEntries(group.entries);
  const warningCount = normalized.filter((entry) => entry.level.toLowerCase() === "warning").length;
  const errorCount = normalized.filter((entry) => entry.level.toLowerCase() === "error").length;
  if (integer(group.warningCount) && group.warningCount !== warningCount) {
    errors.push(`${label}.warningCount does not match entries`);
  }
  if (integer(group.errorCount) && group.errorCount !== errorCount) {
    errors.push(`${label}.errorCount does not match entries`);
  }
  for (const entry of normalized) {
    if (!entry.code || !entry.level || !entry.message) errors.push(`${label}.entries require non-empty code, level, and message`);
  }
}

function canonicalDiagnosticGroup(group) {
  return {
    source: typeof group?.source === "string" ? group.source : "",
    warningCount: group?.warningCount,
    errorCount: group?.errorCount,
    entries: normalizeDiagnosticEntries(group?.entries),
  };
}

function validateCommandExecutions(executor, errors) {
  const commands = executor.commandExecutions;
  if (!Array.isArray(commands) || commands.length === 0) {
    errors.push("executor: commandExecutions must be a non-empty array");
    return;
  }
  if (typeof executor.testProjectPath !== "string" || !path.isAbsolute(executor.testProjectPath)) {
    errors.push("executor: testProjectPath must be an absolute path");
    return;
  }
  const seenSequences = new Set();
  let lastSequence = 0;
  for (const command of commands) {
    if (!Number.isInteger(command?.sequence) || command.sequence < 1 || seenSequences.has(command.sequence) || command.sequence <= lastSequence) {
      errors.push("executor: commandExecutions sequence values must be unique positive integers in ascending order");
    } else {
      seenSequences.add(command.sequence);
      lastSequence = command.sequence;
    }
    if (!Number.isInteger(command?.attempt) || command.attempt < 1) {
      errors.push("executor: commandExecutions attempt must be a positive integer");
    }
    if (!["clean", "build", "run"].includes(command?.kind)) {
      errors.push("executor: commandExecutions kind must be clean, build, or run");
    }
    if (typeof command?.command !== "string" || command.command.trim() === "") {
      errors.push("executor: commandExecutions command must be non-empty");
    } else {
      const expectedPrefix = command.kind === "run" ? "dotnet run" : `dotnet ${command.kind}`;
      if (!command.command.trim().toLowerCase().startsWith(expectedPrefix)) {
        errors.push(`executor: ${command.kind} command must start with ${expectedPrefix}`);
      }
      if (!command.command.includes(executor.testProjectPath)) {
        errors.push("executor: every command must contain the exact absolute testProjectPath");
      }
    }
    if (typeof command?.workingDirectory !== "string" || !path.isAbsolute(command.workingDirectory)) {
      errors.push("executor: commandExecutions workingDirectory must be an absolute path");
    }
    if (!Number.isInteger(command?.exitCode)) errors.push("executor: commandExecutions exitCode must be an integer");
  }
  const buildCommands = commands.filter((command) => command.kind === "build");
  const runCommands = commands.filter((command) => command.kind === "run");
  if (buildCommands.length === 0) errors.push("executor: commandExecutions must contain at least one build command");
  if (integer(executor.executionAttempts) && runCommands.length !== executor.executionAttempts) {
    errors.push("executor: run command count must equal executionAttempts");
  }
  if (executor.buildResult === "success" && !buildCommands.some((command) => command.exitCode === 0)) {
    errors.push("executor: buildResult success requires a successful build command");
  }
  if (executor.testResult === "passed" && !runCommands.some((command) => command.exitCode === 0)) {
    errors.push("executor: testResult passed requires a successful run command");
  }
}

function validateExecutorDiagnostics(executor, errors) {
  validateDiagnosticGroup(executor.diagnostics?.restore, "executor: diagnostics.restore", errors);
  validateDiagnosticGroup(executor.diagnostics?.compile, "executor: diagnostics.compile", errors);
  const source = executor.diagnostics?.restore?.source;
  if (typeof source !== "string" || !path.isAbsolute(source)) {
    errors.push("executor: diagnostics.restore.source must be an absolute project.assets.json path");
    return;
  }
  const relativeSource = path.relative(path.dirname(executor.testProjectPath), source);
  if (relativeSource.startsWith("..") || path.isAbsolute(relativeSource) || path.basename(source).toLowerCase() !== "project.assets.json") {
    errors.push("executor: diagnostics.restore.source must be the test project project.assets.json");
  }
  if (!fs.existsSync(source)) {
    errors.push("executor: diagnostics.restore.source must exist");
    return;
  }
  let actual;
  try {
    const document = JSON.parse(fs.readFileSync(source, "utf8"));
    actual = normalizeDiagnosticEntries(document.logs);
  } catch (error) {
    errors.push(`executor: diagnostics.restore.source is unreadable: ${error.message}`);
    return;
  }
  const recorded = normalizeDiagnosticEntries(executor.diagnostics?.restore?.entries);
  if (JSON.stringify(recorded) !== JSON.stringify(actual)) {
    errors.push("executor: diagnostics.restore.entries must exactly match project.assets.json logs");
  }
}

const BUILD_BLOCKED_SUMMARY = "上游 Executor 建置失敗，測試程式碼未通過編譯；不建立靜態品質結論。";

function validateReviewerAgainstExecutor(executor, reviewer, errors) {
  requireTelemetry(reviewer, "reviewer", errors);
  const expectedDiagnostics = {
    restore: executor.diagnostics?.restore,
    compile: executor.diagnostics?.compile,
  };
  if (!reviewer.diagnosticAssessment
      || JSON.stringify(canonicalDiagnosticGroup(reviewer.diagnosticAssessment.restore)) !== JSON.stringify(canonicalDiagnosticGroup(expectedDiagnostics.restore))
      || JSON.stringify(canonicalDiagnosticGroup(reviewer.diagnosticAssessment.compile)) !== JSON.stringify(canonicalDiagnosticGroup(expectedDiagnostics.compile))) {
    errors.push("reviewer: diagnosticAssessment must exactly copy executor restore and compile diagnostics");
  }
  const warningEntries = [
    ...(executor.diagnostics?.restore?.entries ?? []),
    ...(executor.diagnostics?.compile?.entries ?? []),
  ].filter((entry) => String(entry?.level).toLowerCase() === "warning");
  const reviewerText = JSON.stringify(reviewer);
  const reviewerClaims = [
    reviewer.summary,
    ...(Array.isArray(reviewer.positives) ? reviewer.positives : []),
    ...(Array.isArray(reviewer.issues) ? reviewer.issues : []),
  ].map((value) => typeof value === "string" ? value : JSON.stringify(value)).join("\n");
  if (warningEntries.length > 0) {
    if (reviewer.gateDecision === "pass") {
      errors.push("reviewer: recorded warnings require pass_with_warnings, fail, or blocked");
    }
    if (/(未發現|沒有|無)\s*(warning|警告).*(error|錯誤)|no\s+warnings?/iu.test(reviewerClaims)) {
      errors.push("reviewer: conclusions must not claim warnings are absent when diagnostics contain warnings");
    }
    for (const entry of warningEntries) {
      if (entry.code && !reviewerText.includes(entry.code)) {
        errors.push(`reviewer: warning ${entry.code} must be acknowledged in reviewer-result`);
      }
    }
  }
  if (executor.buildResult === "success") return;

  if (reviewer.reviewMode !== "upstream-build-blocked") {
    errors.push("reviewer: buildResult != success requires reviewMode upstream-build-blocked");
  }
  if (reviewer.overallScore !== "not-rated") {
    errors.push("reviewer: buildResult != success requires overallScore not-rated");
  }
  if (reviewer.rating !== undefined && reviewer.rating !== "not-rated") {
    errors.push("reviewer: buildResult != success permits only rating not-rated");
  }
  if (reviewer.summary !== BUILD_BLOCKED_SUMMARY) {
    errors.push(`reviewer: buildResult != success requires fixed summary: ${BUILD_BLOCKED_SUMMARY}`);
  }
  if (!reviewer.qualityAssessment
      || reviewer.qualityAssessment.status !== "not-established"
      || reviewer.qualityAssessment.reason !== "executor-build-failed") {
    errors.push("reviewer: buildResult != success requires qualityAssessment not-established/executor-build-failed");
  }
  if (!reviewer.upstreamBlocker
      || reviewer.upstreamBlocker.kind !== "executor-build-failed"
      || reviewer.upstreamBlocker.buildResult !== executor.buildResult
      || reviewer.upstreamBlocker.testResult !== executor.testResult) {
    errors.push("reviewer: buildResult != success requires an upstreamBlocker matching executor truth");
  }
  if (reviewer.gateDecision !== "fail" && reviewer.gateDecision !== "blocked") {
    errors.push("reviewer: buildResult != success requires gateDecision fail or blocked");
  }
  if (!Array.isArray(reviewer.positives) || reviewer.positives.length !== 0) {
    errors.push("reviewer: buildResult != success requires an empty positives array");
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
  const resolvedExecutorPath = path.resolve(args.executor);
  const reviewer = args.reviewer ? readJson(args.reviewer) : null;

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
  if (typeof executor.executorResultFilePath !== "string" || executor.executorResultFilePath.trim() === "") {
    errors.push("executor: executorResultFilePath must be a non-empty string");
  } else if (path.resolve(executor.executorResultFilePath) !== resolvedExecutorPath) {
    errors.push("executor: executorResultFilePath must equal the canonical --executor artifact path");
  }
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
  validateCommandExecutions(executor, errors);
  validateExecutorDiagnostics(executor, errors);
  if (!integer(executor.executionAttempts)) {
    errors.push("executor: executionAttempts must be a non-negative integer");
  }
  if (!integer(executor.fixRounds)) {
    errors.push("executor: fixRounds must be a non-negative integer");
  }
  if (!Array.isArray(executor.fixHistory)) {
    errors.push("executor: fixHistory must be an array");
  } else if (integer(executor.fixRounds) && executor.fixRounds !== executor.fixHistory.length) {
    errors.push("executor: fixRounds must equal fixHistory.length");
  }
  if (executor.testResult === "passed" && integer(executor.executionAttempts) && executor.executionAttempts < 1) {
    errors.push("executor: a passed testResult requires executionAttempts of at least 1");
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
    if (!integer(executor.executionAttempts) || executor.executionAttempts < 1) {
      errors.push("executor: successful acceptance requires executionAttempts of at least 1");
    }
  }

  if (reviewer) validateReviewerAgainstExecutor(executor, reviewer, errors);

  if (errors.length > 0) throw new Error(`TUnit execution contract failed:\n- ${errors.join("\n- ")}`);
  process.stdout.write(`${JSON.stringify({
    status: "valid",
    writerArtifactCount: writers.length,
    expectedMethodCount,
    expectedCaseCount,
    executedCaseCount: executor.totalTests,
    executionMethod: executor.executionMethod,
    engineMode: executor.engineMode ?? "evidence-only",
    reviewerChecked: reviewer !== null,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`validate-tunit-execution-contract error: ${error.message}\n`);
  process.exitCode = 1;
}
