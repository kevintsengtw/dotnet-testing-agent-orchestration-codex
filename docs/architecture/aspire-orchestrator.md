# .NET Aspire 測試 Orchestrator 架構說明

> 本文件依**實際 `.codex/skills/dotnet-testing-orchestrator-aspire/SKILL.md` 與 `.codex/agents/dotnet-testing-advanced-aspire-*.toml` 契約**撰寫，描述 Codex 版實際行為（含相對上游 Claude 版的 Codex-specific 強化）。

## 1. 概覽

| 項目 | 說明 |
|---|---|
| 適用場景 | .NET Aspire 分散式應用程式整合測試：以 AppHost Resource graph 編排被測 WebAPI 服務 + Aspire 宣告式管理的容器（SQL Server / PostgreSQL / MongoDB / Redis 等）|
| Orchestrator Skill 路徑 | `.codex/skills/dotnet-testing-orchestrator-aspire/SKILL.md` |
| 觸發方式 | `$dotnet-testing-orchestrator-aspire` |
| Dispatch 機制 | Codex 原生 SpawnAgent |

Orchestrator 是**指揮中心**，調度四個 advanced-aspire Subagent，自身不撰寫測試。流程：Phase 0 前置清理 → Analyzer → Writer → Executor → Reviewer → Phase 5 保留 artifacts。全程維護 `run-state.json`。

**與 Integration（WebApplicationFactory）Orchestrator 的核心差異**：執行模型為 **AppHost / `DistributedApplicationTestingBuilder`**（**非** `WebApplicationFactory`）；測試透過 **`app.CreateHttpClient("servicename")`** 發真實 HTTP 請求，服務名稱必須對齊 AppHost `AddProject("name")`；容器由 **Aspire AppHost 宣告式管理**（**非**程式化 Testcontainers）；DB 連線用 **`App.GetConnectionStringAsync("resourceName")`**（**非** `IConfiguration.GetConnectionString()`）；環境前置為 **Docker 硬前置 + Aspire workload 雙檢**（無 InMemory 退路）。

> **與 TUnit / Integration Orchestrator 的差異**：aspire 用 xUnit `dotnet test` + `--blame-hang-timeout`（**非** `dotnet run`、**非** 無效的 `--timeout`），測試 `.csproj` 含 `Microsoft.NET.Test.Sdk` + `xunit` + `Aspire.Hosting.Testing`、**無** `<OutputType>Exe</OutputType>`。

---

## 2. 元件組成

| 元件 | 類型 | 路徑 |
|---|---|---|
| Orchestrator | Skill | `.codex/skills/dotnet-testing-orchestrator-aspire/` |
| Analyzer | Subagent | `.codex/agents/dotnet-testing-advanced-aspire-analyzer.toml` |
| Writer | Subagent | `.codex/agents/dotnet-testing-advanced-aspire-writer.toml` |
| Executor | Subagent | `.codex/agents/dotnet-testing-advanced-aspire-executor.toml` |
| Reviewer | Subagent | `.codex/agents/dotnet-testing-advanced-aspire-reviewer.toml` |

Orchestrator 在 SpawnAgent 時**只傳 canonical 交接檔案路徑 + 必要控制欄位**，不嵌入完整 JSON、長篇敘事或 `sourceCodeContext`；各 Subagent 的 Step 0 自行讀取上游交接檔案。Orchestrator 自身**禁止讀 SKILL.md、禁止寫測試碼、禁止改 `.csproj` / `.cs`**，第一步只做殘留檢查、初始化 run-state、立即 dispatch Analyzer。

---

## 3. Phase 1 Analyzer

Analyzer 以 **AppHost `Program.cs`** 為主要入口（非 WebAPI `Program.cs`），分析分散式應用程式的 **Resource graph** 與被編排 API 的端點結構，以 **HTTP endpoint 為粒度**，產出 `analysis.json`。

