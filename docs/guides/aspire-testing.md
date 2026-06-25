# Aspire 整合測試工作流程使用指南

本文件說明如何使用 `$dotnet-testing-orchestrator-aspire`，在 Codex 中自動完成 .NET Aspire 分散式應用程式整合測試的分析、撰寫、執行與審查四個階段。

適用場景：任何需要為 **.NET Aspire AppHost** 編排的 WebAPI 端點產生整合測試的情境，包含 AppHost Resource graph（SQL Server / PostgreSQL / Redis / MongoDB 等由 Aspire 宣告式管理的容器）、跨服務依賴、`GET /health` 健康檢查與 ProblemDetails 錯誤格式驗證。

測試技術棧：xUnit + `DistributedApplicationTestingBuilder`（Aspire.Hosting.Testing）+ `app.CreateHttpClient("name")` + AwesomeAssertions(.Web) + Respawn

與 unit / TUnit / integration 工作流程最關鍵的差別：aspire 以 **AppHost 編排的 HTTP endpoint 為粒度**，透過 `DistributedApplicationTestingBuilder` 啟動**真實的 AppHost + 容器**，以 `app.CreateHttpClient("servicename")` 發**真實 HTTP 請求**（**絕不**使用 `WebApplicationFactory`、**絕不**使用程式化 Testcontainers）。執行方式為 **`dotnet test --blame-hang-timeout`**（xUnit，含 `Microsoft.NET.Test.Sdk` + `Aspire.Hosting.Testing`、**無** `OutputType=Exe`、**絕不**用 `dotnet run`、**絕不**用 `--timeout`），且 **Docker 必須可用**（Aspire 容器由 AppHost 啟動，**無 InMemory 退路**）。

---

## A. 前提條件

- **Codex 已就緒**（支援原生 SpawnAgent / multi-agent，`.codex/config.toml` 中 `multi_agent = true`）
- **dotnet-testing-agent-skills 已複製到 `.codex/skills/`**（Writer / Reviewer 載入 `aspire-testing` 所需；Analyzer `requiredSkills` 固定 `["aspire-testing"]`）
- **.NET SDK 8.0 / 9.0 / 10.0 至少一個版本**
- **Docker 必須可用（硬前置）** — Aspire 容器由 AppHost 宣告式啟動，**沒有 InMemory 退路**；Executor Step 0 一律先跑 `docker info`，Docker 不可用即中止
- **Aspire workload 非必要** — `Aspire.AppHost.Sdk` 自 9.0.0 起以 NuGet 套件形式提供，使用 `Aspire.AppHost.Sdk` / Project SDK 的 AppHost 免安裝 workload 即可建置與測試；Executor 在 `dotnet workload list` 無 `aspire` 時會先讀 AppHost `.csproj` 確認，若為 NuGet SDK 則可跳過 workload 要求

---

## B. 觸發方式與使用範例

### 基本觸發

```text
$dotnet-testing-orchestrator-aspire
```

觸發後，提供下列資訊給 Orchestrator：

- 被測 WebAPI 專案路徑
- AppHost 專案路徑
- AppHost 服務名稱（`AddProject("name")` 的 `name`，須與 `CreateHttpClient("name")` 對齊）
- 目標 Controller 名稱（或端點範圍）
- 測試專案路徑（`.csproj`）
- 簡短說明（可選，如「涵蓋全部端點」）

Orchestrator 會透過 SpawnAgent 依序自動啟動 Analyzer → Writer → Executor → Reviewer，全程維護 `run-state.json`。

---

### 使用範例

#### 情境 1：單一 Controller + AppHost 多容器（SQL Server + Redis）

```text
呼叫 $dotnet-testing-orchestrator-aspire，為 samples/aspire/practice_aspire 的 BookingsController 撰寫 Aspire 整合測試，涵蓋全部端點。
AppHost: src/Practice.Aspire.AppHost
WebApi: src/Practice.Aspire.WebApi
測試專案: tests/Practice.Aspire.AppHost.Tests
AppHost 服務名: bookingapi
```

預期 Orchestrator 行為：

