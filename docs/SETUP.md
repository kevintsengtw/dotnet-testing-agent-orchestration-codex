# 安裝與環境設定

本文件提供完整的安裝步驟與常見問題解決。根目錄 README 提供簡版安裝說明，本文提供更完整的設定指南。

本版發佈的是 **Orchestrator 契約本身**（4 個 Orchestrator Skill + 16 個 Subagent + `dotnet-test`）。完整可運作環境 = 本 repo 內容 **＋** 技術型 Agent Skills（步驟 2）。

---

## 目錄

1. [系統需求](#1-系統需求)
2. [安裝步驟](#2-安裝步驟)
3. [常見問題排查](#3-常見問題排查)

---

## 1. 系統需求

### 必要

| 項目         | 說明                                                          |
| ------------ | ------------------------------------------------------------- |
| **Codex**    | 支援原生 SpawnAgent / multi-agent，用於執行 1+4 工作流程      |
| **.NET SDK** | 支援 net8.0 / net9.0 / net10.0，至少安裝一個版本              |

> **Docker**：**integration / aspire 工作流程必需**（啟動真實容器）；**unit / tunit 不需要**。aspire 以 `Aspire.AppHost.Sdk` 9.0+ NuGet 提供，**免安裝 Aspire workload**。
> **Node.js**（任一近期 LTS）：**僅 Estimated Token Usage 需要**（執行 `.codex/scripts/estimate-token-usage.mjs`）；估算器零相依、無需 `npm install`，不影響四階段測試流程本身。

### 驗證必要工具已安裝

```bash
dotnet --list-sdks
```

---

## 2. 安裝步驟

### 步驟 1：取得本 repo 的 `.codex/` 內容

將本 repo 的 `.codex/` 放入你的專案根目錄（或合併進既有 `.codex/`）。內含 **4 個 Orchestrator Skill + 16 個 Subagent**（unit 的 4 個 `dotnet-testing-*` + tunit / integration / aspire 各 4 個 `dotnet-testing-advanced-*-*`）：

```text
.codex/
├── agents/
│   ├── dotnet-testing-analyzer.toml            ← unit
│   ├── dotnet-testing-writer.toml
│   ├── dotnet-testing-executor.toml
│   ├── dotnet-testing-reviewer.toml
│   ├── dotnet-testing-advanced-tunit-*.toml         （analyzer/writer/executor/reviewer）
│   ├── dotnet-testing-advanced-integration-*.toml   （analyzer/writer/executor/reviewer）
│   └── dotnet-testing-advanced-aspire-*.toml        （analyzer/writer/executor/reviewer）
├── config.toml
├── scripts/                                    ← Estimated Token Usage 估算器
└── skills/
    ├── dotnet-test/
    ├── dotnet-testing-orchestrator-unit/
    ├── dotnet-testing-orchestrator-tunit/
    ├── dotnet-testing-orchestrator-integration/
    └── dotnet-testing-orchestrator-aspire/
```

也可以直接 clone 本 repo 後複製 `.codex/`：

```bash
git clone https://github.com/kevintsengtw/dotnet-testing-agent-orchestration-codex.git
cd dotnet-testing-agent-orchestration-codex
```

### 步驟 2：安裝 Agent Skills（dotnet-testing-agent-skills）

Writer 撰寫測試時，會依 Analyzer 判定的技術需求，載入對應的技術型 Agent Skill（例如 `nsubstitute-mocking`、`datetime-testing-timeprovider`、`filesystem-testing-abstractions`）以確保輸出符合最佳實踐。這些 Skill **不內含於本 repo**，由獨立 repo [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 提供。

**直接複製即可**：從 [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 取得各 skill 目錄，複製到本專案的 **`.codex/skills/`** 下（無需 `npx`，無需任何套件管理器）。

複製後，`.codex/skills/` 下會新增以下 **29 個** 技術型 Agent Skill：

```text
dotnet-testing/
dotnet-testing-advanced/
dotnet-testing-advanced-aspire-testing/
dotnet-testing-advanced-aspnet-integration-testing/
dotnet-testing-advanced-testcontainers-database/
dotnet-testing-advanced-testcontainers-nosql/
dotnet-testing-advanced-tunit-advanced/
dotnet-testing-advanced-tunit-fundamentals/
dotnet-testing-advanced-webapi-integration-testing/
dotnet-testing-advanced-xunit-upgrade-guide/
dotnet-testing-autodata-xunit-integration/
dotnet-testing-autofixture-basics/
dotnet-testing-autofixture-bogus-integration/
dotnet-testing-autofixture-customization/
dotnet-testing-autofixture-nsubstitute-integration/
dotnet-testing-awesome-assertions-guide/
dotnet-testing-bogus-fake-data/
dotnet-testing-code-coverage-analysis/
dotnet-testing-complex-object-comparison/
dotnet-testing-datetime-testing-timeprovider/
dotnet-testing-filesystem-testing-abstractions/
dotnet-testing-fluentvalidation-testing/
dotnet-testing-nsubstitute-mocking/
dotnet-testing-private-internal-testing/
dotnet-testing-test-data-builder-pattern/
dotnet-testing-test-naming-conventions/
dotnet-testing-test-output-logging/
dotnet-testing-unit-test-fundamentals/
dotnet-testing-xunit-project-setup/
```

### 步驟 3：確認完整 `.codex/` 目錄結構

完成步驟 1、2 後，`.codex/` 的完整預期結構如下：

```text
.codex/
├── agents/                                ← 本 repo 內建（16 個 subagent，.toml）
│   ├── dotnet-testing-{analyzer,writer,executor,reviewer}.toml            ← unit
│   ├── dotnet-testing-advanced-tunit-{analyzer,writer,executor,reviewer}.toml
│   ├── dotnet-testing-advanced-integration-{analyzer,writer,executor,reviewer}.toml
│   └── dotnet-testing-advanced-aspire-{analyzer,writer,executor,reviewer}.toml
│
├── config.toml                            ← 本 repo 內建（啟用 multi_agent）
├── scripts/                               ← 本 repo 內建（Estimated Token Usage 估算器）
│
└── skills/
    │
    │   ── 本 repo 內建 ──────────────────────────────────────
    ├── dotnet-test/                              .NET 測試執行器
    ├── dotnet-testing-orchestrator-unit/         單元測試 Orchestrator
    ├── dotnet-testing-orchestrator-tunit/        TUnit Orchestrator
    ├── dotnet-testing-orchestrator-integration/  整合測試 Orchestrator
    ├── dotnet-testing-orchestrator-aspire/       Aspire Orchestrator
    │
    │   ── dotnet-testing-agent-skills 複製後新增（29 個）────
    ├── dotnet-testing/
    ├── dotnet-testing-unit-test-fundamentals/
    └── …（其餘技術型 skill，清單見步驟 2）
```

### 步驟 4：驗證安裝

- `.codex/agents/` 有 16 個 `.toml`（unit 的 4 個 `dotnet-testing-*` + tunit / integration / aspire 各 4 個 `dotnet-testing-advanced-*-*`）
- `.codex/skills/` 含 4 個 orchestrator skill（`dotnet-testing-orchestrator-{unit,tunit,integration,aspire}`）的 `SKILL.md`
- `.codex/skills/` 含 `dotnet-test` + 29 個技術型 skill
- `.codex/config.toml` 存在且 `[features] multi_agent = true`
- 在 Codex 呼叫任一 `$dotnet-testing-orchestrator-{unit,tunit,integration,aspire}` 時能正確 SpawnAgent 四階段

---

## 3. 常見問題排查

### 問題 1：Orchestrator 無法觸發

**症狀：** 呼叫 `$dotnet-testing-orchestrator-unit` 後沒有反應，或找不到該 skill。

**可能原因：** Skills 未正確放入 `.codex/skills/`，或目錄結構不正確。

**解法：**

1. 確認 `.codex/skills/dotnet-testing-orchestrator-unit/SKILL.md` 檔案存在
2. 確認目錄名稱完全吻合（如 `dotnet-testing-orchestrator-unit/`）
3. 確認 `.codex/config.toml` 中 `[features] multi_agent = true`，否則 SpawnAgent 無法調度 subagent
4. 重新啟動 Codex 工作階段讓 skills 重新載入

---

### 問題 2：Agent Skills 未載入（Skill 找不到錯誤）

**症狀：** Orchestrator 執行時，Writer 找不到 `dotnet-testing-autofixture-basics`、`dotnet-testing-nsubstitute-mocking` 等技能，產出的測試品質低落或未遵循最佳實踐。

**可能原因：** `dotnet-testing-agent-skills` 未複製到 `.codex/skills/`。

**解法：** 重新執行步驟 2，確認 29 個技術型 skill 目錄都已複製到 `.codex/skills/`（每個目錄下需有 `SKILL.md`）。

---

### 問題 3：SpawnAgent 調度失敗或不穩定

**症狀：** Orchestrator 啟動 subagent 時失敗、卡住，或四階段未依序完成。

**可能原因：** Codex 的 multi-agent 功能未啟用，或 thread / runtime 上限設定過低。

**解法：** 檢查 `.codex/config.toml`：

```toml
[features]
multi_agent = true

[agents]
max_depth = 1
max_threads = 6
job_max_runtime_seconds = 1800
```

確認 `multi_agent = true`，且 `max_threads` 足以容納並行的 subagent。

---

### 問題 4：.NET SDK 版本不符

**症狀：** `dotnet build` 回報 SDK 版本不支援，或建置時出現 TFM 不相符的錯誤。

**解法：**

1. 確認已安裝對應版本的 .NET SDK（net8.0 / net9.0 / net10.0）：

```bash
dotnet --list-sdks
```

2. 若有 `global.json` 指定了特定 SDK 版本，確認該版本已安裝。從 [.NET 官方下載頁](https://dotnet.microsoft.com/download) 安裝缺少的版本。
