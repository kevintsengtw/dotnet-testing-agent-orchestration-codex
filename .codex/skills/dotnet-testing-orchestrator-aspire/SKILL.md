---
name: "dotnet-testing-orchestrator-aspire"
description: ".NET Aspire 整合測試指揮中心 — 分析 AppHost Resource 結構、dispatch 四個 advanced-aspire 角色 subagent 撰寫/執行/審查 Aspire 整合測試。"
---

# .NET Aspire 整合測試 Orchestrator

你是 .NET Aspire 整合測試的指揮中心。你的工作是**分析 AppHost Resource 結構、調度、整合**，不是自己直接撰寫測試程式碼。

Aspire workflow 的核心語意：

- 使用 `DistributedApplicationTestingBuilder`，絕不使用 `WebApplicationFactory`。
- 使用 `app.CreateHttpClient("servicename")`，服務名稱必須對齊 AppHost `AddProject("name")`。
- 容器由 Aspire AppHost 宣告式管理，絕不使用程式化 Testcontainers。
- 執行模型是 xUnit `dotnet test` + Docker + `--blame-hang-timeout`，絕不使用 `dotnet run`。
- Writer / Reviewer 只載入 Aspire 技術技能 `.agents/skills/dotnet-testing-advanced-aspire-testing/`；Analyzer `requiredSkills` 固定 `["aspire-testing"]`。
- 粒度是 HTTP endpoint，不是 unit method、TUnit method 或 integration container descriptor。

> **架構說明**：此文件是 **Skill**，透過 `/dotnet-testing-orchestrator-aspire` 載入 main thread context。
> Main thread 載入此 Skill 後，直接以 Codex 原生 SpawnAgent 調度四個 subagent：
> `dotnet-testing-advanced-aspire-analyzer`、`dotnet-testing-advanced-aspire-writer`、`dotnet-testing-advanced-aspire-executor`、`dotnet-testing-advanced-aspire-reviewer`。

> **語言規定**：所有輸出訊息、狀態更新、錯誤說明、摘要報告，一律使用**繁體中文**。禁止以英文輸出任何面向使用者的文字。

---

## 第一步行動

**不要讀原始碼。不要分析專案。不要寫任何程式碼。**

你收到任務後必須依序執行：

1. `Glob({testProjectDir}/.orchestrator/**)` 檢查殘留。
2. 僅在有殘留時，委託 Executor cleanup。
3. 建立 `{testProjectDir}/.orchestrator/run-state.json`，作為 phase timing truth。
4. 計算 `analysisOutputPath` 與 `{assignmentId}`，透過 `shell_command` 寫入 Analyzer assignment 的 `dispatchIssuedAt`、`target`、`agentDefinitionPath`、`expectedArtifactPath`。
5. `SpawnAgent target=".codex/agents/dotnet-testing-advanced-aspire-analyzer.toml" payload={...}` 立即啟動 Analyzer。
6. SpawnAgent 回傳 `agentId` 後，下一個工具呼叫必須透過 `run-state.mjs set` 寫入 `agentId`、`dispatchAcceptedAt` 並推導 `dispatchAcceptLatencyMs`。

步驟 4～6 合稱 **Analyzer dispatch transaction**，不可拆開、跳過或延後補寫。`dispatchIssuedAt` 寫入失敗時不得啟動 Analyzer；`dispatchAcceptedAt` 寫入失敗時不得繼續 Analyzer artifact 等候或進入 Writer。除上述步驟外，在啟動 Analyzer 之前不得讀 Controller、AppHost、Program.cs、DTO、DbContext、Validator，不得 Grep 探索 Resource 或 endpoint。

Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source。本 workflow 不回報正式 token usage（billing / runtime truth），也不得把估算值包裝為正式用量；只允許在四階段完成後以 `Estimated Token Usage` optional telemetry 呈現 visible-context estimate，且不得作為 correctness gate。

---

## 硬性禁止條款

1. 禁止載入或直接讀取任何共用技術 Skill，且不得讀取 `.agents/skills/**`。除本 workflow 的 Orchestrator Skill 與明確允許的 Codex-specific Skill 外，不得讀取 `.codex/skills/**`；尤其不得讀取其他 `dotnet-testing-orchestrator-*` Skill。Skills 載入是 Writer / Reviewer subagent 的職責。
2. 禁止直接撰寫任何測試程式碼。
3. 禁止直接修改任何 `.csproj`。
4. 禁止直接建立或修改任何 `.cs` 檔案；Reviewer 建議也必須交給 Writer / Executor。
5. 禁止跳過任何階段：Analyzer -> Writer -> Executor -> Reviewer。Reviewer 無論 Executor 是否全過、是否 0 修正輪次，一律執行。
6. 禁止使用 Bash 呼叫 `claude` 命令；所有 subagent 呼叫必須透過 Codex 原生 SpawnAgent。
7. 禁止回報正式 token usage（billing / runtime truth）；只允許四階段完成後以 `Estimated Token Usage` optional telemetry 呈現 visible-context 估算，且不得作為 correctness gate。

你可以做的事：

- 整合四個 subagent 的 artifact 與回傳結果。
- 維護 `.orchestrator/run-state.json` 與 artifact gate。
- 呈現 Reviewer 結果後，等待使用者決定是否啟動修改流程。

### Production Code 修改邊界

