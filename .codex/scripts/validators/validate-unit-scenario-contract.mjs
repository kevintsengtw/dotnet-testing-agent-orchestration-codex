#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const validScenarioStatuses = new Set([
  "accepted",
  "accepted_with_normalization",
  "accepted_with_limitation",
  "merged",
  "rejected",
]);
const validRejectionCodes = new Set([
  "contradicts_implementation",
  "target_not_found",
  "out_of_scope",
  "not_unit_test",
  "unobservable_state",
  "conflicts_with_user_scenario",
]);
const effectiveStatuses = new Set([
  "accepted",
  "accepted_with_normalization",
  "accepted_with_limitation",
]);
const validDetectedFormats = new Set([
  "markdown",
  "json",
  "yaml",
  "table",
  "gherkin",
  "list",
  "free-text",
  "mixed",
]);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function readText(filePath) {
  return fs.readFileSync(path.resolve(filePath), "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function requireMarkers(filePath, markers) {
  const text = readText(filePath);
  for (const marker of markers) {
    if (!text.includes(marker)) {
      fail(`${filePath} missing required marker: ${marker}`);
    }
  }
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function sameStringSet(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function hasExplicitTestData(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && typeof value === "object" && Object.keys(value).length > 0;
}

// C# identifiers allow Unicode letters/letter-numbers or underscore first,
// followed by letters, decimal digits, connector punctuation, combining marks,
// and formatting characters. Scenario normalizedName is also the exact test
// method name, so punctuation such as decimal dots must be normalized upstream.
function isCSharpIdentifierCompatible(value) {
  return typeof value === "string"
    && /^(?:[_\p{L}\p{Nl}])(?:[_\p{L}\p{Nl}\p{Nd}\p{Pc}\p{Mn}\p{Mc}\p{Cf}])*$/u.test(value);
}

function normalizeBlock(value) {
  return typeof value === "string"
    ? value.replace(/\r\n?/g, "\n").trim()
    : "";
}

function normalizeAssert(value) {
  return normalizeBlock(value)
    .replace(/`/g, "")
    .replace(/[。；;]\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMarkdownScenarioBlocks(rawContent) {
  const lines = normalizeBlock(rawContent).split("\n");
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^- `[^`]+`\s*$/u.test(lines[index])) continue;
    if (!/^\s+- Priority：/u.test(lines[index + 1] ?? "")) continue;
    starts.push(index);
  }
  return starts.map((start, index) => {
    const nextStart = starts[index + 1] ?? lines.length;
    let end = nextStart;
    for (let cursor = start + 1; cursor < nextStart; cursor += 1) {
      if (/^##\s+/u.test(lines[cursor]) || /^`{3,}\s*$/u.test(lines[cursor])) {
        end = cursor;
        break;
      }
    }
    while (end > start && lines[end - 1].trim() === "") end -= 1;
    return lines.slice(start, end).join("\n").trim();
  });
}

function validateMarkdownScenarioIntegrity(analysis) {
  const input = analysis.userProvidedScenarioInput ?? {};
  if (input.present !== true || input.detectedFormat !== "markdown") return;

  const userItems = analysis.scenarioCatalog.filter((item) => item?.source === "user");
  const blocks = extractMarkdownScenarioBlocks(input.rawContent);
  if (blocks.length !== userItems.length) {
    fail(`markdown rawContent scenario blocks ${blocks.length} != user catalog ${userItems.length}`);
    return;
  }

  userItems.forEach((item, index) => {
    const expectedBlock = blocks[index];
    if (normalizeBlock(item.originalContent) !== expectedBlock) {
      fail(`${item.scenarioId}: originalContent does not exactly match its complete markdown scenario block`);
    }

    const assertLine = expectedBlock
      .split("\n")
      .find((line) => /^\s+- Assert：/u.test(line));
    if (!assertLine) return;
    const expectedAssert = assertLine.replace(/^\s+- Assert：/u, "");
    if (normalizeAssert(item.assert) !== normalizeAssert(expectedAssert)) {
      fail(`${item.scenarioId}: structured assert does not exactly preserve markdown Assert content`);
    }

    const quotedExpectedTokens = [...expectedAssert.matchAll(/`"([^"]+)"`/gu)].map((match) => match[1]);
    const serializedTestData = JSON.stringify(item.testData ?? {});
    for (const token of quotedExpectedTokens) {
      if (!serializedTestData.includes(token)) {
        fail(`${item.scenarioId}: testData does not preserve quoted expected token ${token}`);
      }
    }
  });
}

function parseArgs(argv) {
  const result = { workflow: "unit", analysis: "", writers: [], reviewer: "", requireReviewPass: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workflow") {
      result.workflow = argv[++index];
    } else if (arg === "--analysis") {
      result.analysis = argv[++index];
    } else if (arg === "--writer") {
      result.writers.push(argv[++index]);
    } else if (arg === "--reviewer") {
      result.reviewer = argv[++index];
    } else if (arg === "--require-review-pass") {
      result.requireReviewPass = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!new Set(["unit", "tunit"]).has(result.workflow)) {
    throw new Error(`--workflow must be unit or tunit, got: ${result.workflow}`);
  }
  return result;
}

function validateStaticContract(workflow) {
  const contracts = workflow === "tunit"
    ? {
        analyzer: ".codex/agents/dotnet-testing-advanced-tunit-analyzer.toml",
        writer: ".codex/agents/dotnet-testing-advanced-tunit-writer.toml",
        reviewer: ".codex/agents/dotnet-testing-advanced-tunit-reviewer.toml",
        orchestrator: ".codex/skills/dotnet-testing-orchestrator-tunit/SKILL.md",
      }
    : {
        analyzer: ".codex/agents/dotnet-testing-analyzer.toml",
        writer: ".codex/agents/dotnet-testing-writer.toml",
        reviewer: ".codex/agents/dotnet-testing-reviewer.toml",
        orchestrator: ".codex/skills/dotnet-testing-orchestrator-unit/SKILL.md",
      };

  requireMarkers(contracts.analyzer, [
    "userProvidedScenarios",
    "userProvidedScenarioInput",
    "scenarioCatalog",
    "scenarioReviewSummary",
    "accepted_with_normalization",
    "accepted_with_limitation",
  ]);
  requireMarkers(contracts.writer, [
    "scenarioCoverage",
    "testDataUsage",
    "testDataEvidence",
  ]);
  requireMarkers(contracts.reviewer, [
    "userScenarioCoverage",
    "missingScenarioIds",
    "dataMismatchScenarioIds",
    "coverageComplete",
    "Scope hard gate",
  ]);
  requireMarkers(contracts.orchestrator, [
    "userProvidedScenarios",
    "scenarioCatalog",
    "scenarioCoverage",
    `--workflow ${workflow}`,
    "--require-review-pass",
  ]);
}

function validateAnalysis(analysis) {
  if (!analysis.userProvidedScenarioInput || typeof analysis.userProvidedScenarioInput.present !== "boolean") {
    fail("analysis missing userProvidedScenarioInput.present");
  }
  if (!Array.isArray(analysis.scenarioCatalog)) {
    fail("analysis missing scenarioCatalog");
    return [];
  }
  if (!analysis.scenarioReviewSummary || typeof analysis.scenarioReviewSummary !== "object") {
    fail("analysis missing scenarioReviewSummary");
  }
  if (!Array.isArray(analysis.suggestedTestScenarios)) {
    fail("analysis missing suggestedTestScenarios");
  }

  const input = analysis.userProvidedScenarioInput ?? {};
  if (input.present === true) {
    if (typeof input.rawContent !== "string" || input.rawContent.trim().length === 0) {
      fail("analysis userProvidedScenarioInput.rawContent must preserve non-empty user input");
    }
    if (!validDetectedFormats.has(input.detectedFormat)) {
      fail(`analysis unsupported detectedFormat: ${input.detectedFormat}`);
    }
  } else if (input.rawContent !== null || input.detectedFormat !== null) {
    fail("analysis without user input must use null rawContent and detectedFormat");
  }

  const ids = new Set();
  const effective = [];
  const counts = {
    accepted: 0,
    accepted_with_normalization: 0,
    accepted_with_limitation: 0,
    merged: 0,
    rejected: 0,
  };
  let userProvided = 0;
  let analyzerSupplemented = 0;

  for (const item of analysis.scenarioCatalog) {
    if (!item || typeof item !== "object") {
      fail("scenarioCatalog contains a non-object item");
      continue;
    }
    if (typeof item.scenarioId !== "string" || !/^(USR|GEN)-\d{3}$/.test(item.scenarioId)) {
      fail(`invalid scenarioId: ${item.scenarioId}`);
    } else if (ids.has(item.scenarioId)) {
      fail(`duplicate scenarioId: ${item.scenarioId}`);
    } else {
      ids.add(item.scenarioId);
    }
    const expectedSource = item.scenarioId?.startsWith("USR-") ? "user" : "analyzer";
    if (item.source !== expectedSource) {
      fail(`${item.scenarioId}: source must be ${expectedSource}`);
    }
    if (!validScenarioStatuses.has(item.status)) {
      fail(`${item.scenarioId}: unsupported status ${item.status}`);
      continue;
    }
    if (item.scenarioId?.startsWith("USR-")) {
      userProvided += 1;
      counts[item.status] += 1;
    }
    if (item.scenarioId?.startsWith("GEN-")) analyzerSupplemented += 1;

    if (item.status === "rejected") {
      if (!validRejectionCodes.has(item.validationReason?.code)) {
        fail(`${item.scenarioId}: invalid rejection reason code`);
      }
      if (!item.validationReason?.message || !item.validationReason?.evidence) {
        fail(`${item.scenarioId}: rejection reason requires message and evidence`);
      }
    }
    if (item.status === "merged" && !item.mergedIntoScenarioId) {
      fail(`${item.scenarioId}: merged scenario missing mergedIntoScenarioId`);
    }
    if (effectiveStatuses.has(item.status)) {
      if (!item.normalizedName) fail(`${item.scenarioId}: effective scenario missing normalizedName`);
      if (!isCSharpIdentifierCompatible(item.normalizedName)) {
        fail(`${item.scenarioId}: normalizedName is not a C# identifier-compatible test method name`);
      }
      effective.push(item);
    }
  }


  for (const item of analysis.scenarioCatalog) {
    if (item?.status !== "merged") continue;
    if (item.mergedIntoScenarioId === item.scenarioId) {
      fail(`${item.scenarioId}: merged scenario cannot point to itself`);
      continue;
    }
    const target = analysis.scenarioCatalog.find((candidate) => candidate?.scenarioId === item.mergedIntoScenarioId);
    if (!target || !effectiveStatuses.has(target.status)) {
      fail(`${item.scenarioId}: mergedIntoScenarioId must reference an effective scenario`);
    }
  }

  const summary = analysis.scenarioReviewSummary ?? {};
  const expectedSummary = {
    userProvided,
    accepted: counts.accepted,
    acceptedWithNormalization: counts.accepted_with_normalization,
    acceptedWithLimitation: counts.accepted_with_limitation,
    merged: counts.merged,
    rejected: counts.rejected,
    analyzerSupplemented,
    effective: effective.length,
  };
  for (const [key, expected] of Object.entries(expectedSummary)) {
    if (summary[key] !== expected) fail(`scenarioReviewSummary.${key}: expected ${expected}, got ${summary[key]}`);
  }

  const normalizedNames = effective.map((item) => item.normalizedName);
  if (JSON.stringify(analysis.suggestedTestScenarios) !== JSON.stringify(normalizedNames)) {
    fail("suggestedTestScenarios does not match effective scenarioCatalog order");
  }
  const methodCount = Object.values(analysis.methodScenarioCounts ?? {}).reduce(
    (sum, value) => sum + (typeof value === "number" ? value : 0),
    0,
  );
  if (methodCount !== effective.length) fail(`methodScenarioCounts total ${methodCount} != effective ${effective.length}`);
  validateMarkdownScenarioIntegrity(analysis);
  return effective;
}

function validateWriters(writerPaths, effective) {
  const coverageById = new Map();
  const effectiveIds = new Set(effective.map((scenario) => scenario.scenarioId));
  const effectiveById = new Map(effective.map((scenario) => [scenario.scenarioId, scenario]));
  for (const writerPath of writerPaths) {
    const writer = readJson(writerPath);
    if (!Array.isArray(writer.scenarioCoverage)) {
      fail(`${writerPath}: missing scenarioCoverage`);
      continue;
    }
    for (const coverage of writer.scenarioCoverage) {
      if (!effectiveIds.has(coverage.scenarioId)) {
        fail(`${writerPath}: unexpected or non-effective scenario coverage ${coverage.scenarioId}`);
      }
      const list = coverageById.get(coverage.scenarioId) ?? [];
      list.push(coverage);
      coverageById.set(coverage.scenarioId, list);
      if (!["implemented", "blocked", "limitation"].includes(coverage.status)) {
        fail(`${writerPath}: ${coverage.scenarioId} invalid coverage status`);
      }
      if (!["exact", "partial", "generated", "not-applicable"].includes(coverage.testDataUsage)) {
        fail(`${writerPath}: ${coverage.scenarioId} invalid testDataUsage`);
      }
      const scenario = effectiveById.get(coverage.scenarioId);
      if (scenario && coverage.normalizedName !== scenario.normalizedName) {
        fail(`${writerPath}: ${coverage.scenarioId} normalizedName does not match analysis catalog`);
      }
      if (coverage.status === "implemented"
          && (!Array.isArray(coverage.testMethodNames)
            || !coverage.testMethodNames.includes(scenario?.normalizedName))) {
        fail(`${writerPath}: ${coverage.scenarioId} testMethodNames must include catalog normalizedName`);
      }
      if (scenario?.source === "user" && ["exact", "partial"].includes(coverage.testDataUsage)) {
        if (!Array.isArray(coverage.testDataEvidence)
            || coverage.testDataEvidence.length === 0
            || coverage.testDataEvidence.some((item) => typeof item !== "string" || item.trim() === "")) {
          fail(`${writerPath}: ${coverage.scenarioId} requires non-empty testDataEvidence`);
        }
      }
      if (coverage.testDataUsage === "partial" && !coverage.note) {
        fail(`${writerPath}: ${coverage.scenarioId} partial testDataUsage requires a note`);
      }
      if (scenario?.source === "user" && coverage.testDataUsage === "generated") {
        if (!coverage.note) {
          fail(`${writerPath}: ${coverage.scenarioId} generated user test data requires a note`);
        }
        if (hasExplicitTestData(scenario.testData) && coverage.status === "implemented") {
          fail(`${writerPath}: ${coverage.scenarioId} with explicit user testData cannot be implemented with generated data`);
        }
      }
      if (["blocked", "limitation"].includes(coverage.status) && !coverage.note) {
        fail(`${writerPath}: ${coverage.scenarioId} requires a note`);
      }
    }
  }
  for (const scenario of effective) {
    const matches = coverageById.get(scenario.scenarioId) ?? [];
    if (matches.length !== 1) {
      fail(`${scenario.scenarioId}: expected exactly one Writer coverage entry, got ${matches.length}`);
    }
  }
  return coverageById;
}

function validateReviewer(reviewerPath, effective, analysis, writerCoverageById, requireReviewPass) {
  const reviewer = readJson(reviewerPath);
  const coverage = reviewer.userScenarioCoverage;
  if (!coverage || typeof coverage !== "object") {
    fail(`${reviewerPath}: missing userScenarioCoverage`);
    return;
  }
  for (const field of [
    "acceptedScenarioIds",
    "implementedScenarioIds",
    "missingScenarioIds",
    "dataMismatchScenarioIds",
    "rejectedScenarioIdsExcluded",
  ]) {
    if (!Array.isArray(coverage[field])) fail(`${reviewerPath}: ${field} must be an array`);
  }
  if (typeof coverage.coverageComplete !== "boolean") {
    fail(`${reviewerPath}: coverageComplete must be boolean`);
  }
  const acceptedUserIds = effective.filter((item) => item.source === "user").map((item) => item.scenarioId).sort();
  const reportedAccepted = [...(coverage.acceptedScenarioIds ?? [])].sort();
  if (JSON.stringify(acceptedUserIds) !== JSON.stringify(reportedAccepted)) {
    fail(`${reviewerPath}: acceptedScenarioIds does not match effective user scenarios`);
  }
  const implemented = coverage.implementedScenarioIds ?? [];
  const missing = coverage.missingScenarioIds ?? [];
  const mismatch = coverage.dataMismatchScenarioIds ?? [];
  const writerCoverageAvailable = writerCoverageById.size > 0;
  const writerImplementedIds = writerCoverageAvailable
    ? acceptedUserIds.filter((id) => writerCoverageById.get(id)?.[0]?.status === "implemented")
    : acceptedUserIds;
  const writerNonImplementedIds = writerCoverageAvailable
    ? acceptedUserIds.filter((id) => !writerImplementedIds.includes(id))
    : [];
  for (const id of writerNonImplementedIds) {
    if (!missing.includes(id)) {
      fail(`${reviewerPath}: Writer non-implemented scenario ${id} must be reported missing`);
    }
  }
  const expectedImplemented = writerImplementedIds.filter((id) => !missing.includes(id));
  if (!sameStringSet(implemented, expectedImplemented)) {
    fail(`${reviewerPath}: implementedScenarioIds does not match Writer implemented scenarios minus missing scenarios`);
  }
  for (const id of [...missing, ...mismatch]) {
    if (!acceptedUserIds.includes(id)) {
      fail(`${reviewerPath}: coverage issue references non-accepted scenario ${id}`);
    }
  }
  const expectedComplete = missing.length === 0
    && mismatch.length === 0
    && writerNonImplementedIds.length === 0;
  if (coverage.coverageComplete !== expectedComplete) {
    fail(`${reviewerPath}: coverageComplete must be ${expectedComplete}`);
  }
  const rejectedIds = (analysis.scenarioCatalog ?? [])
    .filter((item) => item.source === "user" && item.status === "rejected")
    .map((item) => item.scenarioId);
  const reportedRejected = coverage.rejectedScenarioIdsExcluded ?? [];
  if (!sameStringSet(rejectedIds, reportedRejected)) {
    fail(`${reviewerPath}: rejectedScenarioIdsExcluded does not exactly match analysis rejected scenarios`);
  }
  const analysisUserCount = (analysis.scenarioCatalog ?? []).filter((item) => item.source === "user").length;
  if (Number.isInteger(coverage.providedScenarioCount) && coverage.providedScenarioCount !== analysisUserCount) {
    fail(`${reviewerPath}: providedScenarioCount does not match analysis user scenarios`);
  }
  if (Number.isInteger(coverage.effectiveScenarioCount)
      && coverage.effectiveScenarioCount !== acceptedUserIds.length) {
    fail(`${reviewerPath}: effectiveScenarioCount does not match effective user scenarios`);
  }
  if (Number.isInteger(coverage.implementedScenarioCount)
      && coverage.implementedScenarioCount !== implemented.length) {
    fail(`${reviewerPath}: implementedScenarioCount does not match implementedScenarioIds`);
  }
  if (requireReviewPass) {
    const gateDecision = String(reviewer.gateDecision ?? "").trim().toLowerCase();
    if (!coverage.coverageComplete || missing.length > 0 || mismatch.length > 0) {
      fail(`${reviewerPath}: review acceptance requires complete user scenario coverage`);
    }
    if (!gateDecision) {
      fail(`${reviewerPath}: review acceptance rejected gateDecision ${reviewer.gateDecision ?? "missing"}`);
    } else if (!["pass", "fail", "blocked"].includes(gateDecision)) {
      fail(`${reviewerPath}: unsupported gateDecision ${reviewer.gateDecision}`);
    } else if (gateDecision !== "pass") {
      fail(`${reviewerPath}: review acceptance rejected gateDecision ${reviewer.gateDecision}`);
    }
  }
}

const args = parseArgs(process.argv.slice(2));
validateStaticContract(args.workflow);

if (args.analysis) {
  const analysis = readJson(args.analysis);
  const effective = validateAnalysis(analysis);
  const writerCoverageById = args.writers.length > 0
    ? validateWriters(args.writers, effective)
    : new Map();
  if (args.reviewer) {
    validateReviewer(args.reviewer, effective, analysis, writerCoverageById, args.requireReviewPass);
  }
} else if (args.writers.length > 0 || args.reviewer) {
  fail("--writer and --reviewer require --analysis");
}

if (args.requireReviewPass && !args.reviewer) {
  fail("--require-review-pass requires --reviewer");
}

if (process.exitCode !== 1) {
  console.log(`PASS: ${args.workflow} scenario contract validation passed.`);
}
