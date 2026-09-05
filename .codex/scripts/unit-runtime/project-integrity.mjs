import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ignoredDirectories = new Set(["bin", "obj", ".orchestrator", "TestResults", ".git"]);

function slash(value) {
  return value.split(path.sep).join("/");
}

function hash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function collect(root, include) {
  const files = [];
  const visit = (current) => {
    if (!fs.existsSync(current)) return;
    const stat = fs.statSync(current);
    if (stat.isFile()) {
      files.push(current);
      return;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      visit(path.join(current, entry.name));
    }
  };
  for (const item of include) {
    const resolved = path.resolve(root, item);
    if (!isWithin(root, resolved)) throw new Error(`integrity include is outside root: ${item}`);
    visit(resolved);
  }
  return [...new Set(files)].sort().map((filePath) => ({
    path: slash(path.relative(root, filePath)),
    sha256: hash(filePath),
  }));
}

export function captureProjectBaseline({ root, include }) {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) throw new Error(`integrity root does not exist: ${resolvedRoot}`);
  if (!Array.isArray(include) || include.length === 0) throw new Error("integrity include paths are required");
  return { schemaVersion: 1, root: resolvedRoot, include: [...include], files: collect(resolvedRoot, include) };
}

export function verifyProjectIntegrity({ baseline, allowed = null }) {
  if (!baseline || !Array.isArray(baseline.files)) throw new Error("valid integrity baseline is required");
  const actual = collect(path.resolve(baseline.root), baseline.include);
  const expectedByPath = new Map(baseline.files.map((item) => [item.path, item.sha256]));
  const actualByPath = new Map(actual.map((item) => [item.path, item.sha256]));
  const added = [...actualByPath.keys()].filter((item) => !expectedByPath.has(item)).sort();
  const removed = [...expectedByPath.keys()].filter((item) => !actualByPath.has(item)).sort();
  const changed = [...actualByPath.keys()]
    .filter((item) => expectedByPath.has(item) && expectedByPath.get(item) !== actualByPath.get(item))
    .sort();
  if (!allowed) {
    return { status: added.length + removed.length + changed.length === 0 ? "valid" : "modified", added, changed, removed };
  }
  const unexpected = Object.fromEntries([
    ["added", added],
    ["changed", changed],
    ["removed", removed],
  ].map(([kind, values]) => {
    const allow = new Set(Array.isArray(allowed[kind]) ? allowed[kind].map(slash) : []);
    return [kind, values.filter((item) => !allow.has(item))];
  }));
  return {
    status: Object.values(unexpected).every((items) => items.length === 0) ? "valid" : "modified",
    added,
    changed,
    removed,
    unexpected,
  };
}

function parseArgs(argv) {
  const result = { include: [], allowAdd: [], allowChange: [], allowRemove: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--root") result.root = argv[++index];
    else if (key === "--include") result.include.push(argv[++index]);
    else if (key === "--output") result.output = argv[++index];
    else if (key === "--baseline") result.baseline = argv[++index];
    else if (key === "--allow-add") result.allowAdd.push(argv[++index]);
    else if (key === "--allow-change") result.allowChange.push(argv[++index]);
    else if (key === "--allow-remove") result.allowRemove.push(argv[++index]);
    else throw new Error(`unknown argument: ${key}`);
  }
  return result;
}

function writeNew(filePath, value) {
  const output = path.resolve(filePath);
  if (fs.existsSync(output)) throw new Error(`integrity output already exists: ${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`);
  return output;
}

function main() {
  const [operation, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (operation === "capture") {
    if (!args.root || !args.output || args.include.length === 0) {
      throw new Error("capture requires --root, --include and --output");
    }
    const baseline = captureProjectBaseline({ root: args.root, include: args.include });
    const output = writeNew(args.output, baseline);
    process.stdout.write(`${JSON.stringify({ status: "captured", output })}\n`);
    return;
  }
  if (operation === "verify") {
    if (!args.baseline) throw new Error("verify requires --baseline");
    const baseline = JSON.parse(fs.readFileSync(path.resolve(args.baseline), "utf8"));
    const hasAllowlist = args.allowAdd.length + args.allowChange.length + args.allowRemove.length > 0;
    const result = verifyProjectIntegrity({
      baseline,
      allowed: hasAllowlist ? {
        added: args.allowAdd,
        changed: args.allowChange,
        removed: args.allowRemove,
      } : null,
    });
    if (args.output) writeNew(args.output, result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== "valid") process.exitCode = 1;
    return;
  }
  throw new Error("usage: project-integrity.mjs <capture|verify> [options]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(`unit integrity error: ${error.message}`);
    process.exitCode = 1;
  }
}
