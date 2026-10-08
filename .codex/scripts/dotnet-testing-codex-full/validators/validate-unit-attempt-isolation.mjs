#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function parseArgs(argv) {
  const args = { artifacts: [], allowedReads: [], allowedCodexSkills: [], packageDocumentationReceipts: [], workspaceRoot: process.cwd(), workflow: "unit" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--artifact") args.artifacts.push(argv[++i]);
    else if (arg === "--allow-read") args.allowedReads.push(argv[++i]);
    else if (arg === "--allow-codex-skill") args.allowedCodexSkills.push(argv[++i]);
    else if (arg === "--test-project") args.testProject = argv[++i];
    else if (arg === "--workspace-root") args.workspaceRoot = argv[++i];
    else if (arg === "--workflow") args.workflow = argv[++i];
    else if (arg === "--package-documentation") args.packageDocumentation = argv[++i];
    else if (arg === "--save-package-documentation") args.savePackageDocumentation = true;
    else if (arg === "--assignment-id") args.assignmentId = argv[++i];
    else if (arg === "--writer-result") args.writerResult = argv[++i];
    else if (arg === "--write-writer-result") args.writeWriterResult = argv[++i];
    else if (arg === "--package-documentation-receipt") args.packageDocumentationReceipts.push(argv[++i]);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node .codex/scripts/dotnet-testing-codex-full/validators/validate-unit-attempt-isolation.mjs --workflow <unit|tunit|integration|aspire> --test-project <project-file-or-directory> --artifact <path> [--artifact <path> ...] [--allow-read <path> ...] [--allow-codex-skill <id> ...] [--workspace-root <path>]",
    "",
    "Rejects external, prior-attempt/archive, undeclared .orchestrator reads, and out-of-workspace writes declared in declaredAccess (Unit) or tokenEstimateInputs (other workflows).",
    "Aspire Writer/Executor package XML provenance: --workflow aspire --workspace-root <root> --test-project <csproj> --package-documentation <xml> (read-only; no --artifact).",
    "Aspire Writer receipt: add --save-package-documentation --assignment-id <id> --writer-result <canonical-path> before reading XML.",
    "Aspire Writer first delivery: --write-writer-result <canonical-path> --assignment-id <id> [--package-documentation-receipt <path> ...]; complete JSON payload on stdin.",
  ].join("\n");
}

function canonical(root, value) {
  return path.normalize(path.isAbsolute(value) ? value : path.resolve(root, value));
}

