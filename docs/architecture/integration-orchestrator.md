# 整合測試 Orchestrator 架構說明

> 本文件依**實際 `.codex/skills/dotnet-testing-orchestrator-integration/SKILL.md` 與 `.codex/agents/dotnet-testing-advanced-integration-*.toml` 契約**撰寫，描述 Codex 版實際行為（含相對上游 Claude 版的 Codex-specific 強化）。

## 1. 概覽

| 項目 | 說明 |
|---|---|
| 適用場景 | ASP.NET Core WebAPI 整合測試（Controller-based / Minimal API / Mixed）、容器化資料庫（PostgreSQL / SQL Server / MongoDB / Redis）整合測試 |
| Orchestrator Skill 路徑 | `.codex/skills/dotnet-testing-orchestrator-integration/SKILL.md` |
| 觸發方式 | `$dotnet-testing-orchestrator-integration` |
| Dispatch 機制 | Codex 原生 SpawnAgent |

Orchestrator 是**指揮中心**，調度四個 advanced-integration Subagent，自身不撰寫測試。流程：Phase 0 前置清理 → Analyzer → Writer → Executor → Reviewer → Phase 5 保留 artifacts。全程維護 `run-state.json`。

**與 Unit（xUnit）Orchestrator 的核心差異**：測試粒度為 **HTTP endpoint**（非 class method）；執行模型為 **`dotnet test` + Docker/Testcontainers**（需 Docker 環境）；測試透過 **`WebApplicationFactory<Program>`** 發真實 HTTP 請求；HTTP 斷言用 **AwesomeAssertions.Web**（`Be200Ok` / `Be404NotFound` 等）；錯誤格式驗證 **`ProblemDetails` / `ValidationProblemDetails`**；資料隔離用 **Respawn / Collection Fixture**。

> **與 TUnit Orchestrator 的差異**：integration 用 `dotnet test`（xUnit，含 `Microsoft.NET.Test.Sdk`、**無** `OutputType=Exe`），TUnit 用 `dotnet run`（Source Generator、`OutputType=Exe`）。

---

## 2. 元件組成

| 元件 | 類型 | 路徑 |
|---|---|---|
| Orchestrator | Skill | `.codex/skills/dotnet-testing-orchestrator-integration/` |
| Analyzer | Subagent | `.codex/agents/dotnet-testing-advanced-integration-analyzer.toml` |
| Writer | Subagent | `.codex/agents/dotnet-testing-advanced-integration-writer.toml` |
| Executor | Subagent | `.codex/agents/dotnet-testing-advanced-integration-executor.toml` |
| Reviewer | Subagent | `.codex/agents/dotnet-testing-advanced-integration-reviewer.toml` |

Orchestrator 在 SpawnAgent 時**只傳交接檔案路徑 + 摘要數字**，不嵌入完整 JSON；各 Subagent 的 Step 0 自行讀取上游交接檔案。

---

## 3. Phase 1 Analyzer

Analyzer 讀 WebAPI 專案原始碼，以 **HTTP endpoint 為粒度**識別端點結構、資料層依賴與容器需求，產出 `analysis.json`。

**主要分析項目：**

- **API 架構偵測**：`controller-based`（`Controllers/` + `AddControllers()` / `MapControllers()`）/ `minimal-api`（`app.MapGet()` 等）/ `mixed`。
- **端點結構**（`endpointsToTest[]`）：每個端點的 `httpMethod`、`route`、`parameters`、`returnType`、`dependencies`、`errorResponses`。
- **資料層 + 容器需求**（`containerRequirements[]`）：依 NuGet 套件 + `Program.cs` 服務註冊偵測容器類型。

| 偵測規則 | 容器類型 |
|---|---|
| `Microsoft.EntityFrameworkCore.SqlServer` / `AddSqlServer<>()` | SQL Server |
| `Npgsql.EntityFrameworkCore.PostgreSQL` / `AddNpgsql<>()` | PostgreSQL |
| `MongoDB.Driver` / `AddMongoDB()` | MongoDB |
| `StackExchange.Redis` / `AddRedis()` | Redis |
| `Microsoft.EntityFrameworkCore.InMemory` | 無容器需求 |