- Analyzer 從 AppHost `Program.cs` / `.csproj` 解析 Resource graph：`AddSqlServer("sql").AddDatabase("BookingsDb")` + `AddRedis("cache")`，`AddProject<Projects.Practice_Aspire_WebApi>("bookingapi")` 並 `WithReference` / `WaitFor`；產出 `appHostInfo`（含 `aspireVersion`）、`resources[]`、`dependencyGraph`、`apiProjectInfo.endpoints`
- Writer 建立 `AspireAppFixture`（`DistributedApplicationTestingBuilder` + `IAsyncLifetime`）+ `[CollectionDefinition]` / `ICollectionFixture<T>`；用 `app.CreateHttpClient("bookingapi")`（名稱對齊 AppHost）發 HTTP 請求；必要時 `ContainerLifetime.Session` + Respawn 清理
- Executor `docker info` → `dotnet workload list` → `dotnet build` → `dotnet test --no-build --blame-hang-timeout 10m`（net9 / Aspire 9.x）
- 測試方法命名範例：`GetById_預約不存在_應回傳404ProblemDetails`、`Create_客戶名稱為空_應回傳400ValidationProblemDetails`

---

#### 情境 2：指定端點範圍（端點 slice）

```text
呼叫 $dotnet-testing-orchestrator-aspire，僅為 BookingsController 的 POST 建立預約與 GET 查詢端點撰寫 Aspire 整合測試。
AppHost: src/Practice.Aspire.AppHost
WebApi: src/Practice.Aspire.WebApi
測試專案: tests/Practice.Aspire.AppHost.Tests
AppHost 服務名: bookingapi
```

預期 Orchestrator 行為：

- Writer 依端點範圍硬邊界（P3）只覆蓋 prompt 指定端點，**不得擴大**到 sibling endpoints 或 sibling resources
- Reviewer 也嚴禁把指定範圍以外的 sibling endpoint / resource 列為覆蓋缺口
- `writer-result.json` 的 `endpointsCovered` 必須是明確端點清單，不得使用 `All` / `FullController` / 空陣列

---

#### 情境 3：Health Checks / ProblemDetails 驗證

```text
呼叫 $dotnet-testing-orchestrator-aspire，為 BookingsController 撰寫 Aspire 整合測試，重點驗證 GET /health 與 FluentValidation 錯誤回應格式。
AppHost: src/Practice.Aspire.AppHost
WebApi: src/Practice.Aspire.WebApi
測試專案: tests/Practice.Aspire.AppHost.Tests
AppHost 服務名: bookingapi
```

預期 Orchestrator 行為：

- Analyzer 產出 `validators` 與端點 `errorResponses`
- Writer 用 `.And.Satisfy<ValidationProblemDetails>(...)` 驗證 `Errors` 字典的 key 存在性 + 錯誤訊息內容；`GET /health` 預期 200 OK
- 若 WebApi 未註冊 Health Checks 導致 `GET /health` 404，Executor 可在 production 窄例外授權下加 `AddHealthChecks()` + `MapHealthChecks("/health")`，並記入 `fixHistory` 與生產 Bug/修改紀錄

---

#### 情境 4：指定 .NET 版本變體

練習專案提供 net8（Aspire 8.2.2）/ net9（預設）/ net10（Aspire 13.1.2）三個變體，指定對應 AppHost + WebApi + 測試專案即可：

```text
呼叫 $dotnet-testing-orchestrator-aspire，為 BookingsController 撰寫 Aspire 整合測試（net10 變體）。
AppHost: src/Practice.Aspire.Net10.AppHost
WebApi: src/Practice.Aspire.Net10.WebApi
測試專案: tests/Practice.Aspire.Net10.AppHost.Tests
AppHost 服務名: bookingapi
```

預期 Orchestrator 行為：

- Analyzer 從 AppHost `.csproj` 取得 `appHostInfo.aspireVersion`（如 `13.1.2`）與 `projectContext.targetFramework`（`net10.0`）
- Writer 按 Aspire 版本對齊套件：`Aspire.Hosting.Testing`、`Aspire.Hosting.*` resource 套件版本必須與 AppHost 既有 Aspire 版本一致（8.x / 9.x / 13.x **不可混**），既有版本不升不降，缺套件才 add 最低對應版
- Executor 依 Aspire 版本選 `--blame-hang-timeout`：8.x / 9.x 用 `10m`，13.x+ 用 `15m`

---

## C. 練習專案

### 目錄結構

練習專案位於 `samples/aspire/practice_aspire/`：

