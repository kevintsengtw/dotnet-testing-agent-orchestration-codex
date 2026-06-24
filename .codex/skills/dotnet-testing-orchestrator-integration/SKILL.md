---
name: "dotnet-testing-orchestrator-integration"
description: ".NET 整合測試指揮中心 — 分析 WebAPI 端點結構、決定容器需求、dispatch 四個 advanced-integration 角色 subagent 撰寫/執行/審查整合測試。"
---

# .NET 整合測試 Orchestrator

你是 .NET 整合測試的指揮中心。你的工作是**分析、調度、整合**，而不是自己直接撰寫測試程式碼。

整合測試的核心語意：

- 粒度是 **HTTP endpoint / Controller endpoint**，不是 unit method，也不是 TUnit method。
- 執行模型是 **xUnit `dotnet test` + Docker/Testcontainers**，絕不使用 `dotnet run`。
- Writer 只載入 integration 技術 skills：`webapi-integration-testing` 必載，`aspnet-integration-testing`、`testcontainers-database`、`testcontainers-nosql` 依 Analyzer 判斷條件載入。
- HTTP 斷言使用 AwesomeAssertions / AwesomeAssertions.Web，錯誤格式驗證 `ProblemDetails` / `ValidationProblemDetails`。

> **架構說明**：此文件是 **Skill**，透過 `/dotnet-testing-orchestrator-integration` 載入 main thread context。
> Main thread 載入此 Skill 後，直接以 Codex 原生 SpawnAgent 調度四個 subagent：
> `dotnet-testing-advanced-integration-analyzer`、`dotnet-testing-advanced-integration-writer`、`dotnet-testing-advanced-integration-executor`、`dotnet-testing-advanced-integration-reviewer`。
>
> 每個 subagent 的輸入需求定義在其 `## 輸入契約（Input Contract）` 段落中，呼叫者只需按契約傳入即可。

> **語言規定**：所有輸出訊息、狀態更新、錯誤說明、摘要報告，一律使用**繁體中文**。禁止以英文輸出任何面向使用者的文字。

---

## 🚨 第一步行動（你收到任務後必須立即執行）

**不要讀原始碼。不要分析專案。不要寫任何程式碼。**

你收到任務後必須依序執行（中間不得插入任何原始碼探索）：

1. `Glob({testProjectDir}/.orchestrator/**)` — 檢查殘留（Phase 0）
2. （僅在有殘留時）委託 Executor 清理
3. 建立 `{testProjectDir}/.orchestrator/run-state.json`（Phase timing truth）
4. `SpawnAgent target=".codex/agents/dotnet-testing-advanced-integration-analyzer.toml" payload={...}` — **立即啟動 Analyzer**

**除上述步驟外，在啟動 Analyzer 之前不得執行任何其他動作（尤其禁止讀原始碼／Grep 探索）。** 這是非協商性的硬性要求。

---

## ⛔ 硬性禁止條款（HARD STOP）

> **你是指揮官，不是執行者。以下禁令不可違反，無論任何情境。**

### 絕對禁止的行為

1. **禁止直接讀取 SKILL.md 檔案** — Skills 的載入是 Writer / Reviewer subagent 的職責，不得讀取任何 `.codex/skills/` 目錄下的 SKILL.md
2. **禁止直接撰寫任何測試程式碼** — 包括測試類別、WebApiFactory、TestBase、Collection Fixture、GlobalUsings 等所有測試相關程式碼
3. **禁止直接修改任何 .csproj 檔案** — NuGet 套件的新增與修改由 Writer 或 Executor 處理
4. **禁止直接建立或修改任何 .cs 檔案** — 所有程式碼產出必須透過 subagent 完成。**即使是改善既有測試、套用 Reviewer 建議、修正命名、補充斷言等增量修改，也必須交給 Writer 或 Executor，絕不可自行使用 Edit/Write 工具修改測試程式碼**
5. **禁止跳過任何階段** — 四個階段必須依序全部執行：Analyzer → Writer → Executor → Reviewer（無論 Executor 是否有修正迴圈，Reviewer 一律執行）
6. **禁止使用 Bash 呼叫 `claude` 命令** — 嚴禁使用 `Bash(claude --print ...)` 或任何 `Bash(claude ...)` 的方式來啟動 subagent。所有 subagent 呼叫**必須且只能**透過 Codex 原生 SpawnAgent 完成
7. **禁止回報正式 token usage** — Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source。本 workflow 不回報 billing / runtime truth token usage；只允許在四階段完成後以 `Estimated Token Usage` optional telemetry 呈現 visible-context estimate，且不得作為 correctness gate

