import fs from "node:fs";
import path from "node:path";

function requireFile(filePath, kind) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`${kind} evidence does not exist: ${filePath ?? "missing"}`);
  return fs.readFileSync(filePath, "utf8");
}

function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w-]+)="([^"]*)"/gu)].map((match) => [match[1], match[2]]));
}

function integer(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} is not a non-negative integer`);
  return parsed;
}

function percent(covered, valid) {
  return valid === 0 ? null : Number(((covered / valid) * 100).toFixed(2));
}

function decodeXml(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function normalizedPath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^[A-Za-z]:/u, "").replace(/\/+/gu, "/");
}

function sourceMatches(filename, targetSource) {
  const candidate = normalizedPath(filename);
  const target = normalizedPath(targetSource);
  return target.endsWith(`/${candidate}`)
    || candidate.endsWith(`/${target}`)
    || (!candidate.includes("/") && path.posix.basename(target) === candidate);
}

function classMatches(name, targetClass) {
  return name === targetClass
    || name.endsWith(`.${targetClass}`)
    || name.includes(`.${targetClass}/`)
    || name.includes(`.${targetClass}+`);
}

function branchCounts(line) {
  const match = String(line["condition-coverage"] ?? "").match(/\((\d+)\s*\/\s*(\d+)\)/u);
  return match ? { covered: Number(match[1]), valid: Number(match[2]) } : { covered: 0, valid: 0 };
}

function threshold(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${name} must be between 0 and 100`);
  return value;
}

export function parseTrx(xml) {
  const countersTag = xml.match(/<Counters\b[^>]*\/>/u)?.[0];
  if (!countersTag) throw new Error("TRX Counters element is missing");
  const counters = attributes(countersTag);
  const total = integer(counters.total, "TRX total");
  const passed = integer(counters.passed, "TRX passed");
  const failed = integer(counters.failed, "TRX failed");
  const skipped = integer(counters.notExecuted ?? "0", "TRX notExecuted");
  if (total !== passed + failed + skipped) throw new Error("TRX counts are inconsistent");

  const tests = [...xml.matchAll(/<UnitTestResult\b([^>]*)\/>/gu)].map((match) => {
    const item = attributes(match[1]);
    return { name: item.testName, outcome: item.outcome, duration: item.duration ?? null };
  });
  if (tests.length !== total) throw new Error(`TRX result count ${tests.length} does not match total ${total}`);
  return { counts: { total, passed, failed, skipped }, tests };
}

export function parseCobertura(xml) {
  const coverageTag = xml.match(/<coverage\b[^>]*>/u)?.[0];
  if (!coverageTag) throw new Error("Cobertura coverage element is missing");
  const values = attributes(coverageTag);
  const lineCovered = integer(values["lines-covered"], "Cobertura lines-covered");
  const lineValid = integer(values["lines-valid"], "Cobertura lines-valid");
  const branchCovered = integer(values["branches-covered"], "Cobertura branches-covered");
  const branchValid = integer(values["branches-valid"], "Cobertura branches-valid");
  return {
    line: { covered: lineCovered, valid: lineValid, percent: percent(lineCovered, lineValid) },
    branch: { covered: branchCovered, valid: branchValid, percent: percent(branchCovered, branchValid) },
  };
}

