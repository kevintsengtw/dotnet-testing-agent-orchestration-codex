#!/usr/bin/env node
// run-state.mjs — deterministic run-state.json writer for the dotnet-testing orchestrators.
//
// WHY THIS EXISTS:
//   The orchestrator contracts require a {testProjectDir}/.orchestrator/run-state.json
//   timing-truth file that is created and incrementally stamped throughout a run.
//   Earlier contracts told the orchestrator to "use the Write tool" + `date -u`, but
//   Codex has no "Write" tool and `date -u` is not portable. In the Codex CLI the model
//   improvised PowerShell read-modify-write; in the VS Code Codex Extension it did not,
//   so run-state.json was silently never written and all timing telemetry came
//   out empty. This script makes run-state writes deterministic and shell-agnostic:
//   the orchestrator only ever invokes `node .codex/scripts/dotnet-testing-codex-full/unit-runtime/run-state.mjs <op> ...`
//   (node + shell_command are proven to work in both CLI and Extension), and the
//   timestamp is read from the system clock INSIDE this script (no `date -u`).
//
// SCALAR-ONLY CLI (no JSON blobs on argv — keeps it robust under PowerShell quoting):
//   node run-state.mjs init   --path P --workflow W --target T
//   node run-state.mjs set    --path P [--phase PH] [--assignment AID]
//                              [--set key=value]... [--derive field=END-START]...
//   node run-state.mjs append --path P --array NAME [--set key=value]...
//   node run-state.mjs redispatch --path P --phase PH --assignment AID --target T
//                              --set reason=CODE --set waitMs=N
//   node run-state.mjs recover-interrupted --path P
//   node run-state.mjs fail-gate --path P --phase PH --assignment AID
//                              --gate optional-parameter --failure-message MESSAGE
//   node run-state.mjs closeout --path P
//   node run-state.mjs finalize --path P
//   node run-state.mjs validate --path P [--require-complete-timing] [--require-presentation]
//   node run-state.mjs now
//
// VALUE SENTINELS / COERCION (apply to --set values):
//   @now                  -> current UTC time as ISO 8601 (e.g. 2026-06-25T07:41:41.427Z)
//   integer / float       -> stored as a number
//   true / false / null   -> stored as boolean / null
//   anything else         -> stored as a string
//   --set supports DOTTED keys for nesting, e.g. --set overallWallClock.end=@now
//
// --derive field=END-START computes integer milliseconds (END - START) from two
//   ISO fields on the target scope; dotted paths are supported for the output and
//   both endpoints. Stores null if either endpoint is missing or unparseable.
//   e.g. --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt
//   e.g. --derive overallWallClock.durationMs=overallWallClock.end-overallWallClock.start
//
// SCOPE for `set`:
//   (no --phase)                  -> top-level object (counters, overallWallClock.*, ...)
//   --phase PH                    -> phases[PH]
//   --phase PH --assignment AID   -> phases[PH].assignments[] upserted by assignmentId=AID
//
// All ops create parent directories as needed and write pretty-printed JSON.
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";

const UNIT_PHASES = ["analyzer", "writer", "executor", "reviewer"];
const OWNER_WORKFLOW = "unit";

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
      case "--target": {
        args.target = argv[++i];
        args.targets.push(args.target);
        break;
      }
      case "--phase": args.phase = argv[++i]; break;
      case "--assignment": args.assignment = argv[++i]; break;
      case "--gate": args.gate = argv[++i]; break;
      case "--failure-message": args.failureMessage = argv[++i]; break;
      case "--array": args.array = argv[++i]; break;
      case "--set": args.set.push(argv[++i]); break;
      case "--derive": args.derive.push(argv[++i]); break;
      case "--require-complete-timing": args.requireCompleteTiming = true; break;
      case "--require-presentation": args.requirePresentation = true; break;
      case "--help": case "-h": args.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node .codex/scripts/dotnet-testing-codex-full/unit-runtime/run-state.mjs init   --path <run-state.json> --workflow unit --target <t> [--target <t>...]",
    "  node .codex/scripts/dotnet-testing-codex-full/unit-runtime/run-state.mjs set    --path <run-state.json> [--phase <p>] [--assignment <id>] [--set k=v]... [--derive f=END-START]...",
    "  node .codex/scripts/dotnet-testing-codex-full/unit-runtime/run-state.mjs append --path <run-state.json> --array <name> [--set k=v]...",
    "  node .codex/scripts/dotnet-testing-codex-full/unit-runtime/run-state.mjs redispatch --path <run-state.json> --phase <p> --assignment <id> --target <t> --set reason=<code> --set waitMs=<ms>",
    "  node .codex/scripts/dotnet-testing-codex-full/unit-runtime/run-state.mjs recover-interrupted --path <run-state.json>",
    "  node .codex/scripts/dotnet-testing-codex-full/unit-runtime/run-state.mjs fail-gate --path <run-state.json> --phase <p> --assignment <id> --gate optional-parameter --failure-message <message>",
    "  node .codex/scripts/dotnet-testing-codex-full/unit-runtime/run-state.mjs phase-time --path <run-state.json> --phase <p>",
    "  node .codex/scripts/dotnet-testing-codex-full/unit-runtime/run-state.mjs closeout --path <run-state.json>",
    "  node .codex/scripts/dotnet-testing-codex-full/unit-runtime/run-state.mjs finalize --path <run-state.json>",
    "  node .codex/scripts/dotnet-testing-codex-full/unit-runtime/run-state.mjs validate --path <run-state.json> [--require-complete-timing] [--require-presentation]",
    "  node .codex/scripts/dotnet-testing-codex-full/unit-runtime/run-state.mjs now",
    "",
    "Value sentinels: @now -> ISO UTC. Numbers/true/false/null are coerced. --set keys may be dotted for nesting.",
  ].join("\n");
}

// "123" -> 123, "true" -> true, "@now" -> ISO now, else string.
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
  if (state.workflow !== OWNER_WORKFLOW) throw new Error(`run-state owner must remain ${OWNER_WORKFLOW}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`);
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

function opInit(args) {
  if (!args.path) throw new Error("init requires --path");
  if (!args.workflow) throw new Error("init requires --workflow");
  if (args.targets.length === 0) throw new Error("init requires --target");
  if (new Set(args.targets).size !== args.targets.length) throw new Error("init targets must be unique");
  const state = {
    workflow: args.workflow,
    target: args.targets[0],
    targets: [...args.targets],
    overallWallClock: { start: nowIso(), end: null, durationMs: null },
    phases: {},
    redispatchEvents: [],
    boundedRedispatchCount: 0,
    restartCount: 0,
    executorFixRounds: 0,
  };
  if (new Set(["unit", "tunit"]).has(args.workflow)) {
    state.runtimeAssets = runtimeFingerprint();
    state.presentation = { status: "pending" };
  }
  writeState(args.path, state);
  return state;
}

