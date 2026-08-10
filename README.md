# dotnet-testing Agent Orchestration for Codex

這個 repo 提供 **Codex 原生 Subagent** 的 .NET 測試工作流程，透過 Agent Orchestration 自動化完成測試。
核心採 **1 + 4 模型**：1 個 Orchestrator Skill 指揮 4 個專用 Subagent，依序完成 Analyzer → Writer → Executor → Reviewer 的完整測試流程——從分析目標程式碼、撰寫測試、執行驗證，到審查品質，全程自動化。

> 本版由 [`dotnet-testing-agent-orchestration-claude`](https://github.com/kevintsengtw/dotnet-testing-agent-orchestration-claude) 經 migrate-to-codex 轉換，並在 Codex 平台多輪實驗優化驗證而成。

- [dotnet-testing Agent Orchestration for Codex](#dotnet-testing-agent-orchestration-for-codex)
  - [目前涵蓋範圍](#目前涵蓋範圍)
  - [v1.2.0 重要變更](#v120-重要變更)
  - [架構概覽](#架構概覽)
  - [系統需求](#系統需求)
  - [安裝與環境設定](#安裝與環境設定)
    - [步驟 1：取得本 repo 的 `.codex/` 內容](#步驟-1取得本-repo-的-codex-內容)
    - [步驟 2：安裝外部 Agent Skills](#步驟-2安裝外部-agent-skills)
    - [步驟 3：確認完整 workspace 目錄結構](#步驟-3確認完整-workspace-目錄結構)
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

> **Agent 預設模型**：`.codex/agents/` 內全部 16 個 agent TOML 預設使用 `gpt-5.6-sol`，推理強度為 `medium`。GPT-5.6 Sol 與 GPT-5.5 的標準 API 單位費率相同；完整的 GPT-5.4、GPT-5.5、GPT-5.6 Sol／Terra／Luna 計費比照表見 [模型計費與預設設定](docs/guides/model-pricing.md)。

> **Unit 工作流程**:使用者可在一開始以 Markdown、free text、表格、JSON 或混合格式提供測試情境與測試資料。合理內容優先於 Analyzer 自行補充的情境，只有個別情境不合理或不正確時才能逐項拒絕。若已安裝外部 `unit-test-scenarios`，可先呼叫 `$unit-test-scenarios` 產生情境，再交給 `$dotnet-testing-orchestrator-unit`。

> **TUnit 工作流程**:執行模型為 **`dotnet run`**(Source Generator / Microsoft.Testing.Platform,非 `dotnet test`),產出 `OutputType=Exe`、不含 `Microsoft.NET.Test.Sdk`;支援 `[Test]`/`[Arguments]`/`[MethodDataSource]`、`.slnx` 版本感知選擇、xUnit→TUnit 遷移與 Validator。呼叫 `$dotnet-testing-orchestrator-tunit`;練習素材見 `samples/tunit/practice_tunit/`,細節見 `docs/guides/tunit-testing.md`。

> **整合測試工作流程**:執行模型為 **`dotnet test`**(xUnit,含 `Microsoft.NET.Test.Sdk`、無 `OutputType=Exe`)+ **Docker / Testcontainers**;以 **HTTP endpoint 為粒度**,透過 `WebApplicationFactory<Program>` 發真實 HTTP 請求,HTTP 斷言用 **AwesomeAssertions.Web**(`Be200Ok`/`Be404NotFound` 等),錯誤格式驗 `ProblemDetails`/`ValidationProblemDetails`,容器化資料庫(PostgreSQL/SQL Server/MongoDB/Redis)搭配 Respawn 資料隔離。**需 Docker 環境**。呼叫 `$dotnet-testing-orchestrator-integration`;練習素材見 `samples/integration/practice_integration/`,細節見 `docs/guides/integration-testing.md`。

> **Aspire 工作流程**:執行模型為 **AppHost / `DistributedApplicationTestingBuilder`**(Aspire.Hosting.Testing,**非** `WebApplicationFactory`)+ xUnit **`dotnet test --blame-hang-timeout`**(8.x/9.x=`10m`、13.x=`15m`,非 `dotnet run`);以 **HTTP endpoint 為粒度**,`app.CreateHttpClient("name")` 名稱對齊 AppHost `AddProject("name")`,容器由 **Aspire AppHost 宣告式管理**(非程式化 Testcontainers)+ Respawn 資料隔離。Analyzer 分析 **AppHost Resource graph**;Writer 只載入單一 `aspire-testing` 技能。**需 Docker 環境**(容器由 AppHost 啟動,無 InMemory 退路;`Aspire.AppHost.Sdk` 9.0+ 為 NuGet,免安裝 workload)。呼叫 `$dotnet-testing-orchestrator-aspire`;練習素材見 `samples/aspire/practice_aspire/`,細節見 `docs/guides/aspire-testing.md`。

---

## v1.2.0 重要變更

v1.2.0 保留四個 Orchestrator Skill 名稱、每 target 單一 Writer topology 與各 framework runner，主要調整 shared Skill 發布邊界、可重建安裝與 runtime telemetry：

- **Shared Skills 不再內含**：29 個技術型 `dotnet-testing-*` Skills 與可選的 `unit-test-scenarios` 改由 consumer deployment 安裝到 `.agents/skills/`；`.codex/skills/` 只發布 `dotnet-test` 與四個 Orchestrator
- **外部依賴可重建**：正式來源以 tag／commit lock 固定，避免 orchestration repo 內含的 shared Skill 副本與上游版本漂移
- **Analyzer timing fail closed**：四套流程都在 dispatch、接受與 artifact ready 的實際邊界記錄 telemetry；缺少必要時間欄位時停止，不以事後推算補值
- **Unit Reviewer 三值裁決**：Unit reviewer-result 必須明確輸出 `pass`、`fail` 或 `blocked`，且與使用者情境 coverage、issues 與 Executor truth 一致
- **固定 Agent 模型**：16 個 Subagent 預設使用 `gpt-5.6-sol` 與 `medium` reasoning；可依 consumer 需求覆寫
- **完整功能驗證**：Unit、TUnit、Integration、Aspire 共 12 案，289 passed、0 failed、0 skipped；另有 6 個 failure-contract cases 全部通過

升級時應完整替換 `.codex/` workflow assets，移除舊版放在 `.codex/skills/` 的 shared Skill 副本，再由 consumer deployment 將外部 Skills 安裝到 `.agents/skills/`。

完整變更與驗證證據見 [CHANGELOG.md](CHANGELOG.md)。

### v1.1.0 延續契約

v1.1.0 保留四個 Orchestrator Skill 名稱、1 + 4 階段與各 framework runner，主要改進工作流程的 Token Usage、隔離與可稽核性：

- **每個 target 固定一個 Writer**：Unit、TUnit、Integration、Aspire 都不再依 method、scenario、endpoint、Resource 或預估輸出大小 split。多 target 仍是一個 target 對應一個 Writer
- **不限制 Analyzer 案例數**：唯一 Writer 必須承接本次 Analyzer 接受的全部 scenarios；若 context/output limit 無法完成，attempt fail closed，不恢復 split、不靜默刪減
- **Fresh/self-contained roles**：正式角色固定 `fork_turns: "none"`，禁止 prior-attempt artifacts、workspace 外部 memory 與未核准 handoffs
- **更嚴格的 truth chain**：canonical analysis／writer／executor／reviewer artifacts、scenario/endpoint/Resource provenance、Executor runtime evidence、Reviewer acceptance 與 strict `run-state.json` timing 必須一致
- **Runtime validators 隨 `.codex/` 出貨**：`.codex/scripts/validators/` 包含四工作流程所需的 isolation、read-scope、scenario 與 execution gates
- **不使用 RAG**：正式流程只使用 assigned source/project、repo-local Skills 與本次 run 核准的 canonical handoffs

升級既有安裝時，應完整更新本 repo 的 `.codex/agents/`、4 個 Orchestrator Skills、`.codex/scripts/` 與 `.codex/config.toml`，不要只複製單一 `SKILL.md`。

Token 改善來自 controlled comparisons；詳細數據、品質結論與比較限制見 [CHANGELOG.md](CHANGELOG.md)。所有數字都是 visible-context **Estimated Token Usage**，不是 provider billing truth。

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

對單一 target 而言，正式 dispatch 恆為 Analyzer 1 + Writer 1 + Executor 1 + Reviewer 1。不同 targets 可依工作流程規則並行或循序，但同一 target 不會再拆成多個 Writers。

每個階段依序完成；Reviewer 提出改善建議後，**由使用者確認**才會啟動 Writer + Executor 修改流程。

`run-state.json` 是官方 wall-clock timing truth；Executor artifact 是 build/test runtime truth。Reviewer 必須執行品質審查，但不自行重跑測試取代 Executor evidence。

**Writer 為何需要 Agent Skills**：Writer 撰寫測試時會依 Analyzer 判定的技術需求，載入對應的 Agent Skill（例如 `nsubstitute-mocking`、`datetime-testing-timeprovider`、`filesystem-testing-abstractions`）以確保輸出符合最佳實踐。這些技術型 Skill **不內含於本 repo**，需另行安裝（見步驟 2）。

---

## 系統需求

| 項目 | 版本 | 說明 |
|---|---|---|
| Codex | 支援原生 SpawnAgent / multi-agent | 執行 1+4 工作流程 |
| .NET SDK | 8.0 / 9.0 / 10.0 | 被測試專案的目標框架 |
| Docker | 任一近期版本 | **integration / aspire 工作流程必需**（啟動真實容器；unit / tunit 不需要）。aspire 另以 `Aspire.AppHost.Sdk` NuGet 提供,免安裝 Aspire workload |
| Node.js | 任一近期 LTS | 執行 `.codex/scripts/run-state.mjs`、`.codex/scripts/validators/` 與 optional Estimated Token Usage。全部為零相依 scripts，無需 `npm install` |

---

## 安裝與環境設定

本 repo 發佈的是 **Orchestrator 契約本身**（4 個 Orchestrator Skill + 16 個 Subagent + `dotnet-test`）。完整可運作環境 = 本 repo 內容 **＋** 外部 Agent Skills（步驟 2）。

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
├── scripts/
│   ├── run-state.mjs
│   ├── estimate-token-usage.mjs
│   └── validators/                                  （四工作流程 runtime gates）
└── skills/
    ├── dotnet-test/
    ├── dotnet-testing-orchestrator-unit/
    ├── dotnet-testing-orchestrator-tunit/
    ├── dotnet-testing-orchestrator-integration/
    └── dotnet-testing-orchestrator-aspire/
```

### 步驟 2：安裝外部 Agent Skills

Writer 需要的各技術 Skill 由獨立 repo [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 的固定 Release 提供。可選的前置情境 Skill 不內含於本 repo，consumer deployment 必須從公開 repo [`kevintsengtw/unit-test-scenarios`](https://github.com/kevintsengtw/unit-test-scenarios) 抓取。兩者取得後放入 workspace 的 **`.agents/skills/`**。

Release version、managed files 與 rollback 由 `dotnet-testing-vscode-extensions` 管理；本 repository 不發布 standalone shared Skills installer。

`unit-test-scenarios` 的抓取來源固定為公開 repo 的 `skills/unit-test-scenarios/`，目的地為 consumer workspace 的 `.agents/skills/unit-test-scenarios/`。目前驗證基準 commit 為 `d00501984383dfd0b111c33a091c48af20abec55`；orchestration release 不得攜帶該 Skill 的副本。

安裝後，`.agents/skills/` 下會新增以下 **29 個**技術型 Agent Skill：

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

### 步驟 3：確認完整 workspace 目錄結構

完成步驟 1、2 後，workspace 中 `.codex/` 與 `.agents/` 的預期結構（節錄）：

```text
.codex/
├── agents/                       ← 本 repo 內建（16 個 subagent）
│   ├── dotnet-testing-{analyzer,writer,executor,reviewer}.toml            ← unit
│   ├── dotnet-testing-advanced-tunit-{analyzer,writer,executor,reviewer}.toml
│   ├── dotnet-testing-advanced-integration-{analyzer,writer,executor,reviewer}.toml
│   └── dotnet-testing-advanced-aspire-{analyzer,writer,executor,reviewer}.toml
├── config.toml                   ← 本 repo 內建
├── scripts/                      ← 本 repo 內建（run-state、estimator、runtime validators）
└── skills/
    ├── dotnet-test/                              ← 本 repo 內建
    ├── dotnet-testing-orchestrator-unit/         ← 本 repo 內建
    ├── dotnet-testing-orchestrator-tunit/        ← 本 repo 內建
    ├── dotnet-testing-orchestrator-integration/  ← 本 repo 內建
    └── dotnet-testing-orchestrator-aspire/       ← 本 repo 內建
.agents/
└── skills/
    ├── unit-test-scenarios/                      ← setup 從公開 repo 抓取（非內含資產）
    ├── dotnet-testing/                           ← 步驟 2 安裝
    ├── dotnet-testing-unit-test-fundamentals/     ← 步驟 2 安裝
    └── …（其餘技術型 skill）
```

### 步驟 4：驗證安裝

- `.codex/agents/` 有 16 個 `.toml`（unit 的 4 個 `dotnet-testing-*` + tunit / integration / aspire 各 4 個 `dotnet-testing-advanced-*-*`）
- `.codex/skills/` 含 4 個 orchestrator skill（`dotnet-testing-orchestrator-{unit,tunit,integration,aspire}`）的 `SKILL.md`
- `.codex/skills/` 只含五個 Codex-specific Skills；setup 會從兩個外部來源抓取 `unit-test-scenarios` 與 29 個技術型 skill 到 `.agents/skills/`
- `.codex/scripts/` 含 `run-state.mjs`、`estimate-token-usage.mjs` 與 `validators/`
- 四個 Orchestrator 中的 `node .codex/scripts/...` 路徑全部存在
- 在 Codex 呼叫任一 `$dotnet-testing-orchestrator-{unit,tunit,integration,aspire}` 時能正確 SpawnAgent 四階段

---

## 快速開始

在 Codex 中對任一 .NET 類別下指令：

```text
呼叫 $dotnet-testing-orchestrator-unit，為 src/MyProject.Core 的 OrderService 撰寫單元測試。
```

工作流程會：分析 `OrderService` → 載入對應 Skills 撰寫測試 → 建置執行（含修正迴圈）→ 審查並回報；最後呈現固定格式的結果報告（測試總覽、Reviewer 結論、各階段耗時等）。

同一 target 無論 Analyzer 產生多少合理 scenarios，都只派發一個 Writer。若一次指定多個 targets，每個 target 各自有一個 Writer；Integration/Aspire 在共享測試專案與容器資源時會採用較保守的循序執行以保護 correctness。

也可以先呼叫 `$unit-test-scenarios` 產生測試情境，或直接在同一段提示詞提供任意格式的情境與資料；unit workflow 會先驗證並保留合理的使用者輸入，再補足必要案例。

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
- **角色隔離**：正式 roles 使用 self-contained context，並以 attempt-isolation／role-read-scope gates 拒絕 prior-attempt、外部 memory 與 unrelated orchestration reads。
- **產出非決定性**：同一輸入下，Analyzer scenario 數、測試數、技術型 Skill 選擇與 wall-clock 可能有 run-to-run 波動；Writer topology 固定為每 target 一個，不屬於可波動項目。

---

## 文件

- 版本與變更：[CHANGELOG.md](CHANGELOG.md)
- 安裝與環境：[docs/SETUP.md](docs/SETUP.md)
- 架構總覽：[docs/architecture/overview.md](docs/architecture/overview.md)
- Token 估算：[docs/guides/token-usage-estimation.md](docs/guides/token-usage-estimation.md)
- 技術型 Skills：[dotnet-testing-agent-skills](https://github.com/kevintsengtw/dotnet-testing-agent-skills)
- Claude 版（上游）：[dotnet-testing-agent-orchestration-claude](https://github.com/kevintsengtw/dotnet-testing-agent-orchestration-claude)