**主要分析項目（頂層欄位）：**

- **`appHostInfo`（含 `aspireVersion`）**：須處理兩種 csproj 格式 —
  - **(A) 分離 SDK 格式**（`<Sdk Name="Aspire.AppHost.Sdk" Version="X.Y.Z" />`，Aspire 8.x / 9.x）：版本**以 `Aspire.Hosting.AppHost` 套件版本為權威來源**（SDK 版本與套件版本不同時以套件版本為準；8.x 可能用 SDK 9.0.0 但 runtime 套件為 8.x）。
  - **(B) Project SDK 格式**（`<Project Sdk="Aspire.AppHost.Sdk/X.Y.Z">`，Aspire 13.x）：無獨立 `Aspire.Hosting.AppHost` 套件參考，**版本從 SDK 屬性取得**。
- **`resources[]`**：所有 `builder.Add*` 呼叫（類型、名稱、方法、映像、資料卷）。
- **`projectReferences[]`**：被編排專案（名稱、類型、依賴 Resources、`WaitFor` 關係）；`name` 必須與 AppHost `AddProject("name")` 字串參數**完全一致**（影響 `CreateHttpClient("name")` 正確性）。
- **`dependencyGraph`**：服務依賴圖（`WithReference` / `WaitFor` 關係）。
- **`containerLifetime`**：是否有 `WithLifetime(ContainerLifetime.Session)`。
- **`dataVolumes`**：`WithDataVolume` 名稱。
- **`apiProjectInfo`**：含 `endpoints`、`dbContext`、`validators`（**不需** `dbRegistrationAnalysis` — Aspire 自動管理 DB 連線，無 descriptor 移除策略）。
- **`existingTestInfrastructure`**：掃描既有 AspireAppFixture / Collection Fixture / Respawn，避免 Writer 重複建立。
- **`requiredSkills`**：固定 `["aspire-testing"]`。
- **`suggestedTestScenarios`**：中文三段式 `端點操作_情境_預期`。
- **`projectContext`**：`testFramework` 固定 `"xunit"`；`targetFramework` 取自**被編排 API 專案**（非 AppHost）的 `<TargetFramework>`。
- **`sourceCodeContext`**：將已讀檔案的**完整內容**前向傳遞（AppHost / API 的 `Program.cs` + `.csproj`、controllers、models、dbContext、validators、測試 csproj 等），供下游免重複讀取。

Orchestrator 收摘要後用 Glob **驗證 `analysisFilePath` 確實存在**，才 SpawnAgent Writer。

---

## 4. Phase 2 Writer

Writer 在 Step 0 先讀 analysis.json，**只載入單一技術技能** `.codex/skills/dotnet-testing-advanced-aspire-testing/SKILL.md`，撰寫 Aspire 整合測試。**不得載入** unit 的 20 個 technique skills、TUnit skills 或一般 integration skills。

**測試命名**：中文三段式 `端點操作_情境_預期`。
**基礎設施**：`AspireAppFixture`（`IAsyncLifetime`）+ `[CollectionDefinition]` + `ICollectionFixture<T>` 共享 AppHost；必要時 `ContainerLifetime.Session`、必要時 Respawn 做資料隔離。

**Writer 必須使用**：

- `DistributedApplicationTestingBuilder`
- `app.CreateHttpClient("servicename")`（名稱對齊 AppHost `AddProject("name")`）
- `AspireAppFixture` + `IAsyncLifetime`、`[CollectionDefinition]` + `ICollectionFixture<T>`
- 必要時 `ContainerLifetime.Session`、必要時 Respawn
- `App.GetConnectionStringAsync("resourceName")`

**Writer 不得使用**：

- `WebApplicationFactory`
- 程式化 Testcontainers
- `IConfiguration.GetConnectionString()`
- `<OutputType>Exe</OutputType>`

