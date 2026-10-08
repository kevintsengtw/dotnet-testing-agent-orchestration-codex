import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertObserverStopped } from "./usage-observer.mjs";

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function inventory(root) {
  const records = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const current = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Links are not allowed in archive: ${current}`);
      if (entry.isDirectory()) { records.push({ path: path.relative(root, current), directory: true }); visit(current); }
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(current);
        records.push({ path: path.relative(root, current), size: bytes.length,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
      } else throw new Error(`Unsupported archive entry: ${current}`);
    }
  }
  visit(root);
  return records;
}
function validateEvidence(source, state) {
  const errors = [];
  const seals = [];
  const roles = ["analyzer", "writer", "executor", "reviewer", "writerRepair", "executorRepair", "reviewerRepair"];
  const targets = Object.entries(state.targets ?? {});
  if (!targets.length) errors.push("seal: workflow-state has no targets");
  for (const [target, phases] of targets) {
    for (const role of roles) {
      const phase = phases[role];
      const required = phase?.artifact || phase?.artifactSeal || phase?.lifecycle === "completed";
      if (!required) continue;
      try {
        const seal = phase.artifactSeal;
        if (!seal || !phase.artifact || !seal.path) throw new Error("missing artifact or seal");
        const artifact = path.resolve(phase.artifact);
        if (!within(source, artifact) || path.resolve(seal.path) !== artifact
            || fs.realpathSync(artifact) !== artifact) throw new Error("artifact path is not canonical within this run");
        const bytes = fs.readFileSync(artifact);
        const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
        if (bytes.length !== seal.size || sha256 !== seal.sha256) throw new Error("artifact SHA-256 or size mismatch");
        seals.push({ target, role, path: path.relative(source, artifact), sha256, size: bytes.length });
      } catch (error) { errors.push(`seal ${target}/${role}: ${error.message}`); }
    }
    if (state.terminalDecision === "completed") {
      for (const role of roles.slice(0, 4)) {
        if (phases[role]?.lifecycle !== "completed") errors.push(`seal ${target}/${role}: completed run requires completed role`);
      }
    }
  }
  const validator = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "run-state.mjs");
  const args = [validator, "validate", "--path", path.join(source, "run-state.json"), "--require-complete-timing"];
  const result = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const timing = { validator: "run-state.mjs", args: args.slice(1), exitCode: result.status,
    stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  if (result.error || result.status !== 0) errors.push(`timing: ${result.error?.message ?? `${timing.stdout}\n${timing.stderr}`.trim()}`);
  if (errors.length) throw new Error(`Archive evidence validation failed:\n${errors.join("\n")}`);
  return { status: "passed", seals, timing, validatedAt: new Date().toISOString() };
}

export function archiveUnitRun({ testProject, archiveDirectory, requireValidEvidence = false }) {
  const projectFile = fs.realpathSync(path.resolve(testProject));
  if (path.extname(projectFile).toLowerCase() !== ".csproj" || !fs.statSync(projectFile).isFile()) throw new Error("testProject must be an existing csproj");
  const project = path.dirname(projectFile);
  const source = path.join(project, ".orchestrator");
  if (fs.lstatSync(source).isSymbolicLink() || fs.realpathSync(source) !== source) throw new Error("Canonical orchestrator root cannot be a link");
  const requested = path.resolve(archiveDirectory);
  const parent = fs.realpathSync(path.dirname(requested));
  const destination = path.join(parent, path.basename(requested));
  if (within(project, destination) || within(destination, project)) throw new Error("Archive destination must be outside test project and cannot contain it");
  if (fs.existsSync(destination)) throw new Error("Archive destination already exists");
  if (fs.statSync(source).dev !== fs.statSync(parent).dev) throw new Error("Archive requires same-volume atomic rename; no copy/delete fallback");
  const state = JSON.parse(fs.readFileSync(path.join(source, "workflow-state.json"), "utf8"));
  if (!["completed", "failed", "blocked"].includes(state.lifecycle) || state.terminalDecision !== state.lifecycle) {
    throw new Error("Only a terminal Unit run can be archived");
  }
  assertObserverStopped(source);
  const before = inventory(source);
  const validation = requireValidEvidence ? validateEvidence(source, state) : null;
  if (JSON.stringify(before) !== JSON.stringify(inventory(source))) throw new Error("Archive source changed during inventory");
  assertObserverStopped(source);
  // Exclusive container creation prevents replacing any existing archive.
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, "archive-manifest.json"), JSON.stringify({
    schemaVersion: 1, source, archivedRoot: path.join(destination, ".orchestrator"),
    terminalDecision: state.terminalDecision, preservedAt: new Date().toISOString(),
    evidenceValidation: validation ? "passed" : "not_performed", ...(validation ? { validation } : {}), files: before,
  }, null, 2), { flag: "wx" });
  const archivedRoot = path.join(destination, ".orchestrator");
  fs.renameSync(source, archivedRoot);
  if (JSON.stringify(before) !== JSON.stringify(inventory(archivedRoot))) {
    throw new Error(`Archive verification failed; evidence retained at ${archivedRoot}; do not start another run`);
  }
  return { status: "archived", archivedRoot, manifest: path.join(destination, "archive-manifest.json"),
    nextAction: "initialize_new_run", files: before.filter((entry) => !entry.directory).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = {};
    for (let i = 2; i < process.argv.length; i++) {
      if (process.argv[i] === "--require-valid-evidence") { args.requireValidEvidence = true; continue; }
      const key = { "--test-project": "testProject", "--archive-directory": "archiveDirectory" }[process.argv[i]];
      if (!key || !process.argv[i + 1]) throw new Error("usage: archive-unit-run.mjs --test-project <csproj> --archive-directory <new directory>");
      args[key] = process.argv[++i];
    }
    process.stdout.write(`${JSON.stringify(archiveUnitRun(args))}\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
