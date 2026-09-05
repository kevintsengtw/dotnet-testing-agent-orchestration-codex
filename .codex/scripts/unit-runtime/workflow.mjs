import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createUnitRun,
  nextAction,
  recordDispatch,
  recordPhaseResult,
} from "./workflow-state.mjs";
import { validateCoverageDecision } from "./coverage-decision.mjs";

const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
const validatorsDirectory = path.resolve(runtimeDirectory, "..", "validators");

function parseArgs(argv) {
  const result = { targets: [], allowedReads: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--target") result.targets.push(argv[++index]);
    else if (key === "--state") result.state = argv[++index];
    else if (key === "--role") result.role = argv[++index];
    else if (key === "--status") result.status = argv[++index];
    else if (key === "--artifact") result.artifact = argv[++index];
    else if (key === "--failure-kind") result.failureKind = argv[++index];
    else if (key === "--failure-message") result.failureMessage = argv[++index];
    else if (key === "--workspace-root") result.workspaceRoot = argv[++index];
    else if (key === "--test-project") result.testProject = argv[++index];
    else if (key === "--allow-read") result.allowedReads.push(argv[++index]);
    else if (key === "--analysis") result.analysis = argv[++index];
    else if (key === "--writer") result.writer = argv[++index];
    else if (key === "--executor") result.executor = argv[++index];
    else if (key === "--reviewer") result.reviewer = argv[++index];
    else if (key === "--assignment-id") result.assignmentId = argv[++index];
    else if (key === "--line-threshold") result.lineThreshold = Number.parseFloat(argv[++index]);
    else if (key === "--branch-threshold") result.branchThreshold = Number.parseFloat(argv[++index]);
    else throw new Error(`unknown argument: ${key}`);
  }
  return result;
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) throw new Error(`workflow state does not exist: ${statePath}`);
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function hashFile(filePath, assignmentId = null) {
  const content = fs.readFileSync(filePath);
  const result = {
    path: path.resolve(filePath),
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    size: content.byteLength,
  };
  if (assignmentId) result.assignmentId = assignmentId;
  return result;
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/gu, "_");
}

function preserveRejectedArtifact(args, artifactPath, artifactSeal) {
  const testProjectPath = path.resolve(args.testProject);
  const projectDirectory = new Set([".csproj", ".fsproj", ".vbproj"]).has(path.extname(testProjectPath).toLowerCase())
    ? path.dirname(testProjectPath)
    : testProjectPath;
  const directory = path.join(
    projectDirectory,
    ".orchestrator",
    "gate-rejections",
    safeSegment(args.role),
    safeSegment(args.targets[0]),
  );
  const rejectedPath = path.join(
    directory,
    `${safeSegment(args.assignmentId)}.${artifactSeal.sha256}.json`,
  );
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(rejectedPath)) fs.copyFileSync(artifactPath, rejectedPath, fs.constants.COPYFILE_EXCL);
  return rejectedPath;
}

function isSamePath(left, right) {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function requireCanonicalArtifact(args, artifactPath) {
  const specs = {
    analyzer: { directory: "analysis", suffix: "analysis" },
    writer: { directory: "writer-result", suffix: "writer-result" },
    executor: { directory: "executor-result", suffix: "executor-result" },
    reviewer: { directory: "reviewer-result", suffix: "reviewer-result" },
    writerRepair: { directory: "writer-repair-result", suffix: "writer-repair-result" },
    executorRepair: { directory: "executor-repair-result", suffix: "executor-repair-result" },
    reviewerRepair: { directory: "reviewer-repair-result", suffix: "reviewer-repair-result" },
  };
  const spec = specs[args.role];
  if (!spec) throw new Error(`unsupported gate role: ${args.role}`);
  const testProjectPath = path.resolve(args.testProject);
  const projectDirectory = new Set([".csproj", ".fsproj", ".vbproj"]).has(path.extname(testProjectPath).toLowerCase())
    ? path.dirname(testProjectPath)
    : testProjectPath;
  const expected = path.join(
    projectDirectory,
    ".orchestrator",
    spec.directory,
    `${args.targets[0]}.${spec.suffix}.json`,
  );
  if (!isSamePath(expected, artifactPath)) {
    throw new Error(`gate artifact is not canonical for ${args.role}/${args.targets[0]}: ${artifactPath}`);
  }
}

function runValidator(name, args) {
  const script = path.join(validatorsDirectory, name);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
    throw new Error(`${name} failed${detail ? `:\n${detail}` : ""}`);
  }
}

