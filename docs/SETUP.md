# 安裝與環境設定

本文件提供完整的安裝步驟與常見問題解決。根目錄 README 提供簡版安裝說明，本文提供更完整的設定指南。

本版發佈的是 **Orchestrator 契約本身**（4 個 Orchestrator Skill + 16 個 Subagent + `dotnet-test`）。完整可運作環境 = 本 repo 的 Codex-specific workflow 資產 **＋** 外部 `.agents/skills`（步驟 2）。

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
> **Node.js**（任一近期 LTS）：四工作流程的 `run-state.json` 稽核需要 `.codex/scripts/run-state.mjs`，正式 runtime gates 使用 `.codex/scripts/validators/`；optional Estimated Token Usage 使用 `.codex/scripts/estimate-token-usage.mjs`。全部都是零相依腳本，無需 `npm install`。

### 驗證必要工具已安裝

```bash
dotnet --list-sdks
```

---

## 2. 安裝步驟

### 步驟 1：取得本 repo 的 `.codex/` 內容

將本 repo 的 `.codex/` 放入你的專案根目錄。內含 **5 個 Codex-specific Skill + 16 個 Subagent**（unit 的 4 個 `dotnet-testing-*` + tunit / integration / aspire 各 4 個 `dotnet-testing-advanced-*-*`）：

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
├── scripts/                                    ← run-state helper + runtime validators + Estimated Token Usage
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

### 步驟 2：安裝外部 Agent Skills

