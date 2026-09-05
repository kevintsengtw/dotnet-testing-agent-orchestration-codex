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
//   node run-state.mjs redispatch --path P --phase PH --assignment AID --target T
//                              --set reason=CODE --set waitMs=N
//   node run-state.mjs closeout --path P
//   node run-state.mjs finalize --path P
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
import { isDeepStrictEqual } from "node:util";

const UNIT_PHASES = ["analyzer", "writer", "executor", "reviewer"];

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
    "  node .codex/scripts/run-state.mjs redispatch --path <run-state.json> --phase <p> --assignment <id> --target <t> --set reason=<code> --set waitMs=<ms>",
    "  node .codex/scripts/run-state.mjs closeout --path <run-state.json>",
    "  node .codex/scripts/run-state.mjs finalize --path <run-state.json>",
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
    if (state.workflow === "unit" && !args.phase
        && new Set(["redispatchEvents", "boundedRedispatchCount", "profilingSummary"]).has(keyPath[0])) {
      if (keyPath[0] === "profilingSummary") {
        throw new Error("profilingSummary can only be written by the finalize operation");
      }
      throw new Error("redispatch truth can only be written by the redispatch operation");
    }
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
  if (state.workflow === "unit" && args.array === "redispatchEvents") {
    throw new Error("use the redispatch operation to record redispatchEvents at transition time");
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

function derivedMilliseconds(end, start) {
  return isIsoTimestamp(end) && isIsoTimestamp(start)
    ? Date.parse(end) - Date.parse(start)
    : null;
}

function buildUnitProfilingSummary(state, phasesToProfile, earlyTerminal) {
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
  const observability = earlyTerminal
    ? "terminal_partial"
    : (phaseIsFullyObservable && allRequiredPhasesObserved ? "complete" : "partial");
  const redispatchWaitMs = (state.redispatchEvents ?? [])
    .filter((event) => event?.phase === bottleneck.phaseName && event?.target === state.target)
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

  const targetState = workflowState.targets?.[state.target];
  if (!targetState || targetState.lifecycle !== decision) {
    errors.push(`workflow-state.json target ${state.target} must match terminal decision ${decision}`);
    return null;
  }

  const hasExplicitTerminalPhase = requiredPhases.some((phaseName) => (
    targetState[phaseName]?.lifecycle === "failed" || targetState[phaseName]?.lifecycle === "stopped"
  ));
  if (!hasMissingPhase && !hasExplicitTerminalPhase) return null;

  const terminalLifecycle = decision === "failed" ? "failed" : "stopped";
  const terminalStatuses = decision === "failed"
    ? new Set(["contract_failed", "failed"])
    : new Set(["environment_blocked", "blocked"]);
  let terminalIndex = -1;
  for (const [index, phaseName] of requiredPhases.entries()) {
    const phase = targetState[phaseName];
    if (!phase || typeof phase !== "object") {
      errors.push(`workflow-state.json target ${state.target}.${phaseName} is required`);
      continue;
    }
    if (phase.lifecycle === terminalLifecycle) {
      if (terminalIndex !== -1) errors.push("workflow-state.json target must contain exactly one terminal phase");
      terminalIndex = index;
      if (!terminalStatuses.has(phase.resultStatus)) {
        errors.push(`workflow-state.json ${phaseName}.resultStatus does not match ${decision}`);
      }
      if (!Number.isInteger(phase.dispatchCount) || phase.dispatchCount < 1) {
        errors.push(`workflow-state.json ${phaseName}.dispatchCount must record the terminal assignment`);
      }
    }
  }
  if (terminalIndex === -1) {
    errors.push("workflow-state.json target must contain a failed or stopped terminal phase");
    return null;
  }

  for (const [index, phaseName] of requiredPhases.entries()) {
    const phase = targetState[phaseName];
    if (!phase || typeof phase !== "object") continue;
    if (index < terminalIndex && phase.lifecycle !== "completed") {
      errors.push(`workflow-state.json ${phaseName} must be completed before the terminal phase`);
    }
    if (index > terminalIndex && (phase.lifecycle !== "pending" || phase.dispatchCount !== 0)) {
      errors.push(`workflow-state.json ${phaseName} must remain undispatched after the terminal phase`);
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
  const terminalFailureKind = targetState[terminalPhase]?.failure?.kind ?? null;
  return { terminalDecision: decision, terminalPhase, terminalFailureKind, validatedPhases };
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
  const targetState = workflowState.targets?.[state.target];
  if (!targetState || targetState.lifecycle !== decision) {
    throw new Error(`closeout requires terminal target truth for ${state.target}`);
  }
  return { workflowState, targetState, decision };
}

function closeoutPhaseNames(targetState, decision) {
  if (decision === "completed") {
    if (UNIT_PHASES.some((phaseName) => targetState[phaseName]?.lifecycle !== "completed")) {
      throw new Error("completed closeout requires all Unit phases completed");
    }
    return [...UNIT_PHASES];
  }
  if (decision === "blocked"
      && UNIT_PHASES.every((phaseName) => targetState[phaseName]?.lifecycle === "completed")
      && targetState.reviewer?.resultStatus === "blocked") {
    return [...UNIT_PHASES];
  }

  const terminalLifecycle = decision === "failed" ? "failed" : "stopped";
  const terminalIndexes = UNIT_PHASES
    .map((phaseName, index) => targetState[phaseName]?.lifecycle === terminalLifecycle ? index : -1)
    .filter((index) => index >= 0);
  if (terminalIndexes.length !== 1) throw new Error("closeout requires exactly one terminal Unit phase");
  const terminalIndex = terminalIndexes[0];
  for (const [index, phaseName] of UNIT_PHASES.entries()) {
    const phase = targetState[phaseName];
    if (index < terminalIndex && phase?.lifecycle !== "completed") {
      throw new Error(`${phaseName} must be completed before terminal closeout`);
    }
    if (index > terminalIndex && (phase?.lifecycle !== "pending" || phase?.dispatchCount !== 0)) {
      throw new Error(`${phaseName} must remain undispatched after terminal closeout`);
    }
  }
  return UNIT_PHASES.slice(0, terminalIndex + 1);
}

function opCloseout(args) {
  if (!args.path) throw new Error("closeout requires --path");
  const state = readState(args.path);
  const { workflowState, targetState, decision } = readTerminalWorkflowState(args.path, state);
  const closedPhases = closeoutPhaseNames(targetState, decision);

  for (const phaseName of closedPhases) {
    const workflowPhase = targetState[phaseName];
    const boundary = workflowPhase?.completedAt;
    if (!isIsoTimestamp(boundary)) throw new Error(`${phaseName} workflow phase completedAt is required`);
    const phase = state.phases?.[phaseName];
    if (!phase || !Array.isArray(phase.assignments) || phase.assignments.length === 0) {
      throw new Error(`${phaseName} run-state assignment is required for closeout`);
    }
    for (const assignment of phase.assignments) {
      if (!isIsoTimestamp(assignment.completedAt)) {
        throw new Error(`${phaseName} assignment completedAt must be recorded before closeout`);
      }
      if (Date.parse(assignment.completedAt) > Date.parse(boundary)) {
        throw new Error(`${phaseName} assignment completedAt exceeds workflow phase boundary`);
      }
    }
    phase.completedAt = boundary;
    const issued = phase.assignments.map((assignment) => Date.parse(assignment.dispatchIssuedAt));
    if (issued.some(Number.isNaN)) throw new Error(`${phaseName} dispatchIssuedAt is required for closeout`);
    state.phaseDurations ??= {};
    state.phaseDurations[phaseName] = {
      durationMs: Date.parse(boundary) - Math.min(...issued),
      source: "run-state",
    };
    if (state.phaseDurations[phaseName].durationMs < 0) {
      throw new Error(`${phaseName} closeout boundary precedes dispatch`);
    }
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
  delete state.profilingSummary;
  writeState(args.path, state);
  return state;
}

function opFinalize(args) {
  if (!args.path) throw new Error("finalize requires --path");
  const state = readState(args.path);
  if (state.workflow !== "unit") throw new Error("finalize operation is currently defined for Unit workflow only");
  const errors = [];
  const earlyTerminal = readUnitEarlyTerminalProjection(args.path, state, UNIT_PHASES, errors);
  const hasMissingPhase = UNIT_PHASES.some((phaseName) => {
    const phase = state.phases?.[phaseName];
    return !phase || !Array.isArray(phase.assignments) || phase.assignments.length === 0;
  });
  if (errors.length > 0) {
    throw new Error(`profiling finalize failed:\n- ${errors.join("\n- ")}`);
  }
  if (hasMissingPhase && !earlyTerminal) {
    throw new Error("profiling finalize requires all Unit phases or valid early-terminal workflow truth");
  }
  const phasesToProfile = earlyTerminal?.validatedPhases ?? UNIT_PHASES;
  const profilingSummary = buildUnitProfilingSummary(state, phasesToProfile, earlyTerminal);
  if (!profilingSummary) throw new Error("profiling finalize requires observable phase duration truth");
  state.profilingSummary = profilingSummary;
  writeState(args.path, state);
  return state;
}

function opValidate(args) {
  if (!args.path) throw new Error("validate requires --path");
  const state = readState(args.path);
  const errors = [];
  let timingComplete = true;
  const requiredPhases = UNIT_PHASES;
  const earlyTerminal = readUnitEarlyTerminalProjection(args.path, state, requiredPhases, errors);
  const phasesToValidate = earlyTerminal?.validatedPhases ?? requiredPhases;

  if (!state.workflow) errors.push("missing workflow");
  if (!state.target) errors.push("missing target");
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
        const terminalNullIsExplained = earlyTerminal?.terminalPhase === phaseName
          && typeof earlyTerminal.terminalFailureKind === "string"
          && earlyTerminal.terminalFailureKind.trim() !== "";
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
    if (state.workflow === "unit") {
      const expectedProfiling = buildUnitProfilingSummary(state, phasesToValidate, earlyTerminal);
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
    ...(earlyTerminal ? earlyTerminal : { validatedPhases: requiredPhases }),
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
  switch (op) {
    case "init": opInit(args); break;
    case "set": opSet(args); break;
    case "append": opAppend(args); break;
    case "redispatch": opRedispatch(args); break;
    case "closeout": opCloseout(args); break;
    case "finalize": opFinalize(args); break;
    case "validate": opValidate(args); break;
    default: throw new Error(`Unknown op: ${op}. Expected init|set|append|redispatch|closeout|finalize|validate|now.`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`run-state.mjs error: ${err.message}\n`);
  process.exit(1);
}