一般四階段流程與修改流程都不得主動修改 production code。若需修改 `src/**`、AppHost `Program.cs`、production `.csproj`、constructor、public API、加入 seam，Orchestrator 必須標記 `requiresUserApproval`，未取得明確同意前不得 dispatch。

Aspire 測試韌性一律由測試框架端處理。Writer / Executor 不得修改 production 或 AppHost 碼，包含但不限於 `AddHealthChecks()`、`MapHealthChecks("/health")`、`.WithoutHttpsCertificate()`、`WithDataVolume`、`ContainerLifetime`。Redis TLS 等「已知 Aspire 框架預設測試不友善行為」由測試 fixture 端中和（例如 test 端 `WithoutHttpsCertificate()`），不視為 production 改動；production / AppHost 內出現這些呼叫才算違規。AppHost 若因 production 設定無法在測試環境健康起來，屬於「AppHost 非測試就緒」，必須據實回報，不代改使用者的 production / AppHost 設定。

Aspire sample AppHost 目前採**拋棄式容器**：SQL Server / Redis **不使用持久資料卷（WithDataVolume）、不使用 `ContainerLifetime.Session`**。這是 sample 現況；真實專案的持久卷與生命週期差異由測試框架端 sanitizer 通用消化，不逐服務改 AppHost。Reviewer 不得將「未設 ContainerLifetime.Session」或「未用 data volume」列為 WARNING / fixture drift；Executor 不得為 ContainerLifetime.Session 或 data volume 修改 production code。

任何 production / AppHost 改動一律走批准閘門；未取得使用者明確同意前不得 dispatch 會修改 production / AppHost 的工作。

---

## SpawnAgent 正確呼叫方式

`target` 必須指向 `.codex/agents/<name>.toml`。payload 只傳 canonical paths 與必要控制欄位，不傳完整 JSON、長篇敘事或 sourceCodeContext。

```text
SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-advanced-aspire-analyzer.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "workspaceRoot": "<本次 assignment workspace absolute path>",
  "apiProjectPath": "<被測 WebAPI 專案路徑>",
  "appHostPath": "<AppHost 專案路徑>",
  "targetServiceName": "<AppHost AddProject(\"name\") 服務名>",
  "targetController": "<Controller 名稱或 endpoint slice>",
  "testProjectPath": "<測試專案路徑>",
  "analysisOutputPath": "<canonical analysis path>",
  "userRequest": "<使用者特殊需求，如有>"
}

SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-advanced-aspire-writer.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "workspaceRoot": "<本次 assignment workspace absolute path>",
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "apiProjectPath": "<被測 WebAPI 專案路徑>",
  "appHostPath": "<AppHost 專案路徑>",
  "outputPath": "<測試檔案預期輸出路徑>",
  "writerResultFilePath": "<本 assignment 唯一 canonical writer result path>",
  "writerControls": {
    "writerTopology": "single",
    "assignmentRole": "full",
    "endpointScope": "<端點範圍>"
  }
}

SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-advanced-aspire-executor.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "workspaceRoot": "<本次 assignment workspace absolute path>",
  "testProjectPath": "<測試專案路徑>",
  "testFilePaths": ["<Writer 產出的測試檔案路徑>"],
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "writerResultFilePaths": ["<本 target 全部 Writer 交接檔案路徑>"],
  "executorResultFilePath": "<canonical executor result path>"
}

SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-advanced-aspire-reviewer.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "workspaceRoot": "<本次 assignment workspace absolute path>",
  "testFilePaths": ["<測試檔案路徑>"],
  "apiProjectPath": "<被測 WebAPI 專案路徑>",
  "appHostPath": "<AppHost 專案路徑>",
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "writerResultFilePaths": ["<本 target 全部 Writer 交接檔案路徑>"],
  "executorResultFilePath": "<Executor 交接檔案路徑>",
  "reviewResultFilePath": "<canonical reviewer result path>"
}
```

正式 dispatch 必須維持 Analyzer -> Writer -> Executor -> Reviewer。若遇 capacity、thread-limit、stream retry、nested spawn fail、phase timeout、artifact missing after phase start，可做 bounded re-dispatch；每個 phase 最多 2 次，且 re-dispatch 前必須確認前一次同角色沒有留下可用 canonical artifact，避免雙重 truth。

### Formal context isolation（必要）

- 四個正式 role dispatch 都必須明確使用 `fork_turns: "none"`；不得依賴 runtime default。
- payload 必須包含 `executionContext: "self-contained"`、`externalMemoryPolicy: "forbid"` 與 absolute `workspaceRoot`。prompt 第一段固定說明本任務已由 canonical paths 與本次 handoff 完整定義，跳過 workspace memory quick pass。
- roles 禁止讀取 `$CODEX_HOME/memories/**`、`MEMORY.md`、rollout summaries、prior transcript、其他 worktree 或非本次 attempt 的 `.orchestrator` artifacts。
- run-state 每筆 assignment 必須記錄 `contextForkPolicy=none` 與 `externalMemoryPolicy=forbid`；若 runtime 不支援或 telemetry 顯示越界，判定 `attempt-isolation-violation`，不得納入 token comparator。
- 每個 canonical artifact ready 後、下一 phase dispatch 前執行 attempt isolation；`--allow-read` 只列本次 run 的 canonical upstream artifacts：

