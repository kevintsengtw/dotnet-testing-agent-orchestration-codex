# dotnet-testing Agent Orchestration for Codex

這個 repo 提供 **Codex 原生 Subagent** 的 .NET 測試工作流程，透過 Agent Orchestration 自動化完成測試。
核心採 **1 + 4 模型**：1 個 Orchestrator Skill 指揮 4 個專用 Subagent，依序完成 Analyzer → Writer → Executor → Reviewer 的完整測試流程——從分析目標程式碼、撰寫測試、執行驗證，到審查品質，全程自動化。

> 本版由 [`dotnet-testing-agent-orchestration-claude`](https://github.com/kevintsengtw/dotnet-testing-agent-orchestration-claude) 經 migrate-to-codex 轉換，並在 Codex 平台多輪實驗優化驗證而成。

- [dotnet-testing Agent Orchestration for Codex](#dotnet-testing-agent-orchestration-for-codex)
  - [目前涵蓋範圍](#目前涵蓋範圍)
  - [架構概覽](#架構概覽)
  - [系統需求](#系統需求)
  - [安裝與環境設定](#安裝與環境設定)
    - [步驟 1：取得本 repo 的 `.codex/` 內容](#步驟-1取得本-repo-的-codex-內容)
    - [步驟 2：安裝 Agent Skills（dotnet-testing-agent-skills）](#步驟-2安裝-agent-skillsdotnet-testing-agent-skills)
    - [步驟 3：確認完整 `.codex/` 目錄結構](#步驟-3確認完整-codex-目錄結構)
    - [步驟 4：驗證安裝](#步驟-4驗證安裝)
  - [快速開始](#快速開始)
  - [練習專案](#練習專案)
  - [與 Claude 版的差異](#與-claude-版的差異)
  - [文件](#文件)

---

## 目前涵蓋範圍

| 測試類型 | Orchestrator Skill | 狀態 |
|---|---|---|
| Unit Testing | `dotnet-testing-orchestrator-unit` | ✅ 已釋出 |
| TUnit Testing | `dotnet-testing-orchestrator-tunit` | ✅ 已釋出 |
| Integration Testing | `dotnet-testing-orchestrator-integration` | ✅ 已釋出 |
| Aspire | — | 🚧 後續釋出 |

> **TUnit 工作流程**:同樣 1 Skill + 4 Subagent,但執行模型為 **`dotnet run`**(Source Generator / Microsoft.Testing.Platform,非 `dotnet test`),產出 `OutputType=Exe`、不含 `Microsoft.NET.Test.Sdk`;支援 `[Test]`/`[Arguments]`/`[MethodDataSource]`、`.slnx` 版本感知選擇、xUnit→TUnit 遷移、Validator(`forbidWriterSplit`)。呼叫 `$dotnet-testing-orchestrator-tunit`;練習素材見 `samples/tunit/practice_tunit/`,細節見 `docs/guides/tunit-testing.md`。

> **整合測試工作流程**:同樣 1 Skill + 4 Subagent,執行模型為 **`dotnet test`**(xUnit,含 `Microsoft.NET.Test.Sdk`、無 `OutputType=Exe`)+ **Docker / Testcontainers**;以 **HTTP endpoint 為粒度**,透過 `WebApplicationFactory<Program>` 發真實 HTTP 請求,HTTP 斷言用 **AwesomeAssertions.Web**(`Be200Ok`/`Be404NotFound` 等),錯誤格式驗 `ProblemDetails`/`ValidationProblemDetails`,容器化資料庫(PostgreSQL/SQL Server/MongoDB/Redis)搭配 Respawn 資料隔離。**需 Docker 環境**。呼叫 `$dotnet-testing-orchestrator-integration`;練習素材見 `samples/integration/practice_integration/`,細節見 `docs/guides/integration-testing.md`。

---

## 架構概覽

Orchestrator Skill 接收使用者指令後，透過 Codex 原生 **SpawnAgent** 依序調度四個 Subagent：

```text
Orchestrator Skill（dotnet-testing-orchestrator-unit）
    ├── Analyzer Subagent  （分析目標類別、依賴項、需要的測試技術）
    ├── Writer Subagent    （載入對應 Skills，產生符合最佳實踐的測試程式碼）
    ├── Executor Subagent  （建置並執行測試，處理編譯/失敗的修正迴圈）
    └── Reviewer Subagent  （審查命名、斷言、覆蓋率、框架合規性）
```

每個階段依序完成；Reviewer 提出改善建議後，**由使用者確認**才會啟動 Writer + Executor 修改流程。

**Writer 為何需要 Agent Skills**：Writer 撰寫測試時會依 Analyzer 判定的技術需求，載入對應的 Agent Skill（例如 `nsubstitute-mocking`、`datetime-testing-timeprovider`、`filesystem-testing-abstractions`）以確保輸出符合最佳實踐。這些技術型 Skill **不內含於本 repo**，需另行安裝（見步驟 2）。

---

## 系統需求

| 項目 | 版本 | 說明 |
|---|---|---|
| Codex | 支援原生 SpawnAgent / multi-agent | 執行 1+4 工作流程 |
| .NET SDK | 8.0 / 9.0 / 10.0 | 被測試專案的目標框架 |

---

## 安裝與環境設定

本 repo 發佈的是 **Orchestrator 契約本身**（4 個 subagent + orchestrator skill + `dotnet-test`）。完整可運作環境 = 本 repo 內容 **＋** 技術型 Agent Skills（步驟 2）。

### 步驟 1：取得本 repo 的 `.codex/` 內容

將本 repo 的 `.codex/` 放入你的專案根目錄（或合併進既有 `.codex/`）：

```text
.codex/
├── agents/
│   ├── dotnet-testing-analyzer.toml
│   ├── dotnet-testing-writer.toml
│   ├── dotnet-testing-executor.toml
│   └── dotnet-testing-reviewer.toml
├── config.toml
└── skills/
    ├── dotnet-test/
    └── dotnet-testing-orchestrator-unit/
```

### 步驟 2：安裝 Agent Skills（dotnet-testing-agent-skills）

Writer 需要的各技術 Skill 由獨立 repo [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 提供，需放入本專案的 **`.codex/skills/`** 目錄下。

**直接複製即可**：從 [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 取得各 skill 目錄，複製到本專案的 `.codex/skills/` 下。

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

完成步驟 1、2 後，`.codex/` 的預期結構（節錄）：

```text
.codex/
├── agents/                       ← 本 repo 內建（4 個 subagent）
│   ├── dotnet-testing-analyzer.toml
│   ├── dotnet-testing-writer.toml
│   ├── dotnet-testing-executor.toml
│   └── dotnet-testing-reviewer.toml
├── config.toml                   ← 本 repo 內建
└── skills/
    ├── dotnet-test/                          ← 本 repo 內建
    ├── dotnet-testing-orchestrator-unit/     ← 本 repo 內建
    ├── dotnet-testing/                        ← 步驟 2 安裝
    ├── dotnet-testing-unit-test-fundamentals/ ← 步驟 2 安裝
    └── …（其餘 27 個技術型 skill）
```

### 步驟 4：驗證安裝

- `.codex/agents/` 有 4 個 `dotnet-testing-*.toml`
- `.codex/skills/dotnet-testing-orchestrator-unit/SKILL.md` 存在
- `.codex/skills/` 含 `dotnet-test` + 29 個技術型 skill
- 在 Codex 呼叫 `$dotnet-testing-orchestrator-unit` 時能正確 SpawnAgent 四階段

---

## 快速開始

在 Codex 中對任一 .NET 類別下指令：

```text
呼叫 $dotnet-testing-orchestrator-unit，為 src/MyProject.Core 的 OrderService 撰寫單元測試。
```

工作流程會：分析 `OrderService` → 載入對應 Skills 撰寫測試 → 建置執行（含修正迴圈）→ 審查並回報；最後呈現固定格式的結果報告（測試總覽、Reviewer 結論、各階段耗時等）。

---

## 練習專案

本 repo 內含 `samples/unit/practice/`，提供可直接套用工作流程的單元測試練習素材：

- `src/Practice.Core.Net8`、`Practice.Core.Net10`（及 `Practice.Core`）：待測的範例類別，涵蓋純邏輯、`TimeProvider`、`IFileSystem`、FluentValidation、介面 mock、legacy 靜態依賴等情境
- `tests/*.Tests`：對應的測試專案 scaffold（csproj），供工作流程寫入產生的測試
- `*.slnx`：方案檔

> 各測試專案僅含 csproj scaffold，不含預先產生的測試碼——測試由工作流程產生。

範例：

```text
呼叫 $dotnet-testing-orchestrator-unit，為 samples/unit/practice/src/Practice.Core.Net8 的
SubscriptionService 撰寫單元測試。
```

---

## 與 Claude 版的差異

- **Token 用量統計：未提供** — Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source（實證確認），故不回報，避免誤導數字。
- **Dispatch 機制**：Codex 原生 SpawnAgent（非 Claude Agent tool）；額外產出 `run-state.json` 可稽核狀態檔。
- **產出非決定性**：同一輸入下，測試數/分割分組/skill 選擇有 run-to-run 波動——Codex 多 subagent dispatch 的本質，屬已知限制。

---

## 文件

- 版本與變更：[CHANGELOG.md](CHANGELOG.md)
- 技術型 Skills：[dotnet-testing-agent-skills](https://github.com/kevintsengtw/dotnet-testing-agent-skills)
- Claude 版（上游）：[dotnet-testing-agent-orchestration-claude](https://github.com/kevintsengtw/dotnet-testing-agent-orchestration-claude)
