#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ESTIMATOR_NAME = "visible-context-token-estimator";
const ESTIMATOR_VERSION = 2;
const ESTIMATE_METHOD = "chars-heuristic";
const CHARS_PER_TOKEN = 3.6;
const OVERHEAD_FACTORS = {
  analyzer: 1.15,
  writer: 1.2,
  executor: 1.25,
  reviewer: 1.2,
};
const KNOWN_MISSING = [
  "Codex runtime hidden framing",
  "internal reasoning tokens",
  "cached input token accounting",
  "actual provider billing usage",
  "chars-heuristic（非真實 BPE，粗估；中文等非拉丁文字偏差較大）",
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--test-project") {
      args.testProject = argv[++i];
    } else if (arg === "--workspace-root") {
      args.workspaceRoot = argv[++i];
    } else if (arg === "--workflow") {
      args.workflow = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage: node .codex/scripts/estimate-token-usage.mjs --test-project <path> [--workspace-root <path>] [--workflow <label>]",
    "",
    "Writes <test-project-dir>/.orchestrator/token-usage-estimate.json.",
    "",
    "--workflow is an optional output label fallback only; estimator behavior is driven by run-state and artifact metadata.",
  ].join("\n");
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readTextIfFile(p) {
  if (!p || !isFile(p)) {
    return null;
  }
  return fs.readFileSync(p, "utf8");
}

function readJsonIfFile(p) {
  const text = readTextIfFile(p);
  if (text === null) {
    return null;
  }
  return JSON.parse(text);
}

function normalizeSlashes(value) {
  return value.replaceAll("\\", "/");
}

function resolvePath(workspaceRoot, testProjectDir, value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const raw = value.trim();
  if (raw.length === 0) {
    return null;
  }
  if (path.isAbsolute(raw)) {
    return path.normalize(raw);
  }
  const fromWorkspace = path.resolve(workspaceRoot, raw);
  if (isFile(fromWorkspace) || isDirectory(fromWorkspace)) {
    return fromWorkspace;
  }
  return path.resolve(testProjectDir, raw);
}

function tokenEstimateFromChars(text) {
  return Math.ceil([...text].length / CHARS_PER_TOKEN);
}

// 自含估算:刻意不依賴任何外部 tokenizer 套件（gpt-tokenizer / tiktoken 等）。
// 估算定位為「相對成本比較的 optional telemetry、非 billing」,以 chars/CHARS_PER_TOKEN 粗估
// visible-context token 即可;零相依,隨 .codex/ 出貨,node 直接執行,無 npm install。
function makeCounter() {
  return { count: tokenEstimateFromChars };
}

function safeStringify(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function countText(tokenizer, text) {
  if (!text) {
    return 0;
  }
  return tokenizer.count(text);
}

function countFile(tokenizer, filePath) {
  const text = readTextIfFile(filePath);
  if (text === null) {
    return { tokens: 0, status: "missing" };
  }
  return { tokens: countText(tokenizer, text), status: "counted" };
}

function relativeOrNull(workspaceRoot, filePath) {
  if (!filePath) {
    return null;
  }
  return normalizeSlashes(path.relative(workspaceRoot, filePath) || filePath);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function phaseEntries(runState) {
  // run-state phase keys may be capitalized (integration: "Analyzer"/"Writer"/…)
  // or lowercase (unit/tunit: "analyzer"/…). Normalize to lowercase so this shared
  // estimator extracts assignments regardless of the workflow's casing convention.
  const rawPhases = runState?.phases ?? {};
  const phases = {};
  for (const [key, value] of Object.entries(rawPhases)) {
    phases[String(key).toLowerCase()] = value;
  }
  const entries = [];
  for (const phaseName of ["analyzer", "writer", "executor", "reviewer"]) {
    const phase = phases[phaseName];
    if (!phase) {
      entries.push([phaseName, []]);
      continue;
    }
    if (Array.isArray(phase.assignments)) {
      entries.push([phaseName, phase.assignments]);
      continue;
    }
    if (Array.isArray(phase)) {
      entries.push([phaseName, phase]);
      continue;
    }
    entries.push([phaseName, [phase]]);
  }
  return entries;
}

function workflowLabelFor(runState, explicitWorkflow) {
  return runState?.workflow ?? runState?.workflowKind ?? explicitWorkflow ?? "unknown";
}

function looksLikeAgentDefinitionPath(value) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = normalizeSlashes(value.trim());
  return normalized.endsWith(".toml") && normalized.includes(".codex/agents/");
}

function agentDefinitionPathFor(workspaceRoot, testProjectDir, assignment) {
  const candidates = [
    assignment?.agentDefinitionPath,
    assignment?.agentPath,
    assignment?.spawnTarget,
    assignment?.agent?.definitionPath,
    assignment?.agent?.path,
    assignment?.target,
  ];
  for (const candidate of candidates) {
    if (looksLikeAgentDefinitionPath(candidate)) {
      return resolvePath(workspaceRoot, testProjectDir, candidate);
    }
  }
  return null;
}

function collectTokenEstimateInputs(artifactJson) {
  const input = artifactJson?.tokenEstimateInputs;
  if (!input || typeof input !== "object") {
    return null;
  }
  return {
    readFiles: asArray(input.readFiles),
    writtenFiles: asArray(input.writtenFiles),
    toolOutputRefs: asArray(input.toolOutputRefs),
    schemaVersion: input.schemaVersion,
    estimateKind: input.estimateKind,
    notes: asArray(input.notes),
  };
}

function getNestedField(value, dottedPath) {
  if (!dottedPath || typeof dottedPath !== "string") {
    return undefined;
  }
  return dottedPath.split(".").reduce((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return current[segment];
    }
    return undefined;
  }, value);
}

