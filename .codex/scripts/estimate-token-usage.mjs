#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ESTIMATOR_NAME = "visible-context-token-estimator";
const ESTIMATOR_VERSION = 4;
const OUTPUT_SCHEMA_VERSION = 2;
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
    } else if (arg === "--orchestrator-contract") {
      args.orchestratorContract = argv[++i];
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
    "Usage: node .codex/scripts/estimate-token-usage.mjs --test-project <path> [--workspace-root <path>] [--workflow <label>] [--orchestrator-contract <path>]",
    "",
    "Writes <test-project-dir>/.orchestrator/token-usage-estimate.json.",
    "",
    "--workflow is an optional output label fallback only; estimator behavior is driven by run-state and artifact metadata.",
    "--orchestrator-contract optionally measures the main-thread orchestrator contract separately from the existing subagent total.",
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
  // Best-effort estimator: an artifact path may resolve to a non-JSON file (e.g. a
  // generated .cs handoff), or run-state.json may be malformed. A JSON.parse throw here
  // would crash the whole estimator and drop token telemetry. Degrade to null instead —
  // callers already handle null (raw artifact text is still counted via countFile).
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
  const assignmentsFor = (phase) => {
    if (!phase) {
      return [];
    }
    if (Array.isArray(phase.assignments)) {
      return [...phase.assignments];
    }
    if (Array.isArray(phase)) {
      return [...phase];
    }
    return [phase];
  };
  for (const phaseName of ["analyzer", "writer", "executor", "reviewer"]) {
    const phase = phases[phaseName];
    const assignments = assignmentsFor(phase);
    if (phaseName === "writer") {
      assignments.push(...assignmentsFor(phases.writerrepair));
    }
    entries.push([phaseName, assignments]);
  }
  return entries;
}

function detectOverwrittenWriterRepairArtifact(runState) {
  const rawPhases = runState?.phases ?? {};
  const phases = {};
  for (const [key, value] of Object.entries(rawPhases)) {
    phases[String(key).toLowerCase()] = value;
  }
  const writerAssignments = asArray(phases.writer?.assignments);
  const repairAssignments = asArray(phases.writerrepair?.assignments);
  if (writerAssignments.length === 0 || repairAssignments.length === 0) {
    return null;
  }

  const originalPaths = new Set(writerAssignments
    .map((assignment) => assignment?.expectedArtifactPath ?? assignment?.artifact)
    .filter(Boolean)
    .map(normalizeSlashes));
  const overwrittenPath = repairAssignments
    .map((assignment) => assignment?.expectedArtifactPath ?? assignment?.artifact)
    .filter(Boolean)
    .map(normalizeSlashes)
    .find((artifactPath) => originalPaths.has(artifactPath));

  return overwrittenPath ?? null;
}

function workflowLabelFor(runState, explicitWorkflow) {
  return runState?.workflow ?? runState?.workflowKind ?? explicitWorkflow ?? "unknown";
}

function orchestratorContractPathFor(workspaceRoot, testProjectDir, runState, explicitPath) {
  const candidates = [
    explicitPath,
    runState?.orchestratorDefinitionPath,
    runState?.orchestratorContractPath,
    runState?.orchestrator?.definitionPath,
    runState?.orchestrator?.contractPath,
  ];
  for (const candidate of candidates) {
    const resolved = resolvePath(workspaceRoot, testProjectDir, candidate);
    if (resolved && isFile(resolved)) {
      return {
        path: resolved,
        source: candidate === explicitPath ? "cli" : "run-state",
      };
    }
  }
  return { path: null, source: "unavailable" };
}

function makeFileReuseTracker() {
  const files = new Map();
  let skippedDedupedOccurrences = 0;
  const dedupedOccurrencesByReason = new Map();

  function record({ filePath, tokens, status, category, phase, assignmentId }) {
    if (typeof status === "string" && status.startsWith("deduped-")) {
      skippedDedupedOccurrences += 1;
      dedupedOccurrencesByReason.set(status, (dedupedOccurrencesByReason.get(status) ?? 0) + 1);
      return;
    }
    if (!filePath || status !== "counted" || tokens <= 0) {
      return;
    }
    const key = normalizeSlashes(filePath);
    const current = files.get(key) ?? {
      path: key,
      occurrences: 0,
      occurrenceTokensEstimated: 0,
      tokensPerOccurrenceEstimated: tokens,
      categories: new Set(),
      phases: new Set(),
      assignments: new Set(),
    };
    current.occurrences += 1;
    current.occurrenceTokensEstimated += tokens;
    current.tokensPerOccurrenceEstimated = Math.max(current.tokensPerOccurrenceEstimated, tokens);
    current.categories.add(category);
    current.phases.add(phase);
    current.assignments.add(assignmentId);
    files.set(key, current);
  }

  function summarize() {
    const details = [...files.values()]
      .map((item) => ({
        path: item.path,
        occurrences: item.occurrences,
        repeatedOccurrences: Math.max(0, item.occurrences - 1),
        tokensPerOccurrenceEstimated: item.tokensPerOccurrenceEstimated,
        uniqueTokensEstimated: item.tokensPerOccurrenceEstimated,
        repeatedTokensEstimated: Math.max(0, item.occurrenceTokensEstimated - item.tokensPerOccurrenceEstimated),
        occurrenceTokensEstimated: item.occurrenceTokensEstimated,
        categories: [...item.categories].sort(),
        phases: [...item.phases].sort(),
        assignments: [...item.assignments].sort(),
      }))
      .sort((left, right) => right.repeatedTokensEstimated - left.repeatedTokensEstimated || left.path.localeCompare(right.path));

    return {
      scope: "subagent-visible-file-occurrences",
      semantics: "Observation only. Repeated tokens are not deducted from summary totals and do not represent provider cache accounting.",
      countedOccurrences: details.reduce((sum, item) => sum + item.occurrences, 0),
      uniqueFiles: details.length,
      repeatedOccurrences: details.reduce((sum, item) => sum + item.repeatedOccurrences, 0),
      occurrenceTokensEstimated: details.reduce((sum, item) => sum + item.occurrenceTokensEstimated, 0),
      uniqueTokensEstimated: details.reduce((sum, item) => sum + item.uniqueTokensEstimated, 0),
      repeatedTokensEstimated: details.reduce((sum, item) => sum + item.repeatedTokensEstimated, 0),
      skippedDedupedOccurrences,
      dedupedOccurrencesByReason: Object.fromEntries([...dedupedOccurrencesByReason.entries()].sort()),
      files: details,
    };
  }

  return { record, summarize };
}

