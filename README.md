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
| Aspire Testing | `dotnet-testing-orchestrator-aspire` | ✅ 已釋出 |

> 四種工作流程**共用同一個 1 + 4 模型**(1 Orchestrator Skill + 4 Subagent、Codex 原生 SpawnAgent、Analyzer → Writer → Executor → Reviewer);差別在**執行模型、測試粒度與技術棧**,如下。

> **TUnit 工作流程**:執行模型為 **`dotnet run`**(Source Generator / Microsoft.Testing.Platform,非 `dotnet test`),產出 `OutputType=Exe`、不含 `Microsoft.NET.Test.Sdk`;支援 `[Test]`/`[Arguments]`/`[MethodDataSource]`、`.slnx` 版本感知選擇、xUnit→TUnit 遷移、Validator(`forbidWriterSplit`)。呼叫 `$dotnet-testing-orchestrator-tunit`;練習素材見 `samples/tunit/practice_tunit/`,細節見 `docs/guides/tunit-testing.md`。

> **整合測試工作流程**:執行模型為 **`dotnet test`**(xUnit,含 `Microsoft.NET.Test.Sdk`、無 `OutputType=Exe`)+ **Docker / Testcontainers**;以 **HTTP endpoint 為粒度**,透過 `WebApplicationFactory<Program>` 發真實 HTTP 請求,HTTP 斷言用 **AwesomeAssertions.Web**(`Be200Ok`/`Be404NotFound` 等),錯誤格式驗 `ProblemDetails`/`ValidationProblemDetails`,容器化資料庫(PostgreSQL/SQL Server/MongoDB/Redis)搭配 Respawn 資料隔離。**需 Docker 環境**。呼叫 `$dotnet-testing-orchestrator-integration`;練習素材見 `samples/integration/practice_integration/`,細節見 `docs/guides/integration-testing.md`。

> **Aspire 工作流程**:執行模型為 **AppHost / `DistributedApplicationTestingBuilder`**(Aspire.Hosting.Testing,**非** `WebApplicationFactory`)+ xUnit **`dotnet test --blame-hang-timeout`**(8.x/9.x=`10m`、13.x=`15m`,非 `dotnet run`);以 **HTTP endpoint 為粒度**,`app.CreateHttpClient("name")` 名稱對齊 AppHost `AddProject("name")`,容器由 **Aspire AppHost 宣告式管理**(非程式化 Testcontainers)+ Respawn 資料隔離。Analyzer 分析 **AppHost Resource graph**;Writer 只載入單一 `aspire-testing` 技能。**需 Docker 環境**(容器由 AppHost 啟動,無 InMemory 退路;`Aspire.AppHost.Sdk` 9.0+ 為 NuGet,免安裝 workload)。呼叫 `$dotnet-testing-orchestrator-aspire`;練習素材見 `samples/aspire/practice_aspire/`,細節見 `docs/guides/aspire-testing.md`。

---

## 架構概覽

Orchestrator Skill 接收使用者指令後，透過 Codex 原生 **SpawnAgent** 依序調度四個 Subagent：

```text
Orchestrator Skill（dotnet-testing-orchestrator-{unit,tunit,integration,aspire}）
    ├── Analyzer Subagent  （分析目標類別/端點/AppHost Resource、依賴項、需要的測試技術）
    ├── Writer Subagent    （載入對應 Skills，產生符合最佳實踐的測試程式碼）
    ├── Executor Subagent  （建置並執行測試，處理編譯/失敗的修正迴圈）
    └── Reviewer Subagent  （審查命名、斷言、覆蓋率、框架合規性）
```

四種工作流程各有自己的一套 Orchestrator + 4 Subagent；呼叫對應的 `$dotnet-testing-orchestrator-*` 即進入該流程。

每個階段依序完成；Reviewer 提出改善建議後，**由使用者確認**才會啟動 Writer + Executor 修改流程。

**Writer 為何需要 Agent Skills**：Writer 撰寫測試時會依 Analyzer 判定的技術需求，載入對應的 Agent Skill（例如 `nsubstitute-mocking`、`datetime-testing-timeprovider`、`filesystem-testing-abstractions`）以確保輸出符合最佳實踐。這些技術型 Skill **不內含於本 repo**，需另行安裝（見步驟 2）。

---

## 系統需求

| 項目 | 版本 | 說明 |
|---|---|---|
| Codex | 支援原生 SpawnAgent / multi-agent | 執行 1+4 工作流程 |
| .NET SDK | 8.0 / 9.0 / 10.0 | 被測試專案的目標框架 |
| Docker | 任一近期版本 | **integration / aspire 工作流程必需**（啟動真實容器；unit / tunit 不需要）。aspire 另以 `Aspire.AppHost.Sdk` NuGet 提供,免安裝 Aspire workload |
| Node.js | 任一近期 LTS | **僅 Estimated Token Usage 需要**（執行 `.codex/scripts/estimate-token-usage.mjs`）。估算器**零相依、無需 `npm install`**;不影響四階段測試流程本身 |

---

## 安裝與環境設定

