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
    { directory: "reviewer-result", suffix: ".reviewer-result.json" },
  ];
  return allowedArtifactTypes.some(({ directory, suffix }) => (
    isSameCanonicalPath(path.dirname(resolvedArtifact), path.join(currentOrchestratorRoot, directory))
      && path.basename(resolvedArtifact).toLowerCase().endsWith(suffix)
  ));
}

function hasForbiddenSegment(relativeValue) {
  return relativeValue
    .split(/[\\/]+/)
    .some((segment) => /(?:attempt|archive|retained)/i.test(segment));
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
  const allowedReads = new Set(args.allowedReads.map((value) => canonical(workspaceRoot, value).toLowerCase()));
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
      if (hasForbiddenSegment(workspaceRelativeRead)) {
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
        } else if (!allowedCanonicalSelfRead && !allowedReads.has(resolvedRead.toLowerCase())) {
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
      if (hasForbiddenSegment(workspaceRelativeWrite)) {
        errors.push(`${label} contains prior-attempt/archive marker: ${item.path}`);
        continue;
      }
      const segments = workspaceRelativeWrite.split(path.sep);
      const hasOrchestratorSegment = segments.some((segment) => segment.toLowerCase().startsWith(".orchestrator"));
      if (hasOrchestratorSegment) {
        if (!isWithin(currentOrchestratorRoot, resolvedWrite)) {
          errors.push(`${label} references another orchestrator root: ${item.path}`);
        } else if (!isSameCanonicalPath(resolvedArtifact, resolvedWrite)) {
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