function fallbackFilesForArtifact(artifactJson, artifactPath) {
  const files = [];
  if (artifactPath) {
    files.push({ path: artifactPath, reason: "handoff artifact fallback" });
  }
  for (const key of ["testFilePaths", "generatedFiles", "modifiedFiles"]) {
    for (const filePath of asArray(artifactJson?.[key])) {
      files.push({ path: filePath, reason: `${key} fallback` });
    }
  }
  for (const testClass of asArray(artifactJson?.testClasses)) {
    if (testClass?.filePath) {
      files.push({ path: testClass.filePath, reason: "testClasses[].filePath fallback" });
    }
  }
  return files;
}

function countFileRefs(tokenizer, workspaceRoot, testProjectDir, refs) {
  let total = 0;
  const details = [];
  for (const ref of refs) {
    const value = typeof ref === "string" ? ref : ref?.path;
    const resolved = resolvePath(workspaceRoot, testProjectDir, value);
    if (!resolved) {
      details.push({ path: value ?? null, tokens: 0, status: "invalid" });
      continue;
    }
    const result = countFile(tokenizer, resolved);
    total += result.tokens;
    details.push({
      path: normalizeSlashes(path.relative(workspaceRoot, resolved) || resolved),
      reason: typeof ref === "string" ? undefined : ref?.reason,
      tokens: result.tokens,
      status: result.status,
    });
  }
  return { total, details };
}

function countToolOutputRefs(tokenizer, artifactJson, refs) {
  let total = 0;
  const details = [];
  for (const ref of refs) {
    const value = getNestedField(artifactJson, ref?.sourceField);
    const text = safeStringify(value);
    const tokens = countText(tokenizer, text);
    total += tokens;
    details.push({
      kind: ref?.kind ?? "tool-output",
      sourceField: ref?.sourceField ?? null,
      tokens,
      status: text ? "counted" : "missing",
    });
  }
  return { total, details };
}

function assignmentIdFor(phase, assignment, index) {
  return assignment?.assignmentId ?? assignment?.id ?? assignment?.target ?? `${phase}:${index + 1}`;
}

function artifactPathFor(workspaceRoot, testProjectDir, assignment) {
  const candidates = [
    assignment?.artifact,
    assignment?.artifactPath,
    assignment?.expectedArtifactPath,
    assignment?.analysisFilePath,
    assignment?.writerResultFilePath,
    assignment?.executorResultFilePath,
    assignment?.reviewResultFilePath,
  ];
  for (const candidate of candidates) {
    const resolved = resolvePath(workspaceRoot, testProjectDir, candidate);
    if (resolved && isFile(resolved)) {
      return resolved;
    }
  }
  return resolvePath(workspaceRoot, testProjectDir, candidates.find(Boolean));
}

function confidenceFor({ inputs, missingFileCount, artifactJson }) {
  // chars 粗估:信心上限即 medium（永不 high）。資料完整 → medium，否則 low。
  if (!artifactJson) {
    return "unavailable";
  }
  if (inputs && missingFileCount === 0 && asArray(inputs.readFiles).length > 0 && asArray(inputs.writtenFiles).length > 0) {
    return "medium";
  }
  return "low";
}

function confidenceRank(value) {
  return { high: 3, medium: 2, low: 1, unavailable: 0 }[value] ?? 0;
}

