#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROLES = new Set(["analyzer", "reviewer"]);
const PROJECT_CONTEXT_FILES = new Set([
  "directory.build.props", "directory.build.targets", "directory.packages.props", "global.json", "nuget.config",
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
  return "Usage: node .codex/scripts/validators/validate-aspire-role-read-scope.mjs --role <analyzer|reviewer> --artifact <path> [--workspace-root <path>] [--agent-definition <path>] [--allow-read <path> ...]";
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

function samePath(left, right) {
  return comparable(left) === comparable(right);
}

function projectDirectory(value) {
  return path.extname(value) ? path.dirname(value) : value;
}

function workspaceRelative(root, value) {
  return path.relative(root, value).split(path.sep).join("/").toLowerCase();
}

function projectContextFile(value) {
  const basename = path.basename(value).toLowerCase();
  return PROJECT_CONTEXT_FILES.has(basename) || basename.endsWith(".sln") || basename.endsWith(".slnx");
}

function aspireSkillRead(workspaceRoot, value) {
  return workspaceRelative(workspaceRoot, value) === ".codex/skills/dotnet-testing-advanced-aspire-testing/skill.md";
}

function validateAnalyzer({ agentDefinition, artifact, artifactPath, workspaceRoot, allowedReads, reads }) {
  const errors = [];
  const paths = [
    ["appHostProjectPath", artifact.projectContext?.appHostProjectPath],
    ["apiProjectPath", artifact.projectContext?.apiProjectPath],
    ["testProjectPath", artifact.projectContext?.testProjectPath],
  ];
  const projectRoots = [];
  for (const [label, value] of paths) {
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`projectContext.${label} must be a non-empty string`);
      continue;
    }
    const resolved = canonical(workspaceRoot, value);
    if (!isWithin(workspaceRoot, resolved)) errors.push(`projectContext.${label} is outside workspace`);
    projectRoots.push(projectDirectory(resolved));
  }
  if (errors.length > 0) return errors;
  if (JSON.stringify(artifact.requiredSkills) !== JSON.stringify(["aspire-testing"])) {
    errors.push("requiredSkills must equal [\"aspire-testing\"]");
  }

  for (const [index, item] of reads.entries()) {
    const label = `readFiles[${index}]`;
    if (!item || typeof item.path !== "string" || item.path.trim() === "") {
      errors.push(`${label}.path must be a non-empty string`);
      continue;
    }
    const resolved = canonical(workspaceRoot, item.path);
    if (!isWithin(workspaceRoot, resolved)) {
      errors.push(`${label} is outside workspace: ${item.path}`);
      continue;
    }
    const inAssignedProject = projectRoots.some((root) => isWithin(root, resolved)
      && !workspaceRelative(root, resolved).startsWith(".orchestrator/"));
    const allowed = samePath(resolved, agentDefinition)
      || samePath(resolved, artifactPath)
      || allowedReads.has(comparable(resolved))
      || inAssignedProject
      || projectContextFile(resolved)
      || aspireSkillRead(workspaceRoot, resolved);
    if (!allowed) errors.push(`${label} is outside Aspire Analyzer minimal read scope: ${item.path}`);
  }
  return errors;
}

function validateReviewer({ artifactPath, workspaceRoot, reads }) {
  const errors = [];
  for (const [index, item] of reads.entries()) {
    if (!item || typeof item.path !== "string" || item.path.trim() === "") {
      errors.push(`readFiles[${index}].path must be a non-empty string`);
      continue;
    }
    if (samePath(canonical(workspaceRoot, item.path), artifactPath)) {
      errors.push(`readFiles[${index}] reads the canonical reviewer-result after write: ${item.path}`);
    }
  }
  return errors;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return process.stdout.write(`${usage()}\n`);
  if (!ROLES.has(args.role)) throw new Error(`--role must be analyzer or reviewer, got: ${args.role ?? "<missing>"}`);
  if (!args.artifact) throw new Error("--artifact is required");
  const workspaceRoot = canonical(process.cwd(), args.workspaceRoot);
  const artifactPath = canonical(workspaceRoot, args.artifact);
  const agentDefinition = args.agentDefinition ? canonical(workspaceRoot, args.agentDefinition) : null;
  if (!isWithin(workspaceRoot, artifactPath)) throw new Error("artifact is outside workspace");
  if (args.role === "analyzer" && !agentDefinition) throw new Error("--agent-definition is required for analyzer");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const reads = artifact.tokenEstimateInputs?.readFiles;
  if (!Array.isArray(reads)) throw new Error("tokenEstimateInputs.readFiles must be an array");
  const allowedReads = new Set(args.allowedReads.map((value) => comparable(canonical(workspaceRoot, value))));
  const errors = args.role === "analyzer"
    ? validateAnalyzer({ agentDefinition, artifact, artifactPath, workspaceRoot, allowedReads, reads })
    : validateReviewer({ artifactPath, workspaceRoot, reads });
  if (errors.length > 0) throw new Error(`Aspire ${args.role} read-scope validation failed:\n- ${errors.join("\n- ")}`);
  process.stdout.write(`${JSON.stringify({ status: "valid", policy: "aspire-role-read-scope-v1", role: args.role, readCount: reads.length }, null, 2)}\n`);
}

try { main(); } catch (error) {
  process.stderr.write(`validate-aspire-role-read-scope error: ${error.message}\n`);
  process.exitCode = 1;
}