Writer 撰寫測試時，會依 Analyzer 判定的技術需求，載入對應的技術型 Agent Skill。這些 Skill **不內含於本 repo**，由獨立 repo [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 提供。可選的前置情境 Skill 同樣不內含；setup 必須從公開 repo [`kevintsengtw/unit-test-scenarios`](https://github.com/kevintsengtw/unit-test-scenarios) 抓取來源內容。

Consumer deployment 必須使用明確 Release tag 與 exact commit，將 Skills 部署到 consumer workspace 的 **`.agents/skills/`**。Codex 直接以 repository-level Skill discovery 發現它們；缺少必要 Skill 時 workflow 必須明確失敗，不得跳過。本 repository 不發布 standalone shared Skills installer；正式 consumer deployment 由 `dotnet-testing-vscode-extensions` 管理。

`unit-test-scenarios` 從公開 repository 的 `skills/unit-test-scenarios/` 抓取到 consumer workspace 的 `.agents/skills/unit-test-scenarios/`。目前驗證基準 commit 為 `d00501984383dfd0b111c33a091c48af20abec55`。該目的地是安裝後的本機 discovery path，不是 orchestration repository 的發行內容。

複製後，`.agents/skills/` 下會新增以下 **29 個**技術型 Agent Skill：

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

### 步驟 3：確認完整 consumer 目錄結構

完成步驟 1、2 後，完整預期結構如下：

```text
.codex/
├── agents/                                ← 本 repo 內建（16 個 subagent，.toml）
│   ├── dotnet-testing-{analyzer,writer,executor,reviewer}.toml            ← unit
│   ├── dotnet-testing-advanced-tunit-{analyzer,writer,executor,reviewer}.toml
│   ├── dotnet-testing-advanced-integration-{analyzer,writer,executor,reviewer}.toml
│   └── dotnet-testing-advanced-aspire-{analyzer,writer,executor,reviewer}.toml
│
├── config.toml                            ← 本 repo 內建（啟用 multi_agent）
├── scripts/                               ← 本 repo 內建（run-state、runtime validators、Estimated Token Usage）
│   └── validators/                        ← isolation/read-scope/scenario/execution gates
│
└── skills/
    │
    │   ── 本 repo 內建 ──────────────────────────────────────
    ├── dotnet-test/                              .NET 測試執行器
    ├── dotnet-testing-orchestrator-unit/         單元測試 Orchestrator
    ├── dotnet-testing-orchestrator-tunit/        TUnit Orchestrator
    ├── dotnet-testing-orchestrator-integration/  整合測試 Orchestrator
    └── dotnet-testing-orchestrator-aspire/       Aspire Orchestrator
.agents/
└── skills/
    ├── unit-test-scenarios/                      setup 從公開 repo 抓取（非內含資產）
    ├── dotnet-testing/
    ├── dotnet-testing-unit-test-fundamentals/
    └── …（其餘技術型 skill，清單見步驟 2）
```

### 步驟 4：驗證安裝

- `.codex/agents/` 有 16 個 `.toml`（unit 的 4 個 `dotnet-testing-*` + tunit / integration / aspire 各 4 個 `dotnet-testing-advanced-*-*`）
- `.codex/skills/` 含 4 個 orchestrator skill（`dotnet-testing-orchestrator-{unit,tunit,integration,aspire}`）的 `SKILL.md`
- `.codex/skills/` 含 `dotnet-test` 與四個 orchestrator，不含 shared skills
- setup 已從外部來源抓取 `unit-test-scenarios` 與 29 個技術型 skill 到 `.agents/skills/`
- `.codex/scripts/` 含 `run-state.mjs`、`estimate-token-usage.mjs` 與 `validators/`；四個 Orchestrator 引用的 runtime script 路徑全部存在
- `.codex/config.toml` 存在且 `[features] multi_agent = true`
- 在 Codex 呼叫任一 `$dotnet-testing-orchestrator-{unit,tunit,integration,aspire}` 時能正確 SpawnAgent 四階段

---

## 3. 常見問題排查

### 問題 1：Orchestrator 無法觸發

**症狀：** 呼叫 `$dotnet-testing-orchestrator-unit` 後沒有反應，或找不到該 skill。

**可能原因：** Orchestrator Skill 未正確放入 `.codex/skills/`，或目錄結構不正確。

**解法：**

1. 確認 `.codex/skills/dotnet-testing-orchestrator-unit/SKILL.md` 檔案存在
2. 確認目錄名稱完全吻合（如 `dotnet-testing-orchestrator-unit/`）
3. 確認 `.codex/config.toml` 中 `[features] multi_agent = true`，否則 SpawnAgent 無法調度 subagent
4. 重新啟動 Codex 工作階段讓 skills 重新載入

---

### 問題 2：Agent Skills 未載入（Skill 找不到錯誤）

**症狀：** Orchestrator 執行時，Writer 找不到 `dotnet-testing-autofixture-basics`、`dotnet-testing-nsubstitute-mocking` 等技能，產出的測試品質低落或未遵循最佳實踐。

**可能原因：** `dotnet-testing-agent-skills` 未複製到 `.agents/skills/`，或 workspace 仍只有 legacy `.codex/skills/<shared-skill>`。

**解法：** 重新執行步驟 2，確認 29 個技術型 skill 目錄都已複製到 `.agents/skills/`（每個目錄下需有 `SKILL.md`）。不要同時載入新舊兩份；legacy path 只產生 migration diagnostic。

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

---

### 問題 5：各階段耗時與 Estimated Token Usage 全空（`run-state.json` 未產生）

**症狀：** 工作流程四階段都正常跑完、測試也已產生，但最終輸出的「各階段耗時」與「Estimated Token Usage」全是 `null` / `unavailable`，Timing Evidence 標示 `run-state.json` 不存在。

**可能原因：** 喚起工作流程時**沒有以「啟用式」呼叫 skill**。若把 skill 寫成 markdown 檔案連結 `[$dotnet-testing-orchestrator-unit](.../SKILL.md)`，或用技能名前**沒有 `$` 觸發符**的純文字，Codex 只會把 `SKILL.md` 當**參考文件**讀，跟著主流程跑卻略過契約要求的 `run-state.mjs` 打點指令 → `run-state.json` 從不產生 → 耗時與 token 遙測全空。此現象在 **VS Code Codex Extension** 尤其明顯（Codex CLI 的 model 較會自行補跑）。

**解法：** 以**啟用式**喚起——直接輸入裸的 `$dotnet-testing-orchestrator-unit`（讓 Codex 解析成技能 chip 並注入 `<skill>` 治理區塊），**不要**包成 `[$..](路徑)` 連結、也**不要**拿掉 `$`：

```text
使用 $dotnet-testing-orchestrator-unit 工作流程，為 EmployeeService 撰寫並執行單元測試。
- 測試目標專案：...
- 測試目標類別：...
- 測試專案：...
```

自我確認：啟用成功時，model **不需要**再用 `Get-Content` 去讀 `SKILL.md`（內容已注入），且會在啟動 Analyzer 前執行 `node .codex/scripts/run-state.mjs init ...`。四種 orchestrator（unit / tunit / integration / aspire）皆同此規則。