**csproj 硬規則**：`Microsoft.NET.Test.Sdk` + `xunit` + `xunit.runner.visualstudio` + `Aspire.Hosting.Testing`；**無** `<OutputType>Exe</OutputType>`。

### 4.1 端點範圍硬邊界（P3，Codex 強化）

有效端點範圍來源優先序：prompt 明確端點 / Controller slice > Analyzer artifact 的 `suggestedTestScenarios` / `endpoints` > 整個 Controller。上層範圍存在時不得擴大到 sibling endpoints 或 sibling resources；`testClasses[].endpointsCovered`（或 `methodsCovered`）必為明確端點清單，不得填 `All` / `FullController` / 空陣列 / 敘述文字。

### 4.2 分批啟動判斷

| 測試案例數量 | 策略 |
|---|---|
| `scenarioCount ≤ 15` | 單次啟動（基礎設施 + 全部測試案例） |
| `scenarioCount > 15` | 分兩次（第一次只產基礎設施；第二次產測試案例 + 風格統一指令） |

### 4.3 P4 版本政策

既有 `.csproj` 套件版本一律**保留，不升不降**；僅對缺少的必要套件用 SKILL 記載的最低版本；不執行 `dotnet list package --outdated`；fix 回合 **add-only、不 bump**。`Aspire.Hosting.Testing` / `Aspire.Hosting.*` resource 套件版本必須與 AppHost 既有 Aspire 版本對齊（**8.x / 9.x / 13.x 不可混**），只補缺、不改既有版本。

### 4.4 Writer Artifact 完整性 Gate

Writer 回傳後 Orchestrator **不只採信摘要**，必須讀實體 `writerResultFilePath` 驗欄位齊全（`writerResultFilePath`、`testFilePaths` 非空、`testCount` / `testCaseCount` 為數字、`testClasses[].className/filePath/endpointsCovered`（或 `methodsCovered`）、`skillsLoaded`）+ 範圍檢查（`skillsLoaded` 應含 `aspire-testing`，**不得**含 unit / TUnit / integration 技能）。缺欄 / 不可讀 / scope mismatch → 不進 Executor，可 **bounded re-dispatch Writer 最多 2 次**，仍不行則判 blocker。

### 4.5 階段間主動釋放 agent

各 phase 全部 assignment 收斂且 artifact 確認存在後、dispatch 下一 phase 前，Orchestrator **主動關閉已完成 agents** 釋放 Codex runtime thread slots（Analyzer→Writer、Writer→Executor、Executor→Reviewer 同樣處理）。若 runtime 不支援主動關閉，停手並回報「runtime 不支援主動關閉已完成 agent」。

---

## 5. Phase 3 Executor

確認 Docker + Aspire 環境 → 建置 → 執行 → **bounded 修正迴圈（最多 5 輪）**。Aspire 測試需啟動 AppHost + 多容器，環境複雜度高，故修正空間較 integration（3 輪）寬。

- **Step 0 Docker 環境檢查（硬前置）**：`docker info`；`Cannot connect to the Docker daemon` / `command not found` 各自回報。**Aspire 無 InMemory 退路** — 不同於 integration 可純 InMemory 跳過，Aspire 容器由 AppHost 管理，Docker 為必要條件。
- **Step 0.5 Aspire workload 檢查（aspire 專屬）**：`dotnet workload list`；輸出無 `aspire` 時，**NuGet SDK 免 workload 例外** — 先讀 AppHost `.csproj`，若使用 `Aspire.AppHost.Sdk`（9.0.0+ 以 NuGet 套件提供）則 SDK 由 NuGet 解析，可跳過 workload 要求繼續執行；否則回報「請執行 `dotnet workload install aspire`」。
- **建置**：`dotnet build <solution-path> -p:WarningLevel=0 /clp:ErrorsOnly --verbosity minimal`。
- **執行（唯一允許方式）**：`dotnet test <solution-path> --no-build --verbosity minimal --blame-hang-timeout <10m|15m>`。`--blame-hang-timeout` **必須存在**：Aspire 8.x / 9.x 用 `10m`，13.x+ 用 `15m`。**絕不可** `dotnet run`、**絕不可**用無效的 `--timeout`（會導致 MSB1001）。
- 常見修正：補 `using`、**add-only 補齊缺少套件**、`Projects.xxx` 型別（連字號轉底線）、`EnsureCreatedAsync()` 在 fixture、服務名稱一致性、`CreateHttpClient` 找不到服務。容器由 Aspire + `IAsyncLifetime.DisposeAsync` 自動清理，不需手動。**禁升降既有套件版本**修 build；**禁** restart / 拼湊·偽造 artifact / 假綠。
- 結果：通過/失敗/略過數**必須來自實際 `dotnet test` 輸出**，禁編造。