function aggregateConfidence(values) {
  if (values.length === 0) {
    return "unavailable";
  }
  const min = Math.min(...values.map(confidenceRank));
  return Object.entries({ high: 3, medium: 2, low: 1, unavailable: 0 })
    .find(([, rank]) => rank === min)?.[0] ?? "unavailable";
}

async function buildEstimate({ workspaceRoot, testProjectArg, explicitWorkflow }) {
  const tokenizer = makeCounter();
  const testProjectPath = path.resolve(workspaceRoot, testProjectArg);
  const testProjectDir = isDirectory(testProjectPath) ? testProjectPath : path.dirname(testProjectPath);
  const orchestratorDir = path.join(testProjectDir, ".orchestrator");
  const outputPath = path.join(orchestratorDir, "token-usage-estimate.json");
  fs.mkdirSync(orchestratorDir, { recursive: true });

  const runStatePath = path.join(orchestratorDir, "run-state.json");
  const runState = readJsonIfFile(runStatePath);
  if (!runState) {
    return {
      outputPath,
      estimate: unavailableEstimate({
        workspaceRoot,
        runStatePath,
        reason: "run-state.json not found or unreadable",
        tokenizer,
        workflow: explicitWorkflow,
      }),
    };
  }

  const workflow = workflowLabelFor(runState, explicitWorkflow);
  const phases = {};
  const confidenceValues = [];
  let inputTotal = 0;
  let outputTotal = 0;
  let visibleTotal = 0;
  let highRangeTotal = 0;

  for (const [phaseName, assignments] of phaseEntries(runState)) {
    phases[phaseName] = { assignments: [] };
    // Dedupe shared artifacts within a phase. A two-step Writer (and any phase that
    // dispatches multiple assignments sharing one merged handoff artifact) otherwise
    // counts the same readFiles/writtenFiles/artifact tokens once per assignment,
    // over-counting the phase ~Nx. Count the artifact-derived tokens once per unique
    // artifactPath; each assignment still counts its own agentToml + payload.
    const seenArtifacts = new Set();
    for (const [index, assignment] of assignments.entries()) {
      const artifactPath = artifactPathFor(workspaceRoot, testProjectDir, assignment);
      const artifactJson = artifactPath && isFile(artifactPath) ? readJsonIfFile(artifactPath) : null;
      const inputs = collectTokenEstimateInputs(artifactJson);
      const agentPath = agentDefinitionPathFor(workspaceRoot, testProjectDir, assignment);
      const agentToml = countFile(tokenizer, agentPath);
      const payloadTokens = countText(tokenizer, safeStringify(assignment?.spawnPayloadShape ?? assignment?.payloadShape ?? assignment?.payload));
      const readRefs = inputs?.readFiles ?? [];
      const writeRefs = inputs?.writtenFiles ?? fallbackFilesForArtifact(artifactJson, artifactPath);
      const artifactKey = artifactPath && isFile(artifactPath) ? normalizeSlashes(artifactPath) : null;
      const sharedArtifactDeduped = artifactKey !== null && seenArtifacts.has(artifactKey);
      if (artifactKey !== null) {
        seenArtifacts.add(artifactKey);
      }
      const dedupeCounts = (counts) => ({
        total: 0,
        details: counts.details.map((item) => ({ ...item, tokens: 0, status: "deduped-shared-artifact" })),
      });
      const readCountsRaw = countFileRefs(tokenizer, workspaceRoot, testProjectDir, readRefs);
      const writeCountsRaw = countFileRefs(tokenizer, workspaceRoot, testProjectDir, writeRefs);
      const toolOutputRaw = countToolOutputRefs(tokenizer, artifactJson, inputs?.toolOutputRefs ?? []);
      const readCounts = sharedArtifactDeduped ? dedupeCounts(readCountsRaw) : readCountsRaw;
      const writeCounts = sharedArtifactDeduped ? dedupeCounts(writeCountsRaw) : writeCountsRaw;
      const toolOutput = sharedArtifactDeduped ? dedupeCounts(toolOutputRaw) : toolOutputRaw;
      const skillTokens = readCounts.details
        .filter((item) => item.path?.includes(".codex/skills/"))
        .reduce((sum, item) => sum + item.tokens, 0);
      const nonSkillReadTokens = readCounts.total - skillTokens;
      const artifactTokens = sharedArtifactDeduped
        ? 0
        : (artifactPath && isFile(artifactPath) ? countFile(tokenizer, artifactPath).tokens : 0);
      const missingFileCount = [...readCounts.details, ...writeCounts.details, { status: agentToml.status }]
        .filter((item) => item.status !== "counted" && item.status !== "deduped-shared-artifact").length;
      const inputSubtotal = payloadTokens + agentToml.tokens + nonSkillReadTokens + skillTokens + toolOutput.total;
      const outputSubtotal = writeCounts.total + artifactTokens;
      const totalEstimated = inputSubtotal + outputSubtotal;
      const confidence = confidenceFor({
        inputs,
        missingFileCount,
        artifactJson,
      });
      const overhead = OVERHEAD_FACTORS[phaseName] ?? 1.2;

      inputTotal += inputSubtotal;
      outputTotal += outputSubtotal;
      visibleTotal += totalEstimated;
      highRangeTotal += Math.ceil(totalEstimated * overhead);
      confidenceValues.push(confidence);

      phases[phaseName].assignments.push({
        assignmentId: assignmentIdFor(phaseName, assignment, index),
        agentId: assignment?.agentId ?? null,
        target: assignment?.target ?? null,
        artifactPath: artifactPath ? normalizeSlashes(path.relative(workspaceRoot, artifactPath) || artifactPath) : null,
        inputEstimate: {
          orchestratorPayloadTokens: payloadTokens,
          agentTomlTokens: agentToml.tokens,
          readFileTokens: nonSkillReadTokens,
          skillTokens,
          toolOutputTokens: toolOutput.total,
          subtotal: inputSubtotal,
        },
        outputEstimate: {
          writtenFileTokens: writeCounts.total,
          artifactTokens,
          summaryTokens: 0,
          subtotal: outputSubtotal,
        },
        totalEstimatedTokens: totalEstimated,
        range: {
          low: totalEstimated,
          high: Math.ceil(totalEstimated * overhead),
        },
        confidence,
        tokenEstimateInputsStatus: inputs ? "provided" : "artifact-fallback",
        sharedArtifactDeduped,
        method: ESTIMATE_METHOD,
        countedFiles: {
          agentToml: {
            path: relativeOrNull(workspaceRoot, agentPath),
            tokens: agentToml.tokens,
            status: agentToml.status,
          },
          readFiles: readCounts.details,
          writtenFiles: writeCounts.details,
          toolOutputRefs: toolOutput.details,
        },
        knownMissing: [
          "Codex runtime hidden framing",
          "internal reasoning tokens",
          "tool-call serialization overhead",
        ],
      });
    }
  }

  return {
    outputPath,
    estimate: {
      schemaVersion: 1,
      runStatePath: normalizeSlashes(path.relative(workspaceRoot, runStatePath) || runStatePath),
      estimateGeneratedAt: new Date().toISOString(),
      estimator: {
        name: ESTIMATOR_NAME,
        version: ESTIMATOR_VERSION,
        method: ESTIMATE_METHOD,
        charsPerToken: CHARS_PER_TOKEN,
      },
      workflow,
      summary: {
        estimateKind: visibleTotal > 0 ? "estimated" : "unavailable",
        inputTokensEstimated: inputTotal,
        outputTokensEstimated: outputTotal,
        totalTokensEstimated: visibleTotal,
        range: {
          low: visibleTotal,
          high: highRangeTotal,
        },
        confidence: aggregateConfidence(confidenceValues),
      },
      phases,
      knownMissing: KNOWN_MISSING,
    },
  };
}

