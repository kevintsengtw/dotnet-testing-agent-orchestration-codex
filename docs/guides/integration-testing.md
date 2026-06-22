# 整合測試工作流程使用指南

本文件說明如何使用 `$dotnet-testing-orchestrator-integration`，在 Codex 中自動完成 .NET WebAPI 整合測試的分析、撰寫、執行與審查四個階段。

適用場景：任何需要為 **ASP.NET Core WebAPI** 端點產生整合測試的情境，包含 Controller-based / Minimal API、容器化資料庫（PostgreSQL / SQL Server / MongoDB / Redis）、FluentValidation + `ProblemDetails` 錯誤格式驗證。

測試技術棧：xUnit + WebApplicationFactory + AwesomeAssertions(.Web) + Testcontainers + Respawn + Flurl

與 unit / TUnit 工作流程最關鍵的差別：integration 以 **HTTP endpoint 為粒度**，透過 `WebApplicationFactory<Program>` 發**真實 HTTP 請求**，執行方式為 **`dotnet test`**（xUnit，含 `Microsoft.NET.Test.Sdk`、**無** `OutputType=Exe`），且**需 Docker**（Testcontainers 啟動真實資料庫容器）。

---

## A. 前提條件

- **Codex 已就緒**（支援原生 SpawnAgent / multi-agent，`.codex/config.toml` 中 `multi_agent = true`）
- **dotnet-testing-agent-skills 已複製到 `.codex/skills/`**（Writer 載入 `webapi-integration-testing` / `aspnet-integration-testing` / `testcontainers-database` / `testcontainers-nosql` 所需）
- **.NET SDK 8.0 / 9.0 / 10.0 至少一個版本**
- **Docker 必須可用**（有容器需求時 Executor 會先 `docker info`；純 InMemory 測試才可略過）

---

## B. 觸發方式與使用範例

### 基本觸發

```text
$dotnet-testing-orchestrator-integration
```

觸發後，提供下列資訊給 Orchestrator：

- 被測 WebAPI 專案路徑
- 目標 Controller 名稱（或端點範圍）
- 測試專案路徑（`.csproj`）
- 簡短說明（可選，如「使用 PostgreSQL 容器」）

Orchestrator 會透過 SpawnAgent 依序自動啟動 Analyzer → Writer → Executor → Reviewer，全程維護 `run-state.json`。

---

### 使用範例

#### 情境 1：單一 Controller CRUD + 容器資料庫

```text
呼叫 $dotnet-testing-orchestrator-integration，為 OrdersController 撰寫整合測試。
被測 API 專案：samples/integration/practice_integration/src/Practice.Integration.WebApi
測試專案：samples/integration/practice_integration/tests/Practice.Integration.WebApi.Tests/Practice.Integration.WebApi.Tests.csproj
目標 Controller：OrdersController（全部端點）
```

預期 Orchestrator 行為：

- Analyzer 偵測 `OrdersController` 依賴 `OrderDbContext`（PostgreSQL）+ FluentValidation；`containerRequirements: [PostgreSQL]`、`requiredSkills` 含 `testcontainers-database`
- Writer 建立單一 `CustomWebApplicationFactory`（PostgreSQL Testcontainer）+ Collection Fixture + `IntegrationTestBase`（Respawn 清理）
- Executor `docker info` → `dotnet build` → `dotnet test`，測試發真實 HTTP 請求
- 測試方法命名範例：`GetById_訂單不存在_應回傳404ProblemDetails`、`Create_客戶名稱為空_應回傳400ValidationProblemDetails`

---

#### 情境 2：多 Controller / 多容器（多目標調度）

```text
呼叫 $dotnet-testing-orchestrator-integration，為 OrdersController 和 CustomerActivitiesController 撰寫整合測試。
被測 API 專案：samples/integration/practice_integration/src/Practice.Integration.WebApi
測試專案：samples/integration/practice_integration/tests/Practice.Integration.WebApi.Tests/Practice.Integration.WebApi.Tests.csproj
目標：OrdersController 與 CustomerActivitiesController 的所有端點
```

預期 Orchestrator 行為：

- Analyzer **平行** 2 個（Orders → PostgreSQL；CustomerActivities → MongoDB，載入 `testcontainers-nosql`）
- Writer 平行（單一 Controller `scenarioCount > 15` 才再分兩批）；共用 factory 啟動所需容器
- Executor **循序執行**（共用方案、容器避免 port 衝突）
- 2 個 Reviewer 平行，最後彙整概覽表 + 各 Controller 詳細結果

---

#### 情境 3：ProblemDetails / ValidationProblemDetails 驗證

```text
呼叫 $dotnet-testing-orchestrator-integration，為 OrdersController 撰寫整合測試，重點驗證 FluentValidation 錯誤回應格式。
被測 API 專案：samples/integration/practice_integration/src/Practice.Integration.WebApi
測試專案：samples/integration/practice_integration/tests/Practice.Integration.WebApi.Tests/Practice.Integration.WebApi.Tests.csproj
```