- **DbContext 註冊模式**（`dbRegistrationAnalysis`，關鍵步驟）：`hardcoded-unconditional`（高風險，需改 Program.cs）/ `conditional`（已用 `if(!IsEnvironment("Testing"))` 包裹，安全）/ `no-registration`。直接決定 Writer 的 DbContext 置換策略。
- **中介軟體管線**（`middlewarePipeline`）：`IExceptionHandler`、FluentValidation、Auth、CORS、ProblemDetails。
- **Validator 分析**（`validatorInfo`）：`AbstractValidator<T>` 規則 + `validBaseObjectHint`（合法請求體提示，供 Happy Path 使用）。
- **`requiredSkills`**：`webapi-integration-testing` **必載**；`aspnet-integration-testing`（controller-based / mixed）、`testcontainers-database`（SQL Server / PostgreSQL）、`testcontainers-nosql`（MongoDB / Redis）**條件載入**。
- `projectContext.testFramework` 固定 `"xunit"`；`targetFramework` 從 WebAPI `.csproj` 的 `<TargetFramework>` 取得。
- `suggestedTestScenarios`：中文三段式 `端點_情境_預期`。

Orchestrator 收摘要後**驗證交接檔案確實存在**，才 SpawnAgent Writer。

---

## 4. Phase 2 Writer

Writer 在 Step 0 讀 analysis.json，按 `requiredSkills` 載入 Agent Skills，撰寫整合測試。

**測試命名**：中文三段式 `端點操作_情境_預期`（如 `Create_名稱為空_應回傳400ValidationProblemDetails`）。
**斷言**：HTTP 狀態碼用 AwesomeAssertions.Web 專用擴充（`Be200Ok` / `Be201Created` / `Be400BadRequest` / `Be404NotFound` / `Be409Conflict` / `Be204NoContent`，**禁** 不存在的 `.HaveStatusCode()`）；`ProblemDetails` / `ValidationProblemDetails` 用 `.And.Satisfy<T>()` 驗證 body。
**基礎設施**：`WebApplicationFactory<Program>`（容器需求時實作 `IAsyncLifetime`）、`[CollectionDefinition]` + `ICollectionFixture<T>` 共享容器、`IntegrationTestBase`（`IAsyncLifetime` + `HttpClient` + Seed/Cleanup）、Respawn 或 `ExecuteSqlRaw` 資料清理；目錄結構 `Fixtures/` + `TestBase/` + `Controllers/`（或 `Endpoints/`）。
**csproj 硬規則**：`Microsoft.AspNetCore.Mvc.Testing` + `AwesomeAssertions(.Web)` + `Testcontainers.*` + `Respawn` 等；**有** `Microsoft.NET.Test.Sdk`、**無** `<OutputType>Exe</OutputType>`。

### 4.1 DbContext 置換策略（依 `dbRegistrationAnalysis.pattern`）

| pattern | 策略 | 是否改 Program.cs |
|---|---|---|
| `hardcoded-unconditional` | **策略 A**：先在 Program.cs `AddDbContext` 外層加 `if(!builder.Environment.IsEnvironment("Testing"))` → Factory 用 `UseEnvironment("Testing")` + 直接 `AddDbContext`（不需 descriptor 移除） | ✅ 需要 |
| `conditional` | **策略 B**：Factory 用 `UseEnvironment("Testing")` + 直接 `AddDbContext` | ❌ 不需要 |
| `no-registration` | **策略 C**：直接 `AddDbContext` | ❌ 不需要 |
| 不明 | 安全預設：`SingleOrDefault` 精確移除 `DbContextOptions<T>` descriptor 後重註冊 | ❌ |

> **嚴禁模式**（所有 Factory 類型）：`ConfigureTestServices`、nullable `Container?`、公開 `EnsureCreatedAsync()`、`Task.Delay()` 硬等待、`static lock` 初始化鎖。`EnsureCreatedAsync()` 須封裝在 Factory 的 `InitializeAsync()` 內。

### 4.2 分階段啟動（integration 專屬，非 TUnit method-split）

| 測試案例數量 | 策略 |
|---|---|
| `scenarioCount ≤ 15` | 單次啟動（基礎設施 + 全部測試案例） |
| `scenarioCount > 15` | 分兩次（第一次只產基礎設施 GlobalUsings/WebApiFactory/TestBase/csproj；第二次產測試案例 + 風格統一指令） |

### 4.3 端點範圍硬邊界（P3，Codex 強化）

有效端點範圍來源優先序：prompt / `writerControls` 明確 endpoint slice > Analyzer artifact `endpointsToTest[]` > 整個 Controller。上層範圍存在時不得擴大到 sibling endpoints；`testClasses[].endpointsCovered`（或 `methodsCovered`）必為明確端點清單，不得填 `All` / `FullController` / 空陣列 / 敘述文字。

