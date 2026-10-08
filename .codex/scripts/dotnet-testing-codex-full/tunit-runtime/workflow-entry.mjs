#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertObserverStopped, validateWorkspace } from "./usage-observer.mjs";

const PHASES = ["analyzer", "writer", "executor", "reviewer"];
const runtimeRoot = path.dirname(fileURLToPath(import.meta.url));
const runStateRuntime = path.join(runtimeRoot, "run-state.mjs");
const renderer = path.join(runtimeRoot, "workflow-result.mjs");

function parseArgs(argv) {
  const result = { inspect: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--run-state") result.runState = path.resolve(argv[++index]);
    else if (argument === "--workspace-root") result.workspaceRoot = argv[++index];
    else if (argument === "--inspect") result.inspect = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  return result;
}

function usage() {
  return "Usage: node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/workflow-entry.mjs --run-state <run-state.json> [--workspace-root <absolute-workspace>] [--inspect]";
}

function isIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function readState(runState) {
  try {
    return JSON.parse(fs.readFileSync(runState, "utf8"));
  } catch (error) {
    throw new Error(`run-state is unreadable or invalid JSON: ${error.message}`);
  }
}

export function classifyTunitEntryState(runState) {
  if (!fs.existsSync(runState)) {
    return { status: "fresh", action: "continue-phase-0", runState };
  }
  const state = readState(runState);
  if (state.workflow !== "tunit") {
    return {
      status: "unsafe-existing-run-state",
      action: "stop-without-cleanup",
      reason: "workflow-mismatch",
      runState,
    };
  }
  if (state.terminalCloseout !== undefined) {
    return {
      status: state.presentation?.status === "completed"
        ? "terminal-existing"
        : "terminal-presentation-incomplete",
      action: "stop-without-cleanup",
      terminalDecision: state.terminalDecision ?? null,
      runState,
    };
  }

  const presentPhases = PHASES.filter((phaseName) => {
    const assignments = state.phases?.[phaseName]?.assignments;
    return Array.isArray(assignments) && assignments.length > 0;
  });
  const phase = presentPhases.at(-1);
  if (!phase) {
    return {
      status: "unsafe-existing-run-state",
      action: "stop-without-cleanup",
      reason: "no-dispatched-phase",
      runState,
    };
  }
  const assignments = state.phases[phase].assignments;
  const incomplete = assignments.filter((assignment) => !isIsoTimestamp(assignment?.completedAt));
  const recoverable = incomplete.filter((assignment) => (
    typeof assignment?.assignmentId === "string"
      && assignment.assignmentId.trim() !== ""
      && isIsoTimestamp(assignment.dispatchIssuedAt)
      && isIsoTimestamp(assignment.dispatchAcceptedAt)
      && !isIsoTimestamp(assignment.artifactReadyAt)
      && (assignment.artifact === undefined || assignment.artifact === null)
  ));
  if (incomplete.length > 0 && recoverable.length === incomplete.length) {
    return {
      status: "interrupted-recovery-required",
      action: "recover-and-stop",
      phase,
      assignmentIds: recoverable.map((assignment) => assignment.assignmentId),
      runState,
    };
  }
  return {
    status: "unsafe-existing-run-state",
    action: "stop-without-cleanup",
    reason: "incomplete-assignment-is-not-recoverable",
    phase,
    assignmentIds: incomplete.map((assignment) => assignment?.assignmentId ?? null),
    runState,
  };
}

function invoke(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}

function requireSuccess(result, label) {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
    throw new Error(`${label} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function recover(entry, workspaceRoot) {
  const runState = entry.runState;
  requireSuccess(invoke(runStateRuntime, ["recover-interrupted", "--path", runState]), "TUnit interrupted recovery");
  requireSuccess(invoke(runStateRuntime, [
    "validate", "--path", runState, "--require-complete-timing",
  ]), "pre-render TUnit terminal validation");
  const phaseResult = requireSuccess(invoke(renderer, [
    "phase", "--run-state", runState, "--phase", entry.phase,
  ]), "TUnit interrupted phase renderer");
  const outputRoot = path.join(path.dirname(runState), "workflow-result");
  const finalResult = requireSuccess(invoke(renderer, [
    "final",
    ...(workspaceRoot ? ["--workspace-root", workspaceRoot] : []),
    "--run-state", runState,
    "--json-output", path.join(outputRoot, "tunit-workflow-result.json"),
    "--markdown-output", path.join(outputRoot, "tunit-workflow-result.md"),
  ]), "TUnit interrupted final renderer");
  requireSuccess(invoke(runStateRuntime, [
    "validate", "--path", runState, "--require-complete-timing", "--require-presentation",
  ]), "post-render TUnit terminal validation");
  process.stdout.write(phaseResult.stdout);
  process.stdout.write(finalResult.stdout);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (typeof args.runState !== "string" || args.runState.trim() === "") {
    throw new Error("--run-state is required");
  }
  if (args.workspaceRoot) validateWorkspace({ workspaceRoot: args.workspaceRoot, runStatePath: args.runState });
  const entry = classifyTunitEntryState(args.runState);
  if (!args.inspect && entry.status === "fresh") assertObserverStopped(path.dirname(args.runState));
  if (args.inspect || entry.status === "fresh" || entry.status === "terminal-existing") {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
    return;
  }
  if (entry.status === "interrupted-recovery-required") {
    recover(entry, args.workspaceRoot);
    return;
  }
  throw new Error(`${entry.status}: ${entry.reason ?? "existing run-state must be preserved for diagnosis"}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`TUnit workflow entry error: ${error.message}\n${usage()}\n`);
  process.exitCode = 1;
}