```bash
node .codex/scripts/validators/validate-unit-attempt-isolation.mjs --workflow aspire --workspace-root {workspaceRoot} --test-project {testProjectPath} --artifact {analysisFilePath}
node .codex/scripts/validators/validate-unit-attempt-isolation.mjs --workflow aspire --workspace-root {workspaceRoot} --test-project {testProjectPath} --artifact {writerResultFilePath} --allow-read {analysisFilePath}
node .codex/scripts/validators/validate-unit-attempt-isolation.mjs --workflow aspire --workspace-root {workspaceRoot} --test-project {testProjectPath} --artifact {executorResultFilePath} --allow-read {analysisFilePath} --allow-read {writerResultFilePath} [...]
node .codex/scripts/validators/validate-unit-attempt-isolation.mjs --workflow aspire --workspace-root {workspaceRoot} --test-project {testProjectPath} --artifact {reviewResultFilePath} --allow-read {analysisFilePath} --allow-read {writerResultFilePath} [...] --allow-read {executorResultFilePath}
```

Analyzer ready 後另執行 minimal read-scope gate；Reviewer ready 後執行 no-self-read gate：

```bash
node .codex/scripts/validators/validate-aspire-role-read-scope.mjs --role analyzer --workspace-root {workspaceRoot} --agent-definition .codex/agents/dotnet-testing-advanced-aspire-analyzer.toml --artifact {analysisFilePath}
node .codex/scripts/validators/validate-aspire-role-read-scope.mjs --role reviewer --workspace-root {workspaceRoot} --artifact {reviewResultFilePath}
```

### 多目標並行度

- Phase 1 Analyzer 可平行。
- Phase 2 Writer 可平行。
- Phase 3 Executor 必須循序，因 AppHost 啟動與 Docker 容器不可並行互搶。
- Phase 4 Reviewer 可平行。

---

## 核心工作流程

Writer 與 Reviewer artifact ready 後，Orchestrator 必須執行
`node .codex/scripts/validators/validate-skill-read-scope.mjs --artifact <result.json> --analysis <analysis.json> --workflow aspire --role <writer|reviewer>`。
此 gate 依 Skill ID 精確驗證 `.agents/skills` readFiles、拒絕 Unit／TUnit／Integration Skills 與其他 orchestrator Skills，並將 legacy `.codex/skills/<shared-skill>` 回報為 `LEGACY_SHARED_SKILL_PATH`；不得以整個目錄 allowlist 取代。

### Phase 0：前置清理

檢查 `{testProjectDir}/.orchestrator/**/*` 是否有殘留。有殘留時委託 Executor cleanup；無殘留時直接進入 Phase 0.5。

### Phase 0.5：初始化 run-state

以 `node .codex/scripts/run-state.mjs init --path {testProjectDir}/.orchestrator/run-state.json --workflow aspire --target {target}` 建立 `{testProjectDir}/.orchestrator/run-state.json`（詳見下方「run-state.json 寫入機制」）。此檔是本 workflow 的唯一 timing truth source；正式 token usage / hooks 計量不屬於本 Codex 版 truth 契約，缺席時不得阻塞流程。token 相關資訊只能在流程完成後以 `Estimated Token Usage` optional telemetry 呈現。

run-state 初始化必須包含 `workflow: "aspire"`、`target`、`overallWallClock` 起點、空的 `phases`、`redispatchEvents: []`、`boundedRedispatchCount: 0`、`restartCount: 0`、`executorFixRounds: 0`。

> **run-state.json 寫入機制（必用，跨平台）**：run-state.json 一律透過 `shell_command` 呼叫 `node .codex/scripts/run-state.mjs` 建立與更新。**不得**假設有「Write 工具」、**不得**用 `date -u`、**不得**手寫 shell read-modify-write。理由：Codex 沒有「Write」工具，且不同 runtime（Codex CLI vs VS Code Codex Extension）shell 不同；改善前 Extension 環境會整段略過 run-state 維護，導致 run-state.json 從不產生、各階段耗時與 Estimated Token Usage 全空。此腳本為純量參數 API（不傳 JSON blob，避免 PowerShell 引號問題），時間戳由腳本內部以系統時鐘產生（值寫 `@now` 即取 ISO 8601 UTC），毫秒差由 `--derive 欄位=END-START` 推導。以下 `{p}` 代表 `{testProjectDir}/.orchestrator/run-state.json`。常用呼叫：
>
> ```bash
> # 初始化（Phase 0 清理後、啟動 Analyzer 前）
> node .codex/scripts/run-state.mjs init --path {p} --workflow aspire --target {target}
> # dispatch 前：記 dispatchIssuedAt（並一併登記 Estimated Token Usage metadata）
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set dispatchIssuedAt=@now --set target={target} --set agentDefinitionPath={tomlPath} --set expectedArtifactPath={artifactPath} --set contextForkPolicy=none --set externalMemoryPolicy=forbid
> # 收到 agentId：記 agentId/dispatchAcceptedAt，推導 latency
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt
> # artifact 落地：記 artifactReadyAt/artifact，推導 produceSpan
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set artifactReadyAt=@now --set artifact={artifactPath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt
> # assignment gate 收斂：逐 assignment 記 completedAt
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set completedAt=@now
> # phase 收斂：記 completedAt
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --set completedAt=@now
> # 計數 / 整體：counters 與 overallWallClock.end
> node .codex/scripts/run-state.mjs set --path {p} --set executorFixRounds={n} --set overallWallClock.end=@now --derive overallWallClock.durationMs=overallWallClock.end-overallWallClock.start
> # bounded re-dispatch 事件：append 一筆
> node .codex/scripts/run-state.mjs append --path {p} --array redispatchEvents --set phase=writer --set cause=agent-thread-limit --set occurredAt=@now --set waitMs={ms}
> ```
> 後文「以 run-state 寫入機制更新／補上」即指上述 `run-state.mjs` 呼叫。artifactReadyAt 不可獨立觀察時，省略 `--set artifactReadyAt=@now` 與對應 `--derive`（`produceSpanMs` 會因缺端點自動填 `null`），或明確 `--set artifactReadyAt=null`。不得以對話敘述或人工推估值代替腳本寫入。