### 4.4 Writer Artifact 完整性 Gate

Writer 回傳後 Orchestrator **不只採信摘要**，必須讀實體 `writer-result.json` 驗欄位齊全（`writerResultFilePath`、`testFilePaths`、`testCount`/`testCaseCount`、`testClasses[].className/filePath/endpointsCovered`、`skillsLoaded`）+ 範圍檢查（`skillsLoaded` 不得含 unit 的 20 個 technique skills 或 TUnit skills）。缺欄 / 不一致 → 不進 Executor，可 **bounded re-dispatch Writer 最多 2 次**，仍不行則判 blocker。

### 4.5 階段間主動釋放 agent

Writer 全部收斂且 gate 通過後、dispatch Executor 前，Orchestrator **主動關閉已完成 Writer agents** 釋放 runtime thread slots（Analyzer→Writer、Executor→Reviewer 同樣處理）。

---

## 5. Phase 3 Executor

確認 Docker → 建置 → 執行 → **bounded 修正迴圈（最多 3 輪）**。

- **Step 0 Docker 環境檢查**：建置前先 `docker info`；`Cannot connect to the Docker daemon` / `command not found` / `permission denied` 各自回報對應環境問題。**特例**：`containerRequirements` 為空（純 InMemory）可跳過。
- **建置**：`dotnet build <solution-path> -p:WarningLevel=0 /clp:ErrorsOnly --verbosity minimal`。
- **執行（唯一允許方式）**：`dotnet test <solution-path> --no-build --verbosity minimal`（可 `--filter "FullyQualifiedName~XxxControllerTests"`）。**絕不可使用 `dotnet run`**。
- 常見修正：補 `using`、**add-only 補齊缺少的測試套件**、DI 註冊、ConnectionString 置換、`EnsureCreated()`/`Migrate()` 在 `InitializeAsync`。**禁升降既有套件版本**修 build；**禁** restart / 拼湊·偽造 artifact / 假綠。
- 結果：通過/失敗/略過數**必須來自實際 `dotnet test` 輸出**，禁編造。

> **Integration Executor 驗收 Gate**：Orchestrator 讀 `executorResultFilePath`，確認 `executionMethod === "dotnet test"`、`dockerStatus` 存在、通過/失敗/略過來自 xUnit 輸出、`fixRounds` 落入 run-state。若顯示用 `dotnet run`，該 phase 判 blocker。

---

## 6. Phase 4 Reviewer

讀測試碼 + 三個交接檔（analysis/writer-result/executor-result），品質審查。Reviewer 一律執行，不因 Executor 全綠而跳過；有完整審查 / re-review 兩模式。Reviewer **無 `Edit` 工具**，只記錄不修改。

**固定載入**：`test-naming-conventions` + `awesome-assertions` + `webapi-integration-testing`；條件載入 `aspnet-integration-testing` / `testcontainers-database` / `testcontainers-nosql`。

**審查面向**：命名規範（中文三段式）、斷言品質（AwesomeAssertions.Web `Be*` + ProblemDetails/ValidationProblemDetails 完整驗證）、測試結構（AAA、`WebApplicationFactory`、`factory.CreateClient()`、`async Task`）、程式碼品質、**容器管理**（Collection Fixture 共享、`IAsyncLifetime`、Respawn、WaitStrategy 非 `Task.Delay`、固定映像標籤）、**覆蓋率**（端點 × 情境、錯誤路徑、validator 規則、對稱驗證覆蓋）。

收尾寫 `{ControllerName}.reviewer-result.json`，含 `overallRating`、`issues[]`、`missingTestCases[]`、`endpointCoverage`、`qualityGates`、`executionMethodVerified`（確認 Executor 用 `dotnet test`，發現 `dotnet run` / TUnit 形狀則 FAIL）。端點覆蓋審查只限本次指定範圍，不得把 sibling endpoints 列為缺口。

**修改流程（post-review approval gate）**：Reviewer 回傳後 Orchestrator 呈現完整報告並**等待使用者明確指示**才啟動修改流程。**禁止自動觸發、禁止預先授權**。

---

## 7. Production-code 邊界（Codex 與 Claude 共有政策 + integration 窄例外）

本 workflow 預設**只寫/驗測試，不主動改 production code**：