```text
samples/aspire/practice_aspire/
├── Practice.Aspire.slnx               # net9.0 方案檔（Aspire 9.x，預設）
├── Practice.Aspire.Net8.slnx          # net8.0 方案檔（Aspire 8.2.2）
├── Practice.Aspire.Net10.slnx         # net10.0 方案檔（Aspire 13.1.2）
├── src/
│   ├── Practice.Aspire.AppHost/            # net9 AppHost（SQL Server + Redis 編排）
│   ├── Practice.Aspire.WebApi/             # net9 WebAPI（BookingsController）
│   ├── Practice.Aspire.Net8.AppHost/       # net8 變體
│   ├── Practice.Aspire.Net8.WebApi/
│   ├── Practice.Aspire.Net10.AppHost/      # net10 變體
│   └── Practice.Aspire.Net10.WebApi/
└── tests/
    ├── Practice.Aspire.AppHost.Tests/       # 空白測試專案 scaffold（由 Orchestrator 產生測試）
    ├── Practice.Aspire.Net8.AppHost.Tests/
    └── Practice.Aspire.Net10.AppHost.Tests/
```

### AppHost Resource 與 Controller 說明

| 項目 | 內容 | 學習重點 |
|---|---|---|
| AppHost 服務 | `AddProject<Projects.Practice_Aspire_WebApi>("bookingapi")` | `CreateHttpClient("bookingapi")` 名稱對齊 |
| 資料庫 Resource | `AddSqlServer("sql").AddDatabase("BookingsDb")` | `App.GetConnectionStringAsync("BookingsDb")`、Respawn 清理、`ContainerLifetime.Session` |
| 快取 Resource | `AddRedis("cache")` | Aspire 13.1+ Redis TLS（`WithoutHttpsCertificate()`）、容器生命週期 |
| `BookingsController` | 預約 CRUD + 狀態端點 | 端點覆蓋 + ProblemDetails/ValidationProblemDetails + `GET /health` |

> WebApi 透過 `WithReference(bookingsDb)` / `WithReference(cache)` 取得連線字串；測試端以 `App.GetConnectionStringAsync("resourceName")` 取得，**不可**用 `IConfiguration.GetConnectionString()`。

### 還原測試專案

Orchestrator 產生的測試檔案、`.orchestrator/` artifacts 與測試 `.csproj` 的套件變更皆為 byproduct，**不應 commit**。還原初始空白狀態：

```bash
git checkout -- samples/aspire/practice_aspire/tests/
git clean -fd samples/aspire/practice_aspire/tests/
```

> **注意**：所有 `samples/*/tests/` 下產生的測試類別、`.orchestrator/`（含 `run-state.json`）與 `.csproj` 修改，請在練習完成後還原。`.orchestrator/` 已由 `.gitignore` 排除。

---

## D. 常見問題排查

### 1. Docker 未啟動

**症狀**：Executor Step 0 回報 `Cannot connect to the Docker daemon` 或 `error during connect`。

**解法**：啟動 Docker Desktop 後重試。Aspire 容器由 AppHost 管理，**Docker 為硬性必要前提，沒有 InMemory 退路**（這是與 integration 工作流程的關鍵差異）。建議先預拉容器映像（如 SQL Server、Redis 映像）以縮短首次啟動時間。`docker: command not found` 表示 Docker 未安裝。

---

### 2. `dotnet run` / `--timeout` 用錯執行模型

**說明**：Aspire 工作流程以 xUnit + 傳統 VSTest 執行，**必須**用 `dotnet test` 並加上 `--blame-hang-timeout`：

```bash
dotnet test <solution-path> --no-build --verbosity minimal --blame-hang-timeout 10m
```

- **絕不**使用 `dotnet run`（AppHost 測試 csproj **無** `<OutputType>Exe</OutputType>`）。
- **絕不**使用 `--timeout`（不是 `dotnet test` 有效參數，會導致 MSB1001 錯誤）；正確防掛參數是 `--blame-hang-timeout`。
- 超時值：Aspire 8.x / 9.x 用 `10m`，13.x+ 用 `15m`。

若 executor-result 顯示用了 `dotnet run` 或 `--timeout`，該 phase 會被判定為 blocker。

---

### 3. Redis TLS 憑證錯誤（Aspire 13.1+）