run-state 必須記錄：

- `dispatchIssuedAt`
- `dispatchAcceptedAt`
- `artifactReadyAt`
- `completedAt`
- `produceSpanMs`
- `redispatchEvents[]`
- `boundedRedispatchCount`
- `restartCount`
- `executorFixRounds`
- 每筆 assignment 的 `contextForkPolicy=none`、`externalMemoryPolicy=forbid`

**Estimated Token Usage metadata**：`phases` 以 `analyzer` / `writer` / `executor` / `reviewer` 為 key，各含 `assignments[]`。每筆 assignment 除 timing 外，應保留 `assignmentId`、`phase`、`target`、`agentDefinitionPath`（指向該 phase 的 `.codex/agents/dotnet-testing-advanced-aspire-*.toml`）、`spawnPayloadShape`、`expectedArtifactPath`（該 phase canonical 交接檔路徑）、`contextForkPolicy`、`externalMemoryPolicy`。後兩者是 formal isolation gates，其餘欄位只供 `.codex/scripts/estimate-token-usage.mjs` 做 visible-context 估算，不得作為 correctness gate。

每個 assignment 的 canonical artifact 與 formal gates 收斂後，先寫 assignment `completedAt`；全部 assignments 收斂後才寫 phase `completedAt`。closeout 必須補上 `phaseDurations.{phase}.durationMs/source=run-state`、`profilingSummary.timingSource=run-state`、concrete bottleneck/root cause、`overallWallClock.end` 與巢狀 duration；不得建立字面 dotted top-level key。

時間一律取自磁碟 run-state，禁止從對話敘述、subagent 回傳文字、hook additionalContext 或人工推估計算耗時。結果呈現時輸出「### 各階段耗時」與「### Timing Evidence」兩張表。

### Phase 1：Analyzer

Analyzer payload 必須包含 `workspaceRoot`、`executionContext`、`externalMemoryPolicy`、`apiProjectPath`、`appHostPath`、`targetServiceName`、`targetController`、`testProjectPath`、`analysisOutputPath`、`userRequest` 與未改寫的 `userProvidedScenarios`。

#### Analyzer dispatch transaction（硬閘門）

每個 Analyzer assignment 必須依序完成以下操作；多 target 時每筆 assignment 各自執行，不得只記 phase 彙總時間：

1. SpawnAgent **之前**先執行：

   ```bash
   node .codex/scripts/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set dispatchIssuedAt=@now --set target={target} --set agentDefinitionPath=.codex/agents/dotnet-testing-advanced-aspire-analyzer.toml --set expectedArtifactPath={analysisOutputPath}
   ```

2. 上述命令成功後才可 SpawnAgent；若失敗，不得啟動 Analyzer。
3. SpawnAgent 回傳 `agentId` 後，下一個工具呼叫必須是：

   ```bash
   node .codex/scripts/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt
   ```

4. `dispatchAcceptedAt` 寫入失敗時，該 phase 判定為 telemetry contract blocker，不得繼續 artifact 等候或進入 Writer；不得在流程結尾倒推或補造時間。

Analyzer 必須從 AppHost `Program.cs` 與 `.csproj` 分析 Resource graph，輸出頂層欄位：

- `appHostInfo`（含 `aspireVersion`）
- `resourceCatalog[]`（穩定 `RES-*` ID、服務關聯與 evidence）
- `projectReferences[]`
- `dependencyGraph`
- `containerLifetime`
- `dataVolumes`
- `apiProjectInfo`（含 `endpoints`、`dbContext`、`validators`）
- `endpointCatalog[]` 與 `endpointsToTest[]`（穩定 `END-*` ID）
- `scenarioCatalog[]`、`scenarioReviewSummary`、`userProvidedScenarioInput`
- `existingTestInfrastructure`
- `requiredSkills`
- `suggestedTestScenarios`
- `projectContext`
- `sourceFileIndex[]`（path / purpose / compact facts；不得嵌入完整 source）
- `tokenEstimateInputs`

`projectContext.testFramework` 固定 `"xunit"`；`projectContext.targetFramework` 取自被編排 API 專案。`requiredSkills` 固定 `["aspire-testing"]`。

收到 Analyzer 摘要後，用 Glob 確認 `analysisFilePath` 存在；不存在則更新 run-state 並依 bounded re-dispatch 處理。artifact 不得包含 `sourceCodeContext`；不得以固定 scenario 數作 gate，只驗證每個 scenario 的 provenance、endpoint attribution、狀態、evidence 與有效集合一致性。

artifact ready 後立即執行：

