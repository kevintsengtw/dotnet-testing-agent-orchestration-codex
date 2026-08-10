#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROLE_SKILLS = {
  "aspire:writer": ["dotnet-testing-advanced-aspire-testing"],
  "aspire:reviewer": [
    "dotnet-testing-advanced-aspire-testing",
    "dotnet-testing-test-naming-conventions",
    "dotnet-testing-awesome-assertions-guide",
  ],
  "tunit:writer": [
    "dotnet-testing-advanced-tunit-fundamentals",
  ],
  "tunit:reviewer": [
    "dotnet-testing-advanced-tunit-fundamentals",
    "dotnet-testing-test-naming-conventions",
    "dotnet-testing-awesome-assertions-guide",
  ],
  "integration:writer": [
    "dotnet-testing-advanced-webapi-integration-testing",
  ],
  "integration:reviewer": [
    "dotnet-testing-advanced-webapi-integration-testing",
    "dotnet-testing-test-naming-conventions",
    "dotnet-testing-awesome-assertions-guide",
  ],
};

const SHORT_NAMES = {
  "aspire-testing": "dotnet-testing-advanced-aspire-testing",
  "tunit-fundamentals": "dotnet-testing-advanced-tunit-fundamentals",
  "tunit-advanced": "dotnet-testing-advanced-tunit-advanced",
  "webapi-integration-testing": "dotnet-testing-advanced-webapi-integration-testing",
  "aspnet-integration-testing": "dotnet-testing-advanced-aspnet-integration-testing",
  "testcontainers-database": "dotnet-testing-advanced-testcontainers-database",
  "testcontainers-nosql": "dotnet-testing-advanced-testcontainers-nosql",
  "awesome-assertions": "dotnet-testing-awesome-assertions-guide",
};

const WORKFLOW_PREFIXES = {
  unit: ["dotnet-testing-", "!dotnet-testing-advanced-"],
  tunit: ["dotnet-testing-advanced-tunit-"],
  integration: [
    "dotnet-testing-advanced-webapi-integration-testing",
    "dotnet-testing-advanced-aspnet-integration-testing",
    "dotnet-testing-advanced-testcontainers-",
  ],
  aspire: ["dotnet-testing-advanced-aspire-testing"],
};

function normalizeRequiredSkill(value) {
  if (SHORT_NAMES[value]) return SHORT_NAMES[value];
  return value.startsWith("dotnet-testing-") ? value : `dotnet-testing-${value}`;
}

function belongsToWorkflow(workflow, skillId) {
  if (workflow === "unit") {
    return skillId.startsWith("dotnet-testing-") && !skillId.startsWith("dotnet-testing-advanced-");
  }
  return (WORKFLOW_PREFIXES[workflow] ?? []).some((prefix) => skillId.startsWith(prefix));
}

export function validateSkillReadScope({ workflow, role, readFiles, requiredSkills = [] }) {
  const errors = [];
  const allowed = new Set(ROLE_SKILLS[`${workflow}:${role}`] ?? []);
  for (const required of requiredSkills) {
    const normalized = normalizeRequiredSkill(required);
    if (belongsToWorkflow(workflow, normalized)) allowed.add(normalized);
  }
  const actuallyRead = new Set();
  for (const entry of readFiles ?? []) {
    const value = String(typeof entry === "string" ? entry : entry?.path ?? "").replaceAll("\\", "/");
    const shared = value.match(/(?:^|\/)\.agents\/skills\/([^/]+)\//);
    const legacy = value.match(/(?:^|\/)\.codex\/skills\/([^/]+)\//);
    if (shared) {
      actuallyRead.add(shared[1]);
      if (!allowed.has(shared[1])) errors.push(`READ_SCOPE_SKILL_NOT_ALLOWED:${shared[1]}`);
    } else if (legacy && ![
      "dotnet-test",
      "dotnet-testing-orchestrator-unit",
      "dotnet-testing-orchestrator-tunit",
      "dotnet-testing-orchestrator-integration",
      "dotnet-testing-orchestrator-aspire",
    ].includes(legacy[1])) {
      errors.push(`LEGACY_SHARED_SKILL_PATH:${legacy[1]}`);
    } else if (legacy?.[1]?.startsWith("dotnet-testing-orchestrator-")) {
      errors.push(`OTHER_ORCHESTRATOR_SKILL_READ:${legacy[1]}`);
    } else if (legacy && !(role === "executor" && legacy[1] === "dotnet-test")) {
      errors.push(`CODEX_SKILL_NOT_ALLOWED:${legacy[1]}`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    requiredSkills: [...requiredSkills],
    actuallyReadSkills: [...actuallyRead],
  };
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, index, all) => {
    if (item.startsWith("--")) pairs.push([item.slice(2), all[index + 1]]);
    return pairs;
  }, []));
  if (!args.artifact || !args.workflow || !args.role) {
    throw new Error("Usage: validate-skill-read-scope.mjs --artifact <json> --workflow <name> --role <name> [--analysis <json>]");
  }
  const artifact = JSON.parse(fs.readFileSync(path.resolve(args.artifact), "utf8"));
  const analysis = args.analysis
    ? JSON.parse(fs.readFileSync(path.resolve(args.analysis), "utf8"))
    : artifact;
  const requiredSkills = args.role === "reviewer"
    ? (analysis.skillMap?.reviewer ?? analysis.requiredSkills ?? [])
    : (analysis.requiredSkills ?? analysis.requiredTechniques ?? []);
  const result = validateSkillReadScope({
    workflow: args.workflow,
    role: args.role,
    readFiles: artifact.tokenEstimateInputs?.readFiles,
    requiredSkills,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