**說明**：Aspire 13.1.0+ Redis TLS 預設啟用，測試連線出現 TLS / SSL 憑證錯誤。

**解法**：在 AppHost / fixture 對 Redis resource 加 `.WithoutHttpsCertificate()`。此為 Executor 三類 production 窄例外之一，會記入 `fixHistory` 與生產 Bug/修改紀錄。

---

### 4. 容器每測試重啟導致 timeout

**症狀**：`TimeoutException` / Resource readiness timeout / `HttpRequestException`，AppHost + 容器啟動過慢。

**解法**：對容器 resource 加 `.WithLifetime(ContainerLifetime.Session)`（Aspire 9.0+），讓容器在整個測試 session 共用而非每測試重啟。此為 Executor 三類 production 窄例外之一。必要時搭配 `WaitFor` 確認服務就緒。

---

### 5. stale Docker named volume 致 SQL `Access is denied`

**說明**：SQL Server resource 沿用先前殘留的 named volume，造成資料權限衝突或 `Access is denied`。

**解法**：清除殘留的 Docker named volume（`docker volume ls` 找出對應 volume 後 `docker volume rm`），讓 AppHost 重新初始化乾淨容器。這屬環境問題，不得包裝成 Writer 品質缺陷。

---

### 6. `Projects.xxx` 型別不存在

**說明**：測試引用 `Projects.Practice_Aspire_WebApi` 等型別時編譯失敗。

**解法**：確認 AppHost `.csproj` 的 `ProjectReference` 正確；組件名稱含連字號時須轉為底線（`Practice.Aspire.WebApi` → `Practice_Aspire_WebApi`）。`Projects.*` 由 AppHost 自動產生，測試專案須引用 AppHost。

---

### 7. `CreateHttpClient` 找不到服務

**說明**：`app.CreateHttpClient("xxx")` 找不到對應服務。

**解法**：名稱必須與 AppHost `AddProject("name")` **完全一致**（本練習為 `bookingapi`）。必要時建立 `launchSettings.json`。Reviewer 會驗證 `CreateHttpClient` 名稱與 AppHost 一致性。

---

### 8. `GetConnectionStringAsync` 回傳 null

**說明**：取連線字串時誤用 `IConfiguration.GetConnectionString()` 取得 null。

**解法**：改用 Aspire API `App.GetConnectionStringAsync("resourceName")`（如 `"BookingsDb"`）。Aspire 的連線字串由 AppHost 注入，不在測試專案的 `IConfiguration` 內。

---

### 9. `.HaveStatusCode()` 編譯錯誤

**說明**：AwesomeAssertions.Web 9.x **沒有** `.HaveStatusCode(HttpStatusCode.X)`。

**解法**：改用專用狀態碼擴充方法 `Be200Ok()` / `Be201Created()` / `Be204NoContent()` / `Be400BadRequest()` / `Be404NotFound()` / `Be409Conflict()`，使用後不需 `using System.Net;`。

---

## E. 工作流程細節

### Phase 1：Analyzer 分析

- 從 AppHost `Program.cs` 與 `.csproj` 解析 Resource graph，**不讀** Controller 細節以外的無關原始碼
- 輸出 `appHostInfo`（含 `aspireVersion`）、`resources[]`、`projectReferences[]`、`dependencyGraph`、`containerLifetime`、`dataVolumes`
- `apiProjectInfo`（含 `endpoints`、`dbContext`、`validators`）以 HTTP endpoint 為粒度識別待測端點
- `existingTestInfrastructure`、`suggestedTestScenarios`、`projectContext`、`sourceCodeContext`
- `projectContext.testFramework` 固定 `"xunit"`；`projectContext.targetFramework` 取自被測 API 專案；`requiredSkills` 固定 `["aspire-testing"]`
- 產出 compact JSON 寫入 `.orchestrator/analysis/{ControllerName}.analysis.json`

### Phase 2：Writer 撰寫