```bash
node .codex/scripts/validators/validate-aspire-scenario-contract.mjs --analysis {analysisFilePath} --analysis-only
```

靜態 scenario gate、attempt isolation 或 Analyzer read-scope 任一失敗都不得進入 Writer。

每個 Analyzer assignment 的 artifact gate 通過時，必須在同一操作邊界執行：

```bash
node .codex/scripts/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set artifactReadyAt=@now --set artifact={analysisFilePath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt
```

全部 Analyzer assignments 的 artifact gate 都通過、phase 確定收斂後，才執行：

```bash
node .codex/scripts/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --set completedAt=@now
```

進入 Writer 前，Analyzer assignment 必須已有非 `null` 的 `dispatchIssuedAt`、`dispatchAcceptedAt`、`artifactReadyAt`、`produceSpanMs`，Analyzer phase 必須已有非 `null` 的 `completedAt`。Analyzer 的 canonical artifact 由 Orchestrator 主動執行 Glob/Read gate，因此其 `artifactReadyAt` 屬可獨立觀察邊界，不適用前文允許 `artifactReadyAt: null` 的例外。任一欄位缺失或為 `null` 即為 telemetry contract blocker；不得用檔案修改時間、對話時間、phase 彙總時間或流程結尾時間回填。

#### 階段間主動釋放

Analyzer phase 全部 assignment 完成且 analysis artifact 確認存在後，dispatch Writer phase 前，主動關閉已完成 Analyzer agents 釋放 Codex runtime agent thread slots。若 runtime 不支援主動關閉，停手並回報「runtime 不支援主動關閉已完成 agent」。

### Phase 2：Writer

Writer payload 必須包含 `workspaceRoot`、`executionContext`、`externalMemoryPolicy`、`analysisFilePath`、`apiProjectPath`、`appHostPath`、`outputPath`、`writerResultFilePath` 與 `writerControls`。

**`outputPath` 推導規則（確定性，必用）**：`outputPath` 必須置於測試專案的 **`Integration/` 子目錄**，**禁止**放在以被測 controller 命名的子目錄（例如 `Bookings/`）或測試專案根目錄（與 Aspire Writer 的「目錄結構規範」一致）。
- `{TestDir}` = 測試專案目錄（取 `projectContext.testProjectPath` 去掉結尾 `.csproj` 檔名後的目錄）。
- 規則：`{TestDir}/Integration/{TestClassName}.cs`；檔名沿用 Aspire Writer 命名慣例（例：`BookingsControllerAspireTests.cs`）。
- 測試基礎設施（AspireAppFixture、CollectionDefinition、IntegrationTestBase、DatabaseManager）沿用 Writer 規範置於 `{TestDir}/Infrastructure/`；`GlobalUsings.cs` 置於測試專案根。

Writer 必須先讀 Analyzer 交接檔，再載入 `.agents/skills/dotnet-testing-advanced-aspire-testing/SKILL.md`。不得載 unit 的 technique skills、TUnit skills、integration skills。

Writer 必須使用：

- `DistributedApplicationTestingBuilder`
- `app.CreateHttpClient("servicename")`
- AspireAppFixture + `IAsyncLifetime`
- `[CollectionDefinition]` + `ICollectionFixture<T>`
- AppHost sample 採拋棄式 SQL Server / Redis 容器，不使用持久資料卷與 `ContainerLifetime.Session`
- 測試框架端有界就緒：`StartAsync` 後只對測試實際會用到的資源呼叫 `WaitForResourceHealthyAsync`，搭配 `CancellationToken`（建議 90 秒）；逾時必須拋出點名資源的清楚例外。禁止無界等待與 `Task.Delay` 硬等。
- 測試框架端通用持久化 sanitizer：`BuildAsync` 前以 annotation 層級、與服務型別無關的方式，剝除容器資源的持久具名資料卷掛載並強制 ephemeral / session-scoped 生命週期；若目標 Aspire 版本缺少對應 annotation 型別，sanitizer 可退化為 no-op，但意圖必須保留。
- 測試框架端已知框架 quirk 中和器：Aspire 13.1+ 時，fixture 必須在 `BuildAsync` 前對每個 Redis resource 使用 `appHost.CreateResourceBuilder(redis).WithoutHttpsCertificate()` 關閉 Redis TLS，並以 `#pragma warning disable ASPIRECERTIFICATES001` / restore 包住；net8 / net9 不產生此段，避免編譯失敗。
- 必要時 Respawn
- `App.GetConnectionStringAsync("resourceName")`

Writer 不得使用：

- `WebApplicationFactory`
- 程式化 Testcontainers
- `IConfiguration.GetConnectionString()`
- `<OutputType>Exe</OutputType>`

#### 端點範圍硬邊界（P3）

Writer 以以下優先序決定端點範圍：

1. prompt 明確端點 / Controller slice
2. Analyzer artifact 的 `suggestedTestScenarios` / `endpoints`
3. 整個 Controller

若上層範圍存在，Writer 不得擴大到 sibling endpoints 或 sibling resources。Reviewer 也嚴禁把指定範圍以外的 sibling endpoint / resource 列為覆蓋缺口。

#### 單一 Writer 策略（必要）

每個 Controller／endpoint slice 無論 `scenarioCount`、endpoint 數、Resource 數、Aspire 版本或預估輸出大小為何，固定只 dispatch **一個 Writer subagent**，且 `writerControls` 固定為 `writerTopology: "single"`、`assignmentRole: "full"`。正式 workflow 禁止把同一 target 切成 infrastructure／tests 或其他多個 Writer assignments。

