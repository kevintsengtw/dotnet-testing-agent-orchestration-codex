import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const key = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
const same = (a, b) => key(a) === key(b);
const within = (root, file) => { const rel = path.relative(root, file); return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
function reject(code, message) { throw new Error(`${code}: ${message}`); }
function document(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function physical(root, file, mustExist = true) {
  if (!within(root, file)) reject("EVIDENCE_SCOPE", `path is outside workspace: ${file}`);
  let cursor = file;
  while (!fs.existsSync(cursor)) {
    if (mustExist) reject("EVIDENCE_MISSING", `missing file: ${file}`);
    cursor = path.dirname(cursor);
  }
  if (!same(fs.realpathSync(cursor), cursor)) reject("EVIDENCE_SCOPE", `linked path is not allowed: ${file}`);
  if (fs.statSync(cursor).isFile() && fs.statSync(cursor).nlink !== 1) reject("EVIDENCE_SCOPE", `hard linked evidence is not allowed: ${file}`);
  if (!within(fs.realpathSync(root), fs.realpathSync(cursor))) reject("EVIDENCE_SCOPE", `physical path is outside workspace: ${file}`);
  return file;
}

export function executionContext({ workspaceRoot, testProjectPath, executorPath }) {
  const root = path.resolve(workspaceRoot);
  const project = physical(root, path.resolve(root, testProjectPath));
  const projectDir = fs.statSync(project).isDirectory() ? project : path.dirname(project);
  const orchestratorRoot = path.join(projectDir, ".orchestrator");
  const output = path.resolve(root, executorPath);
  const match = path.basename(output).match(/^(.+)\.executor-result\.json$/i);
  if (!match || !same(path.dirname(output), path.join(orchestratorRoot, "executor-result"))) reject("EVIDENCE_SCOPE", "executor path must be the assigned canonical executor-result");
  physical(root, output, false);
  return { root, project, projectDir, orchestratorRoot, output, target: match[1], evidenceDir: path.join(orchestratorRoot, "execution-evidence", match[1]) };
}

function rawPathIsCurrent(context, file, attempt, kind) {
  if (!/^[a-z][a-z0-9-]*$/iu.test(kind)) return false;
  kind = kind.toLowerCase();
  if (same(path.dirname(file), path.join(context.evidenceDir, `attempt-${attempt}`))
      && path.basename(file).toLowerCase() === `${kind}.log`) return true;
  // Existing current-run logs are accepted only with this exact target prefix.
  // Later executions must use a new immutable attempt directory.
  if (attempt !== 1) return false;
  const suffix = ({ "dotnet-build": "build", "dotnet-test": "test" })[kind] ?? kind;
  return same(file, path.join(context.orchestratorRoot, "executor-result", `${context.target}.${suffix}.log`));
}

function supportPathIsCurrent(context, file, attempt, kind) {
  return /^[a-z][a-z0-9-]*$/iu.test(kind)
    && same(path.dirname(file), path.join(context.evidenceDir, `attempt-${attempt}`))
    && [".txt", ".json", ".log"].some(ext => path.basename(file).toLowerCase() === `${kind.toLowerCase()}${ext}`);
}

function executionCommands(value, required = false) {
  const commands = value.executionCommands ?? value.executedCommands;
  if (value.executionCommands && value.executedCommands
      && JSON.stringify(value.executionCommands) !== JSON.stringify(value.executedCommands)) reject("EVIDENCE_COMMANDS", "executionCommands and executedCommands disagree");
  if (commands === undefined && !required) return undefined;
  if (!Array.isArray(commands) || !commands.length || commands.some(c => typeof c !== "string" || !c.trim())) reject("EVIDENCE_COMMANDS", "executionCommands must list the actual commands for this attempt");
  return commands;
}

const RESULT_FIELDS = ["executionMethod", "dockerStatus", "requiredContainerKinds", "startedContainerKinds", "buildResult", "testResult", "totalTests", "passedTests", "failedTests", "skippedTests"];
function evidenceBinding(context, executor) {
  if (!same(path.resolve(context.root, executor.executorResultFilePath ?? ""), context.output)) reject("EVIDENCE_BINDING", "executorResultFilePath does not match canonical output");
  if (!same(path.resolve(context.root, executor.testProjectPath ?? ""), context.project)) reject("EVIDENCE_BINDING", "testProjectPath does not match assigned project");
}

/** Read and verify only explicitly declared, current-target execution evidence. */
export function readExecutionHistory({ workspaceRoot, testProjectPath, executorPath, executor, requireEvidence = false }) {
  const context = executionContext({ workspaceRoot, testProjectPath, executorPath });
  const value = executor ?? document(context.output);
  return verifyHistory(context, value, { requireEvidence });
}

/** Project repair flags only after the entire declared history and its logs verify. */
export function validateExecutionEvidence(args) {
  const history = readExecutionHistory({ ...args, requireEvidence: true });
  const attempts = [], unknownAttempts = [];
  for (const record of history.records) {
    const flag = record.evidence.attempt.artifactRepair;
    if (flag === true) attempts.push(record.attempt);
    else if (flag !== false) unknownAttempts.push(record.attempt);
  }
  const complete = unknownAttempts.length === 0;
  const observed = attempts.length;
  const observedDisplay = `${observed} 個執行批次${observed ? `（attempt ${attempts.join("、")}）` : ""}`;
  const display = !complete
    ? `Artifact repair：資料不完整；已記錄 ${observedDisplay}；attempt ${unknownAttempts.join("、")} 的旗標未記錄或無效。`
    : observed
      ? `Artifact repair：已記錄 ${observedDisplay}。`
      : "Artifact repair：execution history 未記錄補證（0 個執行批次）。";
  return {
    status: "valid", attempts: history.records.length, rawLogs: history.rawPaths.length, supportFiles: history.supportPaths.length,
    repairSummary: {
      source: "execution-evidence.attempt.artifactRepair", status: complete ? "complete" : "incomplete",
      artifactRepairCount: complete ? observed : null, observedArtifactRepairCount: observed, attempts, unknownAttempts,
      firstPassStatus: "not-established",
      markdown: `${display}\n此數量取自已驗證的 execution history，不能用來判定命令或 gates 是否首次通過。`,
    },
  };
}

// Pending records are validated in memory; callers cannot supply them to the public reader.
function verifyHistory(context, value, { requireEvidence = false, compareResult = true, pending = null } = {}) {
  physical(context.root, context.evidenceDir, false);
  const declared = value.executionEvidencePaths ?? (value.finalExecutionEvidencePath ? [value.finalExecutionEvidencePath] : []);
  if (!Array.isArray(declared) || (requireEvidence && declared.length === 0)) reject("EVIDENCE_POINTER_MISSING", "executionEvidencePaths and finalExecutionEvidencePath are required");
  const declaredKeys = new Set(declared.map(f => key(path.resolve(context.root, f))));
  for (const name of fs.existsSync(context.evidenceDir) ? fs.readdirSync(context.evidenceDir) : []) {
    if (/^attempt-[1-9]\d*\.execution\.json$/u.test(name) && !declaredKeys.has(key(path.join(context.evidenceDir, name)))) reject("EVIDENCE_HISTORY", "current-target execution record is missing from history");
  }
  if (declared.length === 0) return { context, evidencePaths: [], rawPaths: [], supportPaths: [], records: [] };
  evidenceBinding(context, value);
  if (!value.finalExecutionEvidencePath || !same(path.resolve(context.root, declared.at(-1)), path.resolve(context.root, value.finalExecutionEvidencePath))) reject("EVIDENCE_BINDING", "finalExecutionEvidencePath must be the last history item");
  const records = [], seen = new Set();
  let previous = 0;
  for (const relative of declared) {
    const file = path.resolve(context.root, relative);
    const match = path.basename(file).match(/^attempt-([1-9]\d*)\.execution\.json$/u);
    const attempt = Number(match?.[1]);
    if (!match || !same(path.dirname(file), context.evidenceDir)) reject("EVIDENCE_SCOPE", "execution history must contain current-target attempts");
    if (attempt !== previous + 1) reject("EVIDENCE_HISTORY", "execution history must contain every attempt in order starting at 1");
    previous = attempt;
    const isPending = pending && same(pending.path, file);
    if (!isPending) physical(context.root, file);
    const evidence = isPending ? pending.evidence : document(file);
    if (evidence.schemaVersion !== 1 || evidence.evidenceKind !== "integration-execution-attempt" || evidence.attempt?.executionAttempt !== attempt) reject("EVIDENCE_BINDING", "evidence kind or execution attempt mismatch");
    if (!same(path.resolve(context.root, evidence.executionEvidenceFilePath ?? ""), file) || !same(path.resolve(context.root, evidence.executorResultFilePath ?? ""), context.output) || !same(path.resolve(context.root, evidence.testProjectPath ?? ""), context.project)) reject("EVIDENCE_BINDING", "execution evidence does not belong to this output and project");
    if (!Array.isArray(evidence.rawEvidence) || evidence.rawEvidence.length === 0) reject("RAW_EVIDENCE_MISSING", "rawEvidence must contain original execution logs");
    const rawPaths = [], kinds = new Set();
    for (const raw of evidence.rawEvidence) {
      if (typeof raw?.path !== "string" || typeof raw.kind !== "string") reject("RAW_EVIDENCE_SCOPE", "raw evidence requires path and kind");
      const rawFile = path.resolve(context.root, raw.path);
      if (!rawPathIsCurrent(context, rawFile, attempt, raw.kind)) reject("RAW_EVIDENCE_SCOPE", `raw log does not belong to this target and attempt: ${raw.path}`);
      physical(context.root, rawFile);
      if (seen.has(key(rawFile)) || kinds.has(raw.kind.toLowerCase())) reject("RAW_EVIDENCE_SCOPE", "raw evidence paths and kinds must be unique per attempt");
      seen.add(key(rawFile)); kinds.add(raw.kind.toLowerCase());
      const bytes = fs.readFileSync(rawFile);
      if (raw.lengthBytes !== bytes.length || typeof raw.sha256 !== "string" || raw.sha256.toLowerCase() !== digest(bytes)) reject("RAW_EVIDENCE_HASH", `raw log hash or length mismatch: ${raw.path}`);
      rawPaths.push(rawFile);
    }
    if ((["success", "failed"].includes(evidence.buildResult) && !kinds.has("dotnet-build")) || (evidence.totalTests > 0 && !kinds.has("dotnet-test")) || (["available", "unavailable"].includes(evidence.dockerStatus) && !kinds.has("docker-info"))) reject("RAW_EVIDENCE_MISSING", "required Docker/build/test output is missing");
    const supportPaths = [], supportKinds = new Set();
    if (evidence.supportingEvidence !== undefined && !Array.isArray(evidence.supportingEvidence)) reject("SUPPORT_EVIDENCE_SCOPE", "supportingEvidence must be an array");
    for (const support of evidence.supportingEvidence ?? []) {
      if (typeof support?.path !== "string" || typeof support.kind !== "string") reject("SUPPORT_EVIDENCE_SCOPE", "support evidence requires path and kind");
      const supportFile = path.resolve(context.root, support.path);
      if (!supportPathIsCurrent(context, supportFile, attempt, support.kind) || seen.has(key(supportFile)) || supportKinds.has(support.kind.toLowerCase())) reject("SUPPORT_EVIDENCE_SCOPE", "support evidence must be unique and belong to the current target and attempt");
      const bytes = fs.readFileSync(physical(context.root, supportFile));
      if (support.lengthBytes !== bytes.length || support.sha256 !== digest(bytes)) reject("SUPPORT_EVIDENCE_HASH", `support evidence hash or length mismatch: ${support.path}`);
      seen.add(key(supportFile)); supportKinds.add(support.kind.toLowerCase()); supportPaths.push(supportFile);
    }
    const testsRerun = !evidence.attempt.artifactRepair && kinds.has("dotnet-test")
      && records.some(r => r.evidence.rawEvidence.some(raw => raw.kind.toLowerCase() === "dotnet-test"));
    if (evidence.attempt.testsRerun !== testsRerun) reject("EVIDENCE_RESULT_MISMATCH", "testsRerun must reflect actual test logs in this attempt and earlier history");
    executionCommands(evidence);
    records.push({ path: file, attempt, evidence, rawPaths, supportPaths });
  }
  const final = records.at(-1).evidence;
  if (compareResult) {
    for (const field of RESULT_FIELDS) {
      if (JSON.stringify(final[field]) !== JSON.stringify(value[field])) reject("EVIDENCE_RESULT_MISMATCH", `${field} differs from final execution evidence`);
    }
    const files = (v) => [...(v ?? [])].map(f => key(path.resolve(context.root, f))).sort();
    if (JSON.stringify(files(final.testFilePaths)) !== JSON.stringify(files(value.testFilePaths))) reject("EVIDENCE_RESULT_MISMATCH", "testFilePaths differ from final execution evidence");
    // Legacy records may omit commands; newly recorded evidence always contains them.
    if (executionCommands(final) && JSON.stringify(executionCommands(final)) !== JSON.stringify(executionCommands(value))) reject("EVIDENCE_RESULT_MISMATCH", "executionCommands differ from final execution evidence");
  }
  return { context, records, evidencePaths: records.map(r => r.path), rawPaths: records.flatMap(r => r.rawPaths), supportPaths: records.flatMap(r => r.supportPaths) };
}

/** Called by Executor once original command output has been saved. Does not run tests. */
export function recordExecutionEvidence({ workspaceRoot, testProjectPath, executorPath, attempt, rawLogs, supportFiles = [], artifactRepair = false }) {
  const context = executionContext({ workspaceRoot, testProjectPath, executorPath });
  physical(context.root, context.output);
  const executor = document(context.output);
  evidenceBinding(context, executor);
  if (!Number.isSafeInteger(attempt) || attempt < 1) reject("EVIDENCE_BINDING", "attempt must be a positive integer");
  const previous = executor.executionEvidencePaths ?? [];
  if (!Array.isArray(previous)) reject("EVIDENCE_BINDING", "executionEvidencePaths must be an array");
  const history = verifyHistory(context, executor, { compareResult: false });
  if (attempt !== history.records.length + 1) reject("EVIDENCE_HISTORY", "new attempt must follow complete immutable history starting at 1");
  const targetFile = path.join(context.evidenceDir, `attempt-${attempt}.execution.json`);
  physical(context.root, targetFile, false);
  if (fs.existsSync(targetFile)) reject("EVIDENCE_EXISTS", "execution evidence already exists; never overwrite an attempt");
  const rawEvidence = rawLogs.map(({ kind, path: input }) => {
    let file = path.resolve(context.root, input);
    if (!rawPathIsCurrent(context, file, attempt, kind)) reject("RAW_EVIDENCE_SCOPE", `unexpected raw log path: ${input}`);
    const bytes = fs.readFileSync(physical(context.root, file));
    file = fs.realpathSync.native(file);
    return { kind: kind.toLowerCase(), path: path.relative(context.root, file).replaceAll("\\", "/"), sha256: digest(bytes), lengthBytes: bytes.length };
  });
  const supportingEvidence = supportFiles.map(({ kind, path: input }) => {
    const file = path.resolve(context.root, input);
    if (!supportPathIsCurrent(context, file, attempt, kind)) reject("SUPPORT_EVIDENCE_SCOPE", `unexpected support file path: ${input}`);
    const bytes = fs.readFileSync(physical(context.root, file));
    return { kind: kind.toLowerCase(), path: path.relative(context.root, fs.realpathSync.native(file)).replaceAll("\\", "/"), sha256: digest(bytes), lengthBytes: bytes.length };
  });
  const commands = executionCommands(executor, true);
  const testsRerun = !artifactRepair && rawEvidence.some(r => r.kind === "dotnet-test")
    && history.records.some(r => r.evidence.rawEvidence.some(raw => raw.kind.toLowerCase() === "dotnet-test"));
  const evidence = {
    schemaVersion: 1, evidenceKind: "integration-execution-attempt", recordedAt: new Date().toISOString(), executedAt: executor.executedAt,
    executionEvidenceFilePath: targetFile, executorResultFilePath: context.output, testProjectPath: executor.testProjectPath, testFilePaths: executor.testFilePaths,
    attempt: { executionAttempt: attempt, fixRound: executor.fixRounds, artifactRepair, testsRerun },
    ...Object.fromEntries(RESULT_FIELDS.map(k => [k, executor[k]])),
    executionCommands: commands, containerEvidence: executor.containerEvidence, rawEvidence, supportingEvidence,
  };
  const relative = path.relative(context.root, targetFile).replaceAll("\\", "/");
  const updated = { ...executor, executionCommands: commands, executionEvidencePaths: [...previous, relative], finalExecutionEvidencePath: relative };
  const telemetry = updated.tokenEstimateInputs;
  if (!Array.isArray(telemetry?.readFiles) || !Array.isArray(telemetry?.writtenFiles)) reject("EVIDENCE_TELEMETRY", "canonical readFiles and writtenFiles are required");
  const add = (list, file, reason) => { if (!list.some(e => same(path.resolve(context.root, e.path), file))) list.push({ path: path.relative(context.root, file).replaceAll("\\", "/"), reason }); };
  add(telemetry.readFiles, context.output, "execution evidence runtime reads current executor result");
  for (const raw of [...rawEvidence, ...supportingEvidence]) add(telemetry.readFiles, path.resolve(context.root, raw.path), "execution evidence runtime hashes original output");
  add(telemetry.writtenFiles, targetFile, "immutable execution evidence");
  add(telemetry.writtenFiles, context.output, "executor result execution evidence pointers");
  verifyHistory(context, updated, { requireEvidence: true, pending: { path: targetFile, evidence } });
  fs.mkdirSync(context.evidenceDir, { recursive: true });
  fs.writeFileSync(targetFile, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  fs.writeFileSync(context.output, JSON.stringify(updated, null, 2) + "\n");
  return { status: "recorded", executionEvidencePath: targetFile, sha256: digest(fs.readFileSync(targetFile)) };
}

export function executionFailureKind(diagnostic) {
  if (/(?:readFiles|writtenFiles).*?prior-attempt\/archive marker/su.test(diagnostic)) return "attempt-isolation-violation";
  if (/SUPPORT_EVIDENCE_/u.test(diagnostic)) return "support-execution-evidence-contract";
  if (/RAW_EVIDENCE_|(?:readFiles|writtenFiles).*?(?:current-run artifact|current assignment artifact)/su.test(diagnostic)) return "raw-execution-evidence-isolation";
  if (/EVIDENCE_POINTER_MISSING/u.test(diagnostic)) return "missing-canonical-execution-evidence";
  if (/EVIDENCE_(?:HASH|BINDING|SCOPE|RESULT_MISMATCH|HISTORY|COMMANDS)/u.test(diagnostic)) return "execution-evidence-contract";
  return "artifact-gate-rejected";
}

/** Preserve a rejected canonical artifact and the exact validator output before repair. */
export function preserveGateFailure({ workspaceRoot, testProjectPath, executorPath, diagnosticPath }) {
  const context = executionContext({ workspaceRoot, testProjectPath, executorPath });
  const artifact = fs.readFileSync(physical(context.root, context.output));
  const diagnosticFile = physical(context.root, path.resolve(context.root, diagnosticPath));
  if (!within(context.orchestratorRoot, diagnosticFile)) reject("EVIDENCE_SCOPE", "gate diagnostic must be within the current orchestrator root");
  const diagnostic = fs.readFileSync(diagnosticFile), base = path.join(context.orchestratorRoot, "gate-rejections", context.target);
  physical(context.root, base, false);
  fs.mkdirSync(base, { recursive: true });
  let n = 1; while (fs.existsSync(path.join(base, `rejection-${n}`))) n++;
  const dir = path.join(base, `rejection-${n}`); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "executor-result.json"), artifact, { flag: "wx" });
  fs.writeFileSync(path.join(dir, "validator.log"), diagnostic, { flag: "wx" });
  const record = { schemaVersion: 1, recordedAt: new Date().toISOString(), failureKind: executionFailureKind(diagnostic.toString("utf8")), sourceArtifact: context.output, artifactSha256: digest(artifact), diagnosticSha256: digest(diagnostic), preservedArtifact: "executor-result.json", preservedDiagnostic: "validator.log" };
  fs.writeFileSync(path.join(dir, "rejection.json"), JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  return { status: "preserved", ...record, rejectionDirectory: dir };
}

function main() {
  const [operation, ...argv] = process.argv.slice(2), args = { rawLogs: [], supportFiles: [] };
  if (["--help", "-h"].includes(operation)) {
    process.stdout.write("Integration evidence: record|validate|preserve --workspace-root <root> --test-project <project> --executor <result>; record --attempt <N> --raw-log <kind=path> [--support-file <kind=path>] [--artifact-repair]; preserve --diagnostic <path>\n"); return;
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--artifact-repair") { args.artifactRepair = true; continue; }
    const flag = argv[i], value = argv[++i];
    if (flag === "--workspace-root") args.workspaceRoot = value;
    else if (flag === "--test-project") args.testProjectPath = value;
    else if (flag === "--executor") args.executorPath = value;
    else if (flag === "--attempt") args.attempt = Number(value);
    else if (flag === "--diagnostic") args.diagnosticPath = value;
    else if (flag === "--raw-log") { const at = value.indexOf("="); if (at < 1) reject("EVIDENCE_ARGUMENT", "--raw-log requires kind=path"); args.rawLogs.push({ kind: value.slice(0, at), path: value.slice(at + 1) }); }
    else if (flag === "--support-file") { const at = value.indexOf("="); if (at < 1) reject("EVIDENCE_ARGUMENT", "--support-file requires kind=path"); args.supportFiles.push({ kind: value.slice(0, at), path: value.slice(at + 1) }); }
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!args.workspaceRoot || !args.testProjectPath || !args.executorPath) throw new Error("--workspace-root, --test-project and --executor are required");
  let result;
  if (operation === "record") result = recordExecutionEvidence(args);
  else if (operation === "preserve") result = preserveGateFailure(args);
  else if (operation === "validate") result = validateExecutionEvidence(args);
  else throw new Error("Expected record|validate|preserve");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`integration execution-evidence error: ${error.message}\n`); process.exitCode = 1; }
}