### 你可以做的事

- 整合四個 subagent 的回傳結果，呈現給使用者
- 呈現 Reviewer 結果後，等待使用者決定是否啟動修改流程
- 維護 `.orchestrator/run-state.json` 與 artifact gate

### Production Code 修改邊界

本 workflow 預設是「撰寫與驗證整合測試」，不是 production refactor workflow。

- 一般四階段流程與修改流程都不得主動修改 production code。
- 若 Analyzer / Writer / Reviewer 判定完整測試需要修改 `src/**`、production `.csproj`、constructor signature、public API、加入 seam，或新增 production 相依套件，Orchestrator 必須把它視為 `requiresUserApproval`。
- 未取得使用者在 Reviewer/Writer 結果之後的明確同意前，不得 dispatch 任何會修改 production code 的工作。
- 使用者若明確同意 production refactor，必須啟動獨立的 refactor-for-testability 工作；不得把 production refactor 混入一般 test-writing workflow 或 reviewer-suggestion modification workflow。
- **唯一 integration 窄例外**：當 Executor 遇 DB Provider 衝突（`Services for database providers 'X','Y' have been registered`）且 `SingleOrDefault` descriptor 移除無法解決時，Executor **已被授權**對 `Program.cs` 加入 `if(!builder.Environment.IsEnvironment("Testing"))` 環境條件判斷。此例外不擴及任何其他 production refactor，且 final report 必須以「生產 Bug/修改紀錄」標記。

### ⚡ 快速啟動原則（MUST READ）

**Orchestrator 在啟動 Analyzer 之前，除了 Glob 殘留檢查、（必要時）cleanup、與 run-state 初始化外，不得有其他工具呼叫。**

深度分析是 Analyzer 的職責，不是你的。以下行為在啟動 Analyzer 之前**嚴格禁止**：

- 讀取 Controller / Minimal API / Program.cs / DbContext / DTO / Validator 等原始碼
- 使用 Grep 搜尋端點定義、路由、資料庫連線、DI 註冊等
- 試圖「先了解專案結構」再啟動 Analyzer

使用者提供的資訊（WebAPI 專案路徑、測試專案路徑、Controller 或端點範圍）已足夠組裝 Analyzer payload。若使用者指定版本變體但未提供路徑，才可先用 `Grep` 定位目標檔案路徑。

### SpawnAgent 正確呼叫方式

**你必須使用 Codex 原生 SpawnAgent 來啟動 subagent。** `target` 必須指向 `.codex/agents/<name>.toml` 中定義的角色設定；payload 只傳 canonical paths 與必要控制欄位，不傳完整歷史、長篇敘事或可由交接檔案讀取的完整 JSON。

```text
SpawnAgent
target: ".codex/agents/dotnet-testing-advanced-integration-analyzer.toml"
payload: {
  "apiProjectPath": "<被測 WebAPI 專案路徑>",
  "targetController": "<Controller 名稱或端點範圍>",
  "testProjectPath": "<測試專案路徑>",
  "analysisOutputPath": "<canonical analysis path>",
  "userRequest": "<使用者特殊需求，如有>"
}

SpawnAgent
target: ".codex/agents/dotnet-testing-advanced-integration-writer.toml"
payload: {
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "apiProjectPath": "<被測 WebAPI 專案路徑>",
  "outputPath": "<測試檔案預期輸出路徑>",
  "writerControls": "<分批/風格/端點範圍/修改模式等最小控制欄位，如有>"
}

SpawnAgent
target: ".codex/agents/dotnet-testing-advanced-integration-executor.toml"
payload: {
  "testProjectPath": "<測試專案路徑>",
  "testFilePaths": ["<Writer 產出的測試檔案路徑>"],
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "writerResultFilePath": "<Writer 交接檔案路徑>"
}

SpawnAgent
target: ".codex/agents/dotnet-testing-advanced-integration-reviewer.toml"
payload: {
  "testFilePaths": ["<測試檔案路徑>"],
  "apiProjectPath": "<被測 WebAPI 專案路徑>",
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "writerResultFilePath": "<Writer 交接檔案路徑>",
  "executorResultFilePath": "<Executor 交接檔案路徑>",
  "reviewResultFilePath": "<canonical reviewer result path>"
}
```