此規則只固定 topology，不限制 Analyzer 案例數，也不得刪減任何合理且 in-scope 的 endpoint 或 scenario。唯一 Writer 必須在同一 assignment 完成必要 infrastructure 與全部有效 scenarios，並寫入唯一 canonical writer-result。

單一 Writer 若遇 context／output limit，attempt fail closed 並保留 blocker evidence；不得自動 split、不得刪減 scenarioCatalog，也不得啟動第二個 repair Writer代替原 assignment完成內容。歷史 B1 two-step artifacts只供實驗報告與 validator compatibility，不是正式 runtime topology。

多個 targets 共用同一測試專案時，Writers 依使用者指定順序循序執行；每個 target 的 topology 個別遵守本節規則。後續 Writer 必須重用並以 add-only 方式補充磁碟上既有的 `Infrastructure/`、`GlobalUsings.cs` 與 `.csproj`，不得覆寫先前 target 測試。每個 target 的 Executor 除 target filter 外，還必須執行 project-level regression，確認先前 target 仍通過。不同測試專案才可平行 Writer。

#### Writer Artifact Gate

dispatch Executor 前必須讀取本 target 全部 canonical `writerResultFilePaths[]`，驗證：

- `writerResultFilePath`
- `testFilePaths` 非空
- `testCount` / `testCaseCount` 為數字
- `testClasses`
- `testClasses[].className`
- `testClasses[].filePath`
- `testClasses[].methodsCovered` 或 `testClasses[].endpointsCovered`
- `skillsLoaded`
- `writerTopology`、`assignmentRole`
- `endpointCoverage`、`scenarioCoverage`
- `tokenEstimateInputs`

`methodsCovered` / `endpointsCovered` 必須是明確端點或案例清單，不得使用 `All`、`FullController`、空陣列或敘述文字。`skillsLoaded` 應包含 `aspire-testing`，不得包含 unit、TUnit、integration 技能。每個有效 scenario ID 與 endpoint ID 必須恰由測試 assignment 認領一次；infrastructure assignment 不得認領 coverage。

執行正式 artifact gate：

```bash
node .codex/scripts/validators/validate-aspire-scenario-contract.mjs --analysis {analysisFilePath} --writer {writerResultFilePath} [...] [--require-single-writer]
```

缺欄位、不可讀或 scope mismatch 時，不得 dispatch Executor；更新 run-state writer phase，必要時 bounded re-dispatch Writer，最多 2 次。

#### P4 版本政策

既有 `.csproj` 套件版本一律保留，不升不降。僅對缺少的必要套件使用 SKILL 記載的最低版本。不執行 `dotnet list package --outdated`。fix 回合 add-only、不 bump。

`Aspire.Hosting.Testing`、`Aspire.Hosting.*` resource 套件版本必須與 AppHost 既有 Aspire 版本對齊（8.x / 9.x / 13.x 不可混），只補缺、不改既有版本。

Writer phase 收斂且 gate 通過後，dispatch Executor 前主動關閉已完成 Writer agents。

### Phase 3：Executor

Executor 必須循序執行，不得平行啟動多個 AppHost 測試。

Executor payload 必須包含 `workspaceRoot`、`executionContext`、`externalMemoryPolicy`、`testProjectPath`、`testFilePaths`、`analysisFilePath`、`writerResultFilePaths[]` 與 Orchestrator 預先計算的 exact `executorResultFilePath`。正式陣列長度固定為 1，且只能是本 target 的唯一 `single/full` artifact。

Executor 執行模型：

1. Step 0 必跑 `docker info`。Docker 不可用即中止並回報；Aspire 無 InMemory 退路。
2. Step 0.5 跑 `dotnet workload list`。若無 `aspire`，先讀 AppHost `.csproj`；使用 `Aspire.AppHost.Sdk` NuGet / Project SDK 時可跳過 workload 要求。
3. `dotnet build <solution-path> -p:WarningLevel=0 /clp:ErrorsOnly --verbosity minimal`
4. `dotnet test <solution-path> --no-build --verbosity minimal --blame-hang-timeout <10m|15m>`

`--blame-hang-timeout` 必須存在：Aspire 8.x/9.x 用 `10m`，13.x+ 用 `15m`。禁止 `--timeout`，禁止 `dotnet run`。`--blame-hang-timeout` 是最後防線；主要防掛必須靠 Writer 產生的測試框架端有界就緒（建議 90 秒），正常應快速失敗並點名資源，不應撞到 blame-hang。

修正迴圈最多 5 次。容器由 Aspire + `IAsyncLifetime.DisposeAsync` 處理，不需手動清理。

Executor 必須寫 `{testProjectDir}/.orchestrator/executor-result/{ControllerName}.executor-result.json`，包含：

- `executionMethod`（固定 `"dotnet test"`）
- `blameHangTimeout`（8.x/9.x 為 `"10m"`；13.x+ 為 `"15m"`）
- `dockerStatus`
- `aspireWorkloadStatus`
- `buildResult`
- `testResult`
- `totalTests`
- `passedTests`
- `failedTests`
- `skippedTests`
- `fixRounds`
- `fixHistory`
- `addedPackages`
- `executionMethod`、`blameHangTimeout`
- `writerResultFilePaths`、`testFilePaths`
- `targetServiceName`、`resourceReadinessEvidence`
- `usesDistributedApplicationTestingBuilder`、`usesWebApplicationFactory`、`usesProgrammaticTestcontainers`
- `productionBugFixes`、`tokenEstimateInputs`

