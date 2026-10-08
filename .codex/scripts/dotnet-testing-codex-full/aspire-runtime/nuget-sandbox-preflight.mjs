#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WORKFLOW = "aspire";

export function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--workspace-root") result.workspaceRoot = path.resolve(argv[++index]);
    else if (argument === "--project") result.project = path.resolve(argv[++index]);
    else if (argument === "--require-blank-start") result.requireBlankStart = true;
    else if (argument === "--docker-only") result.dockerOnly = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!result.workspaceRoot || (!result.dockerOnly && !result.project)) throw new Error("--workspace-root and --project are required unless --docker-only is used");
  if (result.dockerOnly && (result.project || result.requireBlankStart)) throw new Error("--docker-only cannot restore or verify a test project");
  return result;
}

function remediation() {
  return [
    "確認目前 workspace 已受信任，讓 Codex 載入專案的 Skills、agents 與設定。",
    "依回報的 NuGet 錯誤檢查 NuGet.Config、套件來源與快取權限；NUGET_PACKAGES 只有指定自訂快取時才需要設定。",
    "若快取沒有必要套件，依組織政策設定可用的內部 NuGet feed；只有政策允許時才在專案層選用 sandbox_workspace_write.network_access=true。",
    "不需要也不應為本工作流程改寫使用者層 ~/.codex/config.toml。",
  ];
}

function stop(kind, message, details = {}) {
  process.stderr.write(`${JSON.stringify({ status: "blocked", workflow: WORKFLOW, kind, message, remediation: remediation(), ...details }, null, 2)}\n`);
  process.exit(1);
}

export function verifyBlankStart(project) {
  const entries = fs.readdirSync(path.dirname(project), { withFileTypes: true });
  const unexpected = entries.filter(entry => !entry.isFile() || entry.name !== path.basename(project)).map(entry => entry.name);
  if (unexpected.length) throw new Error(`空白起點未成立：${unexpected.join(", ")}`);
  return { status: "blank", verifiedBeforeRestore: true, entries: entries.map(entry => entry.name) };
}

// A separate entry check: no project/cache reads, restore, or artifact writes.
export function verifyDocker(workspaceRoot, spawn = spawnSync) {
  const args = ["info", "--format", "{{json .}}"];
  const result = spawn("docker", args, {
    cwd: workspaceRoot, encoding: "utf8", env: process.env, windowsHide: true,
    timeout: 15000, maxBuffer: 1024 * 1024,
  });
  const evidence = {
    command: "docker", arguments: args, workdir: workspaceRoot,
    exitCode: result.status ?? null, signal: result.signal ?? null,
    stdout: result.stdout ?? "", stderr: result.stderr ?? "",
    error: result.error ? { code: result.error.code ?? null, message: result.error.message } : null,
  };
  let daemon = null;
  try { daemon = JSON.parse(evidence.stdout); } catch { /* retain the original output */ }
  if (!result.error && result.status === 0 && typeof daemon?.ServerVersion === "string" && daemon.ServerVersion.trim()) {
    return { status: "ready", workflow: WORKFLOW, check: "docker", serverVersion: daemon.ServerVersion, evidence };
  }
  const output = `${evidence.stdout}\n${evidence.stderr}\n${evidence.error?.message ?? ""}`;
  const kind = result.error?.code === "ENOENT" ? "docker-cli-unavailable"
    : result.error?.code === "ETIMEDOUT" ? "docker-check-timeout"
    : ["EACCES", "EPERM"].includes(result.error?.code) || /access is denied|permission denied|存取被拒|拒絕存取/i.test(output) ? "docker-access-denied"
    : "docker-daemon-unavailable";
  const messages = {
    "docker-cli-unavailable": "找不到 Docker CLI，Aspire 流程尚未啟動。",
    "docker-check-timeout": "Docker 檢查超過 15 秒，尚未確認 daemon 可用。",
    "docker-access-denied": "Docker 設定或 daemon 存取遭拒；不能據此判定 Docker 未啟動。",
    "docker-daemon-unavailable": "Docker daemon 未回傳有效 ServerVersion；確認 Docker Desktop／daemon 與連線環境。",
  };
  return { status: "blocked", workflow: WORKFLOW, check: "docker", kind, message: messages[kind], evidence,
    remediation: ["確認 Docker Desktop／daemon 已啟動且目前連線可用，再重新下達任務。", "存取遭拒時由 Orchestrator 依工具政策處理；不自動啟動 Docker 或修改設定。"],
    nuget: "not-run", roles: "not-run", build: "not-run", test: "not-run" };
}

function main() {
  const { workspaceRoot, project, requireBlankStart, dockerOnly } = parseArgs(process.argv.slice(2));
  if (dockerOnly) {
    const result = verifyDocker(workspaceRoot);
    const output = result.status === "ready" ? process.stdout : process.stderr;
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === "ready" ? 0 : 1;
    return;
  }
  const relativeProject = path.relative(workspaceRoot, project);
  if (relativeProject.startsWith("..") || path.isAbsolute(relativeProject)) {
    stop("project-outside-workspace", "NuGet preflight project must stay inside workspaceRoot.", { workspaceRoot, project });
  }
  if (!fs.existsSync(project) || !fs.statSync(project).isFile()) {
    stop("restore-project-missing", "NuGet preflight project does not exist.", { project });
  }
  const realRelative = path.relative(fs.realpathSync(workspaceRoot), fs.realpathSync(project));
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    stop("project-outside-workspace", "NuGet preflight project resolved outside workspaceRoot.", { workspaceRoot, project });
  }
  let startingPoint = null;
  if (requireBlankStart) {
    try { startingPoint = verifyBlankStart(project); }
    catch (error) { stop("test-start-not-blank", error.message, { project, verifiedBeforeRestore: true }); }
  }

  const packages = process.env.NUGET_PACKAGES || null;
  if (packages) {
    if (!path.isAbsolute(packages) || !fs.existsSync(packages) || !fs.statSync(packages).isDirectory()) {
      stop("nuget-cache-unavailable", "NUGET_PACKAGES must be an accessible absolute package-cache directory.", { packages });
    }
    try {
      fs.accessSync(packages, fs.constants.R_OK);
    } catch (error) {
      stop("nuget-cache-unavailable", "NUGET_PACKAGES is not readable in the current Codex sandbox.", { packages, error: error.message });
    }
  }

  const restore = spawnSync("dotnet", [
    "restore",
    project,
    ...(packages ? ["--packages", packages] : []),
    "--ignore-failed-sources",
    "--verbosity",
    "minimal",
  ], {
    cwd: path.dirname(project),
    encoding: "utf8",
    env: process.env,
    windowsHide: true,
  });

  if (restore.error) stop("dotnet-unavailable", "Unable to start dotnet restore for the NuGet sandbox preflight.", { error: restore.error.message });
  if (restore.status !== 0) {
    stop("nuget-restore-unavailable", "The exact project cannot restore with the current cache, feeds, and sandbox policy.", {
      project,
      packages,
      exitCode: restore.status,
      output: `${restore.stdout ?? ""}${restore.stderr ?? ""}`.slice(-8000),
    });
  }

  process.stdout.write(`${JSON.stringify({ status: "ready", workflow: WORKFLOW, project, packages, restoreExitCode: restore.status,
    ...(startingPoint ? { startingPoint } : {}) })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