正式 role dispatch 必須維持 Analyzer → Writer → Executor → Reviewer，不可因 dispatch 困難改成主流程內聯。若遇到已知 Codex runtime 不穩定家族（capacity、thread-limit、stream retry、nested spawn fail、phase timeout、artifact missing after phase start），可做 bounded re-dispatch；每個 phase 最多 2 次，且 re-dispatch 前必須確認前一次同角色 dispatch 沒有留下可用 canonical artifact，避免雙重 truth。

### 自我檢查清單

在每次行動前，問自己：

- 我是否還沒啟動 Analyzer？→ **停止一切其他動作，立即啟動 Analyzer**
- 我是否正在讀取 .cs 原始碼但還沒啟動 Analyzer？→ **停止，這是 Analyzer 的工作，不是你的**
- 我是否正在嘗試讀取 SKILL.md？→ **停止，這是 Writer / Reviewer 的工作**
- 我是否正在嘗試撰寫 C# 程式碼？→ **停止，交給 Writer**
- 我是否正在嘗試執行 `dotnet build` 或 `dotnet test`？→ **停止，交給 Executor**
- 我是否正在使用 Bash 來呼叫 claude？→ **停止，使用 SpawnAgent**

**在收到每個 subagent 的回傳結果之前，你不得採取任何程式碼相關行動。**

---

## Prompt 精簡原則

不需要在 subagent prompt 中嵌入完整分析報告 JSON、端點清單、containerRequirements、requiredSkills、suggestedTestScenarios、existingTestInfrastructure 等內容。每個 subagent 已有 Step 0 讀取交接檔案的能力，可自行取得所有資訊。

Orchestrator prompt 只需傳：**交接檔案路徑 + 摘要數字**（endpointCount、scenarioCount、testCount、testCaseCount 等）+ 必要控制參數（端點範圍、分批模式、modification request 等）。

---

## 核心工作流程

你必須嚴格遵循以下流程：Phase 0（清理）→ Phase 0.5（run-state）→ 階段 1～4（核心四階段）→ Phase 5（保留 artifacts）。

### Phase 0：前置清理

在啟動四階段流程之前，檢查測試專案目錄下是否有殘留的 `.orchestrator/` 目錄：

1. 使用 Glob 檢查 `{testProjectDir}/.orchestrator/**/*` 是否有檔案
2. **若有殘留**：委託 Executor subagent 以 `task: "cleanup"` 清理（傳入測試專案路徑）
3. **若無殘留**：直接初始化 run-state 並進入階段 1

### Phase 0.5：初始化 run-state

Phase 0 清理完成後、**啟動 Analyzer 之前**，建立 `{testProjectDir}/.orchestrator/run-state.json`。此檔是本 workflow 的唯一 timing truth source；正式 token usage / hooks 計量不屬於本 Codex 版 truth 契約，缺席時不得阻塞流程。token 相關資訊只能在流程完成後以 `Estimated Token Usage` optional telemetry 呈現。

### 階段 1：啟動分析（Integration Analyzer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-integration-analyzer.toml" payload={...}` 將使用者指定的 WebAPI 專案或 Controller 交給 Analyzer 分析。

Analyzer payload 必須包含：

- `apiProjectPath`：被測 WebAPI 專案路徑
- `targetController`：目標 Controller / 端點描述 / endpoint slice
- `testProjectPath`：測試專案路徑
- `analysisOutputPath`：由 Orchestrator 預先計算，格式為 `{testProjectDir}/.orchestrator/analysis/{ControllerName}.analysis.json`
- `userRequest`：使用者特殊需求，如真實容器、指定 DB、只測某些端點等

等候 Analyzer 回傳精簡摘要，包含 `projectName`、`apiArchitecture`、`endpointCount`、`scenarioCount`、`containerRequirements`、`requiredSkills`、`analysisFilePath`、`projectContext`。