預期 Orchestrator 行為：

- Analyzer 產出 `validatorInfo`（規則 + `validBaseObjectHint`）與 `middlewarePipeline`（`IExceptionHandler` → `ValidationProblemDetails`）
- Writer 用 `.And.Satisfy<ValidationProblemDetails>(...)` 驗證 `Errors` 字典的 **key 存在性 + 錯誤訊息內容**；複合欄位失敗逐欄驗證
- 測試方法命名範例：`Create_Email格式不正確_應回傳400ValidationProblemDetails`

---

#### 情境 4：指定 .NET 版本變體

練習專案提供 net8 / net9 / net10 三個變體，指定對應 src + 測試專案即可：

```text
呼叫 $dotnet-testing-orchestrator-integration，為 OrdersController 撰寫整合測試（net10 變體）。
被測 API 專案：samples/integration/practice_integration/src/Practice.Integration.WebApi.Net10
測試專案：samples/integration/practice_integration/tests/Practice.Integration.WebApi.Net10.Tests/Practice.Integration.WebApi.Net10.Tests.csproj
```

預期 Orchestrator 行為：

- Analyzer 從 `.csproj` 取得 `<TargetFramework>`（`net10.0`）寫入 `projectContext.targetFramework`
- Writer 按框架選對應套件版本（如 net10 → `Npgsql.EntityFrameworkCore.PostgreSQL 10.0.x`、net8 → `8.0.x`），既有版本不升不降，缺套件才 add 最低對應版

---

## C. 練習專案

### 目錄結構

練習專案位於 `samples/integration/practice_integration/`：

```text
samples/integration/practice_integration/
├── Practice.Integration.slnx          # net9.0 方案檔（無版本後綴）
├── Practice.Integration.Net8.slnx     # net8.0 方案檔
├── Practice.Integration.Net10.slnx    # net10.0 方案檔
├── src/
│   ├── Practice.Integration.WebApi/        # net9 WebAPI（PostgreSQL + MongoDB + Redis）
│   ├── Practice.Integration.WebApi.Net8/   # net8 變體
│   └── Practice.Integration.WebApi.Net10/  # net10 變體
└── tests/
    ├── Practice.Integration.WebApi.Tests/       # 空白測試專案 scaffold（由 Orchestrator 產生測試）
    ├── Practice.Integration.WebApi.Net8.Tests/
    └── Practice.Integration.WebApi.Net10.Tests/
```

### 各 Controller 說明

| Controller | 端點數 | 依賴 / 容器 | 學習重點 |
|---|---|---|---|
| `OrdersController` | 8 | `OrderDbContext`（**PostgreSQL**）+ FluentValidation + `TimeProvider` | CRUD + 狀態機（confirm/cancel）+ ProblemDetails/ValidationProblemDetails + Respawn |
| `CustomerActivitiesController` | 5 | `ICustomerActivityRepository`（**MongoDB**）+ FluentValidation | NoSQL 容器、`testcontainers-nosql`、string id |

> Program.cs 的 DB / Mongo / Redis 註冊以 `if(!builder.Environment.IsEnvironment("Testing"))` 包裹（`conditional` 模式），Factory 用 `UseEnvironment("Testing")` + 直接 `AddDbContext` 置換，不需 descriptor 移除。

### 還原測試專案

Orchestrator 產生的測試檔案、`.orchestrator/` artifacts 與測試 `.csproj` 的套件變更皆為 byproduct，**不應 commit**。還原初始空白狀態：

```bash
git checkout -- samples/integration/practice_integration/tests/
git clean -fd samples/integration/practice_integration/tests/
```

> **注意**：所有 `samples/*/tests/` 下產生的測試類別、`.orchestrator/`（含 `run-state.json`）與 `.csproj` 修改，請在練習完成後還原。`.orchestrator/` 已由 `.gitignore` 排除。

---

## D. 常見問題排查

### 1. Docker 未啟動

**症狀**：Executor 回報 `Cannot connect to the Docker daemon`。

**解法**：啟動 Docker Desktop 後重試。有容器需求（`containerRequirements` 非空）時 Docker 為必要前提；純 InMemory 測試才可略過 Docker 檢查。建議先預拉容器映像（如 `docker pull postgres:16-alpine`、`docker pull mongo`）以縮短首次啟動時間。

---

### 2. `dotnet run` 跑不出整合測試 / 用錯執行模型

**說明**：integration 工作流程以 xUnit + `Microsoft.Testing.Platform` 之外的傳統 VSTest 執行，**必須用 `dotnet test`**：

```bash
dotnet test <solution-path> --no-build --verbosity minimal --filter "FullyQualifiedName~OrdersControllerTests"
```

Executor 與 Reviewer 都只用 `dotnet test`（這是與 TUnit 工作流程的關鍵差異——TUnit 才用 `dotnet run`）。若 executor-result 顯示用了 `dotnet run`，該 phase 會被判定為 blocker。

---

### 3. `Services for database providers 'X', 'Y' have been registered`

