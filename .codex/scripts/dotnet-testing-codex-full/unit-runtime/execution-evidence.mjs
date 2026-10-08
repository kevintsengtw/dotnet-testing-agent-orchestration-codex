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
  if (name === targetClass || name.startsWith(`${targetClass}/`) || name.startsWith(`${targetClass}+`)) return true;
  // A qualified target has an exact namespace; only short names use suffix matching.
  const owner = name.split(/[ /+]/u)[0];
  return !targetClass.includes(".") && owner.endsWith(`.${targetClass}`);
}

function branchCounts(line) {
  const match = String(line["condition-coverage"] ?? "").match(/\((\d+)\s*\/\s*(\d+)\)/u);
  return match ? { covered: Number(match[1]), valid: Number(match[2]) } : { covered: 0, valid: 0 };
}

function threshold(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${name} must be between 0 and 100`);
  return value;
}

// Raw Cobertura method records only; no source-method or generated-code attribution.
function methodDetails(body, owner) {
  return [...body.matchAll(/<method\b([^>]*?)(?:\/>|>([\s\S]*?)<\/method>)/gu)].map((match) => {
    const metadata = attributes(match[1]);
    const identity = { className: owner.name, filename: owner.filename,
      name: decodeXml(metadata.name), signature: decodeXml(metadata.signature) };
    const lines = new Map();
    for (const item of (match[2] ?? "").matchAll(/<line\b([^>]*?)(?:\/>|>[\s\S]*?<\/line>)/gu)) {
      const values = attributes(item[1]);
      const number = Number(values.number);
      const hits = Number(values.hits);
      const counts = branchCounts(values);
      if (!Number.isInteger(number) || number <= 0 || !Number.isInteger(hits) || hits < 0
          || counts.covered > counts.valid
          || (values.branch?.toLowerCase() === "true" && counts.valid === 0)) {
        return { ...identity, status: "unavailable", reason: "Invalid method line/branch evidence" };
      }
      const previous = lines.get(number);
      if (previous && (previous.hits !== hits || previous.covered !== counts.covered || previous.valid !== counts.valid)) {
        return { ...identity, status: "unavailable", reason: "Conflicting method line evidence" };
      }
      lines.set(number, { hits, ...counts });
    }
    if (!identity.name || metadata.signature === undefined || lines.size === 0) {
      return { ...identity, status: "unavailable", reason: "Method identity or executable lines missing" };
    }
    const entries = [...lines].sort(([left], [right]) => left - right);
    const covered = entries.filter(([, value]) => value.hits > 0).length;
    const branchCovered = entries.reduce((sum, [, value]) => sum + value.covered, 0);
    const branchValid = entries.reduce((sum, [, value]) => sum + value.valid, 0);
    return { ...identity, status: "available",
      line: { covered, valid: lines.size, percent: percent(covered, lines.size),
        uncoveredLines: entries.filter(([, value]) => value.hits === 0).map(([number]) => number) },
      branch: { covered: branchCovered, valid: branchValid, percent: percent(branchCovered, branchValid),
        uncoveredBranches: entries.filter(([, value]) => value.covered < value.valid)
          .map(([line, value]) => ({ line, covered: value.covered, valid: value.valid })) },
    };
  });
}

// Only Analyzer method identities participate in attribution; selectors are not inputs.
function methodIdentity(signature) {
  const text = String(signature).trim();
  const match = text.match(/^(.*?)\((.*)\)$/);
  const head = (match ? match[1] : text).trim().split(/\s+/).at(-1);
  const name = head?.split(".").at(-1);
  const aliases = { int:"System.Int32", string:"System.String", bool:"System.Boolean", long:"System.Int64", decimal:"System.Decimal", double:"System.Double", object:"System.Object", float:"System.Single", byte:"System.Byte", char:"System.Char" };
  const normalize = value => value.replace(/\bglobal::/g, "").replace(/\b(int|string|bool|long|decimal|double|object|float|byte|char)\b/g, x => aliases[x]).replace(/\s+\w+(?=,|$)/g, "").replace(/\s/g, "");
  return { name, parameters: match ? normalize(match[2]) : null };
}

function parametersMatch(requested, measured) {
  if (requested === null || requested === measured) return true;
  if (measured === null) return false;
  const tokens = value => value.match(/[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|./gu) ?? [];
  const requestedTokens = tokens(requested), measuredTokens = tokens(measured);
  return requestedTokens.length === measuredTokens.length && requestedTokens.every((token, index) => {
    const actual = measuredTokens[index];
    // Only an unqualified type may match its qualified form. All compatible
    // records participate below, so same-name types/overloads remain ambiguous.
    return token === actual || (/^[A-Za-z_]\w*$/u.test(token) && actual.endsWith(`.${token}`));
  });
}

export function projectMethodCoverage(coverage, methodsToTest) {
  if (!Array.isArray(methodsToTest) || !methodsToTest.length || methodsToTest.some(x => typeof x !== "string" || !x.trim())) throw new Error("methodsToTest must contain Analyzer method identities");
  const requested = [...new Set(methodsToTest)];
  const records = coverage.methodDetails?.records ?? [];
  const excludedRecords = records.filter(r => /[+/]<>c(?:__DisplayClass|[+/]|$)/.test(r.className ?? ""))
    .map(r => ({...r, exclusionReason:"lambda/closure is not attributed to the requested method"}));
  const usable = records.filter(r => !excludedRecords.some(e => e.className === r.className && e.name === r.name && e.signature === r.signature));
  const selected = new Map();
  const resolutions = requested.map(signature => {
    const identity = methodIdentity(signature);
    const direct = usable.filter(r => r.className === coverage.scope.targetClass && r.name === identity.name);
    const generated = usable.filter(r => r.name === "MoveNext" && r.className?.startsWith(coverage.scope.targetClass)
      && r.className.slice(coverage.scope.targetClass.length).match(/^[+/]<([^>]+)>d__\d+$/)?.[1] === identity.name);
    const candidates = direct.filter(r => parametersMatch(identity.parameters, methodIdentity(`${r.name}${r.signature}`).parameters));
    let matches = candidates;
    // State machine ordinal does not identify an overload. Do not guess between generated bodies.
    if (generated.length) {
      if (generated.length !== 1 || direct.length > 1 || requested.filter(x => methodIdentity(x).name === identity.name).length > 1) return {signature,status:"unavailable",reason:"Async overload cannot be uniquely attributed from Cobertura signature"};
      if (identity.parameters !== null && direct.length && !candidates.length) return {signature,status:"unavailable",reason:"Analyzer signature does not match Cobertura method"};
      matches = generated;
    }
    if (matches.length !== 1) return {signature,status:"unavailable",reason:"Cobertura method signature is missing or ambiguous"};
    const record = matches[0];
    if (record.status !== "available") return {signature,status:"unavailable",reason:record.reason ?? "Method coverage unavailable"};
    selected.set(JSON.stringify([record.className,record.name,record.signature]), record);
    return {signature,status:"available",className:record.className,name:record.name,coberturaSignature:record.signature};
  });
  const base = {...coverage, classCoverage: {status:coverage.status,line:coverage.line,branch:coverage.branch,goalMet:coverage.goalMet},
    scope:{...coverage.scope,kind:"methods",methods:requested},
    methodDetails:{...coverage.methodDetails,attribution:"analyzer-methods",resolutions,excludedRecords}};
  if (resolutions.some(r => r.status !== "available")) return {...base,status:"unavailable",line:null,branch:null,goalMet:null,reason:resolutions.filter(r => r.reason).map(r => `${r.signature}: ${r.reason}`).join("; ")};
  const metric = name => {
    const values = [...selected.values()].map(r => r[name]);
    const covered = values.reduce((sum,v) => sum+v.covered,0), valid = values.reduce((sum,v) => sum+v.valid,0);
    const percentage = valid === 0 ? 100 : percent(covered,valid);
    return {covered,valid,percent:percentage,threshold:coverage[name].threshold,met:percentage >= coverage[name].threshold};
  };
  const line = metric("line"), branch = metric("branch");
  return {...base,status:"available",line,branch,goalMet:line.met && branch.met};
}

export function validateMethodScope(coverage, methodsToTest) {
  if (coverage?.scope?.kind !== "methods" || !Array.isArray(coverage.scope.methods) || !Array.isArray(methodsToTest)
      || JSON.stringify([...new Set(coverage.scope.methods)].sort()) !== JSON.stringify([...new Set(methodsToTest)].sort())) throw new Error("Executor Coverage methods must equal sealed Analyzer methodsToTest");
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

  const tests = [...xml.matchAll(/<UnitTestResult\b([^>]*)>/gu)].map((match) => {
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
  methodsToTest = null,
}) {
  if (typeof targetSource !== "string" || !targetSource.trim()) throw new Error("targetSource is required");
  if (typeof targetClass !== "string" || !targetClass.trim()) throw new Error("targetClass is required");
  const lineGoal = threshold(lineThreshold, "lineThreshold");
  const branchGoal = threshold(branchThreshold, "branchThreshold");
  const lines = new Map();
  const branches = new Map();
  const matchedClasses = [];
  const methods = [];

  for (const match of xml.matchAll(/<class\b([^>]*?)>([\s\S]*?)<\/class>/gu)) {
    const classAttributes = Object.fromEntries(
      [...match[1].matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/gu)]
        .map((item) => [item[1], decodeXml(item[2])]),
    );
    if (!sourceMatches(classAttributes.filename, targetSource)
        || !classMatches(classAttributes.name ?? "", targetClass)) continue;
    matchedClasses.push({ name: classAttributes.name, filename: classAttributes.filename });
    methods.push(...methodDetails(match[2], classAttributes));
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
  const result = {
    status: "available",
    scope: { targetClass, targetSource, matchedClasses },
    methodDetails: { source: "cobertura", attribution: "raw-records", records: methods,
      status: methods.length === 0 ? "unavailable" : methods.every((method) => method.status === "available") ? "available" : "partial",
      ...(methods.length === 0 ? { reason: "Cobertura contains no method records for target" } : {}) },
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
  return methodsToTest === null ? result : projectMethodCoverage(result, methodsToTest);
}

function warningCount(output) {
  const summary = String(output ?? "").match(/(\d+)\s+(?:Warning\(s\)|個警告)/iu);
  return summary ? Number.parseInt(summary[1], 10) : null;
}

export function buildUnitExecutionEvidence({
  build, test, trxPath, coberturaPath,
  targetSource = null, targetClass = null, lineThreshold = 80, branchThreshold = 70, methodsToTest = null,
}) {
  if (!build || !Array.isArray(build.command)) throw new Error("build command evidence is required");
  if (!test || !Array.isArray(test.command)) throw new Error("test command evidence is required");
  const trx = parseTrx(requireFile(trxPath, "TRX"));
  const cobertura = requireFile(coberturaPath, "Cobertura");
  const coverage = targetSource || targetClass
    ? parseTargetCobertura(cobertura, { targetSource, targetClass, lineThreshold, branchThreshold, methodsToTest })
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