- 先讀 analysis.json，再載入 `.codex/skills/dotnet-testing-advanced-aspire-testing/SKILL.md`（**不得**載 unit / TUnit / integration 技能）
- **必用**：`DistributedApplicationTestingBuilder`、`app.CreateHttpClient("servicename")`、`AspireAppFixture` + `IAsyncLifetime`、`[CollectionDefinition]` + `ICollectionFixture<T>`、必要時 `ContainerLifetime.Session` / Respawn / `App.GetConnectionStringAsync("resourceName")`
- **不得用**：`WebApplicationFactory`、程式化 Testcontainers、`IConfiguration.GetConnectionString()`、`<OutputType>Exe</OutputType>`
- 端點範圍硬邊界（P3）：prompt 端點 > Analyzer `suggestedTestScenarios` / `endpoints` > 整個 Controller；不得擴大到 sibling
- `scenarioCount > 15` 時分兩批（先基礎設施、後測試案例 + 風格統一指令）
- P4 版本政策：既有 `.csproj` 套件不升不降，Aspire 系套件版本對齊 AppHost（8.x / 9.x / 13.x 不混），缺套件才 add 最低版
- 寫 `writer-result.json`；Orchestrator 讀實體檔做 artifact gate（`endpointsCovered` 須為明確清單，`skillsLoaded` 含 `aspire-testing`；缺欄 / scope mismatch 可 bounded re-dispatch 最多 2 次）

### Phase 3：Executor 建置與執行

- Step 0 `docker info`（Docker 必要，無退路）→ Step 0.5 `dotnet workload list`（NuGet `Aspire.AppHost.Sdk` 可免 workload）→ `dotnet build -p:WarningLevel=0 /clp:ErrorsOnly` → **`dotnet test --no-build --blame-hang-timeout <10m|15m>`**
- 多目標時 Executor **循序執行**（AppHost 啟動與 Docker 容器不可並行互搶）
- 解讀 xUnit 通過 / 失敗 / 略過數（來自實際輸出，禁編造）
- 修正迴圈最多 **5 輪**；原則上只改測試碼；production 窄例外僅三類：**Health Checks 缺失、`ContainerLifetime.Session`、Redis TLS**，須記入 `fixHistory` 與 final report
- 寫 `executor-result.json`（`dockerStatus` / `aspireWorkloadStatus` / `buildResult` / `testResult` / 通過數 / `fixRounds` / `fixHistory` / `addedPackages`）

### Phase 4：Reviewer 審查

- 載入 `aspire-testing`，視需要載 `test-naming-conventions` / `awesome-assertions`；Reviewer 無 Edit，只審查不修改
- 驗證：`DistributedApplicationTestingBuilder` 正確使用且無 `WebApplicationFactory`；`CreateHttpClient("name")` 與 AppHost `AddProject("name")` 一致；Collection Fixture / `IAsyncLifetime` / `ContainerLifetime.Session` / Respawn 合理；執行方式為 `dotnet test`（非 `dotnet run`）；csproj 含 `Microsoft.NET.Test.Sdk` + `xunit` + `Aspire.Hosting.Testing` 且無 `OutputType=Exe`；端點覆蓋只針對 P3 範圍
- 寫 `reviewer-result.json`（`overallRating` / `issues` / `missingTestCases` / `endpointCoverage` / `qualityGates`）；Orchestrator 用 Glob 確認落地，不採信回傳文字

---

## F. 修改流程

修改流程**禁止自動觸發**。Orchestrator 呈現完整 Reviewer 結果後**等待使用者決定**是否啟動修改、要套用哪些建議。使用者同意後：

1. 只 dispatch Writer 或 Executor 做測試側修改。
2. 若需 production code（`src/**`、constructor、public API、加 seam），必須先標記 `requiresUserApproval` 並通過批准閘門；唯三類 Aspire 窄例外（**Health Checks / `ContainerLifetime.Session` / Redis TLS**）可由 Executor 在窄例外授權下做最小修改。
3. 修改後更新 `writer-result` / `executor-result`。
4. Reviewer 以 re-review 模式確認前次 issues 是否解決，不展開無限新增審查。

> 各階段耗時取自 `run-state.json` 的 wall-clock 時間戳，輸出「各階段耗時」與「Timing Evidence」兩張表。**Token 用量**：正式 billing token 無可靠 truth source 故不回報；四階段完成後可執行 `node .codex/scripts/estimate-token-usage.mjs --test-project {測試專案}` 產生 `.orchestrator/token-usage-estimate.json`，並在 final report 輸出 optional 的 `Estimated Token Usage`（僅供 visible-context 相對成本比較，不可用於計費或 correctness gate）。細節見 [token-usage-estimation.md](token-usage-estimation.md)。