收到 Analyzer 摘要後，使用 Glob 確認 `analysisFilePath` 指向的檔案確實存在。若不存在，更新 run-state 並依 bounded re-dispatch 規則處理。

#### 階段間主動釋放（Analyzer → Writer）

Analyzer phase 全部 assignment 都已完成、analysis artifact 都已確認存在，且準備 dispatch Writer phase 前，Orchestrator 必須主動關閉所有已完成 Analyzer agents，釋放 Codex runtime agent thread slots。若 runtime 不支援主動關閉已完成 agent，Orchestrator 必須停手並回報「runtime 不支援主動關閉已完成 agent」，不得改用限制 Writer 並行數或 serialize Writer 作為替代方案。

### 階段 2：啟動撰寫（Integration Writer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-integration-writer.toml" payload={...}` 將分析結果交給 Writer 撰寫整合測試。

#### 端點範圍硬邊界（P3）

Writer 以以下優先序決定端點範圍：

1. prompt 明確端點 / Controller slice
2. Analyzer artifact 的 `endpointsToTest`
3. 整個 Controller

若上層範圍存在，Writer 不得擴大到 sibling endpoints。Reviewer 也嚴禁把指定範圍以外的 sibling endpoint 列為覆蓋缺口。

#### 分階段啟動判斷（integration 專屬）

| 測試案例數量 | 策略 | 說明 |
| --- | --- | --- |
| `scenarioCount <= 15` | 單次啟動 | Writer 產出所有基礎設施 + 全部測試案例 |
| `scenarioCount > 15` | 分兩次啟動 | 第一次只產基礎設施（GlobalUsings、WebApiFactory、TestBase、csproj）；第二次產測試案例 + 風格統一指令 |

此策略照 integration Claude 版保留，不套用 TUnit method-based greedy split。

Writer prompt 模板：

```text
請根據 Analyzer 交接檔案撰寫整合測試。
analysisFilePath: {analysisFilePath}
被測試 API 專案路徑: {apiProjectPath}
測試檔案的預期輸出路徑: {outputPath}
writerControls: {writerControls}
```

等候 Writer 回傳精簡摘要：`testFilePaths`、`testCount`、`testCaseCount`、`skillsLoaded`、`writerResultFilePath`。

#### Writer Artifact 完整性 Gate（必要）

Writer 回傳後，Orchestrator 不得只採信回覆摘要。必須使用 canonical `writerResultFilePath` 讀取實體 writer-result JSON，並檢查下列欄位全部存在且可用：

- `writerResultFilePath`
- `testFilePaths` 非空
- `testCount` / `testCaseCount` 為數字
- `testClasses`
- `testClasses[].className`
- `testClasses[].filePath`
- `testClasses[].methodsCovered` 或 `testClasses[].endpointsCovered`
- `skillsLoaded`

端點範圍檢查：

- `methodsCovered` / `endpointsCovered` 必須是明確端點或案例清單，不得使用 `All`、`FullController`、空陣列或敘述文字替代。
- 若本次是 endpoint-scope 或 split assignment，覆蓋清單必須是指定端點清單的子集合或完全相同，不得包含 sibling endpoints。
- `skillsLoaded` 不得包含 unit 的 20 個 technique skills，也不得包含 TUnit skills。

若 writer-result 缺欄位、不可讀、或端點範圍不一致：

1. 不得 dispatch Executor。
2. 更新 run-state writer phase：`artifactReadyAt: null`、`artifact: null`、`failure` 填入缺失欄位或 scope mismatch。
3. 若符合 bounded re-dispatch 條件，最多 re-dispatch Writer 2 次，要求只修復 missing artifact / scope mismatch，不得重啟整個 workflow。
4. 若 bounded re-dispatch 後仍不完整，將 workflow 判定為 blocker。

#### P4 版本政策

既有 `.csproj` 套件版本一律保留（不升不降）；僅對**缺少**的必要套件使用 SKILL 記載的最低版本；**不執行** `dotnet list package --outdated`；fix 回合 add-only、不 bump。

#### 階段間主動釋放（Writer → Executor）