function opSet(args) {
  if (!args.path) throw new Error("set requires --path");
  const state = readState(args.path);
  const scope = resolveScope(state, args);
  for (const token of args.set) {
    const { keyPath, value } = parseSet(token);
    const unitProtectedTruth = state.workflow === "unit"
      && new Set([
        "redispatchEvents", "boundedRedispatchCount", "terminalDecision", "terminalCloseout",
        "profilingSummary", "presentation",
      ]).has(keyPath[0]);
    const tunitProtectedTruth = state.workflow === "tunit" && !args.phase && (
      new Set(["phaseDurations", "terminalDecision", "terminalCloseout", "profilingSummary", "presentation"]).has(keyPath[0])
      || (keyPath[0] === "overallWallClock"
        && (keyPath.length === 1 || new Set(["end", "durationMs"]).has(keyPath[1])))
    );
    const tunitSealedAnalysisTruth = state.workflow === "tunit" && args.phase === "analyzer"
      && args.assignment && keyPath[0] === "sealedAnalysis";
    if (!args.phase && (unitProtectedTruth || tunitProtectedTruth)) {
      if (keyPath[0] === "profilingSummary") {
        throw new Error("profilingSummary can only be written by the finalize operation");
      }
      if (tunitProtectedTruth) {
        throw new Error(`${keyPath.join(".")} can only be written by the TUnit finalize operation`);
      }
      if (keyPath[0] === "presentation") {
        throw new Error(`${keyPath.join(".")} can only be written by the canonical Unit renderer`);
      }
      if (new Set(["terminalDecision", "terminalCloseout"]).has(keyPath[0])) {
        throw new Error(`${keyPath.join(".")} can only be written by the Unit closeout operation`);
      }
      throw new Error("redispatch truth can only be written by the redispatch operation");
    }
    if (tunitSealedAnalysisTruth) {
      throw new Error("sealedAnalysis can only be written by the Analyzer artifact gate");
    }
    setDeep(scope, keyPath, value);
  }
  // Derive after sets so endpoint fields written in the same call are visible.
  for (const token of args.derive) {
    const outputPath = token.slice(0, token.indexOf("=")).split(".").filter(Boolean);
    if (state.workflow === "tunit" && !args.phase
        && outputPath[0] === "overallWallClock"
        && new Set(["end", "durationMs"]).has(outputPath[1])) {
      throw new Error(`${outputPath.join(".")} can only be written by the TUnit finalize operation`);
    }
    applyDerive(scope, token);
  }
  const sealsAnalyzerArtifact = state.workflow === "tunit" && args.phase === "analyzer" && args.assignment
    && args.set.some((token) => ["artifact", "artifactReadyAt"].includes(parseSet(token).keyPath[0]));
  if (sealsAnalyzerArtifact) {
    try {
      sealTunitAnalysisTarget(args.path, scope);
    } catch (error) {
      try {
        closeTunitFailure(args.path, {
          phaseName: "analyzer",
          assignmentIds: [args.assignment],
          status: "failed",
          failureKind: "analyzer_artifact_gate_rejected",
          failureMessage: error.message,
        });
      } catch (closeoutError) {
        throw new Error(`${error.message}; deterministic TUnit closeout failed: ${closeoutError.message}`);
      }
      throw error;
    }
  }
  writeState(args.path, state);
  return state;
}

