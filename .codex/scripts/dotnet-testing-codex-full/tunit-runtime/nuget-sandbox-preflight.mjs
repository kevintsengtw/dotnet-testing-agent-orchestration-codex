#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WORKFLOW = "tunit";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--workspace-root") result.workspaceRoot = path.resolve(argv[++index]);
    else if (argument === "--project") result.project = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!result.workspaceRoot || !result.project) throw new Error("--workspace-root and --project are required");
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

function locateProjectAssetsFile(project, env) {
  const evaluated = spawnSync("dotnet", [
    "msbuild",
    project,
    "-nologo",
    "-getProperty:ProjectAssetsFile",
  ], {
    cwd: path.dirname(project),
    encoding: "utf8",
    env,
    windowsHide: true,
  });
  if (!evaluated.error && evaluated.status === 0) {
    const candidate = String(evaluated.stdout ?? "")
      .split(/\r?\n/u)
      .map((line) => line.trim().replace(/^"|"$/gu, ""))
      .findLast((line) => line.toLowerCase().endsWith("project.assets.json"));
    if (candidate) return path.resolve(path.dirname(project), candidate);
  }
  return path.join(path.dirname(project), "obj", "project.assets.json");
}

export function readRestoreDiagnostics(project, env) {
  const projectAssetsPath = locateProjectAssetsFile(project, env);
  let document;
  try {
    document = JSON.parse(fs.readFileSync(projectAssetsPath, "utf8"));
  } catch (error) {
    stop("restore-diagnostics-unavailable", "NuGet restore succeeded, but project.assets.json diagnostics could not be read.", {
      project,
      projectAssetsPath,
      error: error.message,
    });
  }
  const entries = Array.isArray(document.logs)
    ? document.logs.map((entry) => ({
      code: typeof entry?.code === "string" ? entry.code : "",
      level: typeof entry?.level === "string" ? entry.level : "",
      warningLevel: Number.isInteger(entry?.warningLevel) ? entry.warningLevel : null,
      message: typeof entry?.message === "string" ? entry.message : "",
    }))
    : [];
  return {
    source: projectAssetsPath,
    warningCount: entries.filter((entry) => entry.level.toLowerCase() === "warning").length,
    errorCount: entries.filter((entry) => entry.level.toLowerCase() === "error").length,
    entries,
  };
}

function main() {
  const { workspaceRoot, project } = parseArgs(process.argv.slice(2));
  const relativeProject = path.relative(workspaceRoot, project);
  if (relativeProject.startsWith("..") || path.isAbsolute(relativeProject)) {
    stop("project-outside-workspace", "NuGet preflight project must stay inside workspaceRoot.", { workspaceRoot, project });
  }
  if (!fs.existsSync(project) || !fs.statSync(project).isFile()) {
    stop("restore-project-missing", "NuGet preflight project does not exist.", { project });
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

  const restoreDiagnostics = readRestoreDiagnostics(project, process.env);
  process.stdout.write(`${JSON.stringify({
    status: "ready",
    workflow: WORKFLOW,
    project,
    packages,
    restoreExitCode: restore.status,
    restoreDiagnostics,
  })}\n`);
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) main();