function readArtifact(artifactPath) {
  const document = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`phase artifact must be a JSON object: ${artifactPath}`);
  }
  return document;
}

function blockedFailure(document, role) {
  const structured = document.failure;
  if (structured && typeof structured.kind === "string" && typeof structured.message === "string"
      && structured.kind.trim() && structured.message.trim()) {
    return { kind: structured.kind, message: structured.message };
  }
  const blocker = Array.isArray(document.blockers) ? document.blockers[0] : null;
  const issues = Array.isArray(document.issues) ? document.issues : [];
  const limitations = Array.isArray(document.limitations) ? document.limitations : [];
  const scenarioCoverage = Array.isArray(document.scenarioCoverage) ? document.scenarioCoverage : [];
  const message = (typeof blocker === "string" ? blocker : blocker?.message)
    ?? issues.find((issue) => issue?.severity === "blocker")?.message
    ?? limitations.find((item) => typeof item === "string" && item.trim())
    ?? scenarioCoverage.find((item) => item?.status === "blocked")?.note;
  if (typeof message !== "string" || !message.trim()) {
    throw new Error(`${role} blocked result requires a non-empty structured reason`);
  }
  return { kind: `${role}_blocked`, message };
}

function validateBlockedExecution(args, document, expectedFailure) {
  if (document.status !== "blocked") throw new Error("Writer blocked requires blocked Executor result");
  const declared = document.finalExecutionEvidencePath;
  if (typeof declared !== "string" || !declared.trim()) {
    throw new Error("blocked Executor result requires finalExecutionEvidencePath");
  }
  const evidencePath = path.resolve(args.workspaceRoot, declared);
  const testProjectPath = path.resolve(args.testProject);
  const projectDirectory = new Set([".csproj", ".fsproj", ".vbproj"]).has(path.extname(testProjectPath).toLowerCase())
    ? path.dirname(testProjectPath)
    : testProjectPath;
  const expectedDirectory = path.join(projectDirectory, ".orchestrator", "execution-evidence", args.targets[0]);
  if (!isSamePath(path.dirname(evidencePath), expectedDirectory)
      || path.basename(evidencePath).toLowerCase() !== "attempt-0.execution.json") {
    throw new Error("blocked Executor evidence must use the canonical attempt-0 path");
  }
  const evidence = readArtifact(evidencePath);
  const contradictions = [
    evidence.status !== "blocked",
    evidence.runner !== "not_run",
    evidence.build?.status !== "not_run",
    evidence.test?.status !== "not_run",
    evidence.test?.counts !== null,
    evidence.coverage?.status !== "not_applicable",
    evidence.attempt?.executionAttempt !== 0,
    evidence.attempt?.fixRound !== 0,
    evidence.failure?.kind !== expectedFailure?.kind,
    evidence.failure?.message !== expectedFailure?.message,
  ];
  if (contradictions.some(Boolean)) {
    throw new Error("blocked Executor evidence contradicts deterministic not-run lifecycle");
  }
}

function readFinalExecutionEvidence(args, executorPath) {
  const executor = readArtifact(path.resolve(executorPath));
  if (typeof executor.finalExecutionEvidencePath !== "string" || !executor.finalExecutionEvidencePath.trim()) {
    throw new Error("Executor result requires finalExecutionEvidencePath");
  }
  const evidencePath = path.resolve(args.workspaceRoot, executor.finalExecutionEvidencePath);
  const testProjectPath = path.resolve(args.testProject);
  const projectDirectory = new Set([".csproj", ".fsproj", ".vbproj"]).has(path.extname(testProjectPath).toLowerCase())
    ? path.dirname(testProjectPath)
    : testProjectPath;
  const expectedDirectory = path.join(projectDirectory, ".orchestrator", "execution-evidence", args.targets[0]);
  if (!isSamePath(path.dirname(evidencePath), expectedDirectory)
      || !/^attempt-\d+\.execution\.json$/iu.test(path.basename(evidencePath))) {
    throw new Error("Executor evidence must use the canonical target attempt path");
  }
  return readArtifact(evidencePath);
}