Executor 寫 `{ControllerName}.executor-result.json`，含 `dockerStatus`、`aspireWorkloadStatus`、`buildResult`、`testResult`、`totalTests` / `passedTests` / `failedTests` / `skippedTests`、`fixRounds`、`fixHistory`、`addedPackages`。

---

## 6. Phase 4 Reviewer

讀測試碼 + 三個交接檔（analysis / writer-result / executor-result），品質審查。Reviewer 一律執行，**不因 Executor 第一次全綠、0 修正輪次或使用者未明確要求而跳過**。Reviewer **無 `Edit` 工具**，只記錄不修改；有完整審查 / re-review 兩模式。

**固定載入** `aspire-testing`，並視需要載入 `test-naming-conventions` / `awesome-assertions`。

**審查面向**：

- `DistributedApplicationTestingBuilder` 正確使用，且**沒有** `WebApplicationFactory`。
- `CreateHttpClient("name")` 名稱與 AppHost `AddProject("name")` **一致**。
- Collection Fixture / `IAsyncLifetime` / `ContainerLifetime.Session` / Respawn 使用合理。
- 執行方式為 `dotnet test`，**不是** `dotnet run`。
- csproj 有 `Microsoft.NET.Test.Sdk` + `xunit` + `Aspire.Hosting.Testing`，**沒有** `<OutputType>Exe</OutputType>`。
- 端點覆蓋只針對 P3 指定範圍，不擴大到 sibling endpoints / resources。

收尾寫 `{ControllerName}.reviewer-result.json`（含 `overallRating`、`issues[]`、`missingTestCases[]`、`endpointCoverage`、`qualityGates`、執行方式驗證）。寫失敗即 blocker。Orchestrator 回傳後用 Glob 確認 `reviewResultFilePath` 落地；不存在即 blocker，不採信回傳文字。

**修改流程（post-review approval gate）**：Reviewer 回傳後 Orchestrator 呈現完整報告並**等待使用者明確指示**才啟動修改流程。**禁止自動觸發、禁止預先授權**。同意後只 dispatch Writer / Executor 做測試側修改；需 production code 須先過批准邊界；修改後更新 writer-result / executor-result；Reviewer 以 re-review 模式確認前次 issues，不展開無限新增審查。

---

## 7. Production-code 邊界（Codex 與 Claude 共有政策 + aspire 三類窄例外）

本 workflow 預設**只寫/驗測試，不主動改 production code**：

- 若需改 `src/**` / production `.csproj` / constructor / public API / 加 seam → Orchestrator 標 **`requiresUserApproval`**，未經同意不得 dispatch。
- **Aspire 唯三窄例外**（Executor 已被授權做最小修改，須在 final report 以「生產 Bug/修改紀錄」標記）：
  1. **WebApi 缺 Health Checks**（`GET /health` 404）→ 加 `AddHealthChecks()` + `MapHealthChecks("/health")`。
  2. **容器每測試重啟超時** → 在 AppHost 或 fixture 加 `.WithLifetime(ContainerLifetime.Session)`（Aspire 9.0+）。
  3. **Redis TLS**（Aspire 13.1.0+ 預設啟用）→ 加 `.WithoutHttpsCertificate()` 等對應設定。