function unavailableEstimate({ workspaceRoot, runStatePath, reason, tokenizer, workflow }) {
  return {
    schemaVersion: 1,
    runStatePath: normalizeSlashes(path.relative(workspaceRoot, runStatePath) || runStatePath),
    estimateGeneratedAt: new Date().toISOString(),
    estimator: {
      name: ESTIMATOR_NAME,
      version: ESTIMATOR_VERSION,
      method: ESTIMATE_METHOD,
      charsPerToken: CHARS_PER_TOKEN,
    },
    workflow: workflow ?? "unknown",
    summary: {
      estimateKind: "unavailable",
      inputTokensEstimated: 0,
      outputTokensEstimated: 0,
      totalTokensEstimated: 0,
      range: { low: 0, high: 0 },
      confidence: "unavailable",
      reason,
    },
    phases: {},
    knownMissing: KNOWN_MISSING,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.testProject) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }
  const workspaceRoot = path.resolve(args.workspaceRoot ?? process.cwd());
  const { outputPath, estimate } = await buildEstimate({
    workspaceRoot,
    testProjectArg: args.testProject,
    explicitWorkflow: args.workflow,
  });
  fs.writeFileSync(outputPath, `${JSON.stringify(estimate, null, 2)}\n`, "utf8");
  console.log(normalizeSlashes(path.relative(workspaceRoot, outputPath) || outputPath));
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
