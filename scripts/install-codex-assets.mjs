#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const args = {
    repoRoot: path.resolve(scriptDir, ".."),
    codexHome: path.join(process.cwd(), ".codex"),
    removeLegacyFullScripts: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo-root") {
      args.repoRoot = path.resolve(argv[++i]);
    } else if (arg === "--codex-home") {
      args.codexHome = path.resolve(argv[++i]);
    } else if (arg === "--remove-legacy-full-scripts") {
      args.removeLegacyFullScripts = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function stripInlineComment(raw) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : (quote ?? character);
      continue;
    }
    if (character === "#" && quote === null) return raw.slice(0, index).trim();
  }
  return raw.trim();
}

function parseTomlScalar(raw) {
  const value = stripInlineComment(raw);
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^[+-]?\d(?:_?\d)*$/.test(value)) return Number.parseInt(value.replaceAll("_", ""), 10);
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return Symbol.for(`unsupported:${value}`);
}

function tomlScalar(value) {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function inspectToml(text) {
  const lines = text.split(/\r?\n/);
  const sections = new Map();
  const assignments = new Map();
  const arrayTableCounts = new Map();
  let currentTable = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const arrayTableMatch = line.match(/^\s*\[\[([^\[\]]+)]]\s*(?:#.*)?$/);
    if (arrayTableMatch) {
      if (sections.has(currentTable)) sections.get(currentTable).end = index;
      const table = arrayTableMatch[1].trim();
      const occurrence = arrayTableCounts.get(table) ?? 0;
      arrayTableCounts.set(table, occurrence + 1);
      currentTable = `${table}#${occurrence}`;
      sections.set(currentTable, { header: index, end: lines.length });
      continue;
    }
    const tableMatch = line.match(/^\s*\[([^\[\]]+)]\s*(?:#.*)?$/);
    if (tableMatch) {
      if (sections.has(currentTable)) sections.get(currentTable).end = index;
      currentTable = tableMatch[1].trim();
      if (!sections.has(currentTable)) sections.set(currentTable, { header: index, end: lines.length });
      continue;
    }

    const assignmentMatch = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!assignmentMatch) continue;
    const fullKey = currentTable ? `${currentTable}.${assignmentMatch[1]}` : assignmentMatch[1];
    if (assignments.has(fullKey)) {
      throw new Error(`Duplicate Codex config key is not safe to merge: ${fullKey}`);
    }
    assignments.set(fullKey, {
      raw: stripInlineComment(assignmentMatch[2]),
      value: parseTomlScalar(assignmentMatch[2]),
    });
  }
  if (sections.has(currentTable)) sections.get(currentTable).end = lines.length;
  return { lines, sections, assignments };
}

function requiredConfigSettings() {
  return [
    { table: "features", key: "multi_agent", value: true },
    { table: "agents", key: "max_depth", value: 1 },
    { table: "agents", key: "max_threads", value: 6 },
    { table: "agents", key: "job_max_runtime_seconds", value: 1800 },
  ];
}

function mergeCodexConfig(existingText) {
  const eol = existingText.includes("\r\n") ? "\r\n" : "\n";
  const inspected = inspectToml(existingText);
  const conflicts = [];
  const missingByTable = new Map();

  for (const setting of requiredConfigSettings()) {
    const fullKey = `${setting.table}.${setting.key}`;
    const existing = inspected.assignments.get(fullKey);
    if (existing) {
      if (!Object.is(existing.value, setting.value)) {
        conflicts.push(`${fullKey}: expected ${tomlScalar(setting.value)}, found ${existing.raw}`);
      }
      continue;
    }

    const structuralConflict = [...inspected.assignments.keys()].find(
      (key) => fullKey.startsWith(`${key}.`) || key.startsWith(`${fullKey}.`),
    );
    if (structuralConflict) {
      conflicts.push(`${fullKey}: cannot merge because ${structuralConflict} uses an incompatible inline structure`);
      continue;
    }

    if (!missingByTable.has(setting.table)) missingByTable.set(setting.table, []);
    missingByTable.get(setting.table).push(setting);
  }

  if (conflicts.length > 0) {
    throw new Error(`Codex config conflict(s); no assets were installed:\n- ${conflicts.join("\n- ")}`);
  }
  if (missingByTable.size === 0) return existingText;

  const insertions = [];
  const appendedTables = [];
  for (const [table, settings] of missingByTable) {
    const rows = settings.map(({ key, value }) => `${key} = ${tomlScalar(value)}`);
    const section = inspected.sections.get(table);
    if (section) insertions.push({ index: section.end, rows });
    else appendedTables.push({ table, rows });
  }

  const lines = [...inspected.lines];
  for (const insertion of insertions.sort((left, right) => right.index - left.index)) {
    lines.splice(insertion.index, 0, ...insertion.rows);
  }

  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  for (const { table, rows } of appendedTables) {
    if (lines.length > 0) lines.push("");
    lines.push(`[${table}]`, ...rows);
  }
  return `${lines.join(eol)}${eol}`;
}

const FULL_RUNTIME_DIRECTORY = "dotnet-testing-codex-full";

function readRuntimeManifest(sourceScripts) {
  const manifestPath = path.join(sourceScripts, "asset-manifest.json");
  ensureExists(manifestPath, "Full runtime asset manifest");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.owner !== FULL_RUNTIME_DIRECTORY) {
    throw new Error(`Invalid Full runtime asset manifest: ${manifestPath}`);
  }
  for (const relative of [...(manifest.runtimeScripts ?? []), ...(manifest.runtimeManifests ?? [])]) {
    ensureExists(path.join(sourceScripts, relative), `Full runtime asset ${relative}`);
  }
  return manifest;
}

function removeLegacyRuntimeScripts(codexHome, manifest) {
  const legacyPrefix = ".codex/scripts/";
  for (const legacyPath of manifest.legacyPaths ?? []) {
    const normalized = legacyPath.replaceAll("\\", "/");
    if (!normalized.startsWith(legacyPrefix) || normalized.startsWith(`${legacyPrefix}${FULL_RUNTIME_DIRECTORY}/`)) {
      throw new Error(`Invalid Full legacy runtime path: ${legacyPath}`);
    }
    fs.rmSync(path.join(codexHome, normalized.slice(".codex/".length)), { force: true });
  }
  for (const relative of ["scripts/unit-runtime", "scripts/validators"]) {
    const directory = path.join(codexHome, relative);
    if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  }
}

function ensureExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing ${label}: ${targetPath}`);
  }
}

function copyDirectoryContents(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir)) {
    fs.cpSync(path.join(sourceDir, entry), path.join(targetDir, entry), {
      recursive: true,
      force: true,
    });
  }
}

const CODEX_SKILLS = new Set([
  "dotnet-test",
  "dotnet-testing-orchestrator-unit",
  "dotnet-testing-orchestrator-tunit",
  "dotnet-testing-orchestrator-integration",
  "dotnet-testing-orchestrator-aspire",
]);

function copyCodexSkills(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isDirectory() && CODEX_SKILLS.has(entry.name)) {
      fs.cpSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }
}

const { repoRoot, codexHome, removeLegacyFullScripts } = parseArgs(process.argv.slice(2));

const sourceCodex = path.join(repoRoot, ".codex");
const sourceAgents = path.join(sourceCodex, "agents");
const sourceSkills = path.join(sourceCodex, "skills");
const sourceConfig = path.join(sourceCodex, "config.toml");
const sourceHooks = path.join(sourceCodex, "hooks");
const sourceScripts = path.join(sourceCodex, "scripts", FULL_RUNTIME_DIRECTORY);

ensureExists(sourceAgents, "agents source directory");
ensureExists(sourceSkills, "skills source directory");
ensureExists(sourceConfig, "config source file");
ensureExists(sourceScripts, "scripts source directory");

const targetAgents = path.join(codexHome, "agents");
const targetSkills = path.join(codexHome, "skills");
const targetConfig = path.join(codexHome, "config.toml");
const targetHooks = path.join(codexHome, "hooks");
const targetScriptsRoot = path.join(codexHome, "scripts");
const targetScripts = path.join(targetScriptsRoot, FULL_RUNTIME_DIRECTORY);

const runtimeManifest = readRuntimeManifest(sourceScripts);

// Validate the complete config merge before writing any target asset. A conflict
// must leave the destination untouched rather than producing a partial install.
const existingConfig = fs.existsSync(targetConfig) ? fs.readFileSync(targetConfig, "utf8") : fs.readFileSync(sourceConfig, "utf8");
const mergedConfig = mergeCodexConfig(existingConfig);

const inPlaceInstall = path.resolve(sourceCodex) === path.resolve(codexHome);

fs.mkdirSync(codexHome, { recursive: true });
if (!inPlaceInstall) {
  copyDirectoryContents(sourceAgents, targetAgents);
  copyCodexSkills(sourceSkills, targetSkills);
  fs.rmSync(targetScripts, { recursive: true, force: true });
  copyDirectoryContents(sourceScripts, targetScripts);
  if (removeLegacyFullScripts) removeLegacyRuntimeScripts(codexHome, runtimeManifest);

  if (fs.existsSync(sourceHooks)) {
    copyDirectoryContents(sourceHooks, targetHooks);
  }
}
fs.writeFileSync(targetConfig, mergedConfig, "utf8");

console.log(`Installed Codex-specific assets to: ${codexHome}`);
console.log(`  - config => ${targetConfig}`);
console.log(`  - agents => ${targetAgents}`);
console.log(`  - skills => ${targetSkills}`);
console.log(`  - scripts => ${targetScripts}`);
console.log(`  - legacy Full scripts removed => ${removeLegacyFullScripts}`);
console.log(`  - in-place install => ${inPlaceInstall}`);
if (fs.existsSync(sourceHooks) && !inPlaceInstall) {
  console.log(`  - hooks  => ${targetHooks}`);
}
console.log("External shared Skills are intentionally not installed by this asset installer.");