- 任何超出上述三類的 production 改動仍走批准閘門。final report 誠實標 `blocked` / `requiresUserApproval`。

---

## 8. 交接檔案與 run-state instrumentation

| 交接檔 | 寫入者 | 路徑 |
|---|---|---|
| `{ControllerName}.analysis.json` | Analyzer | `.orchestrator/analysis/` |
| `{ControllerName}.writer-result.json` | Writer | `.orchestrator/writer-result/` |
| `{ControllerName}.executor-result.json` | Executor | `.orchestrator/executor-result/` |
| `{ControllerName}.reviewer-result.json` | Reviewer | `.orchestrator/reviewer-result/` |
| `run-state.json` | Orchestrator | `.orchestrator/` |

**`run-state.json` 是官方耗時的唯一真實來源**（wall-clock，不依賴 narration），含 `workflow: "aspire"` 與逐 assignment 的 `dispatchIssuedAt` / `dispatchAcceptedAt` / `artifactReadyAt` / `completedAt` / `produceSpanMs`、`agentDefinitionPath`、`spawnPayloadShape`、`expectedArtifactPath`、`redispatchEvents[]` / `boundedRedispatchCount` / `restartCount` / `executorFixRounds`。正式 phase timing 必須讀實體檔計算，不得從對話敘述 / hook additionalContext / 人工推估 / token report 推導。結果呈現輸出「### 各階段耗時」與「### Timing Evidence」兩張表。

> **Estimated Token Usage**：Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source，本 workflow 不回報正式 token usage。四階段完成後可執行 `node scripts/estimate-token-usage.mjs --test-project {testProjectDir}` 產生 `.orchestrator/token-usage-estimate.json`，並在 final report 輸出 `Estimated Token Usage` optional telemetry。此估算只供 visible-context 相對成本比較，不可用於 billing、runtime truth 或 correctness gate。

---

## 9. 多目標並行策略

| 階段 | 執行方式 | 原因 |
|---|---|---|
| Analyzer | 平行（逐 Controller / endpoint slice） | 互不依賴 |
| Writer | 平行（逐 target，單一 Controller `scenarioCount > 15` 才分兩批） | dispatch 單位是 Writer assignment |
| Executor | **循序** | **AppHost 啟動與 Docker 容器不可並行互搶**（port / 容器衝突） |
| Reviewer | 平行（逐 target） | 獨立審查 |

- 並行 SpawnAgent 數受 `.codex/config.toml` `[agents] max_threads` 限制。
- **thread-ceiling 自癒**：遇已知 runtime 不穩定家族（capacity / thread-limit / stream retry / nested spawn fail / phase timeout / artifact missing after phase start）做 **bounded re-dispatch**（每 phase 最多 2 次），re-dispatch 前須確認前一次同角色沒留下可用 canonical artifact，避免雙重 truth，`run-state.redispatchEvents` 記錄。

---

## 10. Phase 0 / Phase 5 清理

- **Phase 0**：啟動 Analyzer 前，`Glob({testProjectDir}/.orchestrator/**)` 檢查殘留；有殘留則委託 Executor `task: "cleanup"`，並初始化 `run-state.json`。
- **Phase 5**：四階段完成並呈現結果後，**不自動清理**本次 `.orchestrator/` artifacts（保留 analysis / writer-result / executor-result / reviewer-result / run-state 供驗收與 benchmark），於**下一次 run 的 Phase 0** 殘留清理時一併處理。
- 生成測試碼 + `.orchestrator/` 皆為 byproduct，**不進版控**。

---

## 11. 結果整合與呈現