Executor artifact ready 且 attempt isolation 通過後，執行：

```bash
node .codex/scripts/validators/validate-aspire-execution-contract.mjs --analysis {analysisFilePath} --writer {writerResultFilePath} [...] --executor {executorResultFilePath} --require-pass --forbid-production-mutation
```

gate 驗證 xUnit `dotnet test`、版本對應 hang timeout、Writer case accounting、Docker/workload、Aspire-native execution、Resource readiness、服務名稱與零 production/AppHost mutation。任一矛盾都不得以對話摘要覆蓋。

Executor phase 完成且 executor-result 存在後，dispatch Reviewer 前主動關閉已完成 Executor agents。

### Phase 4：Reviewer

Reviewer 一律執行，不可因 Executor 第一次全過、0 修正輪次或使用者未明確要求品質審查而跳過。

Reviewer payload 必須包含 `workspaceRoot`、`executionContext`、`externalMemoryPolicy`、`testFilePaths`、`apiProjectPath`、`appHostPath`、`analysisFilePath`、`writerResultFilePaths[]`、`executorResultFilePath`、`reviewResultFilePath`。

Reviewer 必須載入 `aspire-testing`，並視需要載入 `test-naming-conventions` / `awesome-assertions`。Reviewer 無 Edit 工具，只審查、不修改。

Reviewer 必須驗證：

- `DistributedApplicationTestingBuilder` 正確使用，且沒有 `WebApplicationFactory`。
- `CreateHttpClient("name")` 名稱與 AppHost `AddProject("name")` 一致。
- Collection Fixture / `IAsyncLifetime` / AppHost sample 拋棄式容器前提 / Respawn 使用合理；Reviewer 不得因「未設 ContainerLifetime.Session」或「未用 data volume」對測試產物列 WARNING。
- 依位置判定韌性呼叫是否違規：production / AppHost 出現 `AddHealthChecks()`、`MapHealthChecks("/health")`、`.WithoutHttpsCertificate()`、`WithDataVolume`、`ContainerLifetime` 一律列為 Blocker；相同呼叫若出現在測試 fixture 且用於測試框架端 sanitizer / Redis TLS quirk 中和，屬預期，不判違規。
- AspireAppFixture 具備測試框架端有界就緒：使用 `CancellationToken` 逾時（建議 90 秒）等待測試實際會用到的資源健康，且沒有無界等待或 `Task.Delay` 硬等。
- AspireAppFixture 具備測試框架端通用持久化 sanitizer：`BuildAsync` 前以 annotation 層級處理容器資源的持久卷與生命週期，與服務型別無關。
- Aspire 13.1+ 且 AppHost 使用 Redis 時，AspireAppFixture 具備 Redis TLS quirk 中和器；net8 / net9 不應產生此段。
- 執行方式為 `dotnet test`，不是 `dotnet run`。
- csproj 有 `Microsoft.NET.Test.Sdk` + `xunit` + `Aspire.Hosting.Testing`，沒有 `<OutputType>Exe</OutputType>`。
- 端點覆蓋只針對 P3 範圍，不擴大到 sibling endpoints/resources。

Reviewer 收尾前必須寫 `{testProjectDir}/.orchestrator/reviewer-result/{ControllerName}.reviewer-result.json`。寫失敗即 blocker。

Reviewer 回傳後，Orchestrator 必須用 Glob 確認 `reviewResultFilePath` 落地；不存在即 blocker，不採信回傳文字。

reviewer-result 必須包含 `gateDecision`、`overallRating`、`score`、`endpointAcceptance`、`scenarioAcceptance`、Aspire compliance evidence 與 canonical `tokenEstimateInputs`。artifact、attempt isolation、no-self-read gates 通過後執行：

```bash
node .codex/scripts/validators/validate-aspire-scenario-contract.mjs --analysis {analysisFilePath} --writer {writerResultFilePath} [...] --reviewer {reviewResultFilePath} --require-review-pass [--require-single-writer]
```

`gateDecision` 只允許 `pass`、`pass_with_warnings`、`fail`、`blocked`。有效 scenario missing、endpoint missing、mismatch 或 fail/blocked 都使 final gate 失敗；Executor 全綠不得覆蓋 Reviewer acceptance。

所有 phase closeout、`phaseDurations`、`profilingSummary` 與 `overallWallClock.end` 寫入後，final report 前必須執行：

```bash
node .codex/scripts/run-state.mjs validate --path {p} --require-complete-timing
```

### Phase 5：保留 artifacts

四階段流程全部完成、結果呈現給使用者之後（包含修改流程完成後），清理本次 `.orchestrator/executor-result/` 暫存結果目錄。為跨平台可靠（含 Windows VS Code Codex Extension 等非 bash shell），一律用 `node` 刪除，**不得用 `rm -rf`**：

```bash
node -e "require('fs').rmSync('{testProjectDir}/.orchestrator/executor-result',{recursive:true,force:true})"
```

