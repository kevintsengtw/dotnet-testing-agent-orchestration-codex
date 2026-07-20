#!/usr/bin/env node
// run-state.mjs — deterministic run-state.json writer for the dotnet-testing orchestrators.
//
// WHY THIS EXISTS:
//   The orchestrator contracts require a {testProjectDir}/.orchestrator/run-state.json
//   timing-truth file that is created and incrementally stamped throughout a run.
//   Earlier contracts told the orchestrator to "use the Write tool" + `date -u`, but
//   Codex has no "Write" tool and `date -u` is not portable. In the Codex CLI the model
//   improvised PowerShell read-modify-write; in the VS Code Codex Extension it did not,
//   so run-state.json was silently never written and all timing + token telemetry came
//   out empty. This script makes run-state writes deterministic and shell-agnostic:
//   the orchestrator only ever invokes `node .codex/scripts/run-state.mjs <op> ...`
//   (node + shell_command are proven to work in both CLI and Extension), and the
//   timestamp is read from the system clock INSIDE this script (no `date -u`).
//
// SCALAR-ONLY CLI (no JSON blobs on argv — keeps it robust under PowerShell quoting):
//   node run-state.mjs init   --path P --workflow W --target T
//   node run-state.mjs set    --path P [--phase PH] [--assignment AID]
//                              [--set key=value]... [--derive field=END-START]...
//   node run-state.mjs append --path P --array NAME [--set key=value]...
//   node run-state.mjs validate --path P [--require-complete-timing]
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
import path from "node:path";
import process from "node:process";

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = { set: [], derive: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--path": args.path = argv[++i]; break;
      case "--workflow": args.workflow = argv[++i]; break;
      case "--target": args.target = argv[++i]; break;
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
  return [
    "Usage:",
    "  node .codex/scripts/run-state.mjs init   --path <run-state.json> --workflow <w> --target <t>",
    "  node .codex/scripts/run-state.mjs set    --path <run-state.json> [--phase <p>] [--assignment <id>] [--set k=v]... [--derive f=END-START]...",
    "  node .codex/scripts/run-state.mjs append --path <run-state.json> --array <name> [--set k=v]...",
    "  node .codex/scripts/run-state.mjs validate --path <run-state.json> [--require-complete-timing]",
    "  node .codex/scripts/run-state.mjs now",
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

function opInit(args) {
  if (!args.path) throw new Error("init requires --path");
  if (!args.workflow) throw new Error("init requires --workflow");
  if (!args.target) throw new Error("init requires --target");
  const state = {
    workflow: args.workflow,
    target: args.target,
    overallWallClock: { start: nowIso(), end: null, durationMs: null },
    phases: {},
    redispatchEvents: [],
    boundedRedispatchCount: 0,
    restartCount: 0,
    executorFixRounds: 0,
  };
  writeState(args.path, state);
  return state;
}

function opSet(args) {
  if (!args.path) throw new Error("set requires --path");
  const state = readState(args.path);
  const scope = resolveScope(state, args);
  for (const token of args.set) {
    const { keyPath, value } = parseSet(token);
    setDeep(scope, keyPath, value);
  }
  // Derive after sets so endpoint fields written in the same call are visible.
  for (const token of args.derive) applyDerive(scope, token);
  writeState(args.path, state);
  return state;
}

function opAppend(args) {
  if (!args.path) throw new Error("append requires --path");
  if (!args.array) throw new Error("append requires --array");
  const state = readState(args.path);
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

function isIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function derivedMilliseconds(end, start) {
  return isIsoTimestamp(end) && isIsoTimestamp(start)
    ? Date.parse(end) - Date.parse(start)
    : null;
}

function opValidate(args) {
  if (!args.path) throw new Error("validate requires --path");
  const state = readState(args.path);
  const errors = [];
  let timingComplete = true;
  const requiredPhases = ["analyzer", "writer", "executor", "reviewer"];

  if (!state.workflow) errors.push("missing workflow");
  if (!state.target) errors.push("missing target");
  if (!isIsoTimestamp(state.overallWallClock?.start)) errors.push("overallWallClock.start must be an ISO timestamp");
  if (!isIsoTimestamp(state.overallWallClock?.end)) errors.push("overallWallClock.end must be an ISO timestamp");
  const expectedOverall = derivedMilliseconds(state.overallWallClock?.end, state.overallWallClock?.start);
  if (!Number.isInteger(state.overallWallClock?.durationMs) || state.overallWallClock.durationMs !== expectedOverall) {
    errors.push("overallWallClock.durationMs must equal end-start");
  }

  for (const phaseName of requiredPhases) {
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
      for (const field of ["assignmentId", "agentId", "target", "agentDefinitionPath", "expectedArtifactPath", "artifact"]) {
        if (typeof assignment[field] !== "string" || assignment[field].trim() === "") {
          errors.push(`${prefix}.${field} must be a non-empty string`);
        }
      }
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
        timingComplete = false;
        if (assignment.produceSpanMs !== null) errors.push(`${prefix}.produceSpanMs must be null when artifactReadyAt is null`);
        if (typeof assignment.timingNote !== "string" || assignment.timingNote.trim() === "") {
          errors.push(`${prefix}.timingNote is required when artifactReadyAt is null`);
        }
        if (args.requireCompleteTiming) errors.push(`${prefix}.artifactReadyAt is required by --require-complete-timing`);
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
  }

  if (errors.length > 0) {
    throw new Error(`validation failed:\n- ${errors.join("\n- ")}`);
  }
  process.stdout.write(`${JSON.stringify({ status: "valid", timingComplete }, null, 2)}\n`);
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
  switch (op) {
    case "init": opInit(args); break;
    case "set": opSet(args); break;
    case "append": opAppend(args); break;
    case "validate": opValidate(args); break;
    default: throw new Error(`Unknown op: ${op}. Expected init|set|append|validate|now.`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`run-state.mjs error: ${err.message}\n`);
  process.exit(1);
}