本 repo 發佈的是 **Orchestrator 契約本身**（4 個 subagent + orchestrator skill + `dotnet-test`）。完整可運作環境 = 本 repo 內容 **＋** 技術型 Agent Skills（步驟 2）。

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
└── skills/
    ├── dotnet-test/
    ├── dotnet-testing-orchestrator-unit/
    ├── dotnet-testing-orchestrator-tunit/
    ├── dotnet-testing-orchestrator-integration/
    └── dotnet-testing-orchestrator-aspire/
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
├── agents/                       ← 本 repo 內建（16 個 subagent）
│   ├── dotnet-testing-{analyzer,writer,executor,reviewer}.toml            ← unit
│   ├── dotnet-testing-advanced-tunit-{analyzer,writer,executor,reviewer}.toml
│   ├── dotnet-testing-advanced-integration-{analyzer,writer,executor,reviewer}.toml
│   └── dotnet-testing-advanced-aspire-{analyzer,writer,executor,reviewer}.toml
├── config.toml                   ← 本 repo 內建
└── skills/
    ├── dotnet-test/                              ← 本 repo 內建
    ├── dotnet-testing-orchestrator-unit/         ← 本 repo 內建
    ├── dotnet-testing-orchestrator-tunit/        ← 本 repo 內建
    ├── dotnet-testing-orchestrator-integration/  ← 本 repo 內建
    ├── dotnet-testing-orchestrator-aspire/       ← 本 repo 內建
    ├── dotnet-testing/                            ← 步驟 2 安裝
    ├── dotnet-testing-unit-test-fundamentals/     ← 步驟 2 安裝
    └── …（其餘技術型 skill）
```

### 步驟 4：驗證安裝

- `.codex/agents/` 有 16 個 `.toml`（unit 的 4 個 `dotnet-testing-*` + tunit / integration / aspire 各 4 個 `dotnet-testing-advanced-*-*`）
- `.codex/skills/` 含 4 個 orchestrator skill（`dotnet-testing-orchestrator-{unit,tunit,integration,aspire}`）的 `SKILL.md`
- `.codex/skills/` 含 `dotnet-test` + 29 個技術型 skill
- 在 Codex 呼叫任一 `$dotnet-testing-orchestrator-{unit,tunit,integration,aspire}` 時能正確 SpawnAgent 四階段

---

## 快速開始

在 Codex 中對任一 .NET 類別下指令：

```text
呼叫 $dotnet-testing-orchestrator-unit，為 src/MyProject.Core 的 OrderService 撰寫單元測試。
```

工作流程會：分析 `OrderService` → 載入對應 Skills 撰寫測試 → 建置執行（含修正迴圈）→ 審查並回報；最後呈現固定格式的結果報告（測試總覽、Reviewer 結論、各階段耗時等）。

---

## 練習專案

本 repo 為四種工作流程各內含一組練習素材（`samples/` 下;各測試專案僅含 csproj scaffold,**不含預先產生的測試碼**——測試由工作流程產生,`src` 為待測範例）：

| 工作流程 | 練習素材 | 待測標的 |
|---|---|---|
| unit | `samples/unit/practice/` | 純邏輯、`TimeProvider`、`IFileSystem`、FluentValidation、介面 mock、legacy 靜態依賴等(net8/net10 變體) |
| tunit | `samples/tunit/practice_tunit/` | `LibraryMemberValidator` 等 TUnit 標的(net8/9/10 變體) |
| integration | `samples/integration/practice_integration/` | `OrdersController`(PostgreSQL)+ `CustomerActivitiesController`(MongoDB)+ FluentValidation(net8/9/10 變體) |
| aspire | `samples/aspire/practice_aspire/` | Aspire AppHost + `BookingsController`(SQL Server + Redis)+ FluentValidation(net8/9/10 變體) |

範例：

```text
# unit
呼叫 $dotnet-testing-orchestrator-unit，為 samples/unit/practice/src/Practice.Core.Net8 的
SubscriptionService 撰寫單元測試。

# aspire（需 Docker）
呼叫 $dotnet-testing-orchestrator-aspire，為 samples/aspire/practice_aspire 的 BookingsController
撰寫 Aspire 整合測試，涵蓋全部端點。
```

---

## 與 Claude 版的差異

- **Token 用量統計：估算版（非 billing）** — Codex native SpawnAgent subagent 的全流程**真實** token 無可靠 truth source（實證確認），故不回報正式用量。改提供 **`Estimated Token Usage`**：四階段完成後執行 `node .codex/scripts/estimate-token-usage.mjs --test-project <測試專案>`，以**零相依的內建 `chars-heuristic`**（`字元數 / 3.6` 粗估,不引入任何外部 tokenizer 套件）對各 subagent 的 **visible context**（讀取的 source/skill/交接檔、寫出的測試與 artifact、spawn payload、agent 定義）做估算,產出 `.orchestrator/token-usage-estimate.json`。**僅供相對成本比較,明確排除 hidden framing / internal reasoning / cached input / provider billing,不可用於計費或任何 correctness gate**;`confidence` 上限即 `medium`,estimator 缺檔/失敗時優雅降級為 unavailable，不阻塞工作流程。細節見 [docs/guides/token-usage-estimation.md](docs/guides/token-usage-estimation.md)。
- **Dispatch 機制**：Codex 原生 SpawnAgent（非 Claude Agent tool）；額外產出 `run-state.json` 可稽核狀態檔。
- **產出非決定性**：同一輸入下，測試數/分割分組/skill 選擇有 run-to-run 波動——Codex 多 subagent dispatch 的本質，屬已知限制。

---

## 文件

- 版本與變更：[CHANGELOG.md](CHANGELOG.md)
- 技術型 Skills：[dotnet-testing-agent-skills](https://github.com/kevintsengtw/dotnet-testing-agent-skills)
- Claude 版（上游）：[dotnet-testing-agent-orchestration-claude](https://github.com/kevintsengtw/dotnet-testing-agent-orchestration-claude)