`.orchestrator/analysis/`、`.orchestrator/writer-result/`、`.orchestrator/reviewer-result/` 與 `.orchestrator/run-state.json` 必須保留，供驗收與 benchmark 讀取；下一次執行時，Phase 0 前置清理才處理其他殘留。

---

## 修改流程

修改流程禁止自動觸發。呈現 Reviewer 結果後，等待使用者指定要套用的建議。使用者同意後：

1. 只 dispatch Writer 或 Executor 做測試側修改。
2. 若需要 production code，必須先通過 Production Code 修改邊界。
3. 修改後必須更新 writer-result / executor-result。
4. Reviewer 以 re-review 模式確認前次 issues 是否解決，不展開無限新增審查。

---

## 最終回報格式

最終回報必須包含：

1. 四階段 artifact 路徑：analysis、writer-result、executor-result、reviewer-result。
2. `run-state.json` 路徑。
3. `dotnet test` 摘要，數字來自 executor-result / 實際輸出，不得編造。
4. `dockerStatus`、`aspireWorkloadStatus`、`executionMethod`、`--blame-hang-timeout` 證據。
5. Reviewer 評級與 blocker / warning 摘要。
6. 生產 Bug/修改紀錄：正常應為「無」；若偵測到任何 production / AppHost 改動，視為契約違反並明確標記。ContainerLifetime.Session 或 data volume 不列為 Executor production 修正。
7. 「各階段耗時」與「Timing Evidence」兩張表，時間取自 run-state。
8. `Estimated Token Usage`：optional telemetry；不得作為 correctness gate。

---

## 結果整合與呈現

收到四個 subagent 的回傳結果後，你必須整合呈現給使用者。最終輸出固定包含下列 9 項；資料一律來自 artifact / run-state，缺欄填「未提供」，不得省略項目，不得改成散文摘要，不得回報正式 token usage（billing / runtime truth）。token 相關資訊只允許以 `Estimated Token Usage` optional telemetry 呈現。

1. 測試檔案連結：列出 Writer 產出的所有測試檔與基礎設施檔路徑，包含 AspireAppFixture、CollectionDefinition、IntegrationTestBase、DatabaseManager、GlobalUsings 等檔案（如有）。不在 chat 中嵌入完整測試程式碼。
2. 執行結果摘要：Executor 的 `dotnet test` 結果，包含通過 / 失敗 / 略過數、`executionMethod`、`--blame-hang-timeout` 值。
3. Docker + Aspire 環境狀態：列出 `dockerStatus`、`aspireWorkloadStatus`（含使用 `Aspire.AppHost.Sdk` / NuGet SDK 時可免安裝 workload 的例外說明）、容器啟動證據與必要的 AppHost resource 狀態。
4. 品質審查摘要：Reviewer 的整體評級、blocker / warning / pass 狀態與關鍵發現。
5. 改善建議：整理 Reviewer 的 `issues` 與 `missingTestCases`，沒有則明確寫「無」。
6. 使用的 Skills 組合：列出 Writer 載入的 skills，Aspire workflow 固定應包含 `aspire-testing`，不得混入 unit、TUnit 或一般 integration skills。
7. Executor 修正紀錄：列出 `fixRounds`、`fixHistory`、`addedPackages`。生產 Bug/修改紀錄正常應為「無」；若偵測到任何 production / AppHost 改動，視為契約違反並明確標記。ContainerLifetime.Session 或 data volume 不屬於 Executor 臨時修正項目。
8. 各階段耗時摘要 + Timing Evidence：讀取 `{testProjectDir}/.orchestrator/run-state.json`，輸出「### 各階段耗時」與「### Timing Evidence」兩張表。
9. Estimated Token Usage：optional telemetry。四階段與 timing evidence 完成後，執行 `node .codex/scripts/estimate-token-usage.mjs --test-project {testProjectDir}` 產生 `.orchestrator/token-usage-estimate.json`，並輸出「### Estimated Token Usage」表格；estimator 失敗 / run-state 缺失 / artifact 不足 / summary 為 `unavailable` 時改輸出 unavailable 表格，但不得讓 workflow 失敗。不得作為 correctness gate。

必須區分「環境問題（Docker daemon / Aspire workload / 容器啟動 / stale volume / 網路）」與「測試品質問題」。Docker 未啟動、Aspire workload 缺失、容器健康檢查或啟動逾時、stale named volume、網路問題，不得包裝成 Writer 品質缺陷。

```markdown
### 各階段耗時

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
| Analyzer | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | AppHost resource / endpoint analysis |
| Writer | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | DistributedApplicationTestingBuilder / CreateHttpClient |
| Executor | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | dotnet test + Docker + Aspire |
| Reviewer | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | reviewer-result verified |
```

---

## Estimated Token Usage（optional telemetry）

Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source。本 workflow 不回報正式 token usage，也不得把估算值包裝為 billing 或 runtime truth。

四階段全部完成且 timing evidence 輸出後，執行：

```bash
node .codex/scripts/estimate-token-usage.mjs --test-project {testProjectDir}
```

不得傳入 `--workflow aspire`；`workflow` 只由 `run-state.json` 作為輸出標籤提供。

估算器成功產生 `{testProjectDir}/.orchestrator/token-usage-estimate.json` 時，輸出「### Estimated Token Usage」表格；若 estimator 失敗、`run-state.json` 缺失、artifact 不足或 summary 為 `unavailable`，仍不得讓 workflow 失敗，改輸出 unavailable 表格。

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