function dedupeOwnedFile(counts, ownedPath, status) {
  if (!ownedPath) {
    return { ...counts, dedupedTokensEstimated: 0 };
  }
  const normalizedOwnedPath = normalizeSlashes(ownedPath);
  let dedupedTokensEstimated = 0;
  const details = counts.details.map((item) => {
    if (item.status !== "counted" || normalizeSlashes(item.path ?? "") !== normalizedOwnedPath) {
      return item;
    }
    dedupedTokensEstimated += item.tokens;
    return {
      ...item,
      tokens: 0,
      status,
      dedupedTokensEstimated: item.tokens,
    };
  });
  return {
    total: counts.total - dedupedTokensEstimated,
    details,
    dedupedTokensEstimated,
  };
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

function buildOrchestratorContractEstimate({ tokenizer, workspaceRoot, testProjectDir, runState, explicitPath }) {
  const resolved = orchestratorContractPathFor(workspaceRoot, testProjectDir, runState, explicitPath);
  const count = countFile(tokenizer, resolved.path);
  return {
    estimateKind: count.status === "counted" ? "estimated" : "unavailable",
    path: relativeOrNull(workspaceRoot, resolved.path),
    source: resolved.source,
    tokensEstimated: count.tokens,
    status: count.status,
    includedInSubagentSummaryTotal: false,
    note: "Main-thread orchestrator contract only; excludes conversation, tool calls, hidden framing, reasoning, and other main-thread context.",
  };
}

async function buildEstimate({ workspaceRoot, testProjectArg, explicitWorkflow, explicitOrchestratorContract }) {
  const tokenizer = makeCounter();
  const testProjectPath = path.resolve(workspaceRoot, testProjectArg);
  const testProjectDir = isDirectory(testProjectPath) ? testProjectPath : path.dirname(testProjectPath);
  const orchestratorDir = path.join(testProjectDir, ".orchestrator");
  const outputPath = path.join(orchestratorDir, "token-usage-estimate.json");
  fs.mkdirSync(orchestratorDir, { recursive: true });

  const runStatePath = path.join(orchestratorDir, "run-state.json");
  const runState = readJsonIfFile(runStatePath);
  const orchestratorContractEstimate = buildOrchestratorContractEstimate({
    tokenizer,
    workspaceRoot,
    testProjectDir,
    runState,
    explicitPath: explicitOrchestratorContract,
  });
  if (!runState) {
    return {
      outputPath,
      estimate: unavailableEstimate({
        workspaceRoot,
        runStatePath,
        reason: "run-state.json not found or unreadable",
        tokenizer,
        workflow: explicitWorkflow,
        orchestratorContractEstimate,
      }),
    };
  }

  const overwrittenWriterArtifact = detectOverwrittenWriterRepairArtifact(runState);
  if (overwrittenWriterArtifact) {
    return {
      outputPath,
      estimate: unavailableEstimate({
        workspaceRoot,
        runStatePath,
        reason: `writer repair overwrote original tokenEstimateInputs: ${overwrittenWriterArtifact}`,
        tokenizer,
        workflow: workflowLabelFor(runState, explicitWorkflow),
        orchestratorContractEstimate,
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
  const fileReuseTracker = makeFileReuseTracker();

  for (const [phaseName, assignments] of phaseEntries(runState)) {
    phases[phaseName] = { assignments: [] };
    // Dedupe shared artifacts within a phase. A two-step Writer (and any phase that
    // dispatches multiple assignments sharing one merged handoff artifact) otherwise
    // counts the same readFiles/writtenFiles/artifact tokens once per assignment,
    // over-counting the phase ~Nx. Count the artifact-derived tokens once per unique
    // artifactPath; each assignment still counts its own agentToml + payload.
    const seenArtifacts = new Set();
    for (const [index, assignment] of assignments.entries()) {
      const assignmentId = assignmentIdFor(phaseName, assignment, index);
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
        details: counts.details.map((item) => ({
          ...item,
          dedupedTokensEstimated: item.tokens,
          tokens: 0,
          status: "deduped-shared-artifact",
        })),
        dedupedTokensEstimated: counts.total,
      });
      const readCountsRaw = countFileRefs(tokenizer, workspaceRoot, testProjectDir, readRefs);
      const writeCountsRaw = countFileRefs(tokenizer, workspaceRoot, testProjectDir, writeRefs);
      const toolOutputRaw = countToolOutputRefs(tokenizer, artifactJson, inputs?.toolOutputRefs ?? []);
      const sharedReadCounts = sharedArtifactDeduped ? dedupeCounts(readCountsRaw) : readCountsRaw;
      const sharedWriteCounts = sharedArtifactDeduped ? dedupeCounts(writeCountsRaw) : writeCountsRaw;
      const readCounts = dedupeOwnedFile(
        sharedReadCounts,
        relativeOrNull(workspaceRoot, agentPath),
        "deduped-contract-owned",
      );
      const writeCounts = dedupeOwnedFile(
        sharedWriteCounts,
        artifactPath ? relativeOrNull(workspaceRoot, artifactPath) : null,
        "deduped-canonical-artifact",
      );
      const toolOutput = sharedArtifactDeduped ? dedupeCounts(toolOutputRaw) : toolOutputRaw;
      const skillTokens = readCounts.details
        .filter((item) => item.path?.includes(".codex/skills/"))
        .reduce((sum, item) => sum + item.tokens, 0);
      const nonSkillReadTokens = readCounts.total - skillTokens;
      const artifactTokens = sharedArtifactDeduped
        ? 0
        : (artifactPath && isFile(artifactPath) ? countFile(tokenizer, artifactPath).tokens : 0);
      const missingFileCount = [...readCounts.details, ...writeCounts.details, { status: agentToml.status }]
        .filter((item) => item.status !== "counted" && !item.status?.startsWith("deduped-")).length;
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

      fileReuseTracker.record({
        filePath: relativeOrNull(workspaceRoot, agentPath),
        tokens: agentToml.tokens,
        status: agentToml.status,
        category: "agent-toml",
        phase: phaseName,
        assignmentId,
      });
      for (const item of readCounts.details) {
        fileReuseTracker.record({
          filePath: item.path,
          tokens: item.tokens,
          status: item.status,
          category: "read-file",
          phase: phaseName,
          assignmentId,
        });
      }
      for (const item of writeCounts.details) {
        fileReuseTracker.record({
          filePath: item.path,
          tokens: item.tokens,
          status: item.status,
          category: "written-file",
          phase: phaseName,
          assignmentId,
        });
      }
      fileReuseTracker.record({
        filePath: artifactPath ? relativeOrNull(workspaceRoot, artifactPath) : null,
        tokens: artifactTokens,
        status: sharedArtifactDeduped ? "deduped-shared-artifact" : (artifactPath && isFile(artifactPath) ? "counted" : "missing"),
        category: "handoff-artifact",
        phase: phaseName,
        assignmentId,
      });

      phases[phaseName].assignments.push({
        assignmentId,
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
        accountingDedupe: {
          agentDefinitionReadTokens: readCounts.dedupedTokensEstimated ?? 0,
          canonicalArtifactWriteTokens: writeCounts.dedupedTokensEstimated ?? 0,
          totalTokens: (readCounts.dedupedTokensEstimated ?? 0) + (writeCounts.dedupedTokensEstimated ?? 0),
        },
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
      schemaVersion: OUTPUT_SCHEMA_VERSION,
      schemaCompatibility: {
        minimumReaderVersion: 1,
        additiveOnlyFromVersion: 1,
      },
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
        measurementScope: "subagent-visible-context",
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
      orchestratorContractEstimate,
      observations: {
        fileReuse: fileReuseTracker.summarize(),
      },
      phases,
      knownMissing: KNOWN_MISSING,
    },
  };
}

function unavailableEstimate({ workspaceRoot, runStatePath, reason, tokenizer, workflow, orchestratorContractEstimate }) {
  return {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    schemaCompatibility: {
      minimumReaderVersion: 1,
      additiveOnlyFromVersion: 1,
    },
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
      measurementScope: "subagent-visible-context",
      estimateKind: "unavailable",
      inputTokensEstimated: 0,
      outputTokensEstimated: 0,
      totalTokensEstimated: 0,
      range: { low: 0, high: 0 },
      confidence: "unavailable",
      reason,
    },
    orchestratorContractEstimate,
    observations: {
      fileReuse: makeFileReuseTracker().summarize(),
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
    explicitOrchestratorContract: args.orchestratorContract,
  });
  fs.writeFileSync(outputPath, `${JSON.stringify(estimate, null, 2)}\n`, "utf8");
  console.log(normalizeSlashes(path.relative(workspaceRoot, outputPath) || outputPath));
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