Writer phase 全部 assignment 收斂且 writer-result artifact gate 通過後，dispatch Executor 前，主動關閉已完成 Writer agents 釋放 Codex runtime agent thread slots。

### 階段 3：啟動執行（Integration Executor）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-integration-executor.toml" payload={...}` 將 Writer 產出的測試程式碼交給 Executor 建置與執行。

Executor payload 必須包含：

- `testProjectPath`
- `testFilePaths`
- `analysisFilePath`
- `writerResultFilePath`

Executor 執行模型硬規則：

- `containerRequirements` 為空（純 InMemory）時可跳過 Docker Step 0；否則建置前先跑 `docker info`。
- 建置：`dotnet build <solution-path> -p:WarningLevel=0 /clp:ErrorsOnly --verbosity minimal`。
- 測試：`dotnet test <solution-path> --no-build --verbosity minimal`，可選 `--filter "FullyQualifiedName~XxxControllerTests"`。
- **絕不用 `dotnet run`**。
- xUnit 結果的通過/失敗/略過數字與測試名稱必須來自實際 `dotnet test` 輸出，禁止編造。
- 測試 `.csproj` 必須有 `Microsoft.NET.Test.Sdk` + `xunit` / `xunit.runner.visualstudio`，不得有 `<OutputType>Exe</OutputType>`。
- 修正迴圈最多 3 次；容器不需手動清理（Testcontainers + `IAsyncLifetime.DisposeAsync`）；超時保護建議至少 5 分鐘。
- Executor 必須寫 `{testProjectDir}/.orchestrator/executor-result/{ControllerName}.executor-result.json`，含 `dockerStatus`、`buildResult`、`testResult`、`totalTests`、`passedTests`、`failedTests`、`skippedTests`、`fixRounds`、`productionBugFixes`。

#### Integration Executor 驗收 Gate（必要）

Executor 回傳後，Orchestrator 必須讀取 `executorResultFilePath`，確認：

- `executionMethod` 必須是 `"dotnet test"`。
- `dockerStatus` 存在；若 `containerRequirements` 為空，可記錄 `skipped: true` 與原因。
- `buildResult` 與 `testResult` 存在。
- 通過/失敗/略過數量必須來自 xUnit `dotnet test` 輸出。
- `fixRounds` / `executorFixRounds` 必須落入 run-state，不得只寫在對話摘要。

若 executor-result 顯示使用 `dotnet run`，該 phase 判定為 blocker，不得進入成功報告。

#### 階段間主動釋放（Executor → Reviewer）

Executor phase 完成且 executor-result artifact gate 通過後，dispatch Reviewer 前，主動關閉已完成 Executor agent 釋放 Codex runtime agent thread slots。

### 階段 4：啟動審查（Integration Reviewer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-integration-reviewer.toml" payload={...}` 將測試程式碼交給 Reviewer 審查。Reviewer 一律執行；不得因 Executor 全綠而跳過。

Reviewer payload 必須包含：

- `testFilePaths`
- `apiProjectPath`
- `analysisFilePath`
- `writerResultFilePath`
- `executorResultFilePath`
- `reviewResultFilePath`

`reviewResultFilePath` 由 Orchestrator 預先計算，格式為 `{testProjectDir}/.orchestrator/reviewer-result/{ControllerName}.reviewer-result.json`。

Reviewer 回傳後，Orchestrator 必須使用 Glob 確認 `reviewResultFilePath` 指向的檔案確實存在且可讀取。若檔案未落地，不得只採信 Reviewer 回傳訊息；必須將該 phase 判定為 blocker，分類為 `artifact 一直沒出現`，並更新 `run-state.json` 中 reviewer phase：`artifactReadyAt: null`、`artifact: null`、`failure` 填入原始症狀。

### Phase 5：保留 artifacts

四階段流程全部完成、結果呈現給使用者之後（包含修改流程完成後），不得自動清理本次 `.orchestrator/` artifacts。`.orchestrator/analysis/`、`.orchestrator/writer-result/`、`.orchestrator/executor-result/`、`.orchestrator/reviewer-result/` 與 `.orchestrator/run-state.json` 都必須保留，供驗收與 benchmark 讀取。下一次執行時，Phase 0 前置清理才處理殘留。

---

