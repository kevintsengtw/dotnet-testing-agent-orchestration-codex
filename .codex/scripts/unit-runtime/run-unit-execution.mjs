import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildUnitExecutionEvidence } from "./execution-evidence.mjs";

function defaultRunCommand({ file, args, cwd }) {
  const result = spawnSync(file, args, { cwd, encoding: "utf8", windowsHide: true });
  return {
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    error: result.error?.message ?? null,
  };
}

function findFile(root, name) {
  if (!fs.existsSync(root)) return null;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const item = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(item);
      else if (entry.name === name) return item;
    }
  }
  return null;
}

export function classifyUnitExecutionEvidence(evidence) {
  if (evidence?.status === "blocked") return "blocked";
  if (evidence?.build?.status !== "passed") return "build_failed";
  if (evidence?.test?.status === "passed") return "passed";

  const counts = evidence?.test?.counts;
  const allRecordedTestsPassed = counts
    && counts.failed === 0
    && counts.total === counts.passed + counts.skipped;
  if (evidence?.test?.exitCode !== 0 && allRecordedTestsPassed) return "environment_failed";
  return "test_failed";
}

export function runUnitExecution({
  testProject,
  resultsDirectory,
  attempt = 1,
  fixRound = attempt - 1,
  maxFixRounds = 3,
  maxEnvironmentRetries = 1,
  blocked = false,
  failureKind = null,
  failureMessage = null,
  targetSource = null,
  targetClass = null,
  lineThreshold = 80,
  branchThreshold = 70,
  now = () => new Date().toISOString(),
  runCommand = defaultRunCommand,
  cwd = process.cwd(),
}) {
  if (!testProject) throw new Error("testProject is required");
  if (!resultsDirectory) throw new Error("resultsDirectory is required");
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("attempt must be a positive integer");
  if (!Number.isInteger(fixRound) || fixRound < 0) throw new Error("fixRound must be a non-negative integer");
  if (!Number.isInteger(maxFixRounds) || maxFixRounds < 0) throw new Error("maxFixRounds must be a non-negative integer");
  if (!Number.isInteger(maxEnvironmentRetries) || maxEnvironmentRetries < 0) {
    throw new Error("maxEnvironmentRetries must be a non-negative integer");
  }
  if (fixRound > maxFixRounds) throw new Error("fixRound exceeds the configured repair budget");
  const environmentRetryCount = attempt - fixRound - 1;
  if (environmentRetryCount < 0) throw new Error("attempt cannot be lower than fixRound plus one");
  if (environmentRetryCount > maxEnvironmentRetries) {
    throw new Error("attempt exceeds the configured environment retry budget");
  }
  const startedAt = now();
  const attemptEvidence = ({ repairEligible = false, environmentRetryEligible = false } = {}) => ({
    executionAttempt: attempt,
    fixRound,
    maxFixRounds,
    environmentRetryCount,
    maxEnvironmentRetries,
    repairEligible,
    environmentRetryEligible,
  });

  if (blocked) {
    const completedAt = now();
    return {
      schemaVersion: 1,
      status: "blocked",
      runner: "not_run",
      build: { status: "not_run", exitCode: null, command: null, rawOutput: null },
      test: { status: "not_run", counts: null, exitCode: null, command: null, rawOutput: null },
      coverage: { status: "not_applicable", line: null, branch: null },
      failure: {
        kind: failureKind ?? "blocked",
        message: failureMessage ?? "Execution was blocked before build.",
      },
      attempt: {
        ...attemptEvidence(),
        executionAttempt: 0,
        fixRound: 0,
        environmentRetryCount: 0,
      },
      timing: {
        startedAt,
        buildCompletedAt: null,
        completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(startedAt),
      },
    };
  }

  const projectPath = path.resolve(cwd, testProject);
  const evidenceRoot = path.resolve(cwd, resultsDirectory);
  fs.mkdirSync(evidenceRoot, { recursive: true });

  const buildArgs = ["build", projectPath, "--no-incremental", "--nologo", "--verbosity", "minimal"];
  const build = runCommand({ file: "dotnet", args: buildArgs, cwd });
  const buildCompletedAt = now();
  const buildEvidence = { command: ["dotnet", ...buildArgs], exitCode: build.exitCode, output: build.output };
  if (build.exitCode !== 0) {
    const completedAt = buildCompletedAt;
    return {
      schemaVersion: 1,
      status: "build_failed",
      runner: "dotnet test",
      build: {
        status: "failed",
        exitCode: build.exitCode,
        command: buildEvidence.command,
        rawOutput: String(build.output ?? ""),
      },
      test: { status: "not_run", counts: null },
      coverage: { status: "not_applicable", line: null, branch: null },
      attempt: attemptEvidence({ repairEligible: fixRound < maxFixRounds }),
      timing: {
        startedAt,
        buildCompletedAt,
        completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(startedAt),
      },
    };
  }

  const testArgs = [
    "test",
    projectPath,
    "--no-build",
    "--nologo",
    "--verbosity",
    "minimal",
    "--results-directory",
    evidenceRoot,
    "--logger",
    "trx;LogFileName=test-results.trx",
    "--collect",
    "XPlat Code Coverage",
  ];
  const test = runCommand({ file: "dotnet", args: testArgs, cwd });
  const completedAt = now();
  const trxPath = findFile(evidenceRoot, "test-results.trx");
  const coberturaPath = findFile(evidenceRoot, "coverage.cobertura.xml");
  const evidence = buildUnitExecutionEvidence({
    build: buildEvidence,
    test: { command: ["dotnet", ...testArgs], exitCode: test.exitCode, output: test.output },
    trxPath,
    coberturaPath,
    targetSource,
    targetClass,
    lineThreshold,
    branchThreshold,
  });
  const status = classifyUnitExecutionEvidence(evidence);
  return {
    ...evidence,
    status,
    attempt: attemptEvidence({
      repairEligible: status === "test_failed" && fixRound < maxFixRounds,
      environmentRetryEligible: status === "environment_failed"
        && environmentRetryCount < maxEnvironmentRetries,
    }),
    timing: {
      startedAt,
      buildCompletedAt,
      completedAt,
      durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    },
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--test-project") result.testProject = argv[++index];
    else if (key === "--results-directory") result.resultsDirectory = argv[++index];
    else if (key === "--output") result.output = argv[++index];
    else if (key === "--attempt") result.attempt = Number.parseInt(argv[++index], 10);
    else if (key === "--fix-round") result.fixRound = Number.parseInt(argv[++index], 10);
    else if (key === "--max-fix-rounds") result.maxFixRounds = Number.parseInt(argv[++index], 10);
    else if (key === "--max-environment-retries") result.maxEnvironmentRetries = Number.parseInt(argv[++index], 10);
    else if (key === "--blocked") result.blocked = true;
    else if (key === "--failure-kind") result.failureKind = argv[++index];
    else if (key === "--failure-message") result.failureMessage = argv[++index];
    else if (key === "--target-source") result.targetSource = argv[++index];
    else if (key === "--target-class") result.targetClass = argv[++index];
    else if (key === "--line-threshold") result.lineThreshold = Number.parseFloat(argv[++index]);
    else if (key === "--branch-threshold") result.branchThreshold = Number.parseFloat(argv[++index]);
    else throw new Error(`unknown argument: ${key}`);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.output) throw new Error("--output is required");
  const result = runUnitExecution(args);
  const output = path.resolve(args.output);
  if (fs.existsSync(output)) throw new Error(`execution evidence already exists: ${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: result.status, output })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(`unit execution error: ${error.message}`);
    process.exitCode = 1;
  }
}
