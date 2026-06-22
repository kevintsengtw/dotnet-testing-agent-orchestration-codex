# Changelog

所有重要變更都記錄於此。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)。

> 版本規則：四種測試工作流程（unit / integration / aspire / tunit）全部完成才升至 `v1.0.0`；在此之前為 `v0.0.x` 預覽版。文件類修改不更新版本號，僅測試工作流程的變更才升版。

## [v0.0.4] - 2026-06-22

Codex 版第三個工作流程預覽:**整合測試 Agent Orchestration**(由 `dotnet-testing-agent-orchestration-claude` 經 migrate-to-codex 轉換,並經 Claude-vs-Codex 對照驗證)。

### 新增
- **`dotnet-testing-orchestrator-integration` Skill**:.NET WebAPI 整合測試指揮中心,1 Skill + 4 Subagent(`dotnet-testing-advanced-integration-{analyzer,writer,executor,reviewer}`),Codex 原生 SpawnAgent dispatch
- **4 個 integration Codex 原生 subagent**(`.codex/agents/dotnet-testing-advanced-integration-*.toml`)
- **integration 練習 sample**(`samples/integration/practice_integration/`),含 `OrdersController`(PostgreSQL)+ `CustomerActivitiesController`(MongoDB)+ FluentValidation,net8/net9/net10 三版變體
- **per-type 文件**:`docs/architecture/integration-orchestrator.md`、`docs/guides/integration-testing.md`

### 特性(整合測試專屬)
- **執行模型 = `dotnet test`**(xUnit,含 `Microsoft.NET.Test.Sdk`、**無** `OutputType=Exe`)+ **Docker / Testcontainers**(Executor Step 0 先 `docker info`,純 InMemory 才略過)
- **測試粒度 = HTTP endpoint**;透過 `WebApplicationFactory<Program>` 發真實 HTTP 請求
- HTTP 斷言用 **AwesomeAssertions.Web**(`Be200Ok`/`Be201Created`/`Be400BadRequest`/`Be404NotFound`/`Be409Conflict`/`Be204NoContent`);錯誤格式以 `.And.Satisfy<T>()` 驗證 **`ProblemDetails` / `ValidationProblemDetails`**
- 容器化資料庫:Testcontainers(PostgreSQL / SQL Server / MongoDB / Redis)+ **Respawn** 資料隔離 + Collection Fixture 容器共享
- **DbContext 置換策略**依 Analyzer `dbRegistrationAnalysis`(hardcoded-unconditional / conditional / no-registration)決定;DB Provider 衝突的 Program.cs 環境條件修改為唯一 production 窄例外
- **分階段啟動**:`scenarioCount > 15` 時 Writer 分兩批(先基礎設施、後測試案例)
- 沿用 unit/tunit 的 Codex 強化:`run-state.json` timing、Writer artifact gate + bounded re-dispatch、phase-boundary agent release、post-review approval gate、production-code 邊界、token de-scoped

### 驗證(Claude-vs-Codex 對照,exp-01~04)
- 單 Controller + PostgreSQL 容器 / 多 Controller 多容器(PG+Mongo)+ 多目標調度 / net10 變體 / net8 變體 四軸全部 **PASS**;net8/net9/net10 三 TFM 版本齊全
- 每個 Codex run 由 reviewer 親跑 `dotnet test` 驗證為真、**零假綠**;完整度與 Claude 基準大致 parity(差 1~10 案例,核心端點覆蓋齊);**零 Codex 專屬硬性 fix**(僅 bounded NU1605 套件版本對齊)
- 6 軸停損判定:Codex integration **good-enough**(與基準實質等價);容器 scope 兩版皆非決定性、net10 confound 在對齊提示詞後解除

## [v0.0.3] - 2026-06-22

Codex 版第二個工作流程預覽:**TUnit 測試 Agent Orchestration**(由 `dotnet-testing-agent-orchestration-claude` 經 migrate-to-codex 轉換,並經 Claude-vs-Codex 對照驗證)。

### 新增
- **`dotnet-testing-orchestrator-tunit` Skill**:TUnit 測試指揮中心,1 Skill + 4 Subagent(`dotnet-testing-advanced-tunit-{analyzer,writer,executor,reviewer}`),Codex 原生 SpawnAgent dispatch
- **4 個 tunit Codex 原生 subagent**(`.codex/agents/dotnet-testing-advanced-tunit-*.toml`)
- **tunit 練習 sample**(`samples/tunit/practice_tunit/`),含 `LibraryMemberValidator` fixture
- **per-type 文件**:`docs/architecture/tunit-orchestrator.md`、`docs/guides/tunit-testing.md`