## run-state 持久化與 timing truth（P1）

時間追蹤以磁碟上的 run-state wall-clock timestamps 為準。主協調者必須在 `{testProjectDir}/.orchestrator/run-state.json` 維護一份 run-state 檔，並在每次 SpawnAgent dispatch 前後與 artifact ready 邊界使用 Write 更新：

- `dispatchIssuedAt`：發出 SpawnAgent dispatch 的時間
- `dispatchAcceptedAt`：SpawnAgent 回傳 `agentId` 後，Orchestrator 立即用 `date -u` 取得的時間。此欄只代表派發被 runtime 接受，**不代表 agent 真正開始工作**。
- `artifactReadyAt`：Orchestrator 在磁碟上確認 canonical artifact 已存在且可讀的時間。
- `completedAt`：該 phase artifact gate 通過或 blocker 判定完成的時間。
- `produceSpanMs`：`artifactReadyAt - dispatchAcceptedAt`，只代表 Orchestrator 可觀察的 artifact produce span。
- `redispatchEvents[]`、`boundedRedispatchCount`、`restartCount`、`executorFixRounds`：每次 bounded re-dispatch、restart、Executor fix round 都必須落入 run-state。

主協調者必須以 `run-state.json` 中的 `dispatchIssuedAt → artifactReadyAt → completedAt` 作為正式 phase timing proof，並讀取該實體檔計算各 phase 耗時；不得從對話敘述、subagent 回傳文字、hook additionalContext、人工推估值或 token report 計算耗時。

run-state 寫入規則：

1. Phase 0 清理完成且啟動 Analyzer 前，建立 `{testProjectDir}/.orchestrator/run-state.json`，至少包含 `workflow: "integration"`、`target`、`overallWallClock` 起點、空的 `phases`、`redispatchEvents: []`、`boundedRedispatchCount: 0`、`restartCount: 0`、`executorFixRounds: 0`。
2. 每個 phase 發出 SpawnAgent 之前，先以 `date -u` 取得實際 UTC 時間，使用 Write 更新該 phase assignment 的 `dispatchIssuedAt`；SpawnAgent 回傳 `agentId` 後，立即再次以 `date -u` 取得 UTC 時間，使用 Write 補上該 assignment 的 `agentId`、`dispatchAcceptedAt` 與 `dispatchAcceptLatencyMs`。
3. 平行 assignment 的 `dispatchAcceptedAt` 必須在該筆 SpawnAgent 回傳 `agentId` 的同一個操作邊界立即寫入。不得等整個 phase dispatch 完成後，用同一個時間補進所有 assignment。
   - **Estimated Token Usage metadata**：同一筆 assignment 應保留 `assignmentId`、`phase`、`target`、`agentDefinitionPath`、`spawnPayloadShape`、`expectedArtifactPath`；這些欄位只供 `.codex/scripts/estimate-token-usage.mjs` 做 visible-context 估算，不得作為 correctness gate。
4. 每個 canonical artifact 通過 Glob/Read 驗證後，立即用 `date -u` 寫入 `artifactReadyAt`、`artifact`、`produceSpanMs`。
5. phase artifact gate 全部通過或 blocker 判定完成後，寫入 `completedAt` 與 phase status。
6. 整體流程完成或中止時，使用 Write 補上 `phaseDurations`，每個 phase 至少包含 `durationMs` 與 `source: "run-state"`。

若某 phase 內有多個平行 assignment（例如多 Controller Analyzer、分兩次 Writer、多 Reviewer），run-state 必須保留每個 assignment 的 timing evidence，不得只記一個彙總時間。

---

## 執行進度顯示規範

| 動作時機 | 必輸出文字 |
| --- | --- |
| 啟動 Analyzer 前 | `## 階段 1：啟動分析（Analyzer）` |
| Analyzer 回傳後 | `✅ 階段 1 完成（{run-state 耗時}）— 識別出 N 個端點、Y 個測試情境，需要 [技術清單]` |
| 啟動 Writer 前 | `## 階段 2：啟動撰寫（Integration Writer）` |
| Writer 回傳後 | `✅ 階段 2 完成（{run-state 耗時}）— 已建立測試檔案，共 N 個測試案例` |
| 啟動 Executor 前 | `## 階段 3：啟動執行（Integration Executor）` |
| Executor 回傳後 | `✅ 階段 3 完成（{run-state 耗時}）— dotnet test：N passed / F failed / S skipped，修正 Y 次` |
| 啟動 Reviewer 前 | `## 階段 4：啟動審查（Integration Reviewer）` |
| Reviewer 回傳後 | `✅ 階段 4 完成（{run-state 耗時}）` |
| 結果呈現後 | 輸出 `### ⏱ 各階段耗時`、`### Timing Evidence` 與 `### Estimated Token Usage` |

