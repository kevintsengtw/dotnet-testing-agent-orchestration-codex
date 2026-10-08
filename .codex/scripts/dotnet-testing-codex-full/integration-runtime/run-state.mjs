import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";

const OWNER_WORKFLOW = "integration";
const INTEGRATION_PHASES = ["analyzer", "writer", "executor", "reviewer"];

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = { set: [], derive: [], targets: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--path": args.path = argv[++i]; break;
      case "--workflow": args.workflow = argv[++i]; break;
      case "--run-id": args.runIdentifier = argv[++i]; break;
      case "--target": {
        args.target = argv[++i];
        args.targets.push(args.target);
        break;
      }
      case "--phase": args.phase = argv[++i]; break;
      case "--assignment": args.assignment = argv[++i]; break;
      case "--array": args.array = argv[++i]; break;
      case "--set": args.set.push(argv[++i]); break;
      case "--derive": args.derive.push(argv[++i]); break;
      case "--require-complete-timing": args.requireCompleteTiming = true; break;
      case "--help": case "-h": args.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return "Integration run-state: init|set|append|redispatch|finalize|validate|timing|now --path <run-state.json>; init requires --workflow integration --target <test target> [--target <other target>] [--run-id <run identifier>]; validate supports --require-complete-timing; timing is read-only, includes assignment evidence and accepts --phase for a closed phase before finalize";
}

function coerceValue(raw) {
  if (raw === "@now") return nowIso();
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return Number.parseFloat(raw);
  return raw;
}

// "a.b.c=value" -> { keyPath: ["a","b","c"], value }
function parseSet(token) {
  const eq = token.indexOf("=");
  if (eq < 0) throw new Error(`--set expects key=value, got: ${token}`);
  const keyPath = token.slice(0, eq).split(".").filter(Boolean);
  if (keyPath.length === 0) throw new Error(`--set has empty key: ${token}`);
  return { keyPath, value: coerceValue(token.slice(eq + 1)) };
}