function opAppend(args) {
  if (!args.path) throw new Error("append requires --path");
  if (!args.array) throw new Error("append requires --array");
  const state = readState(args.path);
  if (state.workflow === "unit" && args.array === "redispatchEvents") {
    throw new Error("use the redispatch operation to record redispatchEvents at transition time");
  }
  if (state.workflow === "tunit"
      && new Set(["phaseDurations", "overallWallClock", "terminalDecision", "terminalCloseout", "profilingSummary"])
        .has(args.array)) {
    throw new Error(`${args.array} can only be written by the TUnit finalize operation`);
  }
  if (!Array.isArray(state[args.array])) state[args.array] = [];
  const item = {};
  for (const token of args.set) {
    const { keyPath, value } = parseSet(token);
    setDeep(item, keyPath, value);
  }
  state[args.array].push(item);
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
  if (state.workflow !== "unit") throw new Error("redispatch operation is currently defined for Unit workflow only");
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

function closeTunitFailure(statePath, {
  phaseName,
  assignmentIds,
  status,
  failureKind,
  failureMessage,
}) {
  const state = readState(statePath);
  if (state.workflow !== "tunit") {
    throw new Error("deterministic failure closeout is TUnit-only");
  }
  if (state.terminalCloseout !== undefined) {
    throw new Error("TUnit run-state is already terminal");
  }
  const phase = state.phases?.[phaseName];
  if (!phase || !Array.isArray(phase.assignments) || phase.assignments.length === 0) {
    throw new Error(`TUnit ${phaseName} failure closeout requires a dispatched assignment`);
  }
  const selected = phase.assignments.filter((assignment) => assignmentIds.includes(assignment.assignmentId));
  if (selected.length !== assignmentIds.length) {
    throw new Error(`TUnit ${phaseName} failure closeout could not resolve every assignment`);
  }
  const completedAt = nowIso();
  for (const assignment of selected) {
    for (const field of [
      "assignmentId",
      "agentId",
      "target",
      "agentDefinitionPath",
      "expectedArtifactPath",
      "dispatchIssuedAt",
      "dispatchAcceptedAt",
    ]) {
      if (typeof assignment[field] !== "string" || assignment[field].trim() === "") {
        throw new Error(`TUnit ${phaseName} failure closeout requires assignment.${field}`);
      }
    }
    if (!Number.isInteger(assignment.dispatchAcceptLatencyMs)
        || assignment.dispatchAcceptLatencyMs !== derivedMilliseconds(
          assignment.dispatchAcceptedAt,
          assignment.dispatchIssuedAt,
        )) {
      throw new Error(`TUnit ${phaseName} failure closeout requires valid dispatch timing`);
    }
    assignment.status = status;
    assignment.failure = { kind: failureKind, message: failureMessage };
    assignment.artifact = null;
    assignment.artifactReadyAt = null;
    assignment.produceSpanMs = null;
    assignment.timingNote = "terminal failure occurred before canonical artifact readiness";
    assignment.completedAt = completedAt;
  }
  phase.status = status;
  phase.failure = { kind: failureKind, message: failureMessage };
  phase.completedAt = completedAt;
  writeState(statePath, state);
  return opFinalize({ path: statePath });
}

function opRecoverInterrupted(args) {
  if (!args.path) throw new Error("recover-interrupted requires --path");
  const state = readState(args.path);
  if (state.workflow !== "tunit") {
    throw new Error("recover-interrupted is TUnit-only");
  }
  if (state.terminalCloseout !== undefined) {
    throw new Error("TUnit run-state is already terminal");
  }
  const presentPhases = UNIT_PHASES.filter((phaseName) => {
    const assignments = state.phases?.[phaseName]?.assignments;
    return Array.isArray(assignments) && assignments.length > 0;
  });
  const phaseName = presentPhases.at(-1);
  if (!phaseName) throw new Error("recover-interrupted requires a dispatched TUnit phase");
  const assignments = state.phases[phaseName].assignments;
  const interrupted = assignments.filter((assignment) => !isIsoTimestamp(assignment.completedAt));
  if (interrupted.length === 0) {
    throw new Error(`recover-interrupted found no incomplete ${phaseName} assignment`);
  }
  return closeTunitFailure(args.path, {
    phaseName,
    assignmentIds: interrupted.map((assignment) => assignment.assignmentId),
    status: "blocked",
    failureKind: "agent_response_missing",
    failureMessage: "The dispatched agent did not return control or a canonical artifact.",
  });
}

function opFailGate(args) {
  if (!args.path) throw new Error("fail-gate requires --path");
  if (!new Set(["analyzer", "writer"]).has(args.phase)) {
    throw new Error("fail-gate requires --phase analyzer|writer");
  }
  if (typeof args.assignment !== "string" || args.assignment.trim() === "") {
    throw new Error("fail-gate requires --assignment");
  }
  if (args.gate !== "optional-parameter") {
    throw new Error("fail-gate only supports --gate optional-parameter");
  }
  if (typeof args.failureMessage !== "string" || args.failureMessage.trim() === "") {
    throw new Error("fail-gate requires --failure-message");
  }
  return closeTunitFailure(args.path, {
    phaseName: args.phase,
    assignmentIds: [args.assignment],
    status: "failed",
    failureKind: "optional_parameter_contract_failure",
    failureMessage: args.failureMessage,
  });
}

function sealTunitAnalysisTarget(statePath, assignment) {
  if (typeof assignment.artifact !== "string" || !assignment.artifact.trim()
      || !isIsoTimestamp(assignment.artifactReadyAt)) return;
  const analysisPath = resolvedArtifactPath(statePath, assignment.artifact);
  let bytes;
  let analysis;
  try {
    bytes = fs.readFileSync(analysisPath);
    analysis = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Analyzer artifact gate requires readable analysis JSON (${error.message})`);
  }
  const targetClasses = analysis?.targetClasses;
  if (!Array.isArray(targetClasses) || targetClasses.length !== 1
      || typeof targetClasses[0]?.className !== "string" || !targetClasses[0].className.trim()) {
    throw new Error("Analyzer artifact gate requires exactly one non-empty targetClasses[].className");
  }
  const targetClassName = targetClasses[0].className.trim();
  if (targetClassLeaf(assignment.target) !== targetClassName) {
    throw new Error(`Analyzer assignment target must resolve to sealed analysis target class ${targetClassName}, got ${assignment.target}`);
  }
  const nextSeal = {
    artifactPath: assignment.artifact,
    artifactSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    targetClassName,
    sealedAt: assignment.artifactReadyAt,
  };
  if (assignment.sealedAnalysis) {
    if (JSON.stringify(assignment.sealedAnalysis) !== JSON.stringify(nextSeal)) {
      throw new Error("sealedAnalysis cannot be replaced after the Analyzer artifact gate");
    }
    return;
  }
  assignment.sealedAnalysis = nextSeal;
}

function validateTunitSealedAnalysisTargetBinding(statePath, state, errors) {
  if (state.workflow !== "tunit") return;
  const analyzerAssignments = state.phases?.analyzer?.assignments;
  if (!Array.isArray(analyzerAssignments) || analyzerAssignments.length === 0) return;

  const sealedTargets = new Map();
  let sealedAnalysisCount = 0;
  analyzerAssignments.forEach((assignment, index) => {
    const prefix = `phases.analyzer.assignments[${index}]`;
    if (typeof assignment?.artifact !== "string" || assignment.artifact.trim() === "") return;
    const analysisPath = resolvedArtifactPath(statePath, assignment.artifact);
    if (typeof assignment.expectedArtifactPath !== "string" || assignment.expectedArtifactPath.trim() === "") {
      errors.push(`${prefix}.expectedArtifactPath is required to seal the analysis target`);
      return;
    }
    const expectedPath = resolvedArtifactPath(statePath, assignment.expectedArtifactPath);
    if (!sameResolvedPath(analysisPath, expectedPath)) {
      errors.push(`${prefix}.artifact must equal the sealed analysis expectedArtifactPath`);
      return;
    }

    const seal = assignment.sealedAnalysis;
    if (!seal || typeof seal !== "object") {
      errors.push(`${prefix}.sealedAnalysis is required for an artifact-backed TUnit Analyzer assignment`);
      return;
    }
    if (seal.artifactPath !== assignment.artifact || seal.sealedAt !== assignment.artifactReadyAt) {
      errors.push(`${prefix}.sealedAnalysis must preserve artifactPath and artifactReadyAt`);
      return;
    }

    let bytes;
    let analysis;
    try {
      bytes = fs.readFileSync(analysisPath);
      analysis = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      errors.push(`${prefix}.artifact must be a readable sealed analysis JSON (${error.message})`);
      return;
    }
    const actualSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (seal.artifactSha256 !== actualSha256) {
      errors.push(`${prefix}.artifact SHA-256 must match sealedAnalysis.artifactSha256`);
      return;
    }
    const targetClasses = analysis?.targetClasses;
    if (!Array.isArray(targetClasses) || targetClasses.length !== 1
        || typeof targetClasses[0]?.className !== "string" || !targetClasses[0].className.trim()) {
      errors.push(`${prefix}.artifact must seal exactly one non-empty targetClasses[].className`);
      return;
    }

    const sealedClassName = targetClasses[0].className.trim();
    if (seal.targetClassName !== sealedClassName) {
      errors.push(`${prefix}.sealedAnalysis.targetClassName must match the analysis artifact`);
      return;
    }
    const target = assignment.target;
    if (targetClassLeaf(target) !== sealedClassName) {
      errors.push(`${prefix}.target must resolve to sealed analysis target class ${sealedClassName}, got ${target}`);
    }
    if (typeof target === "string" && target.trim()) {
      const existing = sealedTargets.get(target);
      if (existing && existing !== sealedClassName) {
        errors.push(`${prefix}.target maps to conflicting sealed analysis classes`);
      }
      sealedTargets.set(target, sealedClassName);
      sealedAnalysisCount += 1;
    }
  });

  const hasDownstreamAssignment = ["writer", "executor", "reviewer"].some((phaseName) => {
    const assignments = state.phases?.[phaseName]?.assignments;
    return Array.isArray(assignments) && assignments.length > 0;
  });
  if (sealedAnalysisCount === 0) {
    if (hasDownstreamAssignment) {
      errors.push("TUnit downstream assignments require a readable sealed Analyzer target");
    }
    return;
  }

  for (const target of stateTargetNames(state)) {
    if (!sealedTargets.has(target)) {
      errors.push(`run-state target ${target} must equal a sealed Analyzer target`);
    }
  }
  for (const phaseName of UNIT_PHASES) {
    const assignments = state.phases?.[phaseName]?.assignments;
    if (!Array.isArray(assignments)) continue;
    assignments.forEach((assignment, index) => {
      if (!sealedTargets.has(assignment?.target)) {
        errors.push(`phases.${phaseName}.assignments[${index}].target must equal a sealed Analyzer target`);
      }
    });
  }
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
  const allRequiredPhasesObserved = UNIT_PHASES.every((phaseName) => phasesToProfile.includes(phaseName));
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

function readTunitReviewerResults(statePath, reviewerPhase, errors) {
  const supportedDecisions = new Set(["pass", "pass_with_warnings", "fail", "blocked"]);
  const results = [];
  for (const [index, assignment] of (reviewerPhase.assignments ?? []).entries()) {
    const prefix = `phases.reviewer.assignments[${index}]`;
    if (typeof assignment?.artifact !== "string" || assignment.artifact.trim() === "") {
      errors.push(`${prefix}.artifact is required for completed TUnit reviewer truth`);
      continue;
    }
    const artifactPath = resolvedArtifactPath(statePath, assignment.artifact);
    let bytes;
    let reviewer;
    try {
      bytes = fs.readFileSync(artifactPath);
      reviewer = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      errors.push(`${prefix}.artifact must be readable reviewer-result JSON (${error.message})`);
      continue;
    }
    const gateDecision = String(reviewer?.gateDecision ?? "").trim().toLowerCase();
    if (!supportedDecisions.has(gateDecision)) {
      errors.push(`${prefix}.artifact gateDecision must be pass, pass_with_warnings, fail, or blocked`);
      continue;
    }
    results.push({
      target: assignment.target,
      artifactPath: assignment.artifact,
      artifactSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      gateDecision,
    });
  }
  return results;
}

function readTunitTerminalProjection(statePath, state, requiredPhases, errors) {
  if (state.workflow !== "tunit") return null;

  const phasePresence = requiredPhases.map((phaseName) => {
    const assignments = state.phases?.[phaseName]?.assignments;
    return Array.isArray(assignments) && assignments.length > 0;
  });
  const lastPresentIndex = phasePresence.lastIndexOf(true);
  if (lastPresentIndex < 0) {
    errors.push("TUnit terminal projection requires at least one dispatched phase");
    return null;
  }
  for (let index = 0; index <= lastPresentIndex; index += 1) {
    if (!phasePresence[index]) {
      errors.push(`phases.${requiredPhases[index]} must not be skipped before the TUnit terminal phase`);
    }
  }
  for (let index = lastPresentIndex + 1; index < requiredPhases.length; index += 1) {
    if (phasePresence[index]) {
      errors.push(`phases.${requiredPhases[index]} must be absent after the TUnit terminal phase`);
    }
  }

  const completedStatuses = new Set(["completed", "passed", "success"]);
  for (let index = 0; index < lastPresentIndex; index += 1) {
    const phaseName = requiredPhases[index];
    const status = String(state.phases?.[phaseName]?.status ?? "").trim().toLowerCase();
    if (!completedStatuses.has(status)) {
      errors.push(`phases.${phaseName}.status must be completed before the TUnit terminal phase`);
    }
  }

  const terminalPhase = requiredPhases[lastPresentIndex];
  const terminal = state.phases?.[terminalPhase] ?? {};
  const terminalStatus = String(terminal.status ?? "").trim().toLowerCase();
  let terminalDecision = null;
  let terminalLifecycle = null;
  let reviewerResults = [];
  if (lastPresentIndex === requiredPhases.length - 1 && completedStatuses.has(terminalStatus)) {
    reviewerResults = readTunitReviewerResults(statePath, terminal, errors);
    if (reviewerResults.length === terminal.assignments.length && reviewerResults.length > 0) {
      const decisions = reviewerResults.map((result) => result.gateDecision);
      terminalDecision = decisions.includes("blocked") ? "blocked"
        : decisions.includes("fail") ? "fail"
          : decisions.includes("pass_with_warnings") ? "pass_with_warnings"
            : "pass";
      terminalLifecycle = terminalDecision === "blocked" ? "blocked"
        : terminalDecision === "fail" ? "failed"
          : "completed";
    }
  } else if (new Set(["blocked", "environment_blocked"]).has(terminalStatus)) {
    terminalDecision = "blocked";
    terminalLifecycle = "blocked";
  } else if (new Set(["failed", "failure", "contract_failed", "rejected"]).has(terminalStatus)) {
    terminalDecision = "failed";
    terminalLifecycle = "failed";
  } else if (lastPresentIndex < requiredPhases.length - 1 && completedStatuses.has(terminalStatus)) {
    errors.push(`phases.${terminalPhase}.status cannot be completed when later TUnit phases are absent`);
  } else {
    errors.push(`phases.${terminalPhase}.status must provide completed, blocked, or failed TUnit terminal truth`);
  }

  const operationalFailureKind = terminal.failure?.kind
    ?? terminal.assignments?.find((assignment) => typeof assignment?.failure?.kind === "string")?.failure?.kind
    ?? null;
  if (new Set(["blocked", "failed"]).has(terminalDecision)
      && reviewerResults.length === 0
      && (typeof operationalFailureKind !== "string" || operationalFailureKind.trim() === "")) {
    errors.push(`phases.${terminalPhase} ${terminalDecision} terminal requires a non-empty failure.kind`);
  }
  const reviewerFailureKind = terminalDecision === "blocked" && reviewerResults.length > 0
    ? "reviewer_gate_blocked"
    : terminalDecision === "fail" ? "reviewer_gate_fail" : null;
  const terminalFailureKind = reviewerFailureKind ?? operationalFailureKind;
  const reviewerFailureKinds = new Map(reviewerResults.map((result) => [
    result.target,
    result.gateDecision === "blocked" ? "reviewer_gate_blocked"
      : result.gateDecision === "fail" ? "reviewer_gate_fail" : null,
  ]));
  const terminalFailureKinds = Object.fromEntries(stateTargetNames(state).map((target) => [
    target,
    reviewerResults.length > 0 ? (reviewerFailureKinds.get(target) ?? null) : terminalFailureKind,
  ]));
  return {
    terminalDecision,
    terminalLifecycle,
    terminalPhase: terminalLifecycle === "completed" ? null : terminalPhase,
    terminalFailureKind,
    terminalFailureKinds,
    validatedPhases: requiredPhases.slice(0, lastPresentIndex + 1),
    reviewerResults,
  };
}

function projectTunitCloseout(state, terminalProjection, errors) {
  if (state.workflow !== "tunit" || !terminalProjection) return null;
  const phaseDurations = {};
  for (const phaseName of terminalProjection.validatedPhases) {
    const phase = state.phases?.[phaseName];
    if (!isIsoTimestamp(phase?.completedAt)) {
      errors.push(`phases.${phaseName}.completedAt is required for TUnit finalize`);
      continue;
    }
    const issued = (phase.assignments ?? []).map((assignment) => Date.parse(assignment?.dispatchIssuedAt));
    if (issued.length === 0 || issued.some(Number.isNaN)) {
      errors.push(`phases.${phaseName}.dispatchIssuedAt is required for TUnit finalize`);
      continue;
    }
    const durationMs = Date.parse(phase.completedAt) - Math.min(...issued);
    if (durationMs < 0) {
      errors.push(`phases.${phaseName}.completedAt must not precede its earliest dispatchIssuedAt`);
      continue;
    }
    phaseDurations[phaseName] = { durationMs, source: "run-state" };
  }
  const completedAt = state.phases?.[terminalProjection.validatedPhases.at(-1)]?.completedAt;
  if (!isIsoTimestamp(state.overallWallClock?.start) || !isIsoTimestamp(completedAt)) {
    errors.push("TUnit finalize requires ISO overall start and terminal phase completedAt");
    return null;
  }
  const overallDurationMs = derivedMilliseconds(completedAt, state.overallWallClock.start);
  if (!Number.isInteger(overallDurationMs) || overallDurationMs < 0) {
    errors.push("TUnit finalize overall boundary precedes run-state start");
    return null;
  }
  const terminalCloseout = {
    source: terminalProjection.reviewerResults.length > 0 ? "run-state+reviewer-result" : "run-state",
    terminalDecision: terminalProjection.terminalDecision,
    lifecycle: terminalProjection.terminalLifecycle,
    terminalPhase: terminalProjection.validatedPhases.at(-1),
    closedPhases: [...terminalProjection.validatedPhases],
    completedAt,
    ...(terminalProjection.reviewerResults.length > 0
      ? { reviewerResults: terminalProjection.reviewerResults }
      : {}),
  };
  return {
    phaseDurations,
    overallWallClock: {
      start: state.overallWallClock.start,
      end: completedAt,
      durationMs: overallDurationMs,
    },
    terminalDecision: terminalProjection.terminalDecision,
    terminalCloseout,
  };
}

function readUnitEarlyTerminalProjection(statePath, state, requiredPhases, errors) {
  const hasMissingPhase = requiredPhases.some((phaseName) => {
    const phase = state.phases?.[phaseName];
    return !phase || !Array.isArray(phase.assignments) || phase.assignments.length === 0;
  });
  if (state.workflow !== "unit") return null;

  const workflowStatePath = path.join(path.dirname(path.resolve(statePath)), "workflow-state.json");
  if (!fs.existsSync(workflowStatePath)) return null;

  let workflowState;
  try {
    workflowState = JSON.parse(fs.readFileSync(workflowStatePath, "utf8"));
  } catch (error) {
    errors.push(`workflow-state.json must be valid JSON (${error.message})`);
    return null;
  }

  const decision = workflowState.terminalDecision;
  if (!new Set(["failed", "blocked"]).has(decision)) {
    if (hasMissingPhase) {
      errors.push("workflow-state.json terminalDecision must be failed or blocked for early terminal validation");
    }
    return null;
  }
  if (workflowState.workflow !== "unit" || workflowState.lifecycle !== decision) {
    errors.push("workflow-state.json workflow and lifecycle must match the Unit terminal decision");
  }
  if (workflowState.lastAction?.type !== "terminal" || workflowState.lastAction?.decision !== decision) {
    errors.push("workflow-state.json lastAction must match the terminal decision");
  }
  if (!isIsoTimestamp(workflowState.timing?.startedAt) || !isIsoTimestamp(workflowState.timing?.completedAt)) {
    errors.push("workflow-state.json terminal timing must contain ISO timestamps");
  } else if (workflowState.timing.durationMs
      !== derivedMilliseconds(workflowState.timing.completedAt, workflowState.timing.startedAt)) {
    errors.push("workflow-state.json timing.durationMs must equal completedAt-startedAt");
  }

  const targetNames = stateTargetNames(state);
  const workflowTargetNames = Object.keys(workflowState.targets ?? {});
  if (targetNames.length === 0 || !isDeepStrictEqual(targetNames, workflowTargetNames)) {
    errors.push("workflow-state.json targets must match run-state target order");
    return null;
  }
  const targetStates = targetNames.map((target) => ({ target, state: workflowState.targets[target] }));
  const terminalTargets = targetStates.filter(({ state: targetState }) => targetState.lifecycle === decision);
  const allowedLifecycles = decision === "failed" ? new Set(["failed", "completed", "cancelled"])
    : new Set(["blocked", "completed", "cancelled"]);
  if (terminalTargets.length === 0
      || targetStates.some(({ state: targetState }) => !allowedLifecycles.has(targetState.lifecycle))) {
    errors.push("workflow-state.json target lifecycles must match the early terminal decision");
    return null;
  }

  const hasExplicitTerminalPhase = terminalTargets.some(({ state: targetState }) => requiredPhases.some((phaseName) => (
    targetState[phaseName]?.lifecycle === "failed" || targetState[phaseName]?.lifecycle === "stopped"
  )));
  if (!hasMissingPhase && !hasExplicitTerminalPhase) return null;

  const terminalLifecycle = decision === "failed" ? "failed" : "stopped";
  const terminalStatuses = decision === "failed"
    ? new Set(["contract_failed", "failed"])
    : new Set(["environment_blocked", "blocked"]);
  const terminalIndexes = [];
  const terminalFailureKinds = {};
  for (const { target, state: targetState } of terminalTargets) {
    const indexes = requiredPhases
      .map((phaseName, index) => targetState[phaseName]?.lifecycle === terminalLifecycle ? index : -1)
      .filter((index) => index >= 0);
    if (indexes.length !== 1) {
      errors.push(`workflow-state.json target ${target} must contain exactly one terminal phase`);
      continue;
    }
    const index = indexes[0];
    const phaseName = requiredPhases[index];
    const phase = targetState[phaseName];
    terminalIndexes.push(index);
    const reviewerFailure = decision === "failed" && phaseName === "reviewer" && phase.resultStatus === "fail";
    if (!terminalStatuses.has(phase.resultStatus) && !reviewerFailure) {
      errors.push(`workflow-state.json ${target}.${phaseName}.resultStatus does not match ${decision}`);
    }
    if (!Number.isInteger(phase.dispatchCount) || phase.dispatchCount < 1) {
      errors.push(`workflow-state.json ${target}.${phaseName}.dispatchCount must record the terminal assignment`);
    }
    terminalFailureKinds[target] = phase.failure?.kind ?? null;
  }
  if (terminalIndexes.length === 0 || new Set(terminalIndexes).size !== 1) {
    errors.push("workflow-state.json targets must share one terminal phase boundary");
    return null;
  }
  const terminalIndex = terminalIndexes[0];

  for (const { target, state: targetState } of targetStates) {
    for (const [index, phaseName] of requiredPhases.entries()) {
      const phase = targetState[phaseName];
      if (!phase || typeof phase !== "object") {
        errors.push(`workflow-state.json target ${target}.${phaseName} is required`);
        continue;
      }
      if (targetState.lifecycle !== "cancelled" && index < terminalIndex && phase.lifecycle !== "completed") {
        errors.push(`workflow-state.json ${target}.${phaseName} must be completed before the terminal phase`);
      }
      if (index > terminalIndex && (phase.lifecycle !== "pending" || phase.dispatchCount !== 0)) {
        errors.push(`workflow-state.json ${target}.${phaseName} must remain undispatched after the terminal phase`);
      }
    }
  }

  const validatedPhases = requiredPhases.slice(0, terminalIndex + 1);
  for (const phaseName of requiredPhases.slice(terminalIndex + 1)) {
    const phase = state.phases?.[phaseName];
    if (phase && Array.isArray(phase.assignments) && phase.assignments.length > 0) {
      errors.push(`phases.${phaseName}.assignments must be absent after the workflow terminal phase`);
    }
  }
  const terminalPhase = requiredPhases[terminalIndex];
  const failureKinds = Object.values(terminalFailureKinds).filter((kind) => typeof kind === "string" && kind.trim());
  const terminalFailureKind = failureKinds.length === 1 ? failureKinds[0] : null;
  return {
    terminalDecision: decision,
    terminalPhase,
    terminalFailureKind,
    terminalFailureKinds,
    validatedPhases,
  };
}

function readTerminalWorkflowState(statePath, state) {
  const workflowStatePath = path.join(path.dirname(path.resolve(statePath)), "workflow-state.json");
  const workflowState = readState(workflowStatePath);
  if (state.workflow !== "unit" || workflowState.workflow !== "unit") {
    throw new Error("closeout operation is currently defined for Unit workflow only");
  }
  const decision = workflowState.terminalDecision;
  if (!new Set(["completed", "failed", "blocked"]).has(decision)
      || workflowState.lifecycle !== decision
      || workflowState.lastAction?.type !== "terminal"
      || workflowState.lastAction?.decision !== decision) {
    throw new Error("closeout requires consistent terminal workflow-state truth");
  }
  if (!isIsoTimestamp(workflowState.timing?.completedAt)
      || workflowState.timing.durationMs
        !== derivedMilliseconds(workflowState.timing.completedAt, workflowState.timing.startedAt)) {
    throw new Error("closeout requires valid workflow-state terminal timing");
  }
  const targetNames = stateTargetNames(state);
  if (targetNames.length === 0 || targetNames.some((target) => !workflowState.targets?.[target])) {
    throw new Error("closeout requires every run-state target in workflow-state");
  }
  const workflowTargets = Object.keys(workflowState.targets ?? {});
  if (!isDeepStrictEqual(workflowTargets, targetNames)) {
    throw new Error("closeout requires run-state targets to match workflow-state target order");
  }
  const targetStates = targetNames.map((target) => ({ target, state: workflowState.targets[target] }));
  const lifecycles = targetStates.map((item) => item.state.lifecycle);
  const allowed = decision === "completed" ? new Set(["completed"])
    : decision === "failed" ? new Set(["completed", "failed", "cancelled"])
      : new Set(["completed", "blocked", "cancelled"]);
  if (lifecycles.some((lifecycle) => !allowed.has(lifecycle))
      || (decision === "failed" && !lifecycles.includes("failed"))
      || (decision === "blocked" && !lifecycles.includes("blocked"))) {
    throw new Error("closeout requires target lifecycles consistent with the terminal decision");
  }
  return { workflowState, targetStates, decision };
}

function closeoutPhaseNames(targetStates, decision) {
  if (decision === "completed") {
    if (targetStates.some(({ state }) => UNIT_PHASES.some((phaseName) => state[phaseName]?.lifecycle !== "completed"))) {
      throw new Error("completed closeout requires all Unit phases completed");
    }
    return [...UNIT_PHASES];
  }
  if (decision === "blocked"
      && targetStates.every(({ state }) => state.lifecycle === "completed"
        || (UNIT_PHASES.every((phaseName) => state[phaseName]?.lifecycle === "completed")
          && state.reviewer?.resultStatus === "blocked"))) {
    return [...UNIT_PHASES];
  }

  const terminalLifecycle = decision === "failed" ? "failed" : "stopped";
  const terminalIndexes = targetStates.flatMap(({ state: targetState }) => UNIT_PHASES
    .map((phaseName, index) => targetState[phaseName]?.lifecycle === terminalLifecycle ? index : -1)
    .filter((index) => index >= 0));
  if (terminalIndexes.length === 0 || new Set(terminalIndexes).size !== 1) {
    throw new Error("closeout requires one consistent terminal Unit phase");
  }
  const terminalIndex = terminalIndexes[0];
  for (const { state: targetState } of targetStates) {
    for (const [index, phaseName] of UNIT_PHASES.entries()) {
      const phase = targetState[phaseName];
      if (targetState.lifecycle !== "cancelled" && index < terminalIndex && phase?.lifecycle !== "completed") {
        throw new Error(`${phaseName} must be completed before terminal closeout`);
      }
      if (index > terminalIndex && (phase?.lifecycle !== "pending" || phase?.dispatchCount !== 0)) {
        throw new Error(`${phaseName} must remain undispatched after terminal closeout`);
      }
    }
  }
  return UNIT_PHASES.slice(0, terminalIndex + 1);
}

function phaseTiming(state, workflowState, phaseName) {
  const phase = state.phases?.[phaseName];
  if (!phase || !Array.isArray(phase.assignments) || phase.assignments.length === 0) {
    throw new Error(`${phaseName} run-state assignment is required for closeout`);
  }
  const boundaries = [];
  for (const assignment of phase.assignments) {
    const targetState = workflowState.targets?.[assignment.target];
    const boundary = targetState?.[phaseName]?.completedAt;
    if (!new Set(["completed", "failed", "stopped"]).has(targetState?.[phaseName]?.lifecycle)) {
      throw new Error(`${phaseName} phase has not ended for ${assignment.target ?? "unknown target"}`);
    }
    if (!isIsoTimestamp(boundary)) {
      throw new Error(`${phaseName} workflow phase completedAt is required for ${assignment.target ?? "unknown target"}`);
    }
    boundaries.push(Date.parse(boundary));
    if (!isIsoTimestamp(assignment.completedAt)) {
      throw new Error(`${phaseName} assignment completedAt must be recorded before closeout`);
    }
    if (Date.parse(assignment.completedAt) > Date.parse(boundary)) {
      throw new Error(`${phaseName} assignment completedAt exceeds workflow phase boundary`);
    }
  }
  const endedTargets = Object.entries(workflowState.targets ?? {})
    .filter(([, targetState]) => new Set(["completed", "failed", "stopped"])
      .has(targetState?.[phaseName]?.lifecycle))
    .map(([target]) => target);
  const assignedTargets = [...new Set(phase.assignments.map((assignment) => assignment?.target))];
  if (assignedTargets.some((target) => typeof target !== "string")
      || endedTargets.length !== assignedTargets.length
      || endedTargets.some((target) => !assignedTargets.includes(target))) {
    throw new Error(`${phaseName} run-state assignments must cover every ended workflow target`);
  }
  const boundary = new Date(Math.max(...boundaries)).toISOString();
  const issued = phase.assignments.map((assignment) => Date.parse(assignment.dispatchIssuedAt));
  if (issued.some(Number.isNaN)) throw new Error(`${phaseName} dispatchIssuedAt is required for closeout`);
  const durationMs = Date.parse(boundary) - Math.min(...issued);
  if (durationMs < 0) throw new Error(`${phaseName} closeout boundary precedes dispatch`);
  return { completedAt: boundary, durationMs };
}

// Read-only progress projection; terminal closeout uses the same calculation.
function opPhaseTime(args) {
  if (!args.path || !UNIT_PHASES.includes(args.phase)) throw new Error("phase-time requires --path and a Unit --phase");
  const state = readState(args.path);
  const workflow = readState(path.join(path.dirname(path.resolve(args.path)), "workflow-state.json"));
  if (state.workflow !== "unit" || workflow.workflow !== "unit") throw new Error("phase-time is defined for Unit only");
  const timing = phaseTiming(state, workflow, args.phase);
  const seconds = Math.floor(timing.durationMs / 1000);
  process.stdout.write(`${JSON.stringify({ phase: args.phase, ...timing, display: `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` })}\n`);
}

function opCloseout(args) {
  if (!args.path) throw new Error("closeout requires --path");
  const state = readState(args.path);
  const { workflowState, targetStates, decision } = readTerminalWorkflowState(args.path, state);
  const closedPhases = closeoutPhaseNames(targetStates, decision);

  for (const phaseName of closedPhases) {
    const timing = phaseTiming(state, workflowState, phaseName);
    state.phases[phaseName].completedAt = timing.completedAt;
    state.phaseDurations ??= {};
    state.phaseDurations[phaseName] = { durationMs: timing.durationMs, source: "run-state" };
  }

  for (const phaseName of UNIT_PHASES.slice(closedPhases.length)) {
    const phase = state.phases?.[phaseName];
    if (phase && Array.isArray(phase.assignments) && phase.assignments.length > 0) {
      throw new Error(`${phaseName} run-state assignments exist after terminal phase`);
    }
  }

  state.overallWallClock.end = workflowState.timing.completedAt;
  state.overallWallClock.durationMs = derivedMilliseconds(
    state.overallWallClock.end,
    state.overallWallClock.start,
  );
  if (!Number.isInteger(state.overallWallClock.durationMs) || state.overallWallClock.durationMs < 0) {
    throw new Error("closeout overall boundary precedes run-state start");
  }
  state.terminalCloseout = {
    source: "workflow-state",
    decision,
    terminalPhase: decision === "completed" ? null : closedPhases.at(-1),
    closedPhases,
    completedAt: workflowState.timing.completedAt,
  };
  state.terminalDecision = decision;
  delete state.profilingSummary;
  writeState(args.path, state);
  return state;
}

function opFinalize(args) {
  if (!args.path) throw new Error("finalize requires --path");
  const state = readState(args.path);
  if (!new Set(["unit", "tunit"]).has(state.workflow)) {
    throw new Error("finalize operation is currently defined for Unit and TUnit workflows only");
  }
  const errors = [];
  const unitEarlyTerminal = readUnitEarlyTerminalProjection(args.path, state, UNIT_PHASES, errors);
  const tunitTerminal = readTunitTerminalProjection(args.path, state, UNIT_PHASES, errors);
  validateTunitSealedAnalysisTargetBinding(args.path, state, errors);
  const terminalProjection = unitEarlyTerminal ?? tunitTerminal;
  const hasMissingPhase = UNIT_PHASES.some((phaseName) => {
    const phase = state.phases?.[phaseName];
    return !phase || !Array.isArray(phase.assignments) || phase.assignments.length === 0;
  });
  if (errors.length > 0) {
    throw new Error(`profiling finalize failed:\n- ${errors.join("\n- ")}`);
  }
  if (hasMissingPhase && !terminalProjection) {
    throw new Error("profiling finalize requires all Unit phases or valid early-terminal workflow truth");
  }
  const phasesToProfile = terminalProjection?.validatedPhases ?? UNIT_PHASES;
  if (state.workflow === "tunit") {
    const closeout = projectTunitCloseout(state, tunitTerminal, errors);
    if (errors.length > 0 || !closeout) {
      throw new Error(`TUnit finalize failed:\n- ${errors.join("\n- ")}`);
    }
    state.phaseDurations = closeout.phaseDurations;
    state.overallWallClock = closeout.overallWallClock;
    state.terminalDecision = closeout.terminalDecision;
    state.terminalCloseout = closeout.terminalCloseout;
  }
  const terminalPartial = terminalProjection && (
    terminalProjection.terminalLifecycle
      ? terminalProjection.terminalLifecycle !== "completed"
      : terminalProjection.terminalDecision !== "completed"
  );
  const profilingSummary = buildDeterministicProfilingSummary(state, phasesToProfile, terminalPartial);
  if (!profilingSummary) throw new Error("profiling finalize requires observable phase duration truth");
  state.profilingSummary = profilingSummary;
  writeState(args.path, state);
  return state;
}

function validateCanonicalPresentation(statePath, state, errors) {
  const presentation = state.presentation;
  if (!presentation || presentation.status !== "completed") {
    errors.push(`presentation.status must be completed by the canonical ${state.workflow} renderer`);
    return;
  }
  const expectedRenderer = `${state.workflow}-runtime/workflow-result.mjs`;
  if (presentation.renderer !== expectedRenderer) {
    errors.push(`presentation.renderer must identify the canonical ${state.workflow} renderer`);
  }
  if (!isIsoTimestamp(presentation.renderedAt)) {
    errors.push("presentation.renderedAt must be an ISO timestamp");
  }
  if (presentation.terminalDecision !== state.terminalDecision) {
    errors.push("presentation.terminalDecision must equal run-state terminalDecision");
  }
  const outputRoot = path.resolve(path.dirname(path.resolve(statePath)), "workflow-result");
  for (const [field, hashField] of [["jsonOutput", "jsonSha256"], ["markdownOutput", "markdownSha256"]]) {
    const outputPath = presentation[field];
    if (typeof outputPath !== "string" || !path.isAbsolute(outputPath)) {
      errors.push(`presentation.${field} must be an absolute path`);
      continue;
    }
    const resolved = path.resolve(outputPath);
    if (!isWithin(outputRoot, resolved)) {
      errors.push(`presentation.${field} must stay within the run-state workflow-result directory`);
      continue;
    }
    if (!fs.existsSync(resolved)) {
      errors.push(`presentation.${field} does not exist`);
      continue;
    }
    const actualHash = crypto.createHash("sha256").update(fs.readFileSync(resolved)).digest("hex");
    if (presentation[hashField] !== actualHash) {
      errors.push(`presentation.${hashField} must match ${field}`);
    }
  }
}

function opValidate(args) {
  if (!args.path) throw new Error("validate requires --path");
  const state = readState(args.path);
  const errors = [];
  let timingComplete = true;
  const requiredPhases = UNIT_PHASES;
  const unitEarlyTerminal = readUnitEarlyTerminalProjection(args.path, state, requiredPhases, errors);
  const tunitTerminal = readTunitTerminalProjection(args.path, state, requiredPhases, errors);
  validateTunitSealedAnalysisTargetBinding(args.path, state, errors);
  const terminalProjection = unitEarlyTerminal ?? tunitTerminal;
  const phasesToValidate = terminalProjection?.validatedPhases ?? requiredPhases;
  const expectedTunitCloseout = projectTunitCloseout(state, tunitTerminal, errors);

  if (args.requirePresentation) {
    if (!new Set(["unit", "tunit"]).has(state.workflow)) {
      errors.push("--require-presentation is defined for Unit and TUnit only");
    } else {
      validateCanonicalPresentation(args.path, state, errors);
      if (state.workflow === "unit") {
        if (typeof state.terminalDecision !== "string") {
          errors.push("Unit presentation requires deterministic terminalDecision");
        }
        if (typeof state.terminalCloseout?.decision !== "string") {
          errors.push("Unit presentation requires deterministic terminalCloseout.decision");
        }
      }
    }
  }

  if (state.workflow === "unit" && state.terminalCloseout?.source === "workflow-state"
      && typeof state.terminalDecision === "string"
      && typeof state.terminalCloseout.decision === "string"
      && state.terminalDecision !== state.terminalCloseout.decision) {
    errors.push("terminalDecision must equal deterministic Unit terminalCloseout.decision");
  }

  if (!state.workflow) errors.push("missing workflow");
  if (!state.target) errors.push("missing target");
  const targetNames = stateTargetNames(state);
  if (targetNames.length === 0 || new Set(targetNames).size !== targetNames.length) {
    errors.push("targets must contain unique non-empty targets");
  }
  if (state.target !== targetNames[0]) errors.push("target must equal the first targets entry");
  if (state.terminalDecision === "completed_with_known_environment_exception") {
    if (state.workflow !== "aspire") errors.push("completed_with_known_environment_exception is only valid for the Aspire workflow");
    if (state.lifecycle !== "completed_with_known_environment_exception") errors.push("known environment exception lifecycle must match terminalDecision");
    const exception = state.knownEnvironmentException;
    if (exception?.status !== "qualified") errors.push("knownEnvironmentException.status must be qualified");
    if (exception?.exceptionCode !== "windows_docker_desktop_mssql_127_0_0_1_tds_prelogin") errors.push("knownEnvironmentException.exceptionCode is invalid");
    if (!Number.isInteger(exception?.failedTests) || exception.failedTests < 1) errors.push("knownEnvironmentException.failedTests must preserve a value greater than 0");
    for (const field of ["executorArtifactPath", "reviewerArtifactPath", "validationArtifactPath"]) {
      if (typeof exception?.[field] !== "string" || !path.isAbsolute(exception[field])) errors.push(`knownEnvironmentException.${field} must be an absolute path`);
    }
    if (!isIsoTimestamp(exception?.validatedAt)) errors.push("knownEnvironmentException.validatedAt must be an ISO timestamp");
  } else if (state.knownEnvironmentException !== undefined) {
    errors.push("knownEnvironmentException requires terminalDecision completed_with_known_environment_exception");
  }
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
      for (const field of ["assignmentId", "agentId", "target", "agentDefinitionPath", "expectedArtifactPath"]) {
        if (typeof assignment[field] !== "string" || assignment[field].trim() === "") {
          errors.push(`${prefix}.${field} must be a non-empty string`);
        }
      }
      if ((typeof assignment.artifact !== "string" || assignment.artifact.trim() === "")
          && !(assignment.artifact === null && terminalNullIsExplained)) {
        errors.push(`${prefix}.artifact must be a non-empty string`);
      }
      if (!targetNames.includes(assignment.target)) errors.push(`${prefix}.target must be a declared target`);
      if (assignment.contextForkPolicy !== "none") {
        errors.push(`${prefix}.contextForkPolicy must be none`);
      }
      if (assignment.externalMemoryPolicy !== "forbid") {
        errors.push(`${prefix}.externalMemoryPolicy must be forbid`);
      }
      if (!isIsoTimestamp(assignment.dispatchIssuedAt)) errors.push(`${prefix}.dispatchIssuedAt must be an ISO timestamp`);
      if (!isIsoTimestamp(assignment.dispatchAcceptedAt)) errors.push(`${prefix}.dispatchAcceptedAt must be an ISO timestamp`);
      if (!isIsoTimestamp(assignment.completedAt)) errors.push(`${prefix}.completedAt must be an ISO timestamp`);
      if (isIsoTimestamp(assignment.dispatchIssuedAt)) dispatchIssuedTimes.push(Date.parse(assignment.dispatchIssuedAt));
      const expectedDispatchLatency = derivedMilliseconds(assignment.dispatchAcceptedAt, assignment.dispatchIssuedAt);
      if (!Number.isInteger(assignment.dispatchAcceptLatencyMs)
          || assignment.dispatchAcceptLatencyMs !== expectedDispatchLatency
          || assignment.dispatchAcceptLatencyMs < 0) {
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

  if (state.workflow === "tunit" && expectedTunitCloseout) {
    if (!isDeepStrictEqual(state.phaseDurations, expectedTunitCloseout.phaseDurations)) {
      errors.push("phaseDurations must equal the deterministic TUnit finalize projection");
    }
    if (!isDeepStrictEqual(state.overallWallClock, expectedTunitCloseout.overallWallClock)) {
      errors.push("overallWallClock must equal the deterministic TUnit finalize projection");
    }
    if (state.terminalDecision !== expectedTunitCloseout.terminalDecision) {
      errors.push("terminalDecision must equal the canonical TUnit reviewer/run-state projection");
    }
    if (!isDeepStrictEqual(state.terminalCloseout, expectedTunitCloseout.terminalCloseout)) {
      errors.push("terminalCloseout must equal the deterministic TUnit finalize projection");
    }
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
    if (new Set(["unit", "tunit"]).has(state.workflow)) {
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
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (op === "init") {
    if (args.workflow !== OWNER_WORKFLOW) {
      throw new Error(`Unit run-state runtime requires --workflow ${OWNER_WORKFLOW}`);
    }
  }
  if (args.path && (op !== "init" || fs.existsSync(args.path))) {
    const state = readState(args.path);
    if (state.workflow !== OWNER_WORKFLOW) {
      throw new Error(`Unit run-state runtime cannot operate on workflow ${state.workflow ?? "missing"}`);
    }
  }
  switch (op) {
    case "init": opInit(args); break;
    case "set": opSet(args); break;
    case "append": opAppend(args); break;
    case "redispatch": opRedispatch(args); break;
    case "recover-interrupted": opRecoverInterrupted(args); break;
    case "fail-gate": opFailGate(args); break;
    case "phase-time": opPhaseTime(args); break;
    case "closeout": opCloseout(args); break;
    case "finalize": opFinalize(args); break;
    case "validate": opValidate(args); break;
    default: throw new Error(`Unknown op: ${op}. Expected init|set|append|redispatch|recover-interrupted|fail-gate|phase-time|closeout|finalize|validate|now.`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`run-state.mjs error: ${err.message}\n`);
  process.exit(1);
}
