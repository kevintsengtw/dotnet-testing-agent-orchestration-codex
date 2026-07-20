#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROLES = new Set(["analyzer", "reviewer"]);
const PROJECT_CONTEXT_FILES = new Set([
  "directory.build.props",
  "directory.build.targets",
  "directory.packages.props",
  "global.json",
  "nuget.config",
]);

function parseArgs(argv) {
  const args = { allowedReads: [], workspaceRoot: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifact") args.artifact = argv[++index];
    else if (arg === "--agent-definition") args.agentDefinition = argv[++index];
    else if (arg === "--allow-read") args.allowedReads.push(argv[++index]);
    else if (arg === "--role") args.role = argv[++index];
    else if (arg === "--workspace-root") args.workspaceRoot = argv[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node .codex/scripts/validators/validate-tunit-role-read-scope.mjs --role <analyzer|reviewer> --artifact <path> [--workspace-root <path>] [--agent-definition <path>] [--allow-read <path> ...]",
    "",
    "Analyzer: allows assigned source/test project inputs, project context, explicit migration inputs, and technical Skills; rejects orchestration-definition reads.",
    "Reviewer: rejects reading back its own canonical reviewer-result artifact.",
  ].join("\n");
}

function canonical(root, value) {
  return path.normalize(path.isAbsolute(value) ? value : path.resolve(root, value));
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function comparable(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isSamePath(left, right) {
  return comparable(left) === comparable(right);
}

function workspaceRelative(workspaceRoot, value) {
  return path.relative(workspaceRoot, value).split(path.sep).join("/").toLowerCase();
}

function isTechnicalSkillRead(workspaceRoot, resolvedRead) {
  const relative = workspaceRelative(workspaceRoot, resolvedRead);
  const match = relative.match(/^\.codex\/skills\/([^/]+)\//);
  return Boolean(match) && !match[1].startsWith("dotnet-testing-orchestrator-");
}

function isProjectContextFile(resolvedRead) {
  const basename = path.basename(resolvedRead).toLowerCase();
  return PROJECT_CONTEXT_FILES.has(basename)
    || basename.endsWith(".sln")
    || basename.endsWith(".slnx");
}

function validateAnalyzer({ agentDefinition, artifact, artifactPath, workspaceRoot, allowedReads, reads }) {
  const errors = [];
  const sourceProjectPath = artifact.projectContext?.sourceProjectPath;
  const testProjectPath = artifact.projectContext?.testProjectPath;
  if (typeof sourceProjectPath !== "string" || sourceProjectPath.trim() === "") {
    errors.push("projectContext.sourceProjectPath must be a non-empty string");
  }
  if (typeof testProjectPath !== "string" || testProjectPath.trim() === "") {
    errors.push("projectContext.testProjectPath must be a non-empty string");
  }
  if (errors.length > 0) return errors;

  const sourceProject = canonical(workspaceRoot, sourceProjectPath);
  const sourceProjectDir = path.dirname(sourceProject);
  const testProject = canonical(workspaceRoot, testProjectPath);
  const testProjectDir = path.dirname(testProject);
  if (!isWithin(workspaceRoot, sourceProject)) {
    errors.push(`projectContext.sourceProjectPath is outside workspace: ${sourceProjectPath}`);
  }
  if (!isWithin(workspaceRoot, testProject)) {
    errors.push(`projectContext.testProjectPath is outside workspace: ${testProjectPath}`);
  }
  if (errors.length > 0) return errors;

  for (const [index, item] of reads.entries()) {
    const label = `readFiles[${index}]`;
    if (!item || typeof item.path !== "string" || item.path.trim() === "") {
      errors.push(`${label}.path must be a non-empty string`);
      continue;
    }
    const resolvedRead = canonical(workspaceRoot, item.path);
    if (!isWithin(workspaceRoot, resolvedRead)) {
      errors.push(`${label} is outside workspace: ${item.path}`);
      continue;
    }

    const allowed = (agentDefinition && isSamePath(resolvedRead, agentDefinition))
      || allowedReads.has(comparable(resolvedRead))
      || isSamePath(resolvedRead, artifactPath)
      || isWithin(sourceProjectDir, resolvedRead)
      || (isWithin(testProjectDir, resolvedRead)
        && !workspaceRelative(testProjectDir, resolvedRead).startsWith(".orchestrator/"))
      || isProjectContextFile(resolvedRead)
      || isTechnicalSkillRead(workspaceRoot, resolvedRead);

    if (!allowed) {
      errors.push(`${label} is outside TUnit Analyzer minimal read scope: ${item.path}`);
    }
  }
  return errors;
}

function validateReviewer({ artifactPath, workspaceRoot, reads }) {
  const errors = [];
  for (const [index, item] of reads.entries()) {
    const label = `readFiles[${index}]`;
    if (!item || typeof item.path !== "string" || item.path.trim() === "") {
      errors.push(`${label}.path must be a non-empty string`);
      continue;
    }
    const resolvedRead = canonical(workspaceRoot, item.path);
    if (isSamePath(resolvedRead, artifactPath)) {
      errors.push(`${label} reads the canonical reviewer-result after write: ${item.path}`);
    }
  }
  return errors;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!ROLES.has(args.role)) throw new Error(`--role must be analyzer or reviewer, got: ${args.role ?? "<missing>"}`);
  if (!args.artifact) throw new Error("--artifact is required");

  const workspaceRoot = canonical(process.cwd(), args.workspaceRoot);
  const artifactPath = canonical(workspaceRoot, args.artifact);
  if (!isWithin(workspaceRoot, artifactPath)) throw new Error(`artifact is outside workspace: ${args.artifact}`);
  const agentDefinition = args.agentDefinition ? canonical(workspaceRoot, args.agentDefinition) : null;
  if (args.role === "analyzer" && !agentDefinition) throw new Error("--agent-definition is required for analyzer");
  if (agentDefinition && !isWithin(workspaceRoot, agentDefinition)) {
    throw new Error(`agent definition is outside workspace: ${args.agentDefinition}`);
  }
  const allowedReads = new Set(args.allowedReads.map((value) => comparable(canonical(workspaceRoot, value))));
  let artifact;
  try {
    artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  } catch (error) {
    throw new Error(`artifact is unreadable or invalid JSON: ${error.message}`);
  }

  const reads = artifact.tokenEstimateInputs?.readFiles;
  if (!Array.isArray(reads)) throw new Error("tokenEstimateInputs.readFiles must be an array");

  const errors = args.role === "analyzer"
    ? validateAnalyzer({ agentDefinition, artifact, artifactPath, workspaceRoot, allowedReads, reads })
    : validateReviewer({ artifactPath, workspaceRoot, reads });

  if (errors.length > 0) {
    throw new Error(`TUnit ${args.role} read-scope validation failed:\n- ${errors.join("\n- ")}`);
  }

  process.stdout.write(`${JSON.stringify({
    status: "valid",
    policy: "tunit-role-read-scope-v1",
    role: args.role,
    readCount: reads.length,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`validate-tunit-role-read-scope error: ${error.message}\n`);
  process.exitCode = 1;
}