function validateCompletedArtifact(args, artifactPath, run, document) {
  if (!args.workspaceRoot) throw new Error("gate requires --workspace-root");
  if (!args.testProject) throw new Error("gate requires --test-project");
  requireCanonicalArtifact(args, artifactPath);
  runValidator("validate-unit-attempt-isolation.mjs", [
    "--workflow", "unit",
    "--workspace-root", path.resolve(args.workspaceRoot),
    "--test-project", path.resolve(args.testProject),
    "--artifact", artifactPath,
    ...args.allowedReads.flatMap((value) => ["--allow-read", path.resolve(value)]),
  ]);

  if (args.role === "analyzer") {
    runValidator("validate-unit-scenario-contract.mjs", [
      "--analysis", artifactPath,
    ]);
  } else if (args.role === "executor" && run.targets[args.targets[0]]?.writer?.resultStatus === "blocked") {
    validateBlockedExecution(args, document, run.targets[args.targets[0]].writer.failure);
  } else if (args.role === "reviewer" || args.role === "reviewerRepair") {
    for (const name of ["analysis", "writer", "executor"]) {
      if (!args[name]) throw new Error(`reviewer gate requires --${name}`);
    }
    const targetState = run.targets[args.targets[0]];
    const expectedArtifacts = args.role === "reviewerRepair"
      ? { analysis: targetState.analyzer.artifact, writer: targetState.writerRepair.artifact, executor: targetState.executorRepair.artifact }
      : { analysis: targetState.analyzer.artifact, writer: targetState.writer.artifact, executor: targetState.executor.artifact };
    for (const name of ["analysis", "writer", "executor"]) {
      if (!isSamePath(path.resolve(args[name]), path.resolve(expectedArtifacts[name]))) {
        throw new Error(`reviewer gate ${name} does not match the sealed current-run artifact`);
      }
    }
    const expectedDecision = targetState?.executor?.resultStatus === "blocked"
      ? "blocked"
      : "pass";
    runValidator("validate-unit-scenario-contract.mjs", [
      "--analysis", path.resolve(args.analysis),
      "--writer", path.resolve(args.writer),
      "--reviewer", artifactPath,
      expectedDecision === "blocked" ? "--require-review-blocked" : "--require-review-pass",
    ]);
    const execution = readFinalExecutionEvidence(args, args.executor);
    if (execution.coverage?.status === "available") {
      const policy = targetState.coveragePolicy;
      if (execution.coverage.line?.threshold !== policy.lineThreshold
          || execution.coverage.branch?.threshold !== policy.branchThreshold) {
        throw new Error("Executor Coverage thresholds do not match workflow policy");
      }
    }
    document.validatedCoverageDecision = validateCoverageDecision({
      execution,
      reviewerDecision: document.coverageDecision,
      repairRound: args.role === "reviewerRepair" ? targetState.coverageRepairRound : 0,
      maxRepairRounds: targetState.maxCoverageRepairRounds,
    });
  }
}

function collectSealErrors(run) {
  const errors = [];
  for (const [target, targetState] of Object.entries(run.targets ?? {})) {
    for (const role of ["analyzer", "writer", "executor", "reviewer", "writerRepair", "executorRepair", "reviewerRepair"]) {
      const phase = targetState[role];
      if (!new Set(["completed", "failed"]).has(phase?.lifecycle)) continue;
      if (phase.lifecycle === "failed" && !phase.artifactSeal) continue;
      if (!phase.artifactSeal) {
        errors.push(`${target}/${role}: completed phase is missing artifact seal`);
        continue;
      }
      try {
        const actual = hashFile(phase.artifactSeal.path);
        if (actual.sha256 !== phase.artifactSeal.sha256 || actual.size !== phase.artifactSeal.size) {
          errors.push(`${target}/${role}: artifact seal mismatch`);
        }
      } catch (error) {
        errors.push(`${target}/${role}: artifact seal mismatch (${error.message})`);
      }
    }
  }
  return errors;
}

function requireValidSeals(run) {
  const errors = collectSealErrors(run);
  if (errors.length > 0) throw new Error(errors.join("\n"));
}

function actionForPersistence(run) {
  const action = nextAction(run);
  if (String(action.type).startsWith("dispatch_")) recordDispatch(run, action);
  run.lastAction = action;
  run.updatedAt = new Date().toISOString();
  return action;
}

