import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
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
import { countTestDeclarations, buildGateDisplay, deriveReviewerProjection } from "./artifact-normalizer.mjs";
import { validateMethodScope } from "./execution-evidence.mjs";
import { executionFailureKind, validateCoverageDecision } from "./coverage-decision.mjs";

const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
const validatorsDirectory = runtimeDirectory;

function parseArgs(argv) {
  const result = { targets: [], allowedReads: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--target") result.targets.push(argv[++index]);
    else if (key === "--requested-scopes") result.requestedScopes = argv[++index];
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

function preserveRejectionReasons(args, artifactPath, artifactSeal, failures) {
  const project = path.resolve(args.testProject);
  const root = new Set([".csproj", ".fsproj", ".vbproj"]).has(path.extname(project).toLowerCase())
    ? path.dirname(project) : project;
  const stem = artifactSeal
    ? preserveRejectedArtifact(args, artifactPath, artifactSeal).slice(0, -5)
    : path.join(root, ".orchestrator", "gate-rejections", safeSegment(args.role),
      safeSegment(args.targets[0]), `${safeSegment(args.assignmentId)}.preflight`);
  const reasonPath = `${stem}.reason.json`;
  const records = fs.existsSync(reasonPath) ? JSON.parse(fs.readFileSync(reasonPath, "utf8")) : [];
  if (!Array.isArray(records)) throw new Error(`invalid reason history: ${reasonPath}`);
  const timestamp = new Date().toISOString();
  for (const failure of failures) records.push({
    role: args.role, target: args.targets[0], assignmentId: args.assignmentId,
    artifactPath, validator: failure.validator, errors: failure.errors, timestamp,
  });
  fs.mkdirSync(path.dirname(reasonPath), { recursive: true });
  fs.writeFileSync(reasonPath, `${JSON.stringify(records, null, 2)}\n`);
  return reasonPath;
}

function validationFailures(error, validator) {
  return error.failures ?? [{ validator, errors: [error.message] }];
}

function isSamePath(left, right) {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function resolveRecordedPath(orchestratorDirectory, recordedPath) {
  return path.isAbsolute(recordedPath)
    ? path.normalize(recordedPath)
    : path.resolve(orchestratorDirectory, recordedPath);
}

function completeRunStateAssignment(args, artifactPath) {
  const runStatePath = path.join(path.dirname(path.resolve(args.state)), "run-state.json");
  const runState = readState(runStatePath);
  if (runState.workflow !== "unit") throw new Error("Unit gate requires workflow=unit run-state");
  const phaseName = args.role.replace(/Repair$/u, "");
  const assignments = runState.phases?.[phaseName]?.assignments;
  const assignment = Array.isArray(assignments)
    ? assignments.find((entry) => entry?.assignmentId === args.assignmentId)
    : null;
  if (!assignment) throw new Error(`${phaseName} run-state assignment does not exist: ${args.assignmentId}`);
  if (assignment.target !== args.targets[0]) {
    throw new Error(`${phaseName} run-state assignment target does not match gate target`);
  }
  const orchestratorDirectory = path.dirname(runStatePath);
  for (const field of ["expectedArtifactPath", "artifact"]) {
    if (typeof assignment[field] !== "string" || assignment[field].trim() === "") {
      throw new Error(`${phaseName} run-state assignment ${field} is required before gate`);
    }
    if (!isSamePath(resolveRecordedPath(orchestratorDirectory, assignment[field]), artifactPath)) {
      throw new Error(`${phaseName} run-state assignment ${field} does not match gate artifact`);
    }
  }
  for (const field of ["dispatchIssuedAt", "dispatchAcceptedAt", "artifactReadyAt"]) {
    if (typeof assignment[field] !== "string" || Number.isNaN(Date.parse(assignment[field]))) {
      throw new Error(`${phaseName} run-state assignment ${field} is required before gate`);
    }
  }
  if (Date.parse(assignment.dispatchIssuedAt) > Date.parse(assignment.dispatchAcceptedAt)
      || Date.parse(assignment.dispatchAcceptedAt) > Date.parse(assignment.artifactReadyAt)) {
    throw new Error(`${phaseName} run-state assignment timing order is invalid before gate`);
  }
  if (assignment.completedAt !== null && assignment.completedAt !== undefined) {
    if (typeof assignment.completedAt !== "string" || Number.isNaN(Date.parse(assignment.completedAt))) {
      throw new Error(`${phaseName} run-state assignment completedAt is invalid`);
    }
    if (Date.parse(assignment.completedAt) < Date.parse(assignment.artifactReadyAt)) {
      throw new Error(`${phaseName} run-state assignment completedAt precedes artifactReadyAt`);
    }
    return;
  }
  const completion = spawnSync(process.execPath, [
    path.join(runtimeDirectory, "run-state.mjs"),
    "set", "--path", runStatePath,
    "--phase", phaseName,
    "--assignment", args.assignmentId,
    "--set", "completedAt=@now",
  ], { encoding: "utf8" });
  if (completion.status !== 0) {
    throw new Error(`failed to record ${phaseName} assignment completion: ${completion.stderr?.trim() || completion.error?.message || "unknown error"}`);
  }
  const completed = readState(runStatePath).phases?.[phaseName]?.assignments
    ?.find((entry) => entry?.assignmentId === args.assignmentId);
  if (!completed || typeof completed.completedAt !== "string" || Number.isNaN(Date.parse(completed.completedAt))) {
    throw new Error(`${phaseName} run-state assignment completedAt was not persisted`);
  }
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
    const error = new Error(`${name} failed${detail ? `:\n${detail}` : ""}`);
    error.failures = [{ validator: name, errors: [detail || error.message] }];
    throw error;
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
    throw new Error(`${role} blocked result requires a non-empty structured reason: provide failure.kind and failure.message, or a supported blocker message`);
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

function validateAnalysisScope(requestedScope, analysis) {
  // Old runs without scope metadata retain their original acceptance contract.
  if (!requestedScope || requestedScope.kind === "class") return;
  if (!isDeepStrictEqual(analysis.requestedScope, requestedScope)) {
    throw new Error("Analyzer requestedScope does not match the saved target selection");
  }
  // An unresolved selection is a semantic blocker, not permission to widen it.
  if (analysis.status === "blocked") {
    blockedFailure(analysis, "analyzer");
    const resolution = analysis.scopeResolution;
    if (!Array.isArray(resolution) || resolution.length !== requestedScope.selectors.length) {
      throw new Error("Blocked Analyzer scopeResolution must preserve every requested selector");
    }
    const seen = new Set();
    for (const item of resolution) {
      if (!item || !requestedScope.selectors.includes(item.selector) || seen.has(item.selector)
          || !Array.isArray(item.methods) || item.methods.length !== 0) {
        throw new Error("Blocked Analyzer scopeResolution requires unique unresolved selectors with empty methods");
      }
      seen.add(item.selector);
    }
    if (!Array.isArray(analysis.methodsToTest) || analysis.methodsToTest.length !== 0) {
      throw new Error("Blocked Analyzer methodsToTest must be empty");
    }
    return;
  }
  const resolution = analysis.scopeResolution;
  if (!Array.isArray(resolution) || resolution.length !== requestedScope.selectors.length) {
    throw new Error("Analyzer scopeResolution must resolve every requested selector");
  }
  const resolvedMethods = new Set();
  const seen = new Set();
  for (const item of resolution) {
    if (!item || !requestedScope.selectors.includes(item.selector) || seen.has(item.selector)
        || !Array.isArray(item.methods) || item.methods.length === 0
        || item.methods.some((method) => typeof method !== "string" || !method.trim())
        || new Set(item.methods).size !== item.methods.length) {
      throw new Error("Analyzer scopeResolution requires unique selectors and resolved methods");
    }
    seen.add(item.selector);
    for (const method of item.methods) resolvedMethods.add(method);
  }
  if (!Array.isArray(analysis.methodsToTest)
      || analysis.methodsToTest.length !== resolvedMethods.size
      || new Set(analysis.methodsToTest).size !== resolvedMethods.size
      || analysis.methodsToTest.some((method) => !resolvedMethods.has(method))) {
    throw new Error("Analyzer methodsToTest must equal the resolved requested scope");
  }
  const effective = new Set(["accepted", "accepted_with_normalization", "accepted_with_limitation"]);
  for (const scenario of analysis.scenarioCatalog ?? []) {
    if (effective.has(scenario.status) && !resolvedMethods.has(scenario.methodName)) {
      throw new Error(`Analyzer scenario ${scenario.scenarioId} is outside the resolved requested scope`);
    }
  }
}

function validateWriterScope(analysis, writer) {
  const methods = new Set(analysis.methodsToTest);
  if (!Array.isArray(writer.testClasses)) {
    throw new Error("Writer testClasses must declare methodsCovered for the requested scope");
  }
  const declared = new Set();
  for (const testClass of writer.testClasses) {
    if (!Array.isArray(testClass?.methodsCovered)) {
      throw new Error("Writer testClasses must declare methodsCovered for the requested scope");
    }
    for (const method of testClass.methodsCovered) {
      if (!methods.has(method)) throw new Error(`Writer method is outside the requested scope: ${method}`);
      declared.add(method);
    }
  }
  const implementedIds = new Set((writer.scenarioCoverage ?? [])
    .filter((item) => item.status === "implemented").map((item) => item.scenarioId));
  const implementedMethods = new Set(analysis.scenarioCatalog
    .filter((item) => implementedIds.has(item.scenarioId)).map((item) => item.methodName));
  if (declared.size !== implementedMethods.size || [...declared].some((method) => !implementedMethods.has(method))) {
    throw new Error("Writer methodsCovered must match the implemented scenario methods");
  }
}

function validateReviewerScope(analysis, review) {
  const methods = new Set(analysis.methodsToTest);
  const findings = [
    ...(review.missingTestCases ?? []),
    ...(review.coverageDecision?.repairable ?? []),
  ];
  for (const finding of findings) {
    if (finding && typeof finding === "object" && finding.methodName !== undefined
        && !methods.has(finding.methodName)) {
      throw new Error(`Reviewer required finding is outside the requested scope: ${finding.methodName}`);
    }
  }
}

function validateCompletedArtifact(args, artifactPath, run, document) {
  if (!args.workspaceRoot) throw new Error("gate requires --workspace-root");
  if (!args.testProject) throw new Error("gate requires --test-project");
  requireCanonicalArtifact(args, artifactPath);
  const failures = [];
  const check = (name, operation) => {
    try { return operation(); }
    catch (error) { failures.push(...validationFailures(error, name)); }
  };
  const validate = (name, argv) => check(name, () => runValidator(name, argv));
  validate("validate-attempt-isolation.mjs", [
    "--workflow", "unit",
    "--workspace-root", path.resolve(args.workspaceRoot),
    "--test-project", path.resolve(args.testProject),
    "--artifact", artifactPath,
    ...args.allowedReads.flatMap((value) => ["--allow-read", path.resolve(value)]),
  ]);

  try {
  if (args.role === "analyzer") {
    check("analysis-scope", () => validateAnalysisScope(run.targets[args.targets[0]].requestedScope, document));
    validate("validate-scenario-contract.mjs", [
      "--analysis", artifactPath,
    ]);
  } else if ((args.role === "writer" || args.role === "writerRepair")
      && run.targets[args.targets[0]].requestedScope?.kind === "methods") {
    const analysisPath = run.targets[args.targets[0]].analyzer.artifact;
    const analysis = readArtifact(analysisPath);
    validate("validate-scenario-contract.mjs", ["--analysis", analysisPath, "--writer", artifactPath]);
    check("writer-scope", () => validateWriterScope(analysis, document));
  } else if (args.role === "executor" && run.targets[args.targets[0]]?.writer?.resultStatus === "blocked") {
    check("blocked-execution", () => validateBlockedExecution(args, document, run.targets[args.targets[0]].writer.failure));
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
    if (targetState.requestedScope?.kind === "methods") {
      const analysis = readArtifact(expectedArtifacts.analysis);
      check("writer-scope", () => validateWriterScope(analysis, readArtifact(expectedArtifacts.writer)));
      check("reviewer-scope", () => validateReviewerScope(analysis, document));
    }
    const execution = readFinalExecutionEvidence(args, args.executor);
    if (targetState.requestedScope?.kind === "methods" && execution.coverage?.status !== "not_applicable") {
      check("executor-method-scope", () => validateMethodScope(execution.coverage, readArtifact(expectedArtifacts.analysis).methodsToTest));
    }
    const executionFailure = executionFailureKind(execution);
    const projection = check("reviewer-projection", () => deriveReviewerProjection({analysis:readArtifact(expectedArtifacts.analysis),writer:readArtifact(expectedArtifacts.writer),execution,review:document,
      repairRound:args.role === "reviewerRepair" ? targetState.coverageRepairRound : 0,maxRepairRounds:targetState.maxCoverageRepairRounds}));
    if(projection) {
      Object.assign(document,projection);
      validate("validate-scenario-contract.mjs", ["--analysis",path.resolve(args.analysis),"--writer",path.resolve(args.writer),"--reviewer",artifactPath,"--reviewer-projection",JSON.stringify(projection)]);
    }
    check("coverage-policy", () => {
    if (execution.coverage?.status === "available") {
      if (targetState.requestedScope?.kind === "methods") {
        const analysis = readArtifact(expectedArtifacts.analysis);
        const scope = execution.coverage.scope;
        if (scope?.targetClass !== args.targets[0]
            || typeof scope.targetSource !== "string" || typeof analysis.sourcePath !== "string"
            || !isSamePath(path.resolve(args.workspaceRoot, scope.targetSource), path.resolve(args.workspaceRoot, analysis.sourcePath))) {
          throw new Error("Executor Coverage scope does not match the sealed Analyzer class/source");
        }
      }
      const policy = targetState.coveragePolicy;
      if (execution.coverage.line?.threshold !== policy.lineThreshold
          || execution.coverage.branch?.threshold !== policy.branchThreshold) {
        throw new Error("Executor Coverage thresholds do not match workflow policy");
      }
    }
    });
    if(projection) document.validatedCoverageDecision = {...projection.coverageDecision,
      releaseEligible:projection.gateDecision === "pass" && projection.coverageDecision.releaseEligible,
      reviewerProjection:projection};
  }
  } catch (error) {
    failures.push(...validationFailures(error, "artifact-prerequisites"));
  }
  if (failures.length > 0) {
    const error = new Error(failures.map((failure) => `${failure.validator}: ${failure.errors.join("\n")}`).join("\n"));
    error.failures = failures;
    throw error;
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
  if (args.targets.some(target => /[()\s]/.test(target))) throw new Error("target must be a class name; put method signatures in --requested-scopes");
  if (!args.state) throw new Error("start requires --state");
  if (args.targets.length === 0) throw new Error("start requires at least one --target");
  const statePath = path.resolve(args.state);
  if (fs.existsSync(statePath)) throw new Error(`workflow state already exists: ${statePath}`);
  const root = path.dirname(statePath);
  if (fs.existsSync(root)) {
    const allowed = new Set(["run-state.json", "integrity/production-baseline.json", "integrity/test-baseline.json"]);
    if (args.requestedScopes) {
      const input = path.relative(root, path.resolve(args.requestedScopes)).split(path.sep).join("/");
      if (input !== ".." && !input.startsWith("../") && !path.isAbsolute(input)) allowed.add(input);
    }
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        const relative = path.relative(root, file).split(path.sep).join("/");
        if (entry.isSymbolicLink()) throw new Error(`initialization residue/link: ${relative}`);
        if (entry.isDirectory() && [...allowed].some((item) => item.startsWith(`${relative}/`))) visit(file);
        else if (!entry.isFile() || !allowed.has(relative)) throw new Error(`initialization residue: ${relative}`);
      }
    };
    visit(root);
    const timingPath = path.join(root, "run-state.json");
    if (fs.existsSync(timingPath)) {
      const timing = readArtifact(timingPath);
      if (timing.workflow !== "unit" || !timing.overallWallClock?.start
          || timing.overallWallClock.end != null || Object.keys(timing.phases ?? {}).length !== 0) {
        throw new Error("initialization residue: run-state is not fresh");
      }
    }
  }
  const run = createUnitRun({
    targets: args.targets,
    requestedScopes: args.requestedScopes ? readArtifact(path.resolve(args.requestedScopes)) : {},
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

function writerDeclarations(args, document) {
  const files = Array.isArray(document.testFilePaths) ? [...new Set(document.testFilePaths)] : [];
  const result = { status: "unavailable", count: null, reason: "Writer 未提供測試檔案", files: [] };
  for (const file of files) {
    try {
      const resolved = path.resolve(args.workspaceRoot, file);
      const relative = path.relative(path.dirname(path.resolve(args.testProject)), resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("測試檔案不在測試專案內");
      result.files.push({ path: file, ...countTestDeclarations(fs.readFileSync(resolved, "utf8")) });
    } catch (error) { result.files.push({ path: file, status: "unavailable", count: null, reason: error.message }); }
  }
  if (files.length && result.files.every((file) => file.status === "available")) {
    result.status = "available"; result.count = result.files.reduce((sum, file) => sum + file.count, 0); result.reason = null;
  } else if (files.length) result.reason = result.files.filter((file) => file.reason).map((file) => `${file.path}: ${file.reason}`).join("; ");
  return result;
}

function gateDisplay(args, document, declarations) {
  const timing = spawnSync(process.execPath, [path.join(runtimeDirectory, "run-state.mjs"), "phase-time", "--path", path.join(path.dirname(path.resolve(args.state)), "run-state.json"), "--phase", args.role.replace(/Repair$/, "")], { encoding: "utf8" });
  let projected;
  try { if (timing.status === 0) projected = JSON.parse(timing.stdout); } catch { /* display remains unavailable */ }
  let execution;
  if (args.role === "executor" || args.role === "executorRepair") {
    try { execution = readFinalExecutionEvidence(args, path.resolve(args.artifact)); } catch { /* preserve unavailable */ }
  }
  const display = buildGateDisplay({ role: args.role, document, declarations, execution, durationMs: projected?.durationMs });
  display.duration.source = "run-state phase-time (same derivation as closeout)";
  if (projected) display.duration.text = projected.display;
  else display.duration.reason = timing.stderr?.trim() || timing.error?.message || "run-state 階段耗時無法取得";
  return display;
}

function gate(args) {
  for (const name of ["state", "role", "status", "artifact", "assignmentId"]) {
    if (!args[name]) throw new Error(`gate requires --${name}`);
  }
  if (args.status !== "completed") throw new Error("gate only accepts --status completed");
  if (args.targets.length !== 1) throw new Error("gate requires exactly one --target");

  const statePath = path.resolve(args.state);
  const artifactPath = path.resolve(args.artifact);
  const run = readState(statePath);
  let artifactSeal;
  let artifactDocument;
  let declarations;
  let validator = "artifact-seals";
  try {
    requireValidSeals(run);
    validator = "canonical-artifact";
    requireCanonicalArtifact(args, artifactPath);
    validator = "artifact-json";
    artifactSeal = hashFile(artifactPath, args.assignmentId);
    artifactDocument = readArtifact(artifactPath);
    validator = "artifact-contract";
    validateCompletedArtifact(args, artifactPath, run, artifactDocument);
    declarations = args.role === "writer" || args.role === "writerRepair" ? writerDeclarations(args, artifactDocument) : null;
    const phaseResult = {
      role: args.role,
      target: args.targets[0],
      status: "completed",
      artifact: artifactPath,
      artifactSeal,
      testDeclarations: declarations,
      outcome: args.role === "reviewer" || args.role === "reviewerRepair"
        ? String(artifactDocument.runtimeOutcome ?? artifactDocument.validatedCoverageDecision?.status ?? artifactDocument.gateDecision ?? "").trim().toLowerCase()
        : String(artifactDocument.status ?? "").trim().toLowerCase() === "blocked" ? "blocked" : "completed",
      coverageDecision: artifactDocument.validatedCoverageDecision ?? null,
      failure: artifactDocument.validatedCoverageDecision?.status === "fail"
        ? { kind: artifactDocument.validatedCoverageDecision.executionFailure ?? "coverage_failed", message: artifactDocument.validatedCoverageDecision.reason }
        : artifactDocument.runtimeOutcome === "fail" ? {kind:"reviewer_failed",message:artifactDocument.runtimeReason}
        : (String(artifactDocument.status ?? "").trim().toLowerCase() === "blocked"
          || String(artifactDocument.gateDecision ?? "").trim().toLowerCase() === "blocked")
        ? blockedFailure(artifactDocument, args.role)
        : null,
    };
    validator = "workflow-phase-transition";
    recordPhaseResult(structuredClone(run), phaseResult);
    validator = "run-state-assignment-completion";
    completeRunStateAssignment(args, artifactPath);
    validator = "workflow-phase-transition";
    recordPhaseResult(run, phaseResult);
  } catch (error) {
    const reasonPath = preserveRejectionReasons(args, artifactPath, artifactSeal, validationFailures(error, validator));
    throw new Error(`${error.message}\nrejection reasons preserved: ${reasonPath}`);
  }
  const action = actionForPersistence(run);
  if(args.role === "executor" || args.role === "executorRepair") {
    let execution;
    try { execution=readFinalExecutionEvidence(args,artifactPath); } catch(error) { action.coverageContextUnavailable=error.message; }
    action.coverageGapClassificationRequired=execution?.coverage?.status === "available" && execution.coverage.goalMet === false;
    action.coverageMethodGaps=action.coverageGapClassificationRequired ? (execution.coverage.methodDetails?.records??[]).filter(r=>execution.coverage.scope?.kind!=="methods" || (execution.coverage.methodDetails?.resolutions??[]).some(m=>m.className===r.className&&m.name===r.name&&m.coberturaSignature===r.signature)).map(r=>({className:r.className,name:r.name,signature:r.signature,status:r.status,uncoveredLines:r.line?.uncoveredLines??[],uncoveredBranches:r.branch?.uncoveredBranches??[]})) : [];
  }
  writeState(statePath, run);
  return { ...action, display: gateDisplay(args, artifactDocument, declarations) };
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