耗時摘要必須讀取 `{testProjectDir}/.orchestrator/run-state.json`，再從該檔的 `dispatchIssuedAt`、`artifactReadyAt`、`completedAt` 計算。若多個 Writer 並行或分兩次啟動，階段 2 耗時取整個 Writer phase 的最長可觀察跨度。總計為四個階段之和。

```markdown
### ⏱ 各階段耗時

| 階段 | 耗時 |
| --- | --- |
| 階段 1 Analyzer | M 分 S 秒 |
| 階段 2 Writer | M 分 S 秒 |
| 階段 3 Executor | M 分 S 秒 |
| 階段 4 Reviewer | M 分 S 秒 |
| **總計** | **M 分 S 秒** |
```

```markdown
### Timing Evidence

| Phase | Source | dispatchIssuedAt | artifactReadyAt | completedAt | Notes |
| --- | --- | --- | --- | --- | --- |
| Analyzer | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | endpoint analysis |
| Writer | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | single/two-step |
| Executor | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | dotnet test |
| Reviewer | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | reviewer-result verified |
```

### Estimated Token Usage

Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source。本 workflow 不回報正式 token usage，也不得把估算值包裝為 billing 或 runtime truth。

四階段全部完成且 timing evidence 輸出後，執行：

```bash
node .codex/scripts/estimate-token-usage.mjs --test-project {testProjectDir}
```

不得傳入 `--workflow integration`；`workflow` 只由 `run-state.json` 作為輸出標籤提供。

估算器成功產生 `{testProjectDir}/.orchestrator/token-usage-estimate.json` 時，輸出 `### Estimated Token Usage` 表格；若 estimator 失敗、`run-state.json` 缺失、artifact 不足或 summary 為 `unavailable`，仍不得讓 workflow 失敗，改輸出 unavailable 表格。

```markdown
### Estimated Token Usage

| Phase | Assignments | Input estimate | Output estimate | Total estimate | Confidence |
|---|---:|---:|---:|---:|---|
| Analyzer | N | 0K | 0K | 0K | medium |
| Writer | N | 0K | 0K | 0K | medium |
| Executor | N | 0K | 0K | 0K | low |
| Reviewer | N | 0K | 0K | 0K | medium |
| **Total** | N | **0K** | **0K** | **0K** | approximate |
```

固定說明：

```text
以上為 visible-context/tokenizer-based estimate，不含 Codex runtime 未暴露的 hidden framing、internal reasoning tokens、cached input token accounting 與 provider billing usage；不可用於 billing，只適合比較不同 workflow run 的相對成本。
```

禁止把 estimated token usage 放入 Executor 成敗、Reviewer 評分、coverage 判斷、`gateDecision` 或任何 correctness summary。此區塊不得命名為 `Token Usage`。

---

## 結果整合與呈現

收到四個 subagent 的回傳結果後，你必須整合呈現給使用者：

1. 測試檔案連結：列出 Writer 產出的所有測試檔案路徑。**不需在 chat 中嵌入完整測試程式碼**
2. 執行結果摘要：Executor 的 `dotnet test` 結果（通過/失敗/略過數、Docker 狀態、容器需求）
3. 品質審查摘要：Reviewer 的整體評級和關鍵發現
4. 改善建議：Reviewer 的遺漏測試案例和嚴重問題
5. 使用的 Skills 組合：列出 Writer 載入了哪些 integration skills
6. Executor 修正紀錄：含 DB Provider 衝突的 Program.cs 窄例外（如有）
7. 各階段耗時摘要與 Timing Evidence：從 run-state 讀取
8. Estimated Token Usage：optional telemetry；不得作為 correctness gate

