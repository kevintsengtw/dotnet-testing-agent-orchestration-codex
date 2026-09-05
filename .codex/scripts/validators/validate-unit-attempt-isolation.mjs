#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { artifacts: [], allowedReads: [], workspaceRoot: process.cwd(), workflow: "unit" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--artifact") args.artifacts.push(argv[++i]);
    else if (arg === "--allow-read") args.allowedReads.push(argv[++i]);
    else if (arg === "--test-project") args.testProject = argv[++i];
    else if (arg === "--workspace-root") args.workspaceRoot = argv[++i];
    else if (arg === "--workflow") args.workflow = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node .codex/scripts/validators/validate-unit-attempt-isolation.mjs --workflow <unit|tunit|integration|aspire> --test-project <project-file-or-directory> --artifact <path> [--artifact <path> ...] [--allow-read <path> ...] [--workspace-root <path>]",
    "",
    "Rejects external, prior-attempt/archive, undeclared .orchestrator reads, and out-of-workspace writes recorded in tokenEstimateInputs.",
  ].join("\n");
}

function canonical(root, value) {
  return path.normalize(path.isAbsolute(value) ? value : path.resolve(root, value));
}

function resolveTestProjectDir(testProject) {
  const projectFileExtensions = new Set([".csproj", ".fsproj", ".vbproj"]);
  return projectFileExtensions.has(path.extname(testProject).toLowerCase())
    ? path.dirname(testProject)
    : testProject;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSameCanonicalPath(left, right) {
  if (process.platform === "win32") return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function isAllowedCanonicalSelfRead(resolvedArtifact, resolvedRead, currentOrchestratorRoot) {
  if (!isSameCanonicalPath(resolvedArtifact, resolvedRead)) return false;

  const allowedArtifactTypes = [
    { directory: "analysis", suffix: ".analysis.json" },
    { directory: "writer-result", suffix: ".writer-result.json" },
    { directory: "writer-repair-result", suffix: ".writer-repair-result.json" },
    { directory: "executor-result", suffix: ".executor-result.json" },
    { directory: "executor-repair-result", suffix: ".executor-repair-result.json" },
    { directory: "reviewer-result", suffix: ".reviewer-result.json" },
    { directory: "reviewer-repair-result", suffix: ".reviewer-repair-result.json" },
  ];
  return allowedArtifactTypes.some(({ directory, suffix }) => (
    isSameCanonicalPath(path.dirname(resolvedArtifact), path.join(currentOrchestratorRoot, directory))
      && path.basename(resolvedArtifact).toLowerCase().endsWith(suffix)
  ));
}

function canonicalKey(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isCanonicalExecutorResult(resolvedPath, currentOrchestratorRoot) {
  return (
    isSameCanonicalPath(path.dirname(resolvedPath), path.join(currentOrchestratorRoot, "executor-result"))
      && path.basename(resolvedPath).toLowerCase().endsWith(".executor-result.json")
  ) || (
    isSameCanonicalPath(path.dirname(resolvedPath), path.join(currentOrchestratorRoot, "executor-repair-result"))
      && path.basename(resolvedPath).toLowerCase().endsWith(".executor-repair-result.json")
  );
}

function executorTargetName(executorArtifactPath) {
  const basename = path.basename(executorArtifactPath);
  for (const suffix of [".executor-result.json", ".executor-repair-result.json"]) {
    if (basename.toLowerCase().endsWith(suffix)) return basename.slice(0, -suffix.length);
  }
  return null;
}

function resolveExecutionEvidencePath(declaredPath, workspaceRoot, currentOrchestratorRoot, expectedTarget = null) {
  if (typeof declaredPath !== "string" || declaredPath.trim() === "") return null;

  const resolvedPath = canonical(workspaceRoot, declaredPath);
  if (!isWithin(currentOrchestratorRoot, resolvedPath)) return null;

  const relativePath = path.relative(currentOrchestratorRoot, resolvedPath);
  const segments = relativePath.split(path.sep);
  const evidenceDirectory = segments[0]?.toLowerCase();
  if (evidenceDirectory !== "execution-evidence") return null;
  if (segments.length !== 3) return null;
  if (expectedTarget && canonicalKey(segments[1]) !== canonicalKey(expectedTarget)) return null;
  if (!/^attempt-\d+\.execution\.json$/i.test(path.basename(resolvedPath))) return null;

  return resolvedPath;
}

function resolveDeclaredExecutionEvidence(document, workspaceRoot, currentOrchestratorRoot, executorArtifactPath = null) {
  return resolveExecutionEvidencePath(
    document?.finalExecutionEvidencePath,
    workspaceRoot,
    currentOrchestratorRoot,
    executorArtifactPath ? executorTargetName(executorArtifactPath) : null,
  );
}

function resolveDeclaredExecutionHistory(document, executorArtifactPath, workspaceRoot, currentOrchestratorRoot) {
  const finalEvidence = resolveDeclaredExecutionEvidence(
    document,
    workspaceRoot,
    currentOrchestratorRoot,
    executorArtifactPath,
  );
  if (!Array.isArray(document?.executionEvidencePaths)) {
    return finalEvidence ? [finalEvidence] : [];
  }
  if (document.executionEvidencePaths.length === 0) {
    throw new Error("executionEvidencePaths must not be empty when provided");
  }

  const target = executorTargetName(executorArtifactPath);
  const resolved = document.executionEvidencePaths.map((declaredPath, index) => {
    const evidencePath = resolveExecutionEvidencePath(
      declaredPath,
      workspaceRoot,
      currentOrchestratorRoot,
      target,
    );
    if (!evidencePath) throw new Error(`executionEvidencePaths[${index}] is not canonical for the current target`);
    return evidencePath;
  });
  if (new Set(resolved.map(canonicalKey)).size !== resolved.length) {
    throw new Error("executionEvidencePaths must contain unique paths");
  }
  if (!finalEvidence || !isSameCanonicalPath(resolved.at(-1), finalEvidence)) {
    throw new Error("executionEvidencePaths must end with finalExecutionEvidencePath");
  }

  let previousAttempt = -1;
  for (const [index, evidencePath] of resolved.entries()) {
    const filenameAttempt = Number.parseInt(path.basename(evidencePath).match(/^attempt-(\d+)\.execution\.json$/i)[1], 10);
    let evidence;
    try {
      evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    } catch (error) {
      throw new Error(`executionEvidencePaths[${index}] is unreadable or invalid JSON (${error.message})`);
    }
    if (evidence?.attempt?.executionAttempt !== filenameAttempt) {
      throw new Error(`executionEvidencePaths[${index}] attempt does not match its filename`);
    }
    if (filenameAttempt <= previousAttempt) {
      throw new Error("executionEvidencePaths attempts must be strictly increasing");
    }
    previousAttempt = filenameAttempt;
  }
  return resolved;
}

function collectDeclaredCurrentExecutionEvidence({
  artifact,
  resolvedArtifact,
  allowedReadPaths,
  workspaceRoot,
  currentOrchestratorRoot,
}) {
  const declaredEvidence = new Set();
  const addExecutorPointer = (document, executorArtifactPath) => {
    if (!isCanonicalExecutorResult(executorArtifactPath, currentOrchestratorRoot)) return;
    const resolvedEvidence = isSameCanonicalPath(executorArtifactPath, resolvedArtifact)
      ? resolveDeclaredExecutionHistory(document, executorArtifactPath, workspaceRoot, currentOrchestratorRoot)
      : [resolveDeclaredExecutionEvidence(document, workspaceRoot, currentOrchestratorRoot, executorArtifactPath)].filter(Boolean);
    for (const evidencePath of resolvedEvidence) declaredEvidence.add(canonicalKey(evidencePath));
  };

  addExecutorPointer(artifact, resolvedArtifact);
  for (const allowedReadPath of allowedReadPaths) {
    if (!isCanonicalExecutorResult(allowedReadPath, currentOrchestratorRoot)) continue;
    try {
      addExecutorPointer(JSON.parse(fs.readFileSync(allowedReadPath, "utf8")), allowedReadPath);
    } catch {
      // Invalid allowed-read artifacts cannot authorize execution evidence.
    }
  }
  return declaredEvidence;
}

function hasForbiddenSegment(relativeValue) {
  const segments = relativeValue.split(/[\\/]+/).filter(Boolean);
  const basename = segments.at(-1) ?? "";
  const marker = /(?:^|[-_.])(?:attempt|archive|retained)(?:$|[-_.])/i;
  return segments.slice(0, -1).some((segment) => marker.test(segment))
    || /^attempt-\d+(?:[-_.].*)?$/i.test(basename);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.testProject) throw new Error("--test-project is required");
  if (args.artifacts.length === 0) throw new Error("at least one --artifact is required");
  if (!new Set(["unit", "tunit", "integration", "aspire"]).has(args.workflow)) {
    throw new Error(`--workflow must be unit, tunit, integration, or aspire, got: ${args.workflow}`);
  }

  const workspaceRoot = canonical(process.cwd(), args.workspaceRoot);
  const testProject = canonical(workspaceRoot, args.testProject);
  const testProjectDir = resolveTestProjectDir(testProject);
  const currentOrchestratorRoot = path.join(testProjectDir, ".orchestrator");
  const allowedReadPaths = args.allowedReads.map((value) => canonical(workspaceRoot, value));
  const allowedReads = new Set(allowedReadPaths.map(canonicalKey));
  const errors = [];
  let readCount = 0;
  let writeCount = 0;

  for (const artifactPath of args.artifacts) {
    const resolvedArtifact = canonical(workspaceRoot, artifactPath);
    let artifact;
    try {
      artifact = JSON.parse(fs.readFileSync(resolvedArtifact, "utf8"));
    } catch (error) {
      errors.push(`${artifactPath}: unreadable or invalid JSON (${error.message})`);
      continue;
    }
    const reads = artifact.tokenEstimateInputs?.readFiles;
    if (!Array.isArray(reads)) {
      errors.push(`${artifactPath}: tokenEstimateInputs.readFiles must be an array`);
      continue;
    }
    const writes = artifact.tokenEstimateInputs?.writtenFiles;
    if (!Array.isArray(writes)) {
      errors.push(`${artifactPath}: tokenEstimateInputs.writtenFiles must be an array`);
      continue;
    }
    const declaredCurrentExecutionEvidence = collectDeclaredCurrentExecutionEvidence({
      artifact,
      resolvedArtifact,
      allowedReadPaths,
      workspaceRoot,
      currentOrchestratorRoot,
    });
    const declaredCurrentExecutionWrites = new Set();
    if (isCanonicalExecutorResult(resolvedArtifact, currentOrchestratorRoot)) {
      const resolvedEvidence = resolveDeclaredExecutionHistory(
        artifact,
        resolvedArtifact,
        workspaceRoot,
        currentOrchestratorRoot,
      );
      for (const evidencePath of resolvedEvidence) {
        declaredCurrentExecutionWrites.add(canonicalKey(evidencePath));
      }
    }
    for (const [index, item] of reads.entries()) {
      readCount += 1;
      const label = `${artifactPath}: readFiles[${index}]`;
      if (!item || typeof item.path !== "string" || item.path.trim() === "") {
        errors.push(`${label}.path must be a non-empty string`);
        continue;
      }
      const resolvedRead = canonical(workspaceRoot, item.path);
      if (!isWithin(workspaceRoot, resolvedRead)) {
        errors.push(`${label} is outside workspace: ${item.path}`);
        continue;
      }
      const workspaceRelativeRead = path.relative(workspaceRoot, resolvedRead);
      const isDeclaredCurrentExecutionEvidence = declaredCurrentExecutionEvidence.has(canonicalKey(resolvedRead));
      if (
        hasForbiddenSegment(workspaceRelativeRead)
        && !isDeclaredCurrentExecutionEvidence
      ) {
        errors.push(`${label} contains prior-attempt/archive marker: ${item.path}`);
        continue;
      }
      const segments = workspaceRelativeRead.split(path.sep);
      const hasOrchestratorSegment = segments.some((segment) => segment.toLowerCase().startsWith(".orchestrator"));
      if (hasOrchestratorSegment) {
        const allowedCanonicalSelfRead = isAllowedCanonicalSelfRead(
          resolvedArtifact,
          resolvedRead,
          currentOrchestratorRoot,
        );
        if (!isWithin(currentOrchestratorRoot, resolvedRead)) {
          errors.push(`${label} references another orchestrator root: ${item.path}`);
        } else if (
          !allowedCanonicalSelfRead
          && !isDeclaredCurrentExecutionEvidence
          && !allowedReads.has(canonicalKey(resolvedRead))
        ) {
          errors.push(`${label} is not an allowed current-run artifact: ${item.path}`);
        }
      }
    }
    for (const [index, item] of writes.entries()) {
      writeCount += 1;
      const label = `${artifactPath}: writtenFiles[${index}]`;
      if (!item || typeof item.path !== "string" || item.path.trim() === "") {
        errors.push(`${label}.path must be a non-empty string`);
        continue;
      }
      const resolvedWrite = canonical(workspaceRoot, item.path);
      if (!isWithin(workspaceRoot, resolvedWrite)) {
        errors.push(`${label} is outside workspace: ${item.path}`);
        continue;
      }
      const workspaceRelativeWrite = path.relative(workspaceRoot, resolvedWrite);
      const isDeclaredCurrentExecutionWrite = declaredCurrentExecutionWrites.has(canonicalKey(resolvedWrite));
      if (hasForbiddenSegment(workspaceRelativeWrite) && !isDeclaredCurrentExecutionWrite) {
        errors.push(`${label} contains prior-attempt/archive marker: ${item.path}`);
        continue;
      }
      const segments = workspaceRelativeWrite.split(path.sep);
      const hasOrchestratorSegment = segments.some((segment) => segment.toLowerCase().startsWith(".orchestrator"));
      if (hasOrchestratorSegment) {
        if (!isWithin(currentOrchestratorRoot, resolvedWrite)) {
          errors.push(`${label} references another orchestrator root: ${item.path}`);
        } else if (
          !isSameCanonicalPath(resolvedArtifact, resolvedWrite)
          && !isDeclaredCurrentExecutionWrite
        ) {
          errors.push(`${label} is not the current assignment artifact: ${item.path}`);
        }
      }
    }
  }

  if (errors.length > 0) throw new Error(`attempt isolation validation failed:\n- ${errors.join("\n- ")}`);
  process.stdout.write(`${JSON.stringify({ status: "valid", workflow: args.workflow, artifactCount: args.artifacts.length, readCount, writeCount }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`validate-unit-attempt-isolation error: ${error.message}\n`);
  process.exitCode = 1;
}