**說明**：WebApplicationFactory 置換 DbContext 時與 Program.cs 原註冊的 Provider 衝突。

**解法**：依 Analyzer 的 `dbRegistrationAnalysis.pattern` 決定策略——`conditional` / `no-registration` 直接 `AddDbContext`；`hardcoded-unconditional` 需在 Program.cs `AddDbContext` 外層加 `if(!builder.Environment.IsEnvironment("Testing"))`。若 `SingleOrDefault` descriptor 移除仍無法解決，Executor **已被授權**對 Program.cs 加入此環境條件判斷（唯一 production 窄例外，會在 `productionBugFixes` 標記）。

---

### 4. `.HaveStatusCode()` 編譯錯誤

**說明**：AwesomeAssertions.Web 9.x **沒有** `.HaveStatusCode(HttpStatusCode.X)`。

**解法**：改用專用狀態碼擴充方法 `Be200Ok()` / `Be201Created()` / `Be204NoContent()` / `Be400BadRequest()` / `Be404NotFound()` / `Be409Conflict()`。使用這些方法後不需要 `using System.Net;`。

---

### 5. 容器使用 `latest` 標籤造成不穩定

**說明**：`postgres:latest` / `mongo:latest` 等浮動標籤可能因上游更新導致測試不可重現（Reviewer 會標 WARN）。

**解法**：改用固定版本標籤，例如 `postgres:16-alpine`、`mongo:7.0`、`redis:7.2`。

---

### 6. 測試間資料污染

**說明**：整合測試共用同一容器，前一個測試的資料殘留影響後續測試。

**解法**：在 `IntegrationTestBase.DisposeAsync()`（或 `InitializeAsync`）以 **Respawn** 重置資料庫，或用 `ExecuteSqlRawAsync("DELETE FROM ...")` 按 FK 順序清理。每個測試前後資料庫狀態須隔離。

---

## E. 工作流程細節

### Phase 1：Analyzer 分析

- 讀取 WebAPI 專案原始碼，偵測 API 架構（controller-based / minimal-api / mixed）
- 以 HTTP endpoint 為粒度識別 `endpointsToTest[]`（method/route/parameters/returnType/dependencies/errorResponses）
- 偵測 `containerRequirements`（PostgreSQL / SQL Server / MongoDB / Redis / InMemory）與 `dbRegistrationAnalysis`（DbContext 註冊模式）
- 分析中介軟體管線（`IExceptionHandler` / FluentValidation / ProblemDetails）與 `validatorInfo`（+ `validBaseObjectHint`）
- 決定 `requiredSkills`（`webapi-integration-testing` 必載；`aspnet-integration-testing` / `testcontainers-database` / `testcontainers-nosql` 條件）
- 產出 compact JSON 寫入 `.orchestrator/analysis/{ControllerName}.analysis.json`

### Phase 2：Writer 撰寫

- 讀 analysis.json，按 `requiredSkills` 載入 Skills
- 建立基礎設施（`CustomWebApplicationFactory` + Collection Fixture + `IntegrationTestBase`）與測試類別；依 `dbRegistrationAnalysis` 決定 DbContext 置換策略
- 中文三段式命名；HTTP 斷言用 AwesomeAssertions.Web；ProblemDetails 用 `.And.Satisfy<T>()`
- `scenarioCount > 15` 時分兩批（先基礎設施、後測試案例 + 風格統一指令）
- 寫 `writer-result.json`；Orchestrator 讀實體檔做 artifact gate（缺欄 / 範圍不符可 bounded re-dispatch 最多 2 次）

### Phase 3：Executor 建置與執行

- `docker info`（有容器需求時）→ `dotnet build` → **`dotnet test --no-build`**
- 解讀 xUnit 通過/失敗/略過數（來自實際輸出，禁編造）
- bounded 修正（補 using、add-only 補套件、DI/ConnectionString/EnsureCreated）最多 3 輪；**禁升降套件版本**、**禁改 production code**（DB Provider 衝突 Program.cs 環境條件為唯一窄例外）
- 寫 `executor-result.json`（`executionMethod` / `dockerStatus` / `buildResult` / `testResult` / 通過數 / `fixRounds` / `productionBugFixes`）；Orchestrator 驗收 Gate 確認用 `dotnet test`

### Phase 4：Reviewer 審查

- 固定載入 `test-naming-conventions` + `awesome-assertions` + `webapi-integration-testing`（條件載入容器 skills）
- 審查命名 / 斷言 / 結構 / 容器管理 / 端點×情境覆蓋 / validator 覆蓋；`executionMethodVerified` 確認用 `dotnet test`
- 寫 `reviewer-result.json`（`overallRating` / `issues` / `missingTestCases` / `endpointCoverage` / `qualityGates`）
- Orchestrator 呈現完整結果後**等待使用者決定**是否啟動修改流程（禁自動觸發、禁預先授權）

> 各階段耗時取自 `run-state.json` 的 wall-clock 時間戳；Token 用量不提供（de-scoped）。