function setDeep(obj, keyPath, value) {
  if (keyPath.some(key => ["__proto__", "prototype", "constructor"].includes(key))) throw new Error("unsafe state key");
  let cur = obj;
  for (let i = 0; i < keyPath.length - 1; i += 1) {
    const k = keyPath[i];
    if (typeof cur[k] !== "object" || cur[k] === null || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[keyPath[keyPath.length - 1]] = value;
}

function getDeep(obj, keyPath) {
  let cur = obj;
  for (const key of keyPath) {
    if (typeof cur !== "object" || cur === null || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function msOrNull(iso) {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

// "produceSpanMs=artifactReadyAt-dispatchAcceptedAt" applied to a scope object.
// Output and endpoint fields may use dotted paths.
function applyDerive(scope, token) {
  const eq = token.indexOf("=");
  if (eq < 0) throw new Error(`--derive expects field=END-START, got: ${token}`);
  const fieldPath = token.slice(0, eq).split(".").filter(Boolean);
  if (fieldPath.length === 0) throw new Error(`--derive has empty output field: ${token}`);
  const expr = token.slice(eq + 1);
  const dash = expr.indexOf("-");
  if (dash < 0) throw new Error(`--derive expression must be END-START, got: ${expr}`);
  const endPath = expr.slice(0, dash).split(".").filter(Boolean);
  const startPath = expr.slice(dash + 1).split(".").filter(Boolean);
  if (endPath.length === 0 || startPath.length === 0) {
    throw new Error(`--derive expression has an empty endpoint: ${expr}`);
  }
  const end = msOrNull(getDeep(scope, endPath));
  const start = msOrNull(getDeep(scope, startPath));
  setDeep(scope, fieldPath, (end === null || start === null) ? null : end - start);
}

function readState(p) {
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    throw new Error(`run-state file not found or unreadable: ${p}. Run 'init' first.`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`run-state file is not valid JSON: ${p} (${err.message})`);
  }
}

function writeState(p, state) {
  if (state.workflow !== OWNER_WORKFLOW) throw new Error("run-state owner must remain integration");
  validateIdentity(state, fs.existsSync(p) ? readState(p) : null);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`);
}

function validateIdentity(state, previous = null) {
  const targets = stateTargetNames(state);
  if (!targets.length || targets.some(t => typeof t !== "string" || !t.trim()) || new Set(targets).size !== targets.length) throw new Error("targets must contain unique non-empty test targets");
  if (state.target !== targets[0]) throw new Error("target must equal the first targets entry");
  if (state.runIdentifier !== undefined && (typeof state.runIdentifier !== "string" || !state.runIdentifier.trim() || targets.includes(state.runIdentifier))) throw new Error("runIdentifier must be a non-empty run identity distinct from test targets");
  if (previous && (!isDeepStrictEqual(state.targets, previous.targets) || state.target !== previous.target || state.runIdentifier !== previous.runIdentifier)) throw new Error("initialized target, targets and runIdentifier are immutable");
  for (const phaseName of INTEGRATION_PHASES) {
    const assignments = state.phases?.[phaseName]?.assignments ?? [];
    if (!Array.isArray(assignments)) throw new Error(`${phaseName} assignments must be an array`);
    for (const assignment of assignments) {
      if (!targets.includes(assignment?.target)) throw new Error(`${phaseName} assignment target must be a declared test target; run identifiers are not targets`);
    }
    for (const old of previous?.phases?.[phaseName]?.assignments ?? []) {
      const current = assignments.find(a => a.assignmentId === old.assignmentId);
      if (!current || current.target !== old.target) throw new Error(`${phaseName} assignment target is immutable`);
    }
  }
}

// Resolve the scope object that --set/--derive target, creating containers as needed.
function resolveScope(state, args) {
  if (!args.phase) return state;
  if (typeof state.phases !== "object" || state.phases === null) state.phases = {};
  if (typeof state.phases[args.phase] !== "object" || state.phases[args.phase] === null) {
    state.phases[args.phase] = {};
  }
  const phase = state.phases[args.phase];
  if (!args.assignment) return phase;
  if (!Array.isArray(phase.assignments)) phase.assignments = [];
  let a = phase.assignments.find((x) => x && x.assignmentId === args.assignment);
  if (!a) {
    a = { assignmentId: args.assignment };
    phase.assignments.push(a);
  }
  return a;
}

function runtimeFingerprint() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
  const result = {
    status: "unavailable", manifestPath: "asset-manifest.json", manifestSha256: null,
    algorithm: "sha256", encoding: "JSON.stringify(sorted [relativePath, sha256] pairs)",
    files: [], fingerprint: null, missingPaths: [], errors: [],
  };
  let manifest;
  try {
    const bytes = fs.readFileSync(path.join(root, result.manifestPath));
    result.manifestSha256 = digest(bytes);
    manifest = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(manifest.runtimeScripts)) throw new Error("runtimeScripts must be an array");
    if (manifest.owner !== "dotnet-testing-orchestrator-integration"
        || manifest.runtimeRoot !== ".codex/scripts/dotnet-testing-codex-full/integration-runtime") throw new Error("Integration owner manifest mismatch");
    const actual = fs.readdirSync(root).filter(name => name.endsWith(".mjs")).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...manifest.runtimeScripts].sort())) throw new Error("owner manifest must include every local module");
  } catch (error) {
    if (error.code === "ENOENT") result.missingPaths.push(result.manifestPath);
    result.errors.push({ path: result.manifestPath, message: error.message });
    return result;
  }
  const seen = new Set();
  for (const relative of manifest.runtimeScripts) {
    try {
      if (typeof relative !== "string" || !relative || relative.includes("\\")
          || path.isAbsolute(relative) || relative.split("/").includes("..") || seen.has(relative)) {
        throw new Error("invalid or duplicate runtime relative path");
      }
      seen.add(relative);
      const stat = fs.lstatSync(path.join(root, relative));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("runtime module must be an independent regular file");
      result.files.push({ path: relative, sha256: digest(fs.readFileSync(path.join(root, relative))) });
    } catch (error) {
      if (error.code === "ENOENT") result.missingPaths.push(relative);
      result.errors.push({ path: relative, message: error.message });
    }
  }
  result.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (result.errors.length === 0) {
    result.status = "available";
    result.fingerprint = digest(JSON.stringify(result.files.map(({ path, sha256 }) => [path, sha256])));
  }
  return result;
}

function prepareArtifactDirectories(statePath) {
  const root = path.dirname(path.resolve(statePath));
  const directories = [root, ...["analysis", "writer-result", "executor-result", "reviewer-result"].map(name => path.join(root, name))];
  // Check every existing ancestor before any mkdir; never follow a link into another artifact tree.
  const checked = new Set();
  for (const directory of directories) {
    for (let current = directory; !checked.has(current); current = path.dirname(current)) {
      checked.add(current);
      let stat;
      try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(`artifact directory must be a real directory: ${current}`);
      if (path.dirname(current) === current) break;
    }
  }
  for (const directory of directories) fs.mkdirSync(directory, { recursive: true });
}

function opInit(args) {
  if (!args.path) throw new Error("init requires --path");
  if (fs.existsSync(args.path)) throw new Error("run-state already exists; init cannot overwrite an existing run");
  if (!args.workflow) throw new Error("init requires --workflow");
  if (args.targets.length === 0) throw new Error("init requires --target");
  if (new Set(args.targets).size !== args.targets.length) throw new Error("init targets must be unique");
  const state = {
    workflow: args.workflow,
    target: args.targets[0],
    targets: [...args.targets],
    runIdentifier: args.runIdentifier ?? crypto.randomUUID(),
    overallWallClock: { start: nowIso(), end: null, durationMs: null },
    phases: {},
    redispatchEvents: [],
    boundedRedispatchCount: 0,
    restartCount: 0,
    executorFixRounds: 0,
  };
  state.runtimeAssets = runtimeFingerprint();
  if (state.runtimeAssets.status !== "available") throw new Error("Integration runtime manifest or modules are unavailable");
  validateIdentity(state);
  prepareArtifactDirectories(args.path);
  writeState(args.path, state);
  return state;
}

function opSet(args) {
  if (!args.path) throw new Error("set requires --path");
  const state = readState(args.path), scope = resolveScope(state, args);
  for (const token of args.set) { const { keyPath, value } = parseSet(token); setDeep(scope, keyPath, value); }
  for (const token of args.derive) applyDerive(scope, token);
  writeState(args.path, state);
  return state;
}

function opAppend(args) {
  if (!args.path || !args.array) throw new Error("append requires --path and --array");
  if (["__proto__", "prototype", "constructor"].includes(args.array)) throw new Error("unsafe array key");
  const state = readState(args.path);
  if (!Array.isArray(state[args.array])) state[args.array] = [];
  const item = {};
  for (const token of args.set) { const { keyPath, value } = parseSet(token); setDeep(item, keyPath, value); }
  state[args.array].push(item);
  if (args.array === "redispatchEvents") state.boundedRedispatchCount = state.redispatchEvents.length;
  writeState(args.path, state);
  return state;
}

function opRedispatch(args) {
  if (!args.path) throw new Error("redispatch requires --path");
  if (!new Set(["analyzer", "writer", "executor", "reviewer"]).has(args.phase)) {
    throw new Error("redispatch requires a valid --phase");
  }
  if (typeof args.assignment !== "string" || args.assignment.trim() === "") {
    throw new Error("redispatch requires --assignment for the new assignment");
  }
  if (typeof args.target !== "string" || args.target.trim() === "") {
    throw new Error("redispatch requires --target");
  }
  const supplied = {};
  for (const token of args.set) {
    const { keyPath, value } = parseSet(token);
    if (keyPath.length !== 1 || !new Set(["reason", "waitMs"]).has(keyPath[0])) {
      throw new Error("redispatch only accepts reason and waitMs fields");
    }
    supplied[keyPath[0]] = value;
  }
  if (typeof supplied.reason !== "string" || supplied.reason.trim() === "") {
    throw new Error("redispatch requires a non-empty reason code");
  }
  if (!Number.isInteger(supplied.waitMs) || supplied.waitMs < 0) {
    throw new Error("redispatch requires a non-negative integer waitMs");
  }
  const state = readState(args.path);
  if (!Array.isArray(state.redispatchEvents)) throw new Error("redispatchEvents must already be an array");
  if (typeof state.phases !== "object" || state.phases === null) state.phases = {};
  if (typeof state.phases[args.phase] !== "object" || state.phases[args.phase] === null) {
    state.phases[args.phase] = { assignments: [] };
  }
  if (!Array.isArray(state.phases[args.phase].assignments)) state.phases[args.phase].assignments = [];
  if (state.phases[args.phase].assignments.some((item) => item?.assignmentId === args.assignment)) {
    throw new Error(`redispatch assignment already exists: ${args.assignment}`);
  }
  const occurredAt = nowIso();
  state.phases[args.phase].assignments.push({
    assignmentId: args.assignment,
    dispatchIssuedAt: occurredAt,
    target: args.target,
  });
  state.redispatchEvents.push({
    action: "redispatch",
    phase: args.phase,
    target: args.target,
    assignmentId: args.assignment,
    reason: supplied.reason,
    waitMs: supplied.waitMs,
    occurredAt,
  });
  state.boundedRedispatchCount = state.redispatchEvents.length;
  writeState(args.path, state);
  return state;
}

function isIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function stateTargetNames(state) {
  if (Array.isArray(state.targets) && state.targets.length > 0) return [...state.targets];
  return typeof state.target === "string" && state.target.trim() ? [state.target] : [];
}

function resolvedArtifactPath(statePath, artifactPath) {
  return path.isAbsolute(artifactPath)
    ? path.normalize(artifactPath)
    : path.resolve(path.dirname(path.resolve(statePath)), artifactPath);
}

function sameResolvedPath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function targetClassLeaf(target) {
  if (typeof target !== "string") return null;
  const trimmed = target.trim();
  if (!trimmed) return null;
  return trimmed.split(".").at(-1) || null;
}






function derivedMilliseconds(end, start) {
  return isIsoTimestamp(end) && isIsoTimestamp(start)
    ? Date.parse(end) - Date.parse(start)
    : null;
}

function buildDeterministicProfilingSummary(state, phasesToProfile, terminalPartial) {
  const observedPhases = phasesToProfile
    .map((phaseName, order) => ({
      phaseName,
      order,
      durationMs: state.phaseDurations?.[phaseName]?.durationMs,
      assignments: state.phases?.[phaseName]?.assignments,
    }))
    .filter((phase) => Number.isInteger(phase.durationMs) && phase.durationMs >= 0
      && Array.isArray(phase.assignments) && phase.assignments.length > 0);
  if (observedPhases.length === 0) return null;

  observedPhases.sort((left, right) => right.durationMs - left.durationMs || left.order - right.order);
  const bottleneck = observedPhases[0];
  const assignments = bottleneck.assignments.map((assignment, order) => ({
    assignment,
    order,
    observedSpanMs: Number.isInteger(assignment.produceSpanMs)
      ? assignment.produceSpanMs
      : derivedMilliseconds(assignment.completedAt, assignment.dispatchAcceptedAt),
  }));
  assignments.sort((left, right) => {
    const leftSpan = Number.isInteger(left.observedSpanMs) ? left.observedSpanMs : -1;
    const rightSpan = Number.isInteger(right.observedSpanMs) ? right.observedSpanMs : -1;
    return rightSpan - leftSpan || left.order - right.order;
  });
  const critical = assignments[0]?.assignment ?? {};
  const phaseIsFullyObservable = bottleneck.assignments.every((assignment) => (
    isIsoTimestamp(assignment.artifactReadyAt) && Number.isInteger(assignment.produceSpanMs)
  ));
  const allRequiredPhasesObserved = INTEGRATION_PHASES.every((phaseName) => phasesToProfile.includes(phaseName));
  const observability = terminalPartial
    ? "terminal_partial"
    : (phaseIsFullyObservable && allRequiredPhasesObserved ? "complete" : "partial");
  const redispatchWaitMs = (state.redispatchEvents ?? [])
    .filter((event) => event?.phase === bottleneck.phaseName
      && stateTargetNames(state).includes(event?.target))
    .reduce((total, event) => total + (Number.isInteger(event.waitMs) && event.waitMs >= 0 ? event.waitMs : 0), 0);

  return {
    timingSource: "run-state",
    bottleneck: bottleneck.phaseName,
    rootCauseCandidate: "largest_observed_phase_duration",
    deferredOptimization: observability !== "complete",
    bottleneckBreakdown: {
      phaseDurationMs: bottleneck.durationMs,
      assignmentId: typeof critical.assignmentId === "string" ? critical.assignmentId : null,
      dispatchAcceptLatencyMs: Number.isInteger(critical.dispatchAcceptLatencyMs)
        ? critical.dispatchAcceptLatencyMs
        : null,
      produceSpanMs: Number.isInteger(critical.produceSpanMs) ? critical.produceSpanMs : null,
      redispatchWaitMs,
      skillLoadMs: Number.isInteger(critical.skillLoadMs) ? critical.skillLoadMs : null,
      observability,
    },
    finalizedBy: "run-state.finalize",
  };
}










function opFinalize(args) {
  return finalizeIntegration(args);
}



function integrationFailure(phase, assignment = null) {
  const value = assignment?.failure ?? phase?.failure;
  return typeof value === "string" ? value.trim() : typeof value?.kind === "string" ? value.kind.trim() : "";
}

function executorPassed(statePath, state) {
  const assignments = new Map((state.phases?.executor?.assignments ?? []).map(a => [a.target, a]));
  const passed = stateTargetNames(state).map(target => {
    const assignment = assignments.get(target);
    if (!assignment || assignment.status !== "completed") throw new Error("completed closeout requires actual Executor assignments");
    const file = path.resolve(path.dirname(statePath), assignment.artifact ?? "");
    if (!isWithin(path.join(path.dirname(path.resolve(statePath)), "executor-result"), file)
        || !sameResolvedPath(file, path.resolve(path.dirname(statePath), assignment.expectedArtifactPath ?? ""))) throw new Error("canonical executor path mismatch");
    const result = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof result.buildResult !== "string" || typeof result.testResult !== "string"
        || !Number.isInteger(result.failedTests) || !Number.isInteger(result.skippedTests)) throw new Error("Executor runtime results are required for final decision");
    return result.buildResult === "success" && result.testResult === "passed" && result.failedTests === 0 && result.skippedTests === 0;
  });
  if (stateTargetNames(state).length > 1) {
    const regressions = [...assignments.values()].map(a => a.projectRegressionResultFilePath).filter(Boolean);
    if (regressions.length === 0) throw new Error("multi-target closeout requires the assigned project regression artifact");
    for (const input of new Set(regressions)) {
      const file = path.resolve(path.dirname(statePath), input);
      if (!isWithin(path.join(path.dirname(path.resolve(statePath)), "executor-result"), file)) throw new Error("project regression path must be canonical");
      const result = JSON.parse(fs.readFileSync(file, "utf8"));
      if (result.regressionScope !== "test-project" || !sameResolvedPath(file, result.executorResultFilePath)) throw new Error("project regression binding mismatch");
      passed.push(result.buildResult === "success" && result.testResult === "passed" && result.failedTests === 0 && result.skippedTests === 0);
    }
  }
  return passed.every(Boolean);
}

function readIntegrationTerminalProjection(statePath, state, errors) {
  const present = INTEGRATION_PHASES.filter(name => (state.phases?.[name]?.assignments?.length ?? 0) > 0);
  if (present.length === 0) { errors.push("at least one dispatched phase is required"); return { validatedPhases: [] }; }
  const last = present.at(-1), index = INTEGRATION_PHASES.indexOf(last);
  const expected = INTEGRATION_PHASES.slice(0, index + 1);
  if (!isDeepStrictEqual(present, expected)) errors.push("dispatched phases must follow Analyzer -> Writer -> Executor -> Reviewer without gaps");
  const terminal = state.phases[last];
  let decision;
  if (["blocked", "failed"].includes(terminal.status)) {
    decision = terminal.status;
    if (!integrationFailure(terminal)) errors.push(`phases.${last} early terminal requires a failure reason`);
    if (!terminal.assignments.some(a => ["blocked", "failed", "artifact-gate-failed"].includes(a.status) && integrationFailure(terminal, a))) errors.push(`phases.${last} terminal requires an actual failed assignment`);
  } else if (last === "reviewer" && terminal.status === "completed") {
    const decisions = [];
    for (const assignment of terminal.assignments.filter(a => a.status === "completed")) {
      try {
        const file = path.resolve(path.dirname(statePath), assignment.artifact ?? "");
        if (!isWithin(path.join(path.dirname(path.resolve(statePath)), "reviewer-result"), file)
            || !sameResolvedPath(file, path.resolve(path.dirname(statePath), assignment.expectedArtifactPath ?? ""))) throw new Error("canonical reviewer path mismatch");
        const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!["pass", "pass_with_warnings", "fail", "blocked"].includes(artifact.gateDecision)) throw new Error("Reviewer gateDecision is required");
        decisions.push(artifact.gateDecision);
      } catch (error) { errors.push(`reviewer artifact: ${error.message}`); }
    }
    if (decisions.length === 0) errors.push("completed workflow requires Reviewer acceptance");
    let executionPassed = false;
    try { executionPassed = executorPassed(statePath, state); } catch (error) { errors.push(error.message); }
    decision = decisions.includes("blocked") ? "blocked" : decisions.includes("fail") || !executionPassed ? "failed" : "completed";
  } else {
    errors.push(`phases.${last} must be terminal before final validation`);
  }
  for (const name of present) {
    const phase = state.phases[name];
    if (name !== last && phase.status !== "completed") errors.push(`phases.${name} must complete before ${last}`);
    const previous = state.phases[present[present.indexOf(name) - 1]];
    if (previous && phase.assignments.some(a => Date.parse(a.dispatchIssuedAt) < Date.parse(previous.completedAt))) errors.push(`phases.${name} was dispatched before the previous phase completed`);
    if (phase.status === "completed") {
      const latest = new Map(phase.assignments.map(a => [a.target, a]));
      for (const target of stateTargetNames(state)) if (latest.get(target)?.status !== "completed") errors.push(`phases.${name} has no completed assignment for ${target}`);
    }
  }
  if (state.terminalDecision !== decision) errors.push("terminalDecision must match the actual terminal phase and Reviewer acceptance");
  for (const name of INTEGRATION_PHASES.slice(index + 1)) {
    if (state.phaseDurations?.[name]?.durationMs !== null || state.phaseDurations?.[name]?.source !== "not-dispatched") errors.push(`phaseDurations.${name} must record null/not-dispatched after early terminal`);
  }
  return { validatedPhases: present, terminalPhase: last, terminalDecision: decision, terminalFailureKind: integrationFailure(terminal), unstartedPhases: INTEGRATION_PHASES.slice(index + 1) };
}

function phaseDuration(state, name) {
  const phase = state.phases?.[name];
  if (!phase || phase.assignments === undefined) return { durationMs: null, source: "not-dispatched" };
  if (!Array.isArray(phase.assignments)) throw new Error(`phase ${name} assignments must be an array`);
  if (!phase.assignments.length) return { durationMs: null, source: "not-dispatched" };
  const starts = phase.assignments.map(a => msOrNull(a.dispatchIssuedAt));
  const end = msOrNull(phase.completedAt);
  if (end === null || starts.some(t => t === null)) throw new Error(`phase ${name} has incomplete timestamps`);
  const durationMs = end - Math.min(...starts);
  if (!Number.isSafeInteger(durationMs) || starts.some(start => start > end)) throw new Error(`phase ${name} has invalid timestamp order`);
  return { durationMs, source: "run-state" };
}

function formatDuration(durationMs, wholeSeconds = false) {
  if (durationMs === null) return "未派發";
  const seconds = wholeSeconds ? Math.round(durationMs / 1000) : durationMs / 1000;
  const minutes = Math.floor(seconds / 60);
  const remainder = wholeSeconds ? String(seconds % 60) : ((durationMs % 60000) / 1000).toFixed(3);
  return `${minutes} 分 ${remainder} 秒`;
}

function timingPresentation(timing) {
  return { ...timing, display: formatDuration(timing.durationMs), summaryDisplay: formatDuration(timing.durationMs, true) };
}

function timingEvidence(state, names) {
  const timestamp = (assignment, field) => {
    const value = assignment[field];
    if (value === undefined || value === null) return null;
    if (!isIsoTimestamp(value)) throw new Error(`assignment ${assignment.assignmentId} has invalid ${field}`);
    return value;
  };
  const rows = names.flatMap(phase => {
    const assignments = state.phases?.[phase]?.assignments ?? [];
    if (!assignments.length) return [{ phase, assignmentId: null, target: null, source: "not-dispatched", dispatchIssuedAt: null, artifactReadyAt: null, completedAt: null, notes: "未派發" }];
    return assignments.map(assignment => ({
      phase,
      assignmentId: assignment.assignmentId ?? null,
      target: assignment.target ?? null,
      source: "run-state",
      dispatchIssuedAt: timestamp(assignment, "dispatchIssuedAt"),
      artifactReadyAt: timestamp(assignment, "artifactReadyAt"),
      completedAt: timestamp(assignment, "completedAt"),
      notes: [assignments.length > 1 ? assignment.assignmentId : null, assignment.status, assignment.timingNote].filter(Boolean).join("；"),
    }));
  });
  const cell = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "&#124;").replace(/`/g, "&#96;").replace(/\\/g, "&#92;").replace(/[\r\n]+/g, " ");
  const lines = rows.map(row => {
    const missing = row.source === "not-dispatched" ? "未派發" : "未取得";
    return `| ${[row.phase[0].toUpperCase() + row.phase.slice(1), row.source, row.dispatchIssuedAt ?? missing, row.artifactReadyAt ?? missing, row.completedAt ?? missing, row.notes].map(cell).join(" | ")} |`;
  });
  return { rows, markdown: ["### Timing Evidence", "", "| Phase | Source | dispatchIssuedAt | artifactReadyAt | completedAt | Notes |", "|---|---|---|---|---|---|", ...lines].join("\n") };
}

function opTiming(args) {
  if (!args.path) throw new Error("timing requires --path");
  if (args.assignment || args.set.length || args.derive.length || args.array || args.targets.length || args.runIdentifier) throw new Error("timing is read-only; use --phase to select phase timing and assignment evidence");
  const state = readState(args.path);
  const phases = {};
  for (const name of args.phase ? [args.phase] : INTEGRATION_PHASES) {
    const timing = phaseDuration(state, name);
    if (state.phaseDurations?.[name] && !isDeepStrictEqual(state.phaseDurations[name], timing)) throw new Error(`phaseDurations.${name} differs from phase timestamps`);
    phases[name] = timingPresentation(timing);
  }
  const result = { workflow: OWNER_WORKFLOW, phases };
  if (!args.phase) {
    const start = msOrNull(state.overallWallClock?.start), end = msOrNull(state.overallWallClock?.end);
    const durationMs = start === null || end === null ? null : end - start;
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) throw new Error("overall timing requires closed wall-clock timestamps");
    if (state.overallWallClock.durationMs !== undefined && state.overallWallClock.durationMs !== null && state.overallWallClock.durationMs !== durationMs) throw new Error("overallWallClock.durationMs differs from timestamps");
    result.overall = timingPresentation({ durationMs, source: "run-state" });
  }
  result.timingEvidence = timingEvidence(state, Object.keys(phases));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function finalizeIntegration(args) {
  if (!args.path) throw new Error("finalize requires --path");
  const state = readState(args.path);
  if (state.workflow !== OWNER_WORKFLOW) throw new Error("Integration run-state runtime cannot operate on another workflow");
  const present = INTEGRATION_PHASES.filter(name => (state.phases?.[name]?.assignments?.length ?? 0) > 0);
  const last = present.at(-1), terminal = state.phases?.[last];
  if (!last || !["completed", "blocked", "failed"].includes(terminal.status)) throw new Error("finalize requires an actual terminal phase");
  state.phaseDurations = {};
  for (const name of INTEGRATION_PHASES) {
    state.phaseDurations[name] = phaseDuration(state, name);
  }
  state.terminalDecision = terminal.status === "completed" ? "completed" : terminal.status;
  if (last === "reviewer" && terminal.status === "completed") {
    const decisions = terminal.assignments.filter(a => a.status === "completed").map(a => JSON.parse(fs.readFileSync(path.resolve(path.dirname(args.path), a.artifact), "utf8")).gateDecision);
    state.terminalDecision = decisions.includes("blocked") ? "blocked" : decisions.includes("fail") || !executorPassed(args.path, state) ? "failed" : "completed";
  }
  const errors = [];
  readIntegrationTerminalProjection(args.path, state, errors);
  if (errors.length) throw new Error(`finalize rejected:\n- ${errors.join("\n- ")}`);
  const end = state.overallWallClock.end ?? nowIso();
  state.overallWallClock = { ...state.overallWallClock, end, durationMs: derivedMilliseconds(end, state.overallWallClock.start) };
  state.profilingSummary = buildDeterministicProfilingSummary(state, present, state.terminalDecision !== "completed");
  writeState(args.path, state);
  return state;
}

function opValidate(args) {
  if (!args.path) throw new Error("validate requires --path");
  const state = readState(args.path);
  const errors = [];
  try { validateIdentity(state); } catch (error) { errors.push(error.message); }
  if (state.runtimeAssets && (state.runtimeAssets.status !== "available" || state.runtimeAssets.fingerprint !== runtimeFingerprint().fingerprint)) errors.push("runtimeAssets must match Integration local modules");
  let timingComplete = true;
  const requiredPhases = INTEGRATION_PHASES;
  const terminalProjection = readIntegrationTerminalProjection(args.path, state, errors);
  const phasesToValidate = terminalProjection?.validatedPhases ?? requiredPhases;

  if (!state.workflow) errors.push("missing workflow");
  if (!state.target) errors.push("missing target");
  const targetNames = stateTargetNames(state);
  if (targetNames.length === 0 || new Set(targetNames).size !== targetNames.length) {
    errors.push("targets must contain unique non-empty targets");
  }
  if (state.target !== targetNames[0]) errors.push("target must equal the first targets entry");
  if (!isIsoTimestamp(state.overallWallClock?.start)) errors.push("overallWallClock.start must be an ISO timestamp");
  if (!isIsoTimestamp(state.overallWallClock?.end)) errors.push("overallWallClock.end must be an ISO timestamp");
  const expectedOverall = derivedMilliseconds(state.overallWallClock?.end, state.overallWallClock?.start);
  if (!Number.isInteger(state.overallWallClock?.durationMs) || state.overallWallClock.durationMs !== expectedOverall) {
    errors.push("overallWallClock.durationMs must equal end-start");
  }

  for (const phaseName of phasesToValidate) {
    const phase = state.phases?.[phaseName];
    if (!phase || !Array.isArray(phase.assignments) || phase.assignments.length === 0) {
      errors.push(`phases.${phaseName}.assignments must contain at least one assignment`);
      continue;
    }
    if (!isIsoTimestamp(phase.completedAt)) errors.push(`phases.${phaseName}.completedAt must be an ISO timestamp`);
    const phaseCompletedAtMs = isIsoTimestamp(phase.completedAt) ? Date.parse(phase.completedAt) : null;
    const dispatchIssuedTimes = [];
    for (const [index, assignment] of phase.assignments.entries()) {
      const prefix = `phases.${phaseName}.assignments[${index}]`;
      const assignmentTerminalFailureKind = terminalProjection?.terminalFailureKinds
        ? terminalProjection.terminalFailureKinds[assignment.target]
        : terminalProjection?.terminalFailureKind;
      const terminalNullIsExplained = terminalProjection?.terminalPhase === phaseName
        && typeof assignmentTerminalFailureKind === "string"
        && assignmentTerminalFailureKind.trim() !== "";
      const dispatchRejected = terminalNullIsExplained && assignment.dispatchAcceptedAt === null && assignment.agentId === null;
      for (const field of ["assignmentId", ...(dispatchRejected ? [] : ["agentId"]), "target", "agentDefinitionPath", "expectedArtifactPath"]) {
        if (typeof assignment[field] !== "string" || assignment[field].trim() === "") {
          errors.push(`${prefix}.${field} must be a non-empty string`);
        }
      }
      if ((typeof assignment.artifact !== "string" || assignment.artifact.trim() === "")
          && !(assignment.artifact === null && terminalNullIsExplained)) {
        errors.push(`${prefix}.artifact must be a non-empty string`);
      }
      if (!["completed", "blocked", "failed", "artifact-gate-failed"].includes(assignment.status)) errors.push(`${prefix}.status must be terminal`);
      if (assignment.status !== "completed" && !integrationFailure(phase, assignment)) errors.push(`${prefix}.failure is required`);
      if (Date.parse(assignment.completedAt) < Date.parse(assignment.dispatchAcceptedAt ?? assignment.dispatchIssuedAt)) errors.push(`${prefix}.completedAt precedes dispatch`);
      if (Date.parse(assignment.dispatchIssuedAt) < Date.parse(state.overallWallClock.start) || Date.parse(phase.completedAt) > Date.parse(state.overallWallClock.end)) errors.push(`${prefix}.timing is outside overall wall clock`);
      if (!targetNames.includes(assignment.target)) errors.push(`${prefix}.target must be a declared target`);
      if (assignment.contextForkPolicy !== "none") {
        errors.push(`${prefix}.contextForkPolicy must be none`);
      }
      if (assignment.externalMemoryPolicy !== "forbid") {
        errors.push(`${prefix}.externalMemoryPolicy must be forbid`);
      }
      if (!isIsoTimestamp(assignment.dispatchIssuedAt)) errors.push(`${prefix}.dispatchIssuedAt must be an ISO timestamp`);
      if (!dispatchRejected && !isIsoTimestamp(assignment.dispatchAcceptedAt)) errors.push(`${prefix}.dispatchAcceptedAt must be an ISO timestamp`);
      if (!isIsoTimestamp(assignment.completedAt)) errors.push(`${prefix}.completedAt must be an ISO timestamp`);
      if (isIsoTimestamp(assignment.dispatchIssuedAt)) dispatchIssuedTimes.push(Date.parse(assignment.dispatchIssuedAt));
      const expectedDispatchLatency = derivedMilliseconds(assignment.dispatchAcceptedAt, assignment.dispatchIssuedAt);
      if (dispatchRejected ? assignment.dispatchAcceptLatencyMs !== null : (!Number.isInteger(assignment.dispatchAcceptLatencyMs)
          || assignment.dispatchAcceptLatencyMs !== expectedDispatchLatency
          || assignment.dispatchAcceptLatencyMs < 0)) {
        errors.push(`${prefix}.dispatchAcceptLatencyMs must equal dispatchAcceptedAt-dispatchIssuedAt`);
      }

      if (assignment.artifactReadyAt === null) {
        if (!terminalNullIsExplained) timingComplete = false;
        if (assignment.produceSpanMs !== null) errors.push(`${prefix}.produceSpanMs must be null when artifactReadyAt is null`);
        if (typeof assignment.timingNote !== "string" || assignment.timingNote.trim() === "") {
          errors.push(`${prefix}.timingNote is required when artifactReadyAt is null`);
        }
        if (args.requireCompleteTiming && !terminalNullIsExplained) {
          errors.push(`${prefix}.artifactReadyAt is required by --require-complete-timing`);
        }
      } else {
        if (!isIsoTimestamp(assignment.artifactReadyAt)) {
          errors.push(`${prefix}.artifactReadyAt must be an ISO timestamp or null`);
        }
        const expectedProduceSpan = derivedMilliseconds(assignment.artifactReadyAt, assignment.dispatchAcceptedAt);
        if (!Number.isInteger(assignment.produceSpanMs)
            || assignment.produceSpanMs !== expectedProduceSpan
            || assignment.produceSpanMs < 0) {
          errors.push(`${prefix}.produceSpanMs must equal artifactReadyAt-dispatchAcceptedAt`);
        }
        if (isIsoTimestamp(assignment.completedAt)
            && isIsoTimestamp(assignment.artifactReadyAt)
            && Date.parse(assignment.artifactReadyAt) > Date.parse(assignment.completedAt)) {
          errors.push(`${prefix}.artifactReadyAt must not be later than completedAt`);
        }
      }
      if (phaseCompletedAtMs !== null
          && isIsoTimestamp(assignment.completedAt)
          && Date.parse(assignment.completedAt) > phaseCompletedAtMs) {
        errors.push(`${prefix}.completedAt must not be later than phases.${phaseName}.completedAt`);
      }
    }

    const phaseDuration = state.phaseDurations?.[phaseName];
    if (!Number.isInteger(phaseDuration?.durationMs) || phaseDuration.durationMs < 0) {
      errors.push(`phaseDurations.${phaseName}.durationMs must be a non-negative integer`);
    }
    if (phaseDuration?.source !== "run-state") errors.push(`phaseDurations.${phaseName}.source must be run-state`);
    if (phaseCompletedAtMs !== null && dispatchIssuedTimes.length === phase.assignments.length) {
      const expectedPhaseDuration = phaseCompletedAtMs - Math.min(...dispatchIssuedTimes);
      if (phaseDuration?.durationMs !== expectedPhaseDuration) {
        errors.push(`phaseDurations.${phaseName}.durationMs must equal phase completedAt-earliest dispatchIssuedAt`);
      }
    }
  }

  if (!Array.isArray(state.redispatchEvents)) errors.push("redispatchEvents must be an array");
  if (!Number.isInteger(state.boundedRedispatchCount)
      || state.boundedRedispatchCount !== (state.redispatchEvents?.length ?? -1)) {
    errors.push("boundedRedispatchCount must equal redispatchEvents.length");
  }
  for (const [index, event] of (state.workflow === "unit" ? (state.redispatchEvents ?? []) : []).entries()) {
    const prefix = `redispatchEvents[${index}]`;
    if (event?.action !== "redispatch") errors.push(`${prefix}.action must be redispatch`);
    if (!new Set(requiredPhases).has(event?.phase)) errors.push(`${prefix}.phase must be a known phase`);
    for (const field of ["target", "assignmentId", "reason"]) {
      if (typeof event?.[field] !== "string" || event[field].trim() === "") {
        errors.push(`${prefix}.${field} must be a non-empty string`);
      }
    }
    if (!Number.isInteger(event?.waitMs) || event.waitMs < 0) {
      errors.push(`${prefix}.waitMs must be a non-negative integer`);
    }
    if (!isIsoTimestamp(event?.occurredAt)) {
      errors.push(`${prefix}.occurredAt must be an ISO timestamp`);
    } else {
      const occurredAt = Date.parse(event.occurredAt);
      const overallStart = Date.parse(state.overallWallClock?.start);
      const overallEnd = Date.parse(state.overallWallClock?.end);
      if (!Number.isNaN(overallStart) && occurredAt < overallStart) {
        errors.push(`${prefix}.occurredAt must not precede overallWallClock.start`);
      }
      if (!Number.isNaN(overallEnd) && occurredAt > overallEnd) {
        errors.push(`${prefix}.occurredAt must not follow overallWallClock.end`);
      }
    }
    const assignment = state.phases?.[event?.phase]?.assignments
      ?.find((item) => item?.assignmentId === event?.assignmentId);
    if (!assignment) {
      errors.push(`${prefix}.assignmentId must reference a recorded phase assignment`);
    } else {
      if (assignment.target !== event.target) errors.push(`${prefix}.target must match the assignment target`);
      if (assignment.dispatchIssuedAt !== event.occurredAt) {
        errors.push(`${prefix}.occurredAt must equal the assignment dispatchIssuedAt boundary`);
      }
    }
  }
  for (const field of ["restartCount", "executorFixRounds"]) {
    if (!Number.isInteger(state[field]) || state[field] < 0) errors.push(`${field} must be a non-negative integer`);
  }

  const profiling = state.profilingSummary;
  if (!profiling || typeof profiling !== "object") {
    errors.push("profilingSummary is required");
  } else {
    for (const field of ["timingSource", "bottleneck", "rootCauseCandidate"]) {
      if (typeof profiling[field] !== "string" || profiling[field].trim() === "" || profiling[field] === "unresolved") {
        errors.push(`profilingSummary.${field} must be a concrete non-empty value`);
      }
    }
    if (typeof profiling.deferredOptimization !== "boolean") errors.push("profilingSummary.deferredOptimization must be boolean");
    if (!profiling.bottleneckBreakdown || typeof profiling.bottleneckBreakdown !== "object") {
      errors.push("profilingSummary.bottleneckBreakdown is required");
    }
    if (state.runtimeAssets) {
      const terminalPartial = terminalProjection && (
        terminalProjection.terminalLifecycle
          ? terminalProjection.terminalLifecycle !== "completed"
          : terminalProjection.terminalDecision !== "completed"
      );
      const expectedProfiling = buildDeterministicProfilingSummary(state, phasesToValidate, terminalPartial);
      if (!expectedProfiling || !isDeepStrictEqual(profiling, expectedProfiling)) {
        errors.push("profilingSummary must equal the deterministic finalize projection");
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`validation failed:\n- ${errors.join("\n- ")}`);
  }
  process.stdout.write(`${JSON.stringify({
    status: "valid",
    timingComplete,
    ...(terminalProjection ? terminalProjection : { validatedPhases: requiredPhases }),
  }, null, 2)}\n`);
  return state;
}

function main() {
  const [op, ...rest] = process.argv.slice(2);
  if (!op || op === "--help" || op === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (op === "now") {
    process.stdout.write(nowIso());
    return;
  }
  const args = parseArgs(rest);
  if (args.phase && !INTEGRATION_PHASES.includes(args.phase)) throw new Error("Integration requires an analyzer|writer|executor|reviewer phase");
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (op === "init" && args.workflow !== OWNER_WORKFLOW) throw new Error("Integration run-state runtime requires --workflow integration");
  if (args.workflow && args.workflow !== OWNER_WORKFLOW) throw new Error("Integration run-state runtime requires --workflow integration");
  if (args.path && fs.existsSync(args.path)) {
    const state = readState(args.path);
    if (state.workflow !== OWNER_WORKFLOW) throw new Error(`Integration run-state runtime cannot operate on workflow ${state.workflow ?? "missing"}`);
  }
  switch (op) {
    case "init": opInit(args); break;
    case "set": opSet(args); break;
    case "append": opAppend(args); break;
    case "redispatch": opRedispatch(args); break;
    case "finalize": opFinalize(args); break;
    case "validate": opValidate(args); break;
    case "timing": opTiming(args); break;
    default: throw new Error(`Unknown op: ${op}. Expected init|set|append|redispatch|finalize|validate|timing|now.`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`run-state.mjs error: ${err.message}\n`);
  process.exit(1);
}