### 特性(TUnit 專屬)
- **執行模型 = `dotnet run`**(Microsoft.Testing.Platform / Source Generator,`engineMode=SourceGenerated`),**絕不用 `dotnet test`**;產出 `OutputType=Exe`、不含 `Microsoft.NET.Test.Sdk`
- TUnit 屬性 `[Test]`/`[Arguments]`/`[MethodDataSource]`/`[Before(Test)]`,測試方法 `async Task`
- **`.slnx` 版本感知選擇**(net8 / net9 / net10)
- **xUnit→TUnit 遷移**軸(`[Fact]`→`[Test]`、`[Theory]`+`[InlineData]`→`[Arguments]`、`[MemberData]`→`[MethodDataSource]`、`IDisposable`→`[After(Test)]`,零 xUnit 殘留)
- Matrix:TUnit 0.6.123 無 `[MatrixDataSource]` → 以 nested-loop `[MethodDataSource]` 模擬
- Validator(`AbstractValidator<T>`)`forbidWriterSplit` 永不分割 + FluentValidation TestHelper
- 沿用 unit 的 Codex 強化:`run-state.json` timing、Writer artifact gate + bounded re-dispatch、phase-boundary agent release、post-review approval gate、production-code 邊界、token de-scoped

### 驗證(Claude-vs-Codex 對照,exp-01~06)
- 基本 / Writer 分割 / xUnit→TUnit 遷移 / net10 框架變體+.slnx / 資料驅動+Matrix / Validator 六軸全部 **PASS**
- 每個 Codex run 由 reviewer 親跑 `dotnet run` 驗證為真、**零假綠**;完整度與 Claude 基準 **parity**;**零 Codex 專屬硬性 fix**
- 6 軸停損判定:Codex tunit **good-enough**(與基準實質等價)

## [v0.0.2] - 2026-06-19

Reviewer 跨檔 fixture 一致檢查補強(工作流程契約變更)。

### 變更
- **Reviewer §3g 跨檔 fixture-setup 一致檢查補強**:`dotnet-testing-reviewer.toml` §3g 新增 fixture-setup 跨檔一致叢集——時間錨同名同值具名常數、AutoFixture 遞迴行為、共用欄位命名(`_fixture`/`_sut`)、per-test 時間區域變數命名、SUT 建構模式;讓 SKILL「Reviewer 逐檔比對 fixture setup」的宣稱真有 Reviewer 後盾(原僅 Writer 生成端 + Orchestrator gate 撐)
- **§3d 程式碼品質**擴充:未使用 `using` 之外,一併檢查宣告但未使用的 fixture 欄位(dead field)

### 驗證
- 注入式實證(非僅靜態文字):於 split 目標注入 fixture 漂移後重跑 Reviewer,`reviewer-result.json` 在 runtime 逐項觸發實質四項(時間錨值 / AutoFixture 遞迴 / 欄位命名 / SUT 建構模式),每條 finding 對應真實漂移;舊 §3g 無法涵蓋這些,屬本次新增項
- 連帶實證:Writer 生成端在同一輸入下確會漂移(同名 `InitialNow` 不同值),新 Reviewer 後盾抓到此真實漏失

## [v0.0.1] - 2026-06-18

Codex 版首個 unit 工作流程預覽：**.NET 單元測試 Agent Orchestration**（由 `dotnet-testing-agent-orchestration-claude` 經 migrate-to-codex 轉換並優化驗證）。

### 新增
- **`dotnet-testing-orchestrator-unit` Skill**：單元測試指揮中心，1 Skill + 4 Subagent（Analyzer → Writer → Executor → Reviewer），透過 Codex 原生 SpawnAgent dispatch
- **4 個 Codex 原生 subagent**（`.codex/agents/dotnet-testing-{analyzer,writer,executor,reviewer}.toml`）
- **`dotnet-test` Skill**：build-first、test-targeted 的選擇性測試執行

### 特性
- 大型類別 per-class Writer 分割、多目標支援
- setup 親和分組 + 跨檔 fixture 一致契約（時間錨具名常數 / AutoFixture 遞迴 / 命名 / SUT 建構一致）
- 建構子 null-guard 測試覆蓋（每個 guarded 依賴一個 `ArgumentNullException` 測試）
- Production-code 邊界：需 seam 即停報 `requiresUserApproval`、不硬測；裸 `DateTime.*` 比照裸 `File.IO`
- 修改流程 post-review approval gate
- 固定最終回覆契約（8 區塊，不可散文化）
- `run-state.json` 階段 timing 證據（逐 assignment、誠實不造假）+ thread-ceiling redispatch 自癒

### 與 Claude 版的差異（平台/設計）
- **Token 用量統計：de-scoped** — Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source（實證確認），故不回報，避免誤導數字
- Dispatch 經 Codex SpawnAgent（非 Claude Agent tool）；多 `run-state.json` 可稽核狀態檔（Codex-only）

### 已知限制
- 同輸入產出有 run-to-run 非決定性（測試數、分割分組、skill 選擇）——Codex native 多 subagent dispatch 的本質，非阻斷
- 階段耗時不對齊 Claude（平台/模型本質不同；耗時優化經實證在「不變更 agent 數」約束下不可行）