function resolveTestProjectDir(testProject) {
  const projectFileExtensions = new Set([".csproj", ".fsproj", ".vbproj"]);
  return projectFileExtensions.has(path.extname(testProject).toLowerCase())
    ? path.dirname(testProject)
    : testProject;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSameCanonicalPath(left, right) {
  if (process.platform === "win32") return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function isAllowedCanonicalSelfRead(resolvedArtifact, resolvedRead, currentOrchestratorRoot) {
  if (!isSameCanonicalPath(resolvedArtifact, resolvedRead)) return false;

  const allowedArtifactTypes = [
    { directory: "analysis", suffix: ".analysis.json" },
    { directory: "writer-result", suffix: ".writer-result.json" },
    { directory: "writer-repair-result", suffix: ".writer-repair-result.json" },
    { directory: "executor-result", suffix: ".executor-result.json" },
    { directory: "executor-repair-result", suffix: ".executor-repair-result.json" },
    { directory: "reviewer-result", suffix: ".reviewer-result.json" },
    { directory: "reviewer-repair-result", suffix: ".reviewer-repair-result.json" },
  ];
  return allowedArtifactTypes.some(({ directory, suffix }) => (
    isSameCanonicalPath(path.dirname(resolvedArtifact), path.join(currentOrchestratorRoot, directory))
      && path.basename(resolvedArtifact).toLowerCase().endsWith(suffix)
  ));
}

function canonicalKey(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isCanonicalExecutorResult(resolvedPath, currentOrchestratorRoot) {
  return (
    isSameCanonicalPath(path.dirname(resolvedPath), path.join(currentOrchestratorRoot, "executor-result"))
      && path.basename(resolvedPath).toLowerCase().endsWith(".executor-result.json")
  ) || (
    isSameCanonicalPath(path.dirname(resolvedPath), path.join(currentOrchestratorRoot, "executor-repair-result"))
      && path.basename(resolvedPath).toLowerCase().endsWith(".executor-repair-result.json")
  );
}

function isCanonicalFullWriterResult(resolvedPath, currentOrchestratorRoot, artifact) {
  return artifact.writerTopology === "single" && artifact.assignmentRole === "full"
    && isSameCanonicalPath(path.dirname(resolvedPath), path.join(currentOrchestratorRoot, "writer-result"))
    && path.basename(resolvedPath).toLowerCase().endsWith(".writer-result.json");
}

function isAllowedExternalCodexSkillRead(resolvedPath, allowedCodexSkills) {
  const segments = path.normalize(resolvedPath).split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length - 2; index += 1) {
    if (segments[index].toLowerCase() !== ".codex" || segments[index + 1].toLowerCase() !== "skills") continue;
    return allowedCodexSkills.has(segments[index + 2].toLowerCase());
  }
  return false;
}

// Package documentation is a restored dependency, not workspace memory. This
// narrow Aspire Writer/Executor path uses the current test project's assets inventory;
// arbitrary external reads and every external write retain the original gate.
function packageDocumentationRead(documentationPath, workspaceRoot, testProject) {
  const realWorkspace = fs.realpathSync(workspaceRoot);
  const realProject = fs.realpathSync(testProject);
  if (!isWithin(realWorkspace, realProject) || !/\.csproj$/i.test(realProject)) {
    throw new Error("package documentation requires a workspace-local test csproj");
  }
  const assetsPath = path.join(path.dirname(realProject), "obj", "project.assets.json");
  if (!isWithin(realWorkspace, fs.realpathSync(assetsPath))) throw new Error("restore assets escaped workspace");
  const assetsBytes = fs.readFileSync(assetsPath);
  const assets = JSON.parse(assetsBytes.toString("utf8"));
  if (!isSameCanonicalPath(fs.realpathSync(assets.project?.restore?.projectPath), realProject)) {
    throw new Error("restore assets belong to another project");
  }
  const document = canonical(workspaceRoot, documentationPath);
  const realDocument = fs.realpathSync(document);
  if (!fs.statSync(document).isFile() || !/\.xml$/i.test(document)) throw new Error("package documentation must be an XML file");
  const matches = [];
  for (const [identity, library] of Object.entries(assets.libraries ?? {})) {
    const split = identity.lastIndexOf("/");
    const packageId = identity.slice(0, split), packageVersion = identity.slice(split + 1);
    if (library.type !== "package" || split < 1 || !Array.isArray(library.files)) continue;
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(packageId) || !/^[a-z0-9][a-z0-9.+-]*$/i.test(packageVersion)) continue;
    const packageRelative = `${packageId.toLowerCase()}/${packageVersion.toLowerCase()}`;
    if (library.path !== packageRelative) continue;
    for (const folder of Object.keys(assets.packageFolders ?? {})) {
      if (!path.isAbsolute(folder)) continue;
      const packageRoot = path.resolve(folder, packageRelative);
      const relative = path.relative(packageRoot, document).split(path.sep).join("/");
      if (!/^(lib|ref)\/[^/]+\/[^/]+\.xml$/i.test(relative) || !library.files.includes(relative)) continue;
      const realPackage = fs.realpathSync(packageRoot);
      if (!isWithin(realPackage, realDocument) || path.relative(realPackage, realDocument).split(path.sep).join("/") !== relative) {
        throw new Error("package documentation symlink escaped its restored package");
      }
      matches.push({ packageId, packageVersion });
    }
  }
  if (matches.length !== 1) throw new Error("XML must uniquely match a lib/ref file in the current restore inventory");
  const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
  return { path: document, reason: "restored-package-api-documentation", packageDocumentation: {
    assetsPath, assetsSha256: sha(assetsBytes), ...matches[0], documentationSha256: sha(fs.readFileSync(document)),
  } };
}

function isVerifiedPackageDocumentationRead(item, reads, workspaceRoot, testProject) {
  if (!item.packageDocumentation) return false;
  const expected = packageDocumentationRead(item.path, workspaceRoot, testProject);
  const actual = item.packageDocumentation;
  if (Object.keys(actual).length !== Object.keys(expected.packageDocumentation).length
    || Object.entries(expected.packageDocumentation).some(([key, value]) => actual[key] !== value)) {
    throw new Error("package documentation provenance does not match current assets/XML SHA-256");
  }
  if (!reads.some(read => typeof read?.path === "string" && isSameCanonicalPath(canonical(workspaceRoot, read.path), expected.packageDocumentation.assetsPath))) {
    throw new Error("package documentation must declare the current restore assets read");
  }
  return true;
}

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sameJson = (left, right) => {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  return Array.isArray(left) === Array.isArray(right)
    && Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every(key => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
};

// New writes are restricted to the assigned project. Resolve existing ancestors
// before mkdir/write so a junction cannot redirect either output outside it.
function verifyOwnedPath(workspaceRoot, file) {
  if (!isWithin(workspaceRoot, file)) throw new Error("Writer path is outside workspace");
  let ancestor = file;
  while (!fs.existsSync(ancestor)) {
    let entry;
    try { entry = fs.lstatSync(ancestor); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (entry?.isSymbolicLink()) fs.realpathSync(ancestor);
    ancestor = path.dirname(ancestor);
  }
  const expected = path.join(fs.realpathSync(workspaceRoot), path.relative(workspaceRoot, ancestor));
  if (!isSameCanonicalPath(fs.realpathSync(ancestor), expected)) throw new Error("Writer path symlink escaped canonical location");
}

function writerBinding(workspaceRoot, testProject, assignmentId, writerResult, producing) {
  if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(assignmentId ?? "") || assignmentId === "..") {
    throw new Error("canonical Writer assignment ID is required");
  }
  if (!/\.csproj$/i.test(testProject) || !isWithin(fs.realpathSync(workspaceRoot), fs.realpathSync(testProject))) {
    throw new Error("Writer requires a workspace-local test csproj");
  }
  const root = path.join(path.dirname(testProject), ".orchestrator");
  if (!isCanonicalFullWriterResult(writerResult, root, { writerTopology: "single", assignmentRole: "full" })) {
    throw new Error("Writer result is not a canonical full Writer path");
  }
  verifyOwnedPath(workspaceRoot, writerResult);
  const statePath = path.join(root, "run-state.json");
  verifyOwnedPath(workspaceRoot, statePath);
  const stateBytes = fs.readFileSync(statePath);
  const state = JSON.parse(stateBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const assignments = state.phases?.writer?.assignments;
  const matches = Array.isArray(assignments) ? assignments.filter(a => a.assignmentId === assignmentId) : [];
  const assignment = matches[0];
  const accepted = Date.parse(assignment?.dispatchAcceptedAt);
  if (state.workflow !== "aspire" || matches.length !== 1 || !Number.isFinite(accepted) || accepted > Date.now()
    || !assignment.agentId || !assignment.target || assignment.contextForkPolicy !== "none"
    || assignment.externalMemoryPolicy !== "forbid"
    || !isSameCanonicalPath(canonical(workspaceRoot, assignment.expectedArtifactPath ?? ""), writerResult)
    || assignments.filter(a => a.target === assignment.target).at(-1) !== assignment
    || assignments.some(a => a !== assignment && a.target === assignment.target
      && !a.completedAt && !["completed", "blocked", "failed"].includes(a.status))
    || assignment.redispatch) {
    throw new Error("Writer binding does not match the current accepted assignment");
  }
  if (producing && (assignment.artifactReadyAt || assignment.completedAt || assignment.failure
    || ["completed", "blocked", "failed"].includes(assignment.status)
    || ["completed", "blocked", "failed"].includes(state.phases.writer.status)
    || state.overallWallClock?.end || state.terminalDecision)) {
    throw new Error("Writer assignment is no longer producing");
  }
  const analysis = state.phases?.analyzer?.assignments?.filter(a => a.target === assignment.target).at(-1);
  const analysisPath = typeof analysis?.artifact === "string" ? canonical(workspaceRoot, analysis.artifact) : null;
  const allowedAnalysis = analysis?.status === "completed" && analysisPath
    && isSameCanonicalPath(analysisPath, canonical(workspaceRoot, analysis.expectedArtifactPath ?? ""))
    && isSameCanonicalPath(path.dirname(analysisPath), path.join(root, "analysis"))
    && path.basename(analysisPath).endsWith(".analysis.json") ? analysisPath : null;
  return { root, assignment, statePath, stateSha256: sha256(stateBytes), allowedAnalysis };
}

function documentationReceiptPath(root, assignmentId, document) {
  return path.join(root, "package-documentation", assignmentId, `${sha256(canonicalKey(document))}.json`);
}

function verifyDocumentationReceipt(receiptPath, workspaceRoot, testProject, assignmentId, writerResult, producing = false) {
  const binding = writerBinding(workspaceRoot, testProject, assignmentId, writerResult, producing);
  if (!isSameCanonicalPath(path.dirname(receiptPath), path.join(binding.root, "package-documentation", assignmentId))
    || !/^[a-f0-9]{64}\.json$/.test(path.basename(receiptPath))) throw new Error("package documentation receipt path is invalid");
  verifyOwnedPath(workspaceRoot, receiptPath);
  const bytes = fs.readFileSync(receiptPath);
  const receipt = JSON.parse(bytes.toString("utf8"));
  if (receipt.schemaVersion !== 1 || receipt.workspaceRoot !== workspaceRoot || receipt.testProjectPath !== testProject
    || receipt.assignmentId !== assignmentId || receipt.writerResultFilePath !== writerResult
    || !Array.isArray(receipt.readFiles) || receipt.readFiles.length !== 2) throw new Error("package documentation receipt binding is invalid");
  const original = receipt.readFiles[1];
  const entry = packageDocumentationRead(original?.path, workspaceRoot, testProject);
  const expectedReads = [{ path: entry.packageDocumentation.assetsPath, reason: "current-project-restore-inventory" }, entry];
  const created = Date.parse(receipt.createdAtUtc), ready = Date.parse(binding.assignment.artifactReadyAt);
  if (!Number.isFinite(created) || created < Date.parse(binding.assignment.dispatchAcceptedAt) || created > Date.now()
    || (Number.isFinite(ready) && created > ready)
    || !isSameCanonicalPath(receiptPath, documentationReceiptPath(binding.root, assignmentId, entry.path))
    || !sameJson(receipt.readFiles, expectedReads)) throw new Error("package documentation receipt path, timestamp or provenance is invalid");
  return { receipt, receiptPath, receiptSha256: sha256(bytes), binding };
}

function collectWriterReceipts(artifact, resolvedArtifact, args, workspaceRoot, testProject, currentOrchestratorRoot) {
  const list = artifact.tokenEstimateInputs?.packageDocumentationReceipts;
  if (list === undefined) return new Set(); // Historical inline provenance remains read-only and compatible.
  if (args.workflow !== "aspire" || !isCanonicalFullWriterResult(resolvedArtifact, currentOrchestratorRoot, artifact)
    || !Array.isArray(list)) throw new Error("package documentation receipts require a canonical Aspire full Writer");
  const paths = new Set(), documents = new Set();
  for (const item of list) {
    if (!item || Object.keys(item).length !== 2 || typeof item.receiptPath !== "string" || !/^[a-f0-9]{64}$/.test(item.receiptSha256 ?? "")) {
      throw new Error("invalid package documentation receipt declaration");
    }
    const receiptPath = canonical(workspaceRoot, item.receiptPath);
    verifyOwnedPath(workspaceRoot, receiptPath);
    const receiptAssignment = path.basename(path.dirname(receiptPath));
    const proof = verifyDocumentationReceipt(receiptPath, workspaceRoot, testProject, receiptAssignment, resolvedArtifact);
    if (proof.receiptSha256 !== item.receiptSha256 || paths.has(canonicalKey(receiptPath))) throw new Error("package documentation receipt SHA-256 or uniqueness mismatch");
    const reads = artifact.tokenEstimateInputs.readFiles;
    for (const entries of [reads, artifact.tokenEstimateInputs.writtenFiles]) {
      if (entries.filter(r => typeof r?.path === "string" && isSameCanonicalPath(canonical(workspaceRoot, r.path), receiptPath)).length !== 1) {
        throw new Error("receipt must declare its current Writer read and write");
      }
    }
    for (const original of proof.receipt.readFiles) {
      const declared = reads.filter(r => typeof r?.path === "string" && isSameCanonicalPath(canonical(workspaceRoot, r.path), original.path));
      if (declared.length !== 1 || !sameJson(declared[0], original)) throw new Error("receipt requires complete original inline provenance");
    }
    const document = canonicalKey(proof.receipt.readFiles[1].path);
    if (documents.has(document)) throw new Error("duplicate package XML receipt");
    documents.add(document); paths.add(canonicalKey(receiptPath));
  }
  return paths;
}

function saveDocumentation(args, workspaceRoot, testProject, writerResult) {
  const binding = writerBinding(workspaceRoot, testProject, args.assignmentId, writerResult, true);
  if (fs.existsSync(writerResult)) throw new Error("canonical Writer result already exists");
  const entry = packageDocumentationRead(args.packageDocumentation, workspaceRoot, testProject);
  const receiptPath = documentationReceiptPath(binding.root, args.assignmentId, entry.path);
  verifyOwnedPath(workspaceRoot, receiptPath);
  if (!fs.existsSync(receiptPath)) {
    const receipt = { schemaVersion: 1, workspaceRoot, testProjectPath: testProject, assignmentId: args.assignmentId,
      writerResultFilePath: writerResult, createdAtUtc: new Date().toISOString(),
      readFiles: [{ path: entry.packageDocumentation.assetsPath, reason: "current-project-restore-inventory" }, entry] };
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  }
  const proof = verifyDocumentationReceipt(receiptPath, workspaceRoot, testProject, args.assignmentId, writerResult, true);
  return { status: "saved-package-documentation", receiptPath, receiptSha256: proof.receiptSha256,
    readFiles: proof.receipt.readFiles, bindingVerification: { runStatePath: binding.statePath, runStateSha256: binding.stateSha256 } };
}

function serializeWriter(args, workspaceRoot, testProject, writerResult) {
  const binding = writerBinding(workspaceRoot, testProject, args.assignmentId, writerResult, true);
  if (fs.existsSync(writerResult)) throw new Error("canonical Writer result already exists");
  const artifact = JSON.parse(fs.readFileSync(0, "utf8").replace(/^\uFEFF/, ""));
  const root = path.join(path.dirname(testProject), ".orchestrator");
  if (!isCanonicalFullWriterResult(writerResult, root, artifact) || typeof artifact.writerResultFilePath !== "string"
    || !path.isAbsolute(artifact.writerResultFilePath)
    || !isSameCanonicalPath(canonical(workspaceRoot, artifact.writerResultFilePath), writerResult)) {
    throw new Error("payload must be the assigned single/full Writer result");
  }
  if (!["testFilePaths", "testClasses", "skillsLoaded", "endpointCoverage", "scenarioCoverage"].every(key => Array.isArray(artifact[key]))
    || !Number.isInteger(artifact.testCount) || artifact.testCount < 0
    || !Number.isInteger(artifact.testCaseCount) || artifact.testCaseCount < 0) throw new Error("complete Writer payload is required");
  const access = artifact.tokenEstimateInputs;
  if (!Array.isArray(access?.readFiles) || !Array.isArray(access?.writtenFiles)
    || Object.hasOwn(access, "packageDocumentationReceipts")) throw new Error("Writer payload access arrays are required; receipt declarations are runtime-owned");
  const proofs = args.packageDocumentationReceipts.map(p => verifyDocumentationReceipt(
    canonical(workspaceRoot, p), workspaceRoot, testProject, args.assignmentId, writerResult, true));
  if (new Set(proofs.map(p => canonicalKey(p.receiptPath))).size !== proofs.length) throw new Error("duplicate package documentation receipt");
  const proven = new Map(proofs.map(p => [canonicalKey(p.receipt.readFiles[1].path), p]));
  for (const proof of proofs) {
    if (!access.readFiles.some(r => typeof r?.path === "string" && isSameCanonicalPath(canonical(workspaceRoot, r.path), proof.receipt.readFiles[1].path))) {
      throw new Error("receipt XML was not declared as read by Writer");
    }
  }
  for (const read of access.readFiles) {
    if (typeof read?.path !== "string") continue; // The ordinary gate rejects malformed entries below.
    const resolved = canonical(workspaceRoot, read.path);
    if ((read.packageDocumentation || (!isWithin(workspaceRoot, resolved) && /\.xml$/i.test(resolved))) && !proven.has(canonicalKey(resolved))) {
      throw new Error("declared package XML requires its original assignment receipt");
    }
  }
  const originals = proofs.flatMap(p => p.receipt.readFiles);
  for (const original of originals) {
    const matches = access.readFiles.filter(r => typeof r?.path === "string" && isSameCanonicalPath(canonical(workspaceRoot, r.path), original.path));
    if (matches.some(r => r.packageDocumentation && !sameJson(r.packageDocumentation, original.packageDocumentation))) {
      throw new Error("payload package documentation conflicts with original receipt");
    }
    access.readFiles = access.readFiles.filter(r => typeof r?.path !== "string" || !isSameCanonicalPath(canonical(workspaceRoot, r.path), original.path));
    access.readFiles.push(original);
  }
  access.packageDocumentationReceipts = proofs.map(({ receiptPath, receiptSha256 }) => ({ receiptPath, receiptSha256 }));
  const add = (list, file, reason) => {
    if (!list.some(r => typeof r?.path === "string" && isSameCanonicalPath(canonical(workspaceRoot, r.path), file))) list.push({ path: file, reason });
  };
  for (const proof of proofs) {
    add(access.readFiles, proof.receiptPath, "current-Writer-package-documentation-receipt");
    add(access.writtenFiles, proof.receiptPath, "saved-Writer-package-documentation-receipt");
  }
  add(access.writtenFiles, writerResult, "writer handoff artifact");
  for (const item of [...access.readFiles, ...access.writtenFiles]) {
    if (typeof item?.path === "string") {
      const resolved = canonical(workspaceRoot, item.path);
      if (isWithin(workspaceRoot, resolved)) verifyOwnedPath(workspaceRoot, resolved);
    }
  }
  validateArtifacts({ ...args, artifacts: [writerResult], allowedReads: binding.allowedAnalysis ? [binding.allowedAnalysis] : [] },
    workspaceRoot, testProject, new Map([[canonicalKey(writerResult), artifact]]));
  verifyOwnedPath(workspaceRoot, writerResult);
  fs.mkdirSync(path.dirname(writerResult), { recursive: true });
  const bytes = `${JSON.stringify(artifact, null, 2)}\n`;
  fs.writeFileSync(writerResult, bytes, { flag: "wx" });
  return { status: "written-writer-result", canonicalPath: writerResult, artifactSha256: sha256(bytes), receiptPaths: proofs.map(p => p.receiptPath),
    bindingVerification: { runStatePath: binding.statePath, runStateSha256: binding.stateSha256 } };
}

function isCanonicalReviewerResult(resolvedPath, currentOrchestratorRoot) {
  return (
    isSameCanonicalPath(path.dirname(resolvedPath), path.join(currentOrchestratorRoot, "reviewer-result"))
      && path.basename(resolvedPath).toLowerCase().endsWith(".reviewer-result.json")
  ) || (
    isSameCanonicalPath(path.dirname(resolvedPath), path.join(currentOrchestratorRoot, "reviewer-repair-result"))
      && path.basename(resolvedPath).toLowerCase().endsWith(".reviewer-repair-result.json")
  );
}

function executorTargetName(executorArtifactPath) {
  const basename = path.basename(executorArtifactPath);
  for (const suffix of [".executor-result.json", ".executor-repair-result.json"]) {
    if (basename.toLowerCase().endsWith(suffix)) return basename.slice(0, -suffix.length);
  }
  return null;
}

function resolveExecutionEvidencePath(declaredPath, workspaceRoot, currentOrchestratorRoot, expectedTarget = null) {
  if (typeof declaredPath !== "string" || declaredPath.trim() === "") return null;

  const resolvedPath = canonical(workspaceRoot, declaredPath);
  if (!isWithin(currentOrchestratorRoot, resolvedPath)) return null;

  const relativePath = path.relative(currentOrchestratorRoot, resolvedPath);
  const segments = relativePath.split(path.sep);
  const evidenceDirectory = segments[0]?.toLowerCase();
  if (evidenceDirectory !== "execution-evidence") return null;
  if (segments.length !== 3) return null;
  if (expectedTarget && canonicalKey(segments[1]) !== canonicalKey(expectedTarget)) return null;
  if (!/^attempt-\d+\.execution\.json$/i.test(path.basename(resolvedPath))) return null;

  return resolvedPath;
}

function resolveDeclaredExecutionEvidence(document, workspaceRoot, currentOrchestratorRoot, executorArtifactPath = null) {
  return resolveExecutionEvidencePath(
    document?.finalExecutionEvidencePath,
    workspaceRoot,
    currentOrchestratorRoot,
    executorArtifactPath ? executorTargetName(executorArtifactPath) : null,
  );
}

function resolveDeclaredExecutionHistory(document, executorArtifactPath, workspaceRoot, currentOrchestratorRoot) {
  const finalEvidence = resolveDeclaredExecutionEvidence(
    document,
    workspaceRoot,
    currentOrchestratorRoot,
    executorArtifactPath,
  );
  if (!Array.isArray(document?.executionEvidencePaths)) {
    return finalEvidence ? [finalEvidence] : [];
  }
  if (document.executionEvidencePaths.length === 0) {
    throw new Error("executionEvidencePaths must not be empty when provided");
  }

  const target = executorTargetName(executorArtifactPath);
  const resolved = document.executionEvidencePaths.map((declaredPath, index) => {
    const evidencePath = resolveExecutionEvidencePath(
      declaredPath,
      workspaceRoot,
      currentOrchestratorRoot,
      target,
    );
    if (!evidencePath) throw new Error(`executionEvidencePaths[${index}] is not canonical for the current target`);
    return evidencePath;
  });
  if (new Set(resolved.map(canonicalKey)).size !== resolved.length) {
    throw new Error("executionEvidencePaths must contain unique paths");
  }
  if (!finalEvidence || !isSameCanonicalPath(resolved.at(-1), finalEvidence)) {
    throw new Error("executionEvidencePaths must end with finalExecutionEvidencePath");
  }

  let previousAttempt = -1;
  for (const [index, evidencePath] of resolved.entries()) {
    const filenameAttempt = Number.parseInt(path.basename(evidencePath).match(/^attempt-(\d+)\.execution\.json$/i)[1], 10);
    let evidence;
    try {
      evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    } catch (error) {
      throw new Error(`executionEvidencePaths[${index}] is unreadable or invalid JSON (${error.message})`);
    }
    if (evidence?.attempt?.executionAttempt !== filenameAttempt) {
      throw new Error(`executionEvidencePaths[${index}] attempt does not match its filename`);
    }
    if (filenameAttempt <= previousAttempt) {
      throw new Error("executionEvidencePaths attempts must be strictly increasing");
    }
    previousAttempt = filenameAttempt;
  }
  return resolved;
}

function collectDeclaredCurrentExecutionEvidence({
  artifact,
  resolvedArtifact,
  allowedReadPaths,
  workspaceRoot,
  currentOrchestratorRoot,
}) {
  const declaredEvidence = new Set();
  const addExecutorPointer = (document, executorArtifactPath) => {
    if (!isCanonicalExecutorResult(executorArtifactPath, currentOrchestratorRoot)) return;
    const resolvedEvidence = resolveDeclaredExecutionHistory(
      document,
      executorArtifactPath,
      workspaceRoot,
      currentOrchestratorRoot,
    );
    for (const evidencePath of resolvedEvidence) declaredEvidence.add(canonicalKey(evidencePath));
  };

  addExecutorPointer(artifact, resolvedArtifact);
  for (const allowedReadPath of allowedReadPaths) {
    if (!isCanonicalExecutorResult(allowedReadPath, currentOrchestratorRoot)) continue;
    try {
      addExecutorPointer(JSON.parse(fs.readFileSync(allowedReadPath, "utf8")), allowedReadPath);
    } catch {
      // Invalid allowed-read artifacts cannot authorize execution evidence.
    }
  }
  return declaredEvidence;
}

function hasForbiddenSegment(relativeValue) {
  const segments = relativeValue.split(/[\\/]+/).filter(Boolean);
  const basename = segments.at(-1) ?? "";
  const marker = /(?:^|[-_.])(?:attempt|archive|retained)(?:$|[-_.])/i;
  return segments.slice(0, -1).some((segment) => marker.test(segment))
    || /^attempt-\d+(?:[-_.].*)?$/i.test(basename);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.testProject) throw new Error("--test-project is required");
  if (args.artifacts.length === 0 && !args.packageDocumentation && !args.writeWriterResult) throw new Error("at least one --artifact is required");
  if (!new Set(["unit", "tunit", "integration", "aspire"]).has(args.workflow)) {
    throw new Error(`--workflow must be unit, tunit, integration, or aspire, got: ${args.workflow}`);
  }
  for (const skillId of args.allowedCodexSkills) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillId)) {
      throw new Error(`--allow-codex-skill must be a canonical skill id, got: ${skillId}`);
    }
  }

  const workspaceRoot = canonical(process.cwd(), args.workspaceRoot);
  const testProject = canonical(workspaceRoot, args.testProject);
  const testProjectDir = resolveTestProjectDir(testProject);
  const currentOrchestratorRoot = path.join(testProjectDir, ".orchestrator");
  const writerOperation = args.savePackageDocumentation || args.writeWriterResult;
  if (writerOperation) {
    if (args.workflow !== "aspire" || args.artifacts.length || args.allowedReads.length || args.allowedCodexSkills.length
      || (args.savePackageDocumentation && (!args.packageDocumentation || !args.writerResult || args.writeWriterResult || args.packageDocumentationReceipts.length))
      || (args.writeWriterResult && (args.packageDocumentation || args.writerResult))) throw new Error("Writer delivery is a standalone Aspire operation");
    const writerResult = canonical(workspaceRoot, args.writeWriterResult ?? args.writerResult);
    const result = args.savePackageDocumentation ? saveDocumentation(args, workspaceRoot, testProject, writerResult)
      : serializeWriter(args, workspaceRoot, testProject, writerResult);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (args.assignmentId || args.writerResult || args.packageDocumentationReceipts.length) throw new Error("Writer options require a Writer operation");
  if (args.packageDocumentation) {
    if (args.workflow !== "aspire" || args.artifacts.length || args.allowedReads.length || args.allowedCodexSkills.length) {
      throw new Error("package documentation inspection is a standalone Aspire operation");
    }
    const entry = packageDocumentationRead(args.packageDocumentation, workspaceRoot, testProject);
    process.stdout.write(`${JSON.stringify({ status: "verified-package-documentation", readFiles: [
      { path: entry.packageDocumentation.assetsPath, reason: "current-project-restore-inventory" }, entry,
    ] }, null, 2)}\n`);
    return;
  }
  const result = validateArtifacts(args, workspaceRoot, testProject);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function validateArtifacts(args, workspaceRoot, testProject, inMemory = new Map()) {
  const currentOrchestratorRoot = path.join(resolveTestProjectDir(testProject), ".orchestrator");
  const allowedReadPaths = args.allowedReads.map((value) => canonical(workspaceRoot, value));
  const allowedReads = new Set(allowedReadPaths.map(canonicalKey));
  const allowedCodexSkills = new Set(args.allowedCodexSkills.map((value) => value.toLowerCase()));
  const currentAssignmentArtifacts = new Set(
    args.artifacts.map((value) => canonicalKey(canonical(workspaceRoot, value))),
  );
  const errors = [];
  let readCount = 0;
  let writeCount = 0;

  for (const artifactPath of args.artifacts) {
    const resolvedArtifact = canonical(workspaceRoot, artifactPath);
    let artifact;
    try {
      artifact = inMemory.get(canonicalKey(resolvedArtifact)) ?? JSON.parse(fs.readFileSync(resolvedArtifact, "utf8"));
    } catch (error) {
      errors.push(`${artifactPath}: unreadable or invalid JSON (${error.message})`);
      continue;
    }
    const unit = args.workflow === "unit";
    const access = unit ? artifact.declaredAccess : artifact.tokenEstimateInputs;
    const reads = access?.readFiles;
    const writes = access?.writtenFiles;
    if (!unit && (!Array.isArray(reads) || !Array.isArray(writes))) {
      if (!Array.isArray(reads)) errors.push(`${artifactPath}: tokenEstimateInputs.readFiles must be an array`);
      if (!Array.isArray(writes)) errors.push(`${artifactPath}: tokenEstimateInputs.writtenFiles must be an array`);
      continue;
    }
    // Unit declarations are partial self-reports, not proof of complete access.
    // Normalize only in memory; never rewrite artifacts or their seals.
    const readEntries = (Array.isArray(reads) ? reads : []).map((item) =>
      typeof item === "string" && unit ? { path: item } : item);
    const writeEntries = (Array.isArray(writes) ? writes : []).map((item) =>
      typeof item === "string" && unit ? { path: item } : item);
    const writerReceipts = collectWriterReceipts(artifact, resolvedArtifact, args, workspaceRoot, testProject, currentOrchestratorRoot);
    const declaredCurrentExecutionEvidence = collectDeclaredCurrentExecutionEvidence({
      artifact,
      resolvedArtifact,
      allowedReadPaths,
      workspaceRoot,
      currentOrchestratorRoot,
    });
    const declaredCurrentExecutionWrites = new Set();
    if (isCanonicalExecutorResult(resolvedArtifact, currentOrchestratorRoot)) {
      const resolvedEvidence = resolveDeclaredExecutionHistory(
        artifact,
        resolvedArtifact,
        workspaceRoot,
        currentOrchestratorRoot,
      );
      for (const evidencePath of resolvedEvidence) {
        declaredCurrentExecutionWrites.add(canonicalKey(evidencePath));
      }
    }
    for (const [index, item] of readEntries.entries()) {
      readCount += 1;
      const label = `${artifactPath}: readFiles[${index}]`;
      if (!item || typeof item.path !== "string" || item.path.trim() === "") {
        if (!unit) errors.push(`${label}.path must be a non-empty string`);
        continue;
      }
      let resolvedRead;
      try {
        if (item.path.includes("\0")) throw new Error("invalid path");
        resolvedRead = canonical(workspaceRoot, item.path);
      } catch (error) {
        if (!unit) throw error;
        continue;
      }
      if (!isWithin(workspaceRoot, resolvedRead)) {
        let packageRead = false;
        const packageDocumentationRole = isCanonicalExecutorResult(resolvedArtifact, currentOrchestratorRoot)
          || isCanonicalFullWriterResult(resolvedArtifact, currentOrchestratorRoot, artifact);
        if (args.workflow === "aspire" && packageDocumentationRole && item.packageDocumentation) {
          try { packageRead = isVerifiedPackageDocumentationRead(item, readEntries, workspaceRoot, testProject); }
          catch (error) { errors.push(`${label}: ${error.message}`); }
        }
        if (!packageRead && !isAllowedExternalCodexSkillRead(resolvedRead, allowedCodexSkills)) {
          errors.push(`${label} is outside workspace: ${item.path}`);
        }
        continue;
      }
      const workspaceRelativeRead = path.relative(workspaceRoot, resolvedRead);
      const isCurrentAssignmentSibling = (
        !isSameCanonicalPath(resolvedArtifact, resolvedRead)
        && currentAssignmentArtifacts.has(canonicalKey(resolvedRead))
      );
      const isDeclaredCurrentExecutionEvidence = declaredCurrentExecutionEvidence.has(canonicalKey(resolvedRead));
      const isWriterReceipt = writerReceipts.has(canonicalKey(resolvedRead));
      if (
        hasForbiddenSegment(workspaceRelativeRead)
        && !isDeclaredCurrentExecutionEvidence
        && !isWriterReceipt
      ) {
        errors.push(`${label} contains prior-attempt/archive marker: ${item.path}`);
        continue;
      }
      const segments = workspaceRelativeRead.split(path.sep);
      const hasOrchestratorSegment = segments.some((segment) => segment.toLowerCase().startsWith(".orchestrator"));
      if (hasOrchestratorSegment) {
        const allowedCanonicalSelfRead = isAllowedCanonicalSelfRead(
          resolvedArtifact,
          resolvedRead,
          currentOrchestratorRoot,
        );
        if (!isWithin(currentOrchestratorRoot, resolvedRead)) {
          errors.push(`${label} references another orchestrator root: ${item.path}`);
        } else if (
          !allowedCanonicalSelfRead
          && !isCurrentAssignmentSibling
          && !isDeclaredCurrentExecutionEvidence
          && !isWriterReceipt
          && !allowedReads.has(canonicalKey(resolvedRead))
        ) {
          errors.push(`${label} is not an allowed current-run artifact: ${item.path}`);
        }
      }
    }
    for (const [index, item] of writeEntries.entries()) {
      writeCount += 1;
      const label = `${artifactPath}: writtenFiles[${index}]`;
      if (!item || typeof item.path !== "string" || item.path.trim() === "") {
        if (!unit) errors.push(`${label}.path must be a non-empty string`);
        continue;
      }
      let resolvedWrite;
      try {
        if (item.path.includes("\0")) throw new Error("invalid path");
        resolvedWrite = canonical(workspaceRoot, item.path);
      } catch (error) {
        if (!unit) throw error;
        continue;
      }
      if (!isWithin(workspaceRoot, resolvedWrite)) {
        errors.push(`${label} is outside workspace: ${item.path}`);
        continue;
      }
      const workspaceRelativeWrite = path.relative(workspaceRoot, resolvedWrite);
      const isCurrentAssignmentSibling = (
        !isSameCanonicalPath(resolvedArtifact, resolvedWrite)
        && currentAssignmentArtifacts.has(canonicalKey(resolvedWrite))
      );
      const isDeclaredCurrentExecutionWrite = declaredCurrentExecutionWrites.has(canonicalKey(resolvedWrite));
      const isWriterReceipt = writerReceipts.has(canonicalKey(resolvedWrite));
      if (hasForbiddenSegment(workspaceRelativeWrite) && !isDeclaredCurrentExecutionWrite && !isWriterReceipt) {
        errors.push(`${label} contains prior-attempt/archive marker: ${item.path}`);
        continue;
      }
      const segments = workspaceRelativeWrite.split(path.sep);
      const hasOrchestratorSegment = segments.some((segment) => segment.toLowerCase().startsWith(".orchestrator"));
      if (hasOrchestratorSegment) {
        if (!isWithin(currentOrchestratorRoot, resolvedWrite)) {
          errors.push(`${label} references another orchestrator root: ${item.path}`);
        } else if (
          !isSameCanonicalPath(resolvedArtifact, resolvedWrite)
          && !isCurrentAssignmentSibling
          && !isDeclaredCurrentExecutionWrite
          && !isWriterReceipt
        ) {
          errors.push(`${label} is not the current assignment artifact: ${item.path}`);
        }
      }
    }
  }

  if (errors.length > 0) throw new Error(`attempt isolation validation failed:\n- ${errors.join("\n- ")}`);
  return { status: "valid", workflow: args.workflow, artifactCount: args.artifacts.length, readCount, writeCount };
}

try {
  main();
} catch (error) {
  process.stderr.write(`validate-unit-attempt-isolation error: ${error.message}\n`);
  process.exitCode = 1;
}