- 若需改 `src/**` / production `.csproj` / constructor / public API / 加 seam / 加 production 套件 → Orchestrator 標 **`requiresUserApproval`**，未經同意不得 dispatch。
- **唯一 integration 窄例外**：當 Executor 遇 DB Provider 衝突（`Services for database providers 'X','Y' have been registered`）且 `SingleOrDefault` descriptor 移除無法解決時，Executor **已被授權**對 `Program.cs` 加入 `if(!builder.Environment.IsEnvironment("Testing"))` 環境條件判斷。此例外不擴及任何其他 production refactor，且須在 final report 以「生產 Bug/修改紀錄」標記（`productionBugFixes[]`）。
- final report 誠實標 `blocked` / `characterization-only` / `requiresUserApproval`。

---

## 8. 交接檔案與 run-state instrumentation

| 交接檔 | 寫入者 | 路徑 |
|---|---|---|
| `{ControllerName}.analysis.json` | Analyzer | `.orchestrator/analysis/` |
| `{ControllerName}.writer-result.json` | Writer | `.orchestrator/writer-result/` |
| `{ControllerName}.executor-result.json` | Executor | `.orchestrator/executor-result/` |
| `{ControllerName}.reviewer-result.json` | Reviewer | `.orchestrator/reviewer-result/` |
| `run-state.json` | Orchestrator | `.orchestrator/` |

**`run-state.json` 是官方耗時的唯一真實來源**（wall-clock，不依賴 narration），含逐 assignment 的 `dispatchIssuedAt` / `dispatchAcceptedAt` / `artifactReadyAt` / `completedAt` / `produceSpanMs`、`phaseDurations`、`redispatchEvents[]` / `boundedRedispatchCount` / `restartCount` / `executorFixRounds`。正式 phase timing 必須讀實體檔計算，不得從對話敘述 / hook / 人工推估 / token report 推導。

> **Token 用量不提供（de-scoped）**：Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source，本 workflow 不回報、不執行 token report。

---

## 9. 多目標並行策略

| 階段 | 執行方式 | 原因 |
|---|---|---|
| Analyzer | 平行（逐 Controller / endpoint slice） | 互不依賴 |
| Writer | 平行（逐 target，單一 Controller `scenarioCount > 15` 才分兩批） | dispatch 單位是 Writer assignment |
| Executor | **循序** | 同方案 `dotnet build` 不可並行；容器避免 port 衝突 |
| Reviewer | 平行（逐 target） | 獨立審查 |

- 並行 SpawnAgent 數受 `.codex/config.toml` `[agents] max_threads` 限制。
- **thread-ceiling 自癒**：遇已知 runtime 不穩定家族（capacity / thread-limit / stream retry / nested spawn fail / phase timeout / artifact missing）做 **bounded re-dispatch**（每 phase 最多 2 次，`restartCount=0`），`run-state.redispatchEvents` 記錄。

---

## 10. Phase 0 / Phase 5 清理

- **Phase 0**：啟動 Analyzer 前，`Glob({testProjectDir}/.orchestrator/**)` 檢查殘留；有殘留則委託 Executor `task: "cleanup"`，並初始化 `run-state.json`。
- **Phase 5**：四階段完成並呈現結果後，**不自動清理**本次 `.orchestrator/` artifacts（保留供驗收與 benchmark），於**下一次 run 的 Phase 0** 殘留清理時一併處理。
- 生成測試碼 + `.orchestrator/` 皆為 byproduct，**不進版控**。

---

## 11. 支援的測試技術棧

```text
xUnit + Microsoft.NET.Test.Sdk（dotnet test 執行模型）
Microsoft.AspNetCore.Mvc.Testing（WebApplicationFactory<Program>）
AwesomeAssertions + AwesomeAssertions.Web（Be200Ok / Be404NotFound / Satisfy<T> 等 HTTP 斷言）
Testcontainers.PostgreSql / .MsSql / .MongoDb / .Redis（容器化資料庫）
Respawn（資料庫狀態重置）/ Flurl（URL 建構）
FluentValidation（ProblemDetails / ValidationProblemDetails 驗證）
```

> 執行模型：`dotnet test`（xUnit）+ Docker / Testcontainers；測試專案含 `Microsoft.NET.Test.Sdk`、**無** `OutputType=Exe`。需 Docker 環境（有容器需求時 Executor 先 `docker info`）。
>
> 技術型 `dotnet-testing-*` Skills 由外部 repo [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 提供，需直接複製到 `.codex/skills/`。