export function parseTargetCobertura(xml, {
  targetSource,
  targetClass,
  lineThreshold = 80,
  branchThreshold = 70,
}) {
  if (typeof targetSource !== "string" || !targetSource.trim()) throw new Error("targetSource is required");
  if (typeof targetClass !== "string" || !targetClass.trim()) throw new Error("targetClass is required");
  const lineGoal = threshold(lineThreshold, "lineThreshold");
  const branchGoal = threshold(branchThreshold, "branchThreshold");
  const lines = new Map();
  const branches = new Map();
  const matchedClasses = [];

  for (const match of xml.matchAll(/<class\b([^>]*?)>([\s\S]*?)<\/class>/gu)) {
    const classAttributes = Object.fromEntries(
      [...match[1].matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/gu)]
        .map((item) => [item[1], decodeXml(item[2])]),
    );
    if (!sourceMatches(classAttributes.filename, targetSource)
        || !classMatches(classAttributes.name ?? "", targetClass)) continue;
    matchedClasses.push({ name: classAttributes.name, filename: classAttributes.filename });
    for (const lineMatch of match[2].matchAll(/<line\b([^>]*?)(?:\/>|>(?:[\s\S]*?)<\/line>)/gu)) {
      const line = Object.fromEntries(
        [...lineMatch[1].matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/gu)]
          .map((item) => [item[1], decodeXml(item[2])]),
      );
      const number = Number(line.number);
      if (!Number.isInteger(number)) continue;
      const hits = Number(line.hits ?? 0);
      lines.set(number, Math.max(lines.get(number) ?? 0, Number.isFinite(hits) ? hits : 0));
      const counts = branchCounts(line);
      if (counts.valid > 0) {
        const current = branches.get(number) ?? { covered: 0, valid: 0 };
        branches.set(number, {
          covered: Math.max(current.covered, counts.covered),
          valid: Math.max(current.valid, counts.valid),
        });
      }
    }
  }
  if (matchedClasses.length === 0) {
    throw new Error(`Cobertura target class/source not found: ${targetClass} @ ${targetSource}`);
  }
  if (lines.size === 0) throw new Error(`Cobertura target class/source contains no executable lines: ${targetClass}`);

  const sortedLines = [...lines].sort(([left], [right]) => left - right);
  const sortedBranches = [...branches].sort(([left], [right]) => left - right);
  const lineCovered = sortedLines.filter(([, hits]) => hits > 0).length;
  const branchCovered = sortedBranches.reduce((sum, [, item]) => sum + item.covered, 0);
  const branchValid = sortedBranches.reduce((sum, [, item]) => sum + item.valid, 0);
  const linePercent = Number(((lineCovered / sortedLines.length) * 100).toFixed(2));
  const branchPercent = branchValid === 0 ? 100 : Number(((branchCovered / branchValid) * 100).toFixed(2));
  return {
    status: "available",
    scope: { targetClass, targetSource, matchedClasses },
    matchedClasses,
    line: {
      covered: lineCovered, valid: sortedLines.length, percent: linePercent,
      threshold: lineGoal, met: linePercent >= lineGoal,
      uncoveredLines: sortedLines.filter(([, hits]) => hits === 0).map(([number]) => number),
    },
    branch: {
      covered: branchCovered, valid: branchValid, percent: branchPercent,
      threshold: branchGoal, met: branchPercent >= branchGoal,
      uncoveredBranches: sortedBranches.filter(([, item]) => item.covered < item.valid)
        .map(([line, item]) => ({ line, covered: item.covered, valid: item.valid })),
    },
    goalMet: linePercent >= lineGoal && branchPercent >= branchGoal,
  };
}

function warningCount(output) {
  const summary = String(output ?? "").match(/(\d+)\s+Warning\(s\)/iu);
  return summary ? Number.parseInt(summary[1], 10) : null;
}

export function buildUnitExecutionEvidence({
  build, test, trxPath, coberturaPath,
  targetSource = null, targetClass = null, lineThreshold = 80, branchThreshold = 70,
}) {
  if (!build || !Array.isArray(build.command)) throw new Error("build command evidence is required");
  if (!test || !Array.isArray(test.command)) throw new Error("test command evidence is required");
  const trx = parseTrx(requireFile(trxPath, "TRX"));
  const cobertura = requireFile(coberturaPath, "Cobertura");
  const coverage = targetSource || targetClass
    ? parseTargetCobertura(cobertura, { targetSource, targetClass, lineThreshold, branchThreshold })
    : parseCobertura(cobertura);

  return {
    schemaVersion: 1,
    runner: "dotnet test",
    build: {
      command: build.command,
      exitCode: build.exitCode,
      status: build.exitCode === 0 ? "passed" : "failed",
      warnings: warningCount(build.output),
      rawOutput: String(build.output ?? ""),
    },
    test: {
      command: test.command,
      exitCode: test.exitCode,
      status: test.exitCode === 0 && trx.counts.failed === 0 ? "passed" : "failed",
      counts: trx.counts,
      tests: trx.tests,
      rawOutput: String(test.output ?? ""),
    },
    coverage,
    sources: { testCounts: "trx", coverage: "cobertura" },
    evidencePaths: { trx: trxPath, cobertura: coberturaPath },
  };
}