function start(args) {
  if (!args.state) throw new Error("start requires --state");
  if (args.targets.length === 0) throw new Error("start requires at least one --target");
  const statePath = path.resolve(args.state);
  if (fs.existsSync(statePath)) throw new Error(`workflow state already exists: ${statePath}`);
  const run = createUnitRun({
    targets: args.targets,
    coveragePolicy: {
      lineThreshold: args.lineThreshold ?? 80,
      branchThreshold: args.branchThreshold ?? 70,
      maxRepairRounds: 1,
    },
  });
  run.createdAt = new Date().toISOString();
  const action = actionForPersistence(run);
  writeState(statePath, run);
  return action;
}

function advance(args) {
  for (const name of ["state", "role", "status"]) {
    if (!args[name]) throw new Error(`advance requires --${name}`);
  }
  if (args.targets.length !== 1) throw new Error("advance requires exactly one --target");
  if (args.status === "completed") throw new Error("completed transitions require gate");
  if (args.artifact && !fs.existsSync(path.resolve(args.artifact))) {
    throw new Error(`phase artifact does not exist: ${args.artifact}`);
  }
  const statePath = path.resolve(args.state);
  const run = readState(statePath);
  recordPhaseResult(run, {
    role: args.role,
    target: args.targets[0],
    status: args.status,
    artifact: args.artifact ? path.resolve(args.artifact) : null,
    failure: args.failureKind || args.failureMessage
      ? { kind: args.failureKind ?? "unspecified", message: args.failureMessage ?? "" }
      : null,
  });
  const action = actionForPersistence(run);
  writeState(statePath, run);
  return action;
}

function gate(args) {
  for (const name of ["state", "role", "status", "artifact", "assignmentId"]) {
    if (!args[name]) throw new Error(`gate requires --${name}`);
  }
  if (args.status !== "completed") throw new Error("gate only accepts --status completed");
  if (args.targets.length !== 1) throw new Error("gate requires exactly one --target");

  const statePath = path.resolve(args.state);
  const artifactPath = path.resolve(args.artifact);
  if (!fs.existsSync(artifactPath)) throw new Error(`phase artifact does not exist: ${args.artifact}`);
  const run = readState(statePath);
  requireValidSeals(run);
  const artifactDocument = readArtifact(artifactPath);
  const artifactSeal = hashFile(artifactPath, args.assignmentId);
  try {
    validateCompletedArtifact(args, artifactPath, run, artifactDocument);
  } catch (error) {
    const rejectedPath = preserveRejectedArtifact(args, artifactPath, artifactSeal);
    throw new Error(`${error.message}\nrejected artifact preserved: ${rejectedPath}`);
  }
  recordPhaseResult(run, {
    role: args.role,
    target: args.targets[0],
    status: "completed",
    artifact: artifactPath,
    artifactSeal,
    outcome: args.role === "reviewer" || args.role === "reviewerRepair"
      ? String(artifactDocument.validatedCoverageDecision?.status ?? artifactDocument.gateDecision ?? "").trim().toLowerCase()
      : String(artifactDocument.status ?? "").trim().toLowerCase() === "blocked" ? "blocked" : "completed",
    coverageDecision: artifactDocument.validatedCoverageDecision ?? null,
    failure: artifactDocument.validatedCoverageDecision?.status === "fail"
      ? { kind: "coverage_failed", message: artifactDocument.validatedCoverageDecision.reason }
      : (String(artifactDocument.status ?? "").trim().toLowerCase() === "blocked"
        || String(artifactDocument.gateDecision ?? "").trim().toLowerCase() === "blocked")
      ? blockedFailure(artifactDocument, args.role)
      : null,
  });
  const action = actionForPersistence(run);
  writeState(statePath, run);
  return action;
}

function verifySeals(args) {
  if (!args.state) throw new Error("verify-seals requires --state");
  const run = readState(path.resolve(args.state));
  requireValidSeals(run);
  return { status: "valid", sealedArtifacts: Object.values(run.targets ?? {}).reduce(
    (count, targetState) => count + ["analyzer", "writer", "executor", "reviewer", "writerRepair", "executorRepair", "reviewerRepair"]
      .filter((role) => targetState[role]?.artifactSeal).length,
    0,
  ) };
}

function main() {
  const [operation, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (operation === "start") return start(args);
  if (operation === "advance") return advance(args);
  if (operation === "gate") return gate(args);
  if (operation === "verify-seals") return verifySeals(args);
  throw new Error("usage: workflow.mjs <start|advance|gate|verify-seals> --state <path> [options]");
}

try {
  process.stdout.write(`${JSON.stringify(main())}\n`);
} catch (error) {
  console.error(`unit workflow error: ${error.message}`);
  process.exitCode = 1;
}
