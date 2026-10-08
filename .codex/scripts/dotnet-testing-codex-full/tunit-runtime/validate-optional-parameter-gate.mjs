#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateWorkspace } from "./usage-observer.mjs";

const runtimeRoot = path.dirname(fileURLToPath(import.meta.url));
const validatorPath = path.join(runtimeRoot, "validate-optional-parameter-contract.mjs");
const runStatePath = path.join(runtimeRoot, "run-state.mjs");
const rendererPath = path.join(runtimeRoot, "workflow-result.mjs");

function parseArgs(argv) {
  const result = { writers: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--analysis") result.analysis = argv[++index];
    else if (arg === "--writer") result.writers.push(argv[++index]);
    else if (arg === "--run-state") result.runState = argv[++index];
    else if (arg === "--phase") result.phase = argv[++index];
    else if (arg === "--assignment") result.assignment = argv[++index];
    else if (arg === "--workspace-root") result.workspaceRoot = argv[++index];
    else if (arg === "--help" || arg === "-h") result.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function usage() {
  return "Usage: node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-optional-parameter-gate.mjs --analysis <analysis.json> [--writer <writer-result.json> ...] --run-state <run-state.json> --phase <analyzer|writer> --assignment <assignment-id> [--workspace-root <absolute-workspace>]";
}

function invoke(scriptPath, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
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

function failureMessage(result) {
  const raw = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) return parsed.errors.join("; ");
  } catch {
    // Preserve the validator's original diagnostic when it is not JSON.
  }
  return raw || "TUnit optional-parameter contract rejected the canonical artifact.";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  for (const field of ["analysis", "runState", "phase", "assignment"]) {
    if (typeof args[field] !== "string" || args[field].trim() === "") {
      throw new Error(`--${field.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} is required`);
    }
  }
  if (!new Set(["analyzer", "writer"]).has(args.phase)) {
    throw new Error("--phase must be analyzer or writer");
  }
  if (args.workspaceRoot) validateWorkspace({ workspaceRoot: args.workspaceRoot, runStatePath: path.resolve(args.runState) });

  const validatorArgs = ["--analysis", path.resolve(args.analysis)];
  for (const writer of args.writers) validatorArgs.push("--writer", path.resolve(writer));
  const validation = invoke(validatorPath, validatorArgs);
  if (validation.error) throw validation.error;
  if (validation.status === 0) {
    process.stdout.write(validation.stdout);
    return;
  }

  const runState = path.resolve(args.runState);
  const message = failureMessage(validation);
  requireSuccess(invoke(runStatePath, [
    "fail-gate",
    "--path", runState,
    "--phase", args.phase,
    "--assignment", args.assignment,
    "--gate", "optional-parameter",
    "--failure-message", message,
  ]), "deterministic TUnit gate closeout");
  requireSuccess(invoke(runStatePath, [
    "validate", "--path", runState, "--require-complete-timing",
  ]), "pre-render TUnit terminal validation");

  const phaseResult = requireSuccess(invoke(rendererPath, [
    "phase", "--run-state", runState, "--phase", args.phase,
  ]), "TUnit phase renderer");
  const workflowResultRoot = path.join(path.dirname(runState), "workflow-result");
  const finalResult = requireSuccess(invoke(rendererPath, [
    "final",
    ...(args.workspaceRoot ? ["--workspace-root", args.workspaceRoot] : []),
    "--run-state", runState,
    "--json-output", path.join(workflowResultRoot, "tunit-workflow-result.json"),
    "--markdown-output", path.join(workflowResultRoot, "tunit-workflow-result.md"),
  ]), "TUnit final renderer");
  requireSuccess(invoke(runStatePath, [
    "validate", "--path", runState, "--require-complete-timing", "--require-presentation",
  ]), "post-render TUnit terminal validation");

  process.stderr.write(`${validation.stderr || validation.stdout}`);
  process.stdout.write(phaseResult.stdout);
  process.stdout.write(finalResult.stdout);
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`TUnit optional-parameter gate error: ${error.message}\n${usage()}\n`);
  process.exitCode = 1;
}