收到四個 subagent 回傳後，Orchestrator 整合呈現給使用者。最終輸出固定包含下列 **9 項**；資料一律來自 artifact / run-state，缺欄填「未提供」，不得省略項目、不得改成散文摘要、不得回報正式 token usage（只允許 `Estimated Token Usage` optional telemetry）：

1. **測試檔案連結**：Writer 產出的所有測試檔與基礎設施檔路徑（AspireAppFixture、CollectionDefinition、IntegrationTestBase、DatabaseManager、GlobalUsings 等），不在 chat 嵌入完整測試碼。
2. **執行結果摘要**：Executor 的 `dotnet test` 結果（通過 / 失敗 / 略過數、`executionMethod`、`--blame-hang-timeout` 值）。
3. **Docker + Aspire 環境狀態**：`dockerStatus`、`aspireWorkloadStatus`（含 `Aspire.AppHost.Sdk` / NuGet SDK 免 workload 例外說明）、容器啟動證據與必要的 AppHost resource 狀態。
4. **品質審查摘要**：Reviewer 整體評級、blocker / warning / pass 與關鍵發現。
5. **改善建議**：整理 Reviewer 的 `issues` 與 `missingTestCases`，沒有則明確寫「無」。
6. **使用的 Skills 組合**：Writer 載入的 skills，固定應含 `aspire-testing`，不得混入 unit / TUnit / 一般 integration skills。
7. **Executor 修正紀錄**：`fixRounds`、`fixHistory`、`addedPackages`，並標記是否套用 Aspire production 窄例外（僅限 Health Checks、`ContainerLifetime.Session`、Redis TLS），沒有則明確寫「無」。
8. **各階段耗時摘要 + Timing Evidence**：讀 `run-state.json`，輸出「### 各階段耗時」與「### Timing Evidence」兩張表。
9. **Estimated Token Usage**：optional telemetry。四階段與 timing evidence 完成後執行 `node scripts/estimate-token-usage.mjs --test-project {testProjectDir}` 產生 `.orchestrator/token-usage-estimate.json`，輸出「### Estimated Token Usage」表格；estimator 失敗 / run-state 缺失 / artifact 不足 / summary 為 `unavailable` 時改輸出 unavailable 表格，但不得讓 workflow 失敗，且不得作為 correctness gate。

> **環境問題 vs 測試品質問題**：必須區分「環境問題（Docker daemon / Aspire workload / 容器啟動 / stale named volume / 網路）」與「測試品質問題」。Docker 未啟動、Aspire workload 缺失、容器健康檢查或啟動逾時、stale volume、網路問題，**不得**包裝成 Writer 品質缺陷。

---

## 12. 支援的測試技術棧

```text
xUnit + Microsoft.NET.Test.Sdk（dotnet test + --blame-hang-timeout 執行模型）
Aspire.Hosting.Testing（DistributedApplicationTestingBuilder + app.CreateHttpClient("name")）
AspireAppFixture（IAsyncLifetime）+ CollectionDefinition（AppHost 共享）
ContainerLifetime.Session（Aspire 9.0+，避免容器每測試重啟）
App.GetConnectionStringAsync("resourceName")（Aspire 管理連線，非 IConfiguration）
Respawn（資料庫狀態重置）
```

> 執行模型：xUnit `dotnet test` + `--blame-hang-timeout`（8.x/9.x=10m、13.x=15m）+ Docker + Aspire AppHost 宣告式容器；測試 `.csproj` 含 `Microsoft.NET.Test.Sdk` + `xunit` + `Aspire.Hosting.Testing`、**無** `<OutputType>Exe</OutputType>`。需 Docker（Executor Step 0 `docker info` 硬前置，無 InMemory 退路）+ Aspire workload（Step 0.5 `dotnet workload list`，含 `Aspire.AppHost.Sdk` NuGet 免 workload 例外）。
>
> 技術型 `dotnet-testing-*` Skills 由外部 repo [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 提供，需直接複製到 `.codex/skills/`。