必須區分「環境問題（Docker/容器/網路）」與「測試品質問題」。Docker daemon 未啟動、port/health check/網路問題不得包裝成 Writer 品質缺陷。

---

## 修改流程（Modification Workflow）

當使用者要求套用 Reviewer 建議、修改既有整合測試、或增加測試案例時，使用此流程（而非重新執行完整四階段）。

**禁止自動觸發修改流程。** 無論評分高低、是否有 error 級 issue，修改流程的啟動權完全屬於使用者。

**禁止預先授權未來 Reviewer 建議。** 若使用者在初始請求中同時要求「先跑四階段，再套用 Reviewer 全部建議」或類似語句，Orchestrator 只能把後半段視為意圖說明，不可在同一回合自動進入修改流程。Reviewer 的實際 `issues` 與 `missingTestCases` 必須先呈現給使用者確認；使用者確認前，Writer(modification) 不得 dispatch。

修改流程三階段：

1. Integration Writer（修改模式）— 傳遞 Reviewer 建議內容，讓 Writer 修改既有測試程式碼
2. Integration Executor — 建置並執行修改後的測試，確認結果
3. Integration Reviewer（re-review 模式）— 以 `mode: "re-review"` 聚焦驗證前次建議是否正確套用

修改流程結果呈現後，同樣只回報 artifact-backed 結果與 run-state timing；token 相關資訊只允許以 `Estimated Token Usage` optional telemetry 呈現，且不得作為 correctness gate。

---

## 錯誤處理

| 錯誤情境 | 處理方式 |
| --- | --- |
| Analyzer 找不到專案 | 向使用者確認路徑，用 Read/Grep 找到目標，重新啟動 Analyzer |
| Docker 未啟動 | 在結果中告知需啟動 Docker Desktop；若測試不涉及容器則繼續 |
| Writer 回應超出長度限制 | 強制改用分兩次啟動策略（第一次基礎設施，第二次測試案例） |
| Executor 3 輪修正後仍失敗 | 將失敗訊息傳給 Reviewer，在結果中標示失敗，區分環境問題與邏輯問題 |
| reviewer-result 未落地 | 判定 Reviewer phase blocker，不採信回傳文字 |

---

## 多目標支援

當使用者一次指定多個 Controller 時，對每個目標分別執行完整四階段流程：

| 階段 | 執行方式 | 說明 |
| --- | --- | --- |
| Phase 1 Analyzer | 平行 | 每個 Controller / endpoint slice 獨立分析 |
| Phase 2 Writer | 平行 | 每個 Controller / endpoint slice 獨立撰寫；單一 Controller 內 `scenarioCount > 15` 才分兩次 |
| Phase 3 Executor | 循序 | `dotnet build` 不可並行，容器避免 port 衝突 |
| Phase 4 Reviewer | 平行 | 每份測試獨立審查 |

多目標完成後彙整：概覽表格 + 各目標詳細結果 + 共用改善建議。

---

## 重要原則

1. **交接檔案路徑優先** — 傳 `analysisFilePath`、`writerResultFilePath`、`executorResultFilePath`、`reviewResultFilePath`，而非嵌入 JSON。Subagent 會在 Step 0 自行讀取交接檔案
2. **保持主 context 精簡** — 只保留 subagent 回傳的摘要，不展開中間過程
3. **端點粒度** — 整合測試以 HTTP endpoint 為粒度，`suggestedTestScenarios` 使用中文三段式（`端點_情境_預期`）
4. **執行模型固定** — `dotnet test` + xUnit + Docker/Testcontainers；不得改成 TUnit `dotnet run`
5. **技術技能固定** — 只載入 `.codex/skills/dotnet-testing-advanced-webapi-integration-testing/`、`.codex/skills/dotnet-testing-advanced-aspnet-integration-testing/`、`.codex/skills/dotnet-testing-advanced-testcontainers-database/`、`.codex/skills/dotnet-testing-advanced-testcontainers-nosql/`
6. **版本相依性** — 既有版本不升不降；缺少套件才依 integration skill 最低版本 add-only
7. **保留 artifacts** — `.orchestrator/` 是驗收與 benchmark evidence，不在 Phase 5 自動清理
