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

1. 執行 Aspire 專屬 Docker preflight（Phase -2），確認 daemon 實際回應；未 ready 就依該節停止，不進行 NuGet restore 或派發角色。
2. Docker preflight 回傳 ready 後，執行 Aspire 專屬 NuGet sandbox preflight（Phase -1）。本次若要求 tests 空白起點，對 test project 加上 `--require-blank-start`；runtime 在 restore 前核對，ready 的 `startingPoint` 為原始證據。
3. `Glob({testProjectDir}/.orchestrator/**)` 檢查殘留。
4. 僅在有前次 `.orchestrator` 殘留且本次允許清理時，委託 Executor cleanup；當次 preflight 的 restore `obj` 不屬歷史殘留。
5. 建立 `{testProjectDir}/.orchestrator/run-state.json`，作為 phase timing truth；若步驟 4 實際派發 cleanup，先依 Phase 0 的 runtime 命令登記其原始 dispatch／完成證據。隨即執行本地 `usage-observer.mjs start` 建立 HTML 等待頁，再進入步驟 6
6. 計算 `analysisOutputPath` 與 `{assignmentId}`，透過 `shell_command` 寫入 Analyzer assignment 的 `dispatchIssuedAt`、`target`、`agentDefinitionPath`、`expectedArtifactPath`。
7. `SpawnAgent target=".codex/agents/dotnet-testing-advanced-aspire-analyzer.toml" payload={...}` 立即啟動 Analyzer。
8. SpawnAgent 回傳 `agentId` 後，下一個工具呼叫必須透過 `run-state.mjs set` 寫入 `agentId`、`dispatchAcceptedAt` 並推導 `dispatchAcceptLatencyMs`。

步驟 6～8 合稱 **Analyzer dispatch transaction**，不可拆開、跳過或延後補寫。`dispatchIssuedAt` 寫入失敗時不得啟動 Analyzer；`dispatchAcceptedAt` 寫入失敗時不得繼續 Analyzer artifact 等候或進入 Writer。除上述步驟外，在啟動 Analyzer 之前不得讀 Controller、AppHost、Program.cs、DTO、DbContext、Validator，不得 Grep 探索 Resource 或 endpoint。

本 workflow 不估算 token；實際用量由本地 usage runtime 產生 JSON／HTML，最終回覆交付報告連結。`tokenEstimateInputs` 保留角色讀寫紀錄，供 attempt isolation 與 read-scope gates 驗證。

---

## 硬性禁止條款

1. 禁止載入或直接讀取任何共用技術 Skill，且不得讀取 `.agents/skills/**`。除本 workflow 的 Orchestrator Skill 與明確允許的 Codex-specific Skill 外，不得讀取 `.codex/skills/**`；尤其不得讀取其他 `dotnet-testing-orchestrator-*` Skill。Skills 載入是 Writer / Reviewer subagent 的職責。
2. 禁止直接撰寫任何測試程式碼。
3. 禁止直接修改任何 `.csproj`。
4. 禁止直接建立或修改任何 `.cs` 檔案；Reviewer 建議也必須交給 Writer / Executor。
5. 禁止跳過任何階段：Analyzer -> Writer -> Executor -> Reviewer。Reviewer 無論 Executor 是否全過、是否 0 修正輪次，一律執行。
6. 禁止使用 Bash 呼叫 `claude` 命令；所有 subagent 呼叫必須透過 Codex 原生 SpawnAgent。
7. 不以字數或累計計數器估算 token；只由本地 usage runtime 提供實際用量 HTML。

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
  "testProjectPath": "<既有測試專案 exact .csproj 絕對路徑>",
  "analysisOutputPath": "<canonical analysis path>",
  "userRequest": "<使用者特殊需求，如有>",
  "userProvidedScenarios": "<使用者原始 scenarios，如有；沒有時為 null>"
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
  "assignmentId": "<本次 Writer dispatch 的 assignment ID>",
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

正式 dispatch 必須維持 Analyzer -> Writer -> Executor -> Reviewer。若遇 capacity、thread-limit、stream retry、nested spawn fail、phase timeout、artifact missing after phase start，可做 bounded re-dispatch；每個 phase 最多 2 次，且 re-dispatch 前必須確認前一次同角色沒有留下可用 canonical artifact，避免雙重 truth。已接受的 assignment 在產出前失敗時，原樣保存 host 錯誤於本次 `.orchestrator/validation/{assignmentId}.dispatch-failure.json`，以 `dispatch-failure` 封存原始 code／message、evidence SHA、failed 狀態與 null artifact timing；它只結束該 assignment，不直接關閉 workflow。再由 `redispatch` 建立同一 target 的新 assignment，runtime 自動登記前後 assignment 關係與重派次數。成功 artifact 僅屬於成功 assignment，不回填前次失敗紀錄；formal gate 拒絕仍走既有 `fail-gate` 停止契約。

### Formal context isolation（必要）

- 四個正式 role dispatch 都必須明確使用 `fork_turns: "none"`；不得依賴 runtime default。
- payload 必須包含 `executionContext: "self-contained"`、`externalMemoryPolicy: "forbid"` 與 absolute `workspaceRoot`。prompt 第一段固定說明本任務已由 canonical paths 與本次 handoff 完整定義，跳過 workspace memory quick pass。
- roles 禁止讀取 `$CODEX_HOME/memories/**`、`MEMORY.md`、rollout summaries、prior transcript、其他 worktree 或非本次 attempt 的 `.orchestrator` artifacts。
- run-state 每筆 assignment 必須記錄 `contextForkPolicy=none` 與 `externalMemoryPolicy=forbid`；若 runtime 不支援或 telemetry 顯示越界，判定 `attempt-isolation-violation`。
- 每個 canonical artifact ready 後、下一 phase dispatch 前執行 attempt isolation；`--allow-read` 只列本次 run 的 canonical upstream artifacts：

```bash
node .codex/scripts/dotnet-testing-codex-full/validators/validate-unit-attempt-isolation.mjs --workflow aspire --workspace-root {workspaceRoot} --test-project {testProjectPath} --artifact {analysisFilePath}
node .codex/scripts/dotnet-testing-codex-full/validators/validate-unit-attempt-isolation.mjs --workflow aspire --workspace-root {workspaceRoot} --test-project {testProjectPath} --artifact {writerResultFilePath} --allow-read {analysisFilePath}
node .codex/scripts/dotnet-testing-codex-full/validators/validate-unit-attempt-isolation.mjs --workflow aspire --workspace-root {workspaceRoot} --test-project {testProjectPath} --artifact {executorResultFilePath} --allow-read {analysisFilePath} --allow-read {writerResultFilePath} [...]
node .codex/scripts/dotnet-testing-codex-full/validators/validate-unit-attempt-isolation.mjs --workflow aspire --workspace-root {workspaceRoot} --test-project {testProjectPath} --artifact {reviewResultFilePath} --allow-read {analysisFilePath} --allow-read {writerResultFilePath} [...] --allow-read {executorResultFilePath}
```

Analyzer ready 後另執行 minimal read-scope gate；Reviewer ready 後執行 no-self-read gate：

```bash
node .codex/scripts/dotnet-testing-codex-full/validators/validate-aspire-role-read-scope.mjs --role analyzer --workspace-root {workspaceRoot} --agent-definition .codex/agents/dotnet-testing-advanced-aspire-analyzer.toml --artifact {analysisFilePath}
node .codex/scripts/dotnet-testing-codex-full/validators/validate-aspire-role-read-scope.mjs --role reviewer --workspace-root {workspaceRoot} --artifact {reviewResultFilePath}
```

### 多目標並行度

- Phase 1 Analyzer 可平行。
- Phase 2 Writer 可平行。
- Phase 3 Executor 必須循序，因 AppHost 啟動與 Docker 容器不可並行互搶。
- Phase 4 Reviewer 可平行。

---

## 核心工作流程

Writer 與 Reviewer artifact ready 後，Orchestrator 必須執行
`node .codex/scripts/dotnet-testing-codex-full/validators/validate-skill-read-scope.mjs --artifact <result.json> --analysis <analysis.json> --workflow aspire --role <writer|reviewer>`。
此 gate 依 Skill ID 精確驗證 `.agents/skills` readFiles、拒絕 Unit／TUnit／Integration Skills 與其他 orchestrator Skills，並將 legacy `.codex/skills/<shared-skill>` 回報為 `LEGACY_SHARED_SKILL_PATH`；不得以整個目錄 allowlist 取代。

### Phase -2：Docker preflight

第一個環境檢查使用既有 Aspire runtime 的 Docker-only 模式：

```bash
node .codex/scripts/dotnet-testing-codex-full/aspire-runtime/nuget-sandbox-preflight.mjs --workspace-root {workspaceRoot} --docker-only
```

此模式只執行 `docker info --format "{{json .}}"`，最多等待 15 秒，不讀測試專案或 NuGet 快取、不 restore、不寫 artifacts。只有 exit code 為 0、stdout `status=ready` 且有有效 `ServerVersion` 的 daemon 回應，才可進入 Phase -1；Docker CLI 存在或 Desktop 程序存在不構成 ready。

一般環境依現有權限執行。`docker-access-denied` 是設定／socket／named pipe 存取故障，不能直接判定 Docker 未啟動。只有工具支援且政策允許時，對同一原始 Docker-only preflight 命令提出單次工具核准：`exec_command` 的 `sandbox_permissions="require_escalated"`，`workdir` 固定為 `{workspaceRoot}`，`justification` 說明讀取原有 Docker 設定與 daemon 狀態，省略 `prefix_rule`。核准通過才執行一次原命令；程序未結束就只等待同一程序。核准遭拒、工具不支援或政策禁止時保留原始原因並停止；不換命令或連線位置、不自動啟動 Docker、不改設定或 context、不設定永久核准或全域 Full Access。runtime 本身不提升權限。

其他非零回傳、逾時或無有效 daemon 回應立即中止。回覆明確列出「中斷階段：Docker preflight」、blocker kind／message、原始命令、核准結果（如有）、exit code、stdout／stderr／error 與 remediation；保留首次失敗及核准後輸出。說明 NuGet、四角色與 build／test 尚未執行，不建立本次 run-state 或啟動 usage observer，因此沒有本次 token-usage HTML。環境修復後才重新下達任務。此處 ready 只代表當次檢查成功，Executor Step 0 仍須重查，處理流程中 Docker 停止或權限改變的情況。

### Phase -1：NuGet sandbox preflight

`{restoreProjectPath}` 優先使用既有 `testProjectPath`；明確尚無測試專案時才使用 `appHostPath`：

```bash
node .codex/scripts/dotnet-testing-codex-full/aspire-runtime/nuget-sandbox-preflight.mjs --workspace-root {workspaceRoot} --project {restoreProjectPath}
```

第一次 preflight 前，依本次 session／工具明示的 sandbox 與核准政策選擇執行方式；不另跑網路 probe、不讀取 workspace 外設定或快取來判定。一般環境依現有權限執行。若目前 sandbox 禁止 NuGet feed 連線或所需預設快取存取，且本次沒有可完成 restore 的離線環境證據，先對上述原始完整命令提出單次工具核准：只有工具支援且政策允許時，使用 `exec_command` 的 `sandbox_permissions="require_escalated"`，`workdir` 固定為 `{workspaceRoot}`，`justification` 說明「允許本次 Aspire NuGet preflight 使用原有 NuGet 設定完成還原」，省略 `prefix_rule`。這項核准由正式 Orchestrator 處理，不要求使用者在測試提示詞補寫權限操作；提出核准不等於已獲核准。

需要上述核准但遭拒、工具不支援或政策禁止時，保留原始原因並停止，不改用其他命令或設定。核准通過後只執行第一次 preflight；程序尚在執行時只等待同一程序，不再啟動第二次命令。不得先在 sandbox 執行同一 preflight 再換權限重試，不設定永久命令核准、不切換全域 Full Access。`NUGET_PACKAGES` 維持選用，沿用原有 NuGet 設定與預設快取；不改 workspace／user config、不指定固定 cache、不加入 CLI NuGet override。

只有 stdout `status` 為 `ready` 才能進入 Phase 0。非零 exit code 時立即停止，不得建立本次 run-state、dispatch Analyzer、修改 workflow 或改用 Full Access 重跑；將原始命令、核准結果（如有）、exit code、stderr 的 blocker 與 remediation 原樣回報。這個 preflight 只驗證目前指定專案在該次實際執行權限下可用的 restore 環境，不保證後續 sandbox 或 Writer 新增且尚未快取的套件一定可用。

使用者要求空白 tests 時，在上述命令加 `--require-blank-start`，且 project 必須是已指定的 test csproj。runtime 在任何 restore 前確認目錄僅有原 test csproj；不成立就停止、不刪除。ready 的 `startingPoint.verifiedBeforeRestore=true` 是起點事實；之後 restore 產生的 `obj` 不再觸發空白起點檢查或 cleanup。

### Phase 0：前置清理

檢查 `{testProjectDir}/.orchestrator/**/*` 是否有前次殘留。有殘留且本次允許清理時委託 Executor cleanup；本次禁止清理就回報 blocker。無殘留時直接進入 Phase 0.5，不對當次 restore 產物另派 cleanup。

合法 cleanup 只屬前置作業，不是四個正式階段之一。派發前用 runtime `now` 取得 dispatchIssuedAt，SpawnAgent 回傳後取得 dispatchAcceptedAt，收到 completed terminal 後取得 completedAt；禁止在初始化後補造前三個時間。初始化 run-state 後、啟動 observer 前，以以下 scalar 命令保存實際值（不得放入四階段 assignments 或替代正式 Executor）：

```bash
node .codex/scripts/dotnet-testing-codex-full/run-state.mjs append --path {p} --array preparationAssignments --set assignmentId={cleanupAssignmentId} --set operation=cleanup --set role=executor --set agentId={cleanupAgentId} --set agentDefinitionPath=.codex/agents/dotnet-testing-advanced-aspire-executor.toml --set contextForkPolicy=none --set externalMemoryPolicy=forbid --set dispatchIssuedAt={observedIssuedAt} --set dispatchAcceptedAt={observedAcceptedAt} --set completedAt={observedCompletedAt} --set status=completed
```

用量 runtime 以本次 root turn 的唯一 thread 與此記錄歸屬 cleanup 用量，保留全部 requests。未登記、角色／時間不符或未完成的子代理仍保留診斷，不能宣告完整；cleanup 不滿足四角色 gate，也不加入官方四階段 timing。

### Phase 0.5：初始化 run-state

以 `node .codex/scripts/dotnet-testing-codex-full/run-state.mjs init --path {testProjectDir}/.orchestrator/run-state.json --workflow aspire --target {target}` 建立 `{testProjectDir}/.orchestrator/run-state.json`（詳見下方「run-state.json 寫入機制」）。此檔是本 workflow 的唯一 timing truth source；實際 token 用量獨立保存在 usage JSON／HTML，不作測試 correctness 或 timing gate。

run-state 建立成功後執行本 workflow 的用量收集入口，再開始 Analyzer dispatch transaction：

```bash
node .codex/scripts/dotnet-testing-codex-full/aspire-runtime/usage-observer.mjs start --workspace-root "{workspaceRoot}" --run-state "{testProjectDir}/.orchestrator/run-state.json"
```

此入口從 `CODEX_THREAD_ID` 與 session 綁定目前 root turn，優先使用 Node 內建 SQLite 唯讀查詢 Codex 代理關係，不可用時才嘗試現有 Python 執行器；不推測最新 session、不讀取角色對話內容。先建立 `.orchestrator/usage/{runIdentifier}/report.html` 等待頁，再由隱藏的背景程序於主代理回合結束、資料完整且三次快照一致後更新 JSON／HTML。run-state 未提供 runIdentifier 時，由本地用量 runtime 依本次 run 身分推導，不改寫 run-state。

同一次 workflow 因服務錯誤後續接時，既有背景收集器只依 run-state 登記的唯一角色、代理關係、派發時間及原始 request 的 `root_turn_id` 辨識續接回合；報告列出實際納入的回合與歸屬證據，不猜測最新 session、不收錄整個 thread，也不改寫原 binding 或 run-state。服務端容量錯誤保留於診斷；角色已以原始錯誤結束且缺少用量時，workflow 與已觀察回合結束、三次快照一致後以 `incomplete` 收尾，缺漏不補零、不宣告完整。無法精確歸屬時保留缺漏診斷。

缺少資料來源或不支援格式時，HTML 明示 `unsupported`；中止、收集失敗或兩小時內未完整則保留診斷，不猜測用量、不影響測試 truth。不得在 chat 等待自己的回合結束；先交付連結。NuGet preflight 等尚未建立 run-state 的中止，明示「用量 observer 尚未啟動」。`tokenEstimateInputs` 仍只供既有角色讀寫 gates 使用。

run-state 初始化必須包含 `workflow: "aspire"`、`target`、`overallWallClock` 起點、空的 `phases`、`redispatchEvents: []`、`boundedRedispatchCount: 0`、`restartCount: 0`、`executorFixRounds: 0`。

> **run-state.json 寫入機制（必用，跨平台）**：run-state.json 一律透過 `shell_command` 呼叫 `node .codex/scripts/dotnet-testing-codex-full/run-state.mjs` 建立與更新。**不得**假設有「Write 工具」、**不得**用 `date -u`、**不得**手寫 shell read-modify-write。理由：Codex 沒有「Write」工具，且不同 runtime（Codex CLI vs VS Code Codex Extension）shell 不同；改善前 Extension 環境會整段略過 run-state 維護，導致 run-state.json 從不產生、各階段耗時全空。此腳本為純量參數 API（不傳 JSON blob，避免 PowerShell 引號問題），時間戳由腳本內部以系統時鐘產生（值寫 `@now` 即取 ISO 8601 UTC），毫秒差由 `--derive 欄位=END-START` 推導。以下 `{p}` 代表 `{testProjectDir}/.orchestrator/run-state.json`。常用呼叫：
>
> ```bash
> # 初始化（Phase 0 清理後、啟動 Analyzer 前）
> node .codex/scripts/dotnet-testing-codex-full/run-state.mjs init --path {p} --workflow aspire --target {target}
> # dispatch 前：記 dispatchIssuedAt
> node .codex/scripts/dotnet-testing-codex-full/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set dispatchIssuedAt=@now --set target={target} --set agentDefinitionPath={tomlPath} --set expectedArtifactPath={artifactPath} --set contextForkPolicy=none --set externalMemoryPolicy=forbid
> # 收到 agentId：記 agentId/dispatchAcceptedAt，推導 latency
> node .codex/scripts/dotnet-testing-codex-full/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt
> # artifact 落地：記 artifactReadyAt/artifact，推導 produceSpan
> node .codex/scripts/dotnet-testing-codex-full/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set artifactReadyAt=@now --set artifact={artifactPath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt
> # assignment gate 收斂：逐 assignment 記 completedAt
> node .codex/scripts/dotnet-testing-codex-full/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set completedAt=@now --set status=completed
> # phase 收斂：記 status 與 completedAt
> node .codex/scripts/dotnet-testing-codex-full/run-state.mjs set --path {p} --phase analyzer --set completedAt=@now --set status=completed
> # 計數；整體 terminal/timing/profiling 由 finalize 推導
> node .codex/scripts/dotnet-testing-codex-full/run-state.mjs set --path {p} --set executorFixRounds={n}
> node .codex/scripts/dotnet-testing-codex-full/run-state.mjs finalize --path {p}
> # 產出前派發失敗：保存原始 error JSON 後封存 assignment
> node .codex/scripts/dotnet-testing-codex-full/run-state.mjs dispatch-failure --path {p} --phase {phase} --assignment {failedAssignmentId} --gate {originalFailureCode} --failure-message "{originalMessage}" --evidence-path {originalEvidencePath}
> # bounded re-dispatch：建立新 assignment，dispatchIssuedAt 由 runtime 記錄
> node .codex/scripts/dotnet-testing-codex-full/run-state.mjs redispatch --path {p} --phase {phase} --assignment {newAssignmentId} --target {target} --set reason={originalFailureCode} --set waitMs={ms}
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

**Assignment metadata**：`phases` 以 `analyzer` / `writer` / `executor` / `reviewer` 為 key，各含 `assignments[]`。每筆 assignment 除 timing 外，應保留 `assignmentId`、`phase`、`target`、`agentDefinitionPath`（指向該 phase 的 `.codex/agents/dotnet-testing-advanced-aspire-*.toml`）、`spawnPayloadShape`、`expectedArtifactPath`（該 phase canonical 交接檔路徑）、`contextForkPolicy`、`externalMemoryPolicy`。後兩者是 formal isolation gates。

成功 assignment 的 canonical artifact 與 formal gates 收斂後，先寫 assignment `status=completed` 與 `completedAt`；全部 assignments 收斂後才寫 phase `status=completed` 與 `completedAt`。已封存的派發失敗保留 `failed` 與 null artifact timing，由 `finalize`／strict validate 核對原始 SHA、同 phase／target 的重派關係及後續成功 artifact，不要求失敗 assignment 產出成功 artifact。若停止重派，記 phase `status=blocked` 與 `completedAt` 後 finalize，保留原始失敗。`finalize` 從已記錄 phase boundaries 與 canonical Executor／Reviewer 推導 phaseDurations、overall、terminal 與 profilingSummary；禁止模型用 set／derive／手寫 JSON 補造這些欄位。未派發 phase 只記 null／not-dispatched，不建立 assignment。

時間一律取自磁碟 run-state，禁止從對話敘述、subagent 回傳文字、hook additionalContext 或人工推估計算耗時。結果呈現時輸出「### 各階段耗時」與「### Timing Evidence」兩張表。

### Phase 1：Analyzer

Analyzer payload 必須包含 `workspaceRoot`、`executionContext`、`externalMemoryPolicy`、`apiProjectPath`、`appHostPath`、`targetServiceName`、`targetController`、`testProjectPath`、`analysisOutputPath`、`userRequest` 與未改寫的 `userProvidedScenarios`。

#### Analyzer dispatch transaction（硬閘門）

每個 Analyzer assignment 必須依序完成以下操作；多 target 時每筆 assignment 各自執行，不得只記 phase 彙總時間：

1. SpawnAgent **之前**先執行：

   ```bash
   node .codex/scripts/dotnet-testing-codex-full/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set dispatchIssuedAt=@now --set target={target} --set agentDefinitionPath=.codex/agents/dotnet-testing-advanced-aspire-analyzer.toml --set expectedArtifactPath={analysisOutputPath}
   ```

2. 上述命令成功後才可 SpawnAgent；若失敗，不得啟動 Analyzer。
3. SpawnAgent 回傳 `agentId` 後，下一個工具呼叫必須是：

   ```bash
   node .codex/scripts/dotnet-testing-codex-full/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt
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
- `endpointCatalog[]`（穩定 `END-*` ID）與 `endpointsToTest[]`（物件陣列，每個元素含 `endpointId`，例如 `[{ "endpointId": "END-001" }]`；引用完整 in-scope catalog ID 集合）
- `scenarioCatalog[]`、頂層整數 `scenarioCount`、`scenarioReviewSummary`、`userProvidedScenarioInput`
- `existingTestInfrastructure`
- `requiredSkills`
- `suggestedTestScenarios`
- `projectContext`
- `sourceFileIndex[]`（path / purpose / compact facts；不得嵌入完整 source）
- `tokenEstimateInputs`

`projectContext.testFramework` 固定 `"xunit"`；`projectContext.targetFramework` 取自被編排 API 專案。`requiredSkills` 固定 `["aspire-testing"]`。

三種 catalog 的 `evidence` 都是非空陣列；頂層 `scenarioCount` 等於有效 scenario 集合長度及 `scenarioReviewSummary.effective`。schema 由 Analyzer profile 定義，runtime 不替不合格 artifact 轉型或補值。

收到 Analyzer 摘要後，用 Glob 確認 `analysisFilePath` 存在；不存在則更新 run-state 並依 bounded re-dispatch 處理。artifact 不得包含 `sourceCodeContext`；不得以固定 scenario 數作 gate，只驗證每個 scenario 的 provenance、endpoint attribution、狀態、evidence 與有效集合一致性。

artifact ready 後立即執行：

```bash
node .codex/scripts/dotnet-testing-codex-full/run-state.mjs analysis-gate --path {p} --assignment {assignmentId}
```

靜態 scenario gate、attempt isolation 或 Analyzer read-scope 任一失敗都不得進入 Writer。

`analysis-gate` 執行原 scenario validator，將命令、原 stdout／stderr、exit code 與 analysis SHA 保存為 `.orchestrator/validation/{assignmentId}.analysis-gate.json`，已存在則停止，不覆寫。拒絕時 runtime 記錄原 failure、null artifact timing 並 finalize；接著執行下述 strict validate、blocked phase renderer、final renderer 與 receipt validate，照錄 stdout 後停止，不重派。其餘 formal gate 失敗時，以原始 evidence path 呼叫同一正式收尾，再走相同呈現路徑：

```bash
node .codex/scripts/dotnet-testing-codex-full/run-state.mjs fail-gate --path {p} --phase {phase} --assignment {assignmentId} --gate {actualGateCode} --failure-message "{originalFailure}" --evidence-path "{originalEvidencePath}"
```

此收尾只處理已接受 dispatch 的 assignment；權限、無法取得 dispatch boundary 等 blocker 保留證據並停止，不補造 agent 或 timestamp。嚴格 timing／receipt 若仍不成立，據實回報 presentation blocker，不宣稱成功呈現。

每個 Analyzer assignment 的 artifact gate 通過時，必須在同一操作邊界執行：

```bash
node .codex/scripts/dotnet-testing-codex-full/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set artifactReadyAt=@now --set artifact={analysisFilePath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt
```

全部 Analyzer assignments 的 artifact gate 都通過、phase 確定收斂後，才執行：

```bash
node .codex/scripts/dotnet-testing-codex-full/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --set completedAt=@now --set status=completed
```

進入 Writer 前，Analyzer assignment 必須已有非 `null` 的 `dispatchIssuedAt`、`dispatchAcceptedAt`、`artifactReadyAt`、`produceSpanMs`，Analyzer phase 必須已有非 `null` 的 `completedAt`。Analyzer 的 canonical artifact 由 Orchestrator 主動執行 Glob/Read gate，因此其 `artifactReadyAt` 屬可獨立觀察邊界，不適用前文允許 `artifactReadyAt: null` 的例外。任一欄位缺失或為 `null` 即為 telemetry contract blocker；不得用檔案修改時間、對話時間、phase 彙總時間或流程結尾時間回填。

#### 階段間交接（Analyzer → Writer）

只有在 Analyzer role 已回傳 `completed` terminal、全部 Analyzer assignments 的 canonical analysis artifacts 已存在，且進入下一 phase 所需的既有 artifact、attempt isolation、read-scope、schema 與 telemetry gates 全部通過後，才可 dispatch Writer。角色回傳 `blocked` 或 `failed` terminal 不代表 artifact gate 通過；必須依既有失敗契約保存 evidence 並停止，或只執行當次已授權的既有 bounded repair／re-dispatch。當次 live 未授權重試時立即停止。

對已 completed agent 不得呼叫 `interrupt_agent` 模擬 close，也不要求 host 提供 completed-agent close；目前沒有實測證據可宣稱 completed agent 必然釋放 runtime slot。實際 dispatch 若回報 capacity／thread-limit 失敗，依當次授權與既有失敗契約保存結構化 blocker 並停止或處理，不得改變正式 phase 順序或每個 target 單一 Writer topology。

### Phase 2：Writer

Writer payload 必須包含 `workspaceRoot`、`executionContext`、`externalMemoryPolicy`、`analysisFilePath`、`apiProjectPath`、`appHostPath`、`outputPath`、`writerResultFilePath`、本次已接受派發的 `assignmentId` 與 `writerControls`。

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
- 測試框架端有界就緒：必要資源集合固定為已驗證 analysis 的 `resourceCatalog[].requiredForTarget === true` 加上 `targetServiceName`，包含 AppHost 啟動相依資源；不得因 Controller 未直接使用就排除，也不擴大到未標示必要的資源。 依 runtime 套件版本與當次已還原套件的 API 判定，不依 .NET target framework 或 AppHost SDK 版本猜測。可用且有實際健康檢查時對必要資源集合呼叫 `WaitForResourceHealthyAsync`；缺少 healthy API 或實際健康檢查時，`Running` 只確認啟動，fallback 必須接續依 `resourceCatalog` 型別與實際用途的協定就緒確認，writer-result 記錄原因與確認方式。HTTP API 的 fallback 在 fixture 初始化完成前，以共用 `CancellationToken` 對本次已驗證的唯讀路由取得實際 HTTP 回應，依端點契約判定是否就緒；`CreateHttpClient` 與第一個測試案例的呼叫不能取代此確認。SQL Server 使用 `App.GetConnectionStringAsync(resourceName, ct)` 的原連線設定，以 `SqlConnection.OpenAsync(ct)` 確認可登入，成功後才初始化 schema／Respawn。在 `CreateAsync` 前建立取消期限；`CreateAsync`、`BuildAsync`、`StartAsync`、資源等待、取得連線字串、協定就緒、重試退避與 schema／Respawn 初始化共用一個總逾時與 `CancellationToken`（建議 90 秒），將同一 token 傳給可取消的 API；不接受 token 的非同步初始化（例如 `Respawner.CreateAsync`）仍須以共用 token 限制等待（例如 `WaitAsync(ct)`）。等待取消不代表底層作業已停止；取消後停止初始化，處理尚未完成作業的失敗與連線釋放；暫時失敗可短暫退避，取消涵蓋每次嘗試與退避，不重新計時。逾時點名資源並保留最後失敗原因；禁止無界等待與沒有就緒判斷的 `Task.Delay` 硬等，不改 production／AppHost 或連線目的地／TLS 設定。
- 測試框架端通用持久化 sanitizer：`BuildAsync` 前以 annotation 層級、與服務型別無關的方式，剝除容器資源的持久具名資料卷掛載並強制 ephemeral / session-scoped 生命週期；若目標 Aspire 版本缺少對應 annotation 型別，sanitizer 可退化為 no-op，但意圖必須保留。
- 測試框架端已知框架 quirk 中和器：Aspire 13.1+ 時，fixture 必須在 `BuildAsync` 前對每個 Redis resource 使用 `appHost.CreateResourceBuilder(redis).WithoutHttpsCertificate()` 關閉 Redis TLS，並以 `#pragma warning disable ASPIRECERTIFICATES001` / restore 包住；依當次 Redis 套件、TLS 設定與實際可用 API 判定，不依 .NET target framework；沒有此行為或 API 時不強加此段。
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
- `testCount` 為測試方法數，`testCaseCount` 為資料展開後案例數；兩者不得以 scenario 數代替
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

正式 single-writer gate 直接讀取 `testFilePaths`，核對靜態可確定的 Fact／InlineData 方法數與展開案例數；不改寫 Writer artifact。動態資料來源或無法靜態確定的宣告顯示 `deferred-to-executor`，維持既有 Executor 實測一致性 gate，不限制測試技術選擇，也不把宣告檢查當成實際執行。

```bash
node .codex/scripts/dotnet-testing-codex-full/validators/validate-aspire-scenario-contract.mjs --analysis {analysisFilePath} --writer {writerResultFilePath} [...] [--require-single-writer]
```

缺欄位、不可讀或 scope mismatch 時，不得 dispatch Executor；更新 run-state writer phase，必要時 bounded re-dispatch Writer，最多 2 次。

#### P4 版本政策

以 Analyzer 的 `existingTestInfrastructure.packageReferences` 記錄起點已有套件，其 `.csproj` 版本一律保留，不升不降。缺少的必要套件以技術 Skill 的最低版本作參考，依目標 test project 當次 restore assets 與相依需求選擇相容版本；範例版本不是固定值。不執行 `dotnet list package --outdated`，不查詢或套用最新版。

Executor 依起點基準與 Writer `nugetChanges` 區分已有／本輪新增套件；本輪新增套件造成 NU1605 等解析錯誤時，可在既有最多 5 輪內修正測試側參考並重新建置／測試，不升降起點已有版本。這是同一 assignment 的修正迴圈，不是重新啟動 workflow；遇權限拒絕或核准範圍內無法解決的 blocker，保存原始失敗與未驗證修正並停止，不繞過拒絕。

`Aspire.Hosting.Testing`、`Aspire.Hosting.*` resource 套件版本必須與 AppHost 既有 Aspire 版本對齊（8.x / 9.x / 13.x 不可混），只補缺、不改既有版本。

#### 階段間交接（Writer → Executor）

只有在 Writer role 已回傳 `completed` terminal、全部 Writer assignments 的 canonical writer-result artifacts 已存在，且進入下一 phase 所需的既有 artifact、attempt isolation、schema、scenario acceptance 與 telemetry gates 全部通過後，才可 dispatch Executor。角色回傳 `blocked` 或 `failed` terminal 不代表 artifact gate 通過；必須依既有失敗契約保存 evidence 並停止，或只執行當次已授權的既有 bounded repair／re-dispatch。當次 live 未授權重試時立即停止。

對已 completed agent 不得呼叫 `interrupt_agent` 模擬 close，也不要求 host 提供 completed-agent close；目前沒有實測證據可宣稱 completed agent 必然釋放 runtime slot。實際 dispatch 若回報 capacity／thread-limit 失敗，依當次授權與既有失敗契約保存結構化 blocker 並停止或處理，不得改變正式 phase 順序或每個 target 單一 Writer topology。

### Phase 3：Executor

Executor 必須循序執行，不得平行啟動多個 AppHost 測試。

Executor payload 必須包含 `workspaceRoot`、`executionContext`、`externalMemoryPolicy`、`testProjectPath`、`testFilePaths`、`analysisFilePath`、`writerResultFilePaths[]` 與 Orchestrator 預先計算的 exact `executorResultFilePath`。正式陣列長度固定為 1，且只能是本 target 的唯一 `single/full` artifact。

Executor 執行模型：

1. Step 0 獨立執行 `docker info`，依 Executor profile 的既有 Docker 檢查分類與單次工具核准處置。設定檔／socket／named pipe 存取遭拒不能直接判定 Docker 未啟動；只有工具支援且政策允許時，由 Executor 提出原命令的單次核准，保留原始失敗、核准結果與核准後回傳。核准遭拒、工具不支援或政策禁止時停止，不繞過拒絕；Docker 未確認可用即中止並如實回報 build／test 未執行，不補造 readiness，也不以 preflight ready 代表後續 Docker 權限已取得。Aspire 無 InMemory 退路。
2. Step 0.5 跑 `dotnet workload list`。若無 `aspire`，先讀 AppHost `.csproj`；使用 `Aspire.AppHost.Sdk` NuGet / Project SDK 時可跳過 workload 要求。
3. `dotnet build <solution-path> -p:WarningLevel=0 /clp:ErrorsOnly --verbosity minimal`
4. `dotnet test <solution-path> --no-build --verbosity minimal --blame-hang-timeout <10m|15m>`

`--blame-hang-timeout` 必須存在：Aspire 8.x/9.x 用 `10m`，13.x+ 用 `15m`。禁止 `--timeout`，禁止 `dotnet run`。`--blame-hang-timeout` 是最後防線；主要防掛必須靠 Writer 產生的測試框架端有界就緒（建議 90 秒），正常應快速失敗並點名資源，不應撞到 blame-hang。

交接前依 Executor Step 3.5 核對全部必要資源，不限測試失敗時；必要資源集合固定為已驗證 analysis 的 `resourceCatalog[].requiredForTarget === true` 加上 `targetServiceName`，包含 AppHost 啟動相依資源；不得因 Controller 未直接使用就排除，也不擴大到未標示必要的資源。 正常交接的 `resourceReadinessEvidence` 對每個必要資源恰有一筆，包含 `verification.method`（`health-check`／`protocol`；邏輯資料庫可用 `initialization`）、`succeeded: true`、具體 `observation`、測試專案內實際確認程式的絕對 `sourcePath` 與當次內容 `sourceSha256`。狀態可以如實保留 `running`、`ready` 或 `healthy`，但狀態字串本身不足以證明就緒；確認必須由本次 fixture 在初始化完成前實際執行，不能以全數測試通過或第一個測試代替。來源 SHA 只確認程式身分與內容，成功觀察仍須符合 Executor 的執行輸出與 fixture 實作。 必要來源讀取與 SHA 核對如實列入 readFiles，不擴大品質掃描。

修正迴圈最多 5 次。只有 `Running`、缺少協定就緒確認或取消未涵蓋初始化與連線時，Executor 可依一般修正迴圈補足測試 fixture 的有界就緒，保留每次原始失敗與修正歷史並重新建置／測試；TDS pre-login signature 本身不能證明純環境故障。這不等於放寬環境例外資格，不改 production／AppHost、連線目的地／TLS 設定或失敗 truth。需要的當次日誌應在 fixture 失敗後、資源釋放前保存，不為補取日誌額外啟動測試。Redis TLS 測試 fixture 缺口也可在同一修正迴圈補足，依當次套件與 API 判斷。逾時先核對測試側就緒缺口，不能只由 Windows／WSL2 或逾時字串認定環境故障。容器由 Aspire + `IAsyncLifetime.DisposeAsync` 處理，不需手動清理。

Writer 撰寫需要已還原套件 XML 時，依 profile 的 `--package-documentation --save-package-documentation` 操作取得本 test project assets／package／version／XML SHA provenance，綁定目前已接受且仍在產出的唯一 Writer `assignmentId` 與 `writerResultFilePath` 保存不可覆寫的收據，成功後才讀取文件。Writer 將完整 payload 透過 stdin 交給 `--write-writer-result`，帶入每個已讀 XML 的 `--package-documentation-receipt`；未讀套件 XML 時省略收據參數。runtime 先核對來源仍吻合與 scope，再原樣合併兩筆 readFiles、填入收據 SHA 及必要 reads／writes並排他首次建立 canonical 結果；缺收據、衝突或來源變更即停止，不手工轉寫 metadata，不修改既有 canonical 或歷史 rejection evidence。run-state 僅由 runtime 查核 binding，不交給 Writer 作分析材料。Executor 編譯診斷仍使用既有唯讀 `--package-documentation` 操作並原樣記錄兩筆 readFiles；isolation gate 維持唯讀且要求完整 inline provenance，僅對 canonical Aspire Writer（`single`／`full`）與 Executor 的合格文件讀取採此分支，不補寫缺欄位。Writer 新增參考尚未出現在當次還原清單時，不讀取未驗證的快取文件，在 writer-result 既有 `tokenEstimateInputs.notes` 記錄 API 驗證延後至 Executor；Writer 不執行 restore／build／test，Executor 的正式編譯與測試才是實際 API 證據。其他外部讀取、歷史資料與外部寫入仍依原 gate 拒絕。

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
node .codex/scripts/dotnet-testing-codex-full/validators/validate-aspire-execution-contract.mjs --analysis {analysisFilePath} --writer {writerResultFilePath} [...] --executor {executorResultFilePath} --require-pass --forbid-production-mutation
```

gate 驗證 xUnit `dotnet test`、版本對應 hang timeout、Writer case accounting、Docker/workload、Aspire-native execution、Resource readiness 的成功確認方式、觀察與測試來源 SHA、服務名稱與零 production/AppHost mutation。只有 Running 或沒有 verification 不得通過正常分支；MSSQL 狹義例外維持下述獨立判定。任一矛盾都不得以對話摘要覆蓋。

Windows Docker Desktop／MSSQL 狹義例外只在使用者已明確授權且 fresh bounded attempt 留下完整同候選證據時評估。Executor 以 `status: "candidate"` 保留原始失敗 truth；Orchestrator 驗證 MSSQL 容器內部 ready、`127.0.0.1` TDS pre-login／SQL readiness signature、所有非 MSSQL resources、bookingapi 唯一相依阻擋與全部非環境 gates後，以 `--allow-known-environment-exception` 執行同一 validator，由 validator 輸出 `knownEnvironmentExceptionQualified: true` 與 terminal decision，並保存 validation artifact。不得移除 `--require-pass`；validator 只對完整符合狹義 schema 的 candidate 改採例外分支。任何其他失敗維持正式失敗，且 canonical executor artifact 不得由 Orchestrator 改寫。

#### 階段間交接（Executor → Reviewer）

只有在 Executor role 已回傳 `completed` terminal、canonical executor-result artifact 已存在，且進入 Reviewer 所需的既有 artifact、attempt isolation 與 schema gates 已通過、execution evidence 已保存後，才可 dispatch Reviewer。角色回傳 `blocked` 或 `failed` terminal 不代表 artifact gate 通過；必須依既有失敗契約保存 evidence 並停止，或只執行當次已授權的既有 bounded repair。Executor correctness failure 或已核准的狹義環境例外仍依前述規則執行 Reviewer，不等於略過 artifact gate。當次 live 未授權重試時立即停止。

對已 completed agent 不得呼叫 `interrupt_agent` 模擬 close，也不要求 host 提供 completed-agent close；目前沒有實測證據可宣稱 completed agent 必然釋放 runtime slot。實際 dispatch 若回報 capacity／thread-limit 失敗，依當次授權與既有失敗契約保存結構化 blocker 並停止或處理，不得改變正式 phase 順序。

### Phase 4：Reviewer

Reviewer 一律執行，不可因 Executor 第一次全過、0 修正輪次或使用者未明確要求品質審查而跳過。

Reviewer payload 必須包含 `workspaceRoot`、`executionContext`、`externalMemoryPolicy`、`testFilePaths`、`apiProjectPath`、`appHostPath`、`analysisFilePath`、`writerResultFilePaths[]`、`executorResultFilePath`、`reviewResultFilePath`。

Reviewer 必須載入 `aspire-testing`，並視需要載入 `test-naming-conventions` / `awesome-assertions`。Reviewer 無 Edit 工具，只審查、不修改。

Reviewer 必須驗證：

- `DistributedApplicationTestingBuilder` 正確使用，且沒有 `WebApplicationFactory`。
- `CreateHttpClient("name")` 名稱與 AppHost `AddProject("name")` 一致。
- Collection Fixture / `IAsyncLifetime` / AppHost sample 拋棄式容器前提 / Respawn 使用合理；Reviewer 不得因「未設 ContainerLifetime.Session」或「未用 data volume」對測試產物列 WARNING。
- 依位置判定韌性呼叫是否違規：production / AppHost 出現 `AddHealthChecks()`、`MapHealthChecks("/health")`、`.WithoutHttpsCertificate()`、`WithDataVolume`、`ContainerLifetime` 一律列為 Blocker；相同呼叫若出現在測試 fixture 且用於測試框架端 sanitizer / Redis TLS quirk 中和，屬預期，不判違規。
- AspireAppFixture 具備與 Writer 相同的有界就緒契約：必要資源集合固定為已驗證 analysis 的 `resourceCatalog[].requiredForTarget === true` 加上 `targetServiceName`，包含 AppHost 啟動相依資源；不得因 Controller 未直接使用就排除，也不擴大到未標示必要的資源。 正常交接的 `resourceReadinessEvidence` 對每個必要資源恰有一筆，包含 `verification.method`（`health-check`／`protocol`；邏輯資料庫可用 `initialization`）、`succeeded: true`、具體 `observation`、測試專案內實際確認程式的絕對 `sourcePath` 與當次內容 `sourceSha256`。狀態可以如實保留 `running`、`ready` 或 `healthy`，但狀態字串本身不足以證明就緒；確認必須由本次 fixture 在初始化完成前實際執行，不能以全數測試通過或第一個測試代替。來源 SHA 只確認程式身分與內容，成功觀察仍須符合 Executor 的執行輸出與 fixture 實作。 核對實際 fixture 與 Executor 證據，不自行重跑測試。依 runtime 套件版本與當次已還原套件的 API 判定，不依 .NET target framework 或 AppHost SDK 版本猜測。可用且有實際健康檢查時使用 `WaitForResourceHealthyAsync`；缺少 healthy API 或實際健康檢查時，`Running` 後有協定就緒確認，SQL Server 使用原連線設定的 `SqlConnection.OpenAsync(ct)`，成功後才初始化 schema／Respawn。在 `CreateAsync` 前建立取消期限；`CreateAsync`、`BuildAsync`、`StartAsync`、資源等待、取得連線字串、協定就緒、重試退避與 schema／Respawn 初始化共用一個總逾時與 `CancellationToken`（建議 90 秒），將同一 token 傳給可取消的 API；不接受 token 的非同步初始化（例如 `Respawner.CreateAsync`）仍須以共用 token 限制等待（例如 `WaitAsync(ct)`）。等待取消不代表底層作業已停止；取消後停止初始化，處理尚未完成作業的失敗與連線釋放，沒有無界等待或硬等；不因舊版沒有 healthy API 本身列缺失，Runtime 通過與否仍以 Executor 原始結果判定。
- AspireAppFixture 具備測試框架端通用持久化 sanitizer：`BuildAsync` 前以 annotation 層級處理容器資源的持久卷與生命週期，與服務型別無關。
- Redis TLS quirk 中和器依當次 Redis 套件、TLS 設定與實際可用 API 判定，不依 .NET target framework；缺少且只有風險列 WARNING，實際 hang 或遮蔽失敗列 Blocker。
- 執行方式為 `dotnet test`，不是 `dotnet run`。
- csproj 有 `Microsoft.NET.Test.Sdk` + `xunit` + `Aspire.Hosting.Testing`，沒有 `<OutputType>Exe</OutputType>`。
- 端點覆蓋只針對 P3 已接受的 endpoint 與全部有效 scenario，不擴大到 sibling endpoints/resources。Collection 名稱或常數須與有效 CollectionDefinition 及共享 fixture 對應，不要求固定字面值；合理檔名、目錄、欄位與斷言選擇差異不列缺失。

Reviewer 收尾前必須寫 `{testProjectDir}/.orchestrator/reviewer-result/{ControllerName}.reviewer-result.json`。寫失敗即 blocker。

Reviewer 回傳後，Orchestrator 必須用 Glob 確認 `reviewResultFilePath` 落地；不存在即 blocker，不採信回傳文字。

reviewer-result 必須包含 `gateDecision`、`overallRating`、`score`、`endpointAcceptance`、`scenarioAcceptance`、Aspire compliance evidence 與 canonical `tokenEstimateInputs`。artifact、attempt isolation、no-self-read gates 通過後執行：

```bash
node .codex/scripts/dotnet-testing-codex-full/validators/validate-aspire-scenario-contract.mjs --analysis {analysisFilePath} --writer {writerResultFilePath} [...] --reviewer {reviewResultFilePath} --require-review-pass [--require-single-writer]
```

若且唯若 execution exception 已通過機器驗證，Reviewer artifact 另有 accepted `knownEnvironmentExceptionReview` 時，上式加 `--allow-known-environment-exception`；Reviewer 的 `gateDecision` 仍代表非 runtime 品質與完整 acceptance，不得把 Executor 原始失敗數改為 0。

`gateDecision` 只允許 `pass`、`pass_with_warnings`、`fail`、`blocked`。有效 scenario missing、endpoint missing、mismatch 或 fail/blocked 都使 final gate 失敗；Executor 全綠不得覆蓋 Reviewer acceptance。

全部 phase gates 通過後，final report 前必須執行 deterministic finalize 及 strict validate；提前 gate failure 由 runtime finalize 後仍執行相同 strict validate：

```bash
node .codex/scripts/dotnet-testing-codex-full/run-state.mjs finalize --path {p}
node .codex/scripts/dotnet-testing-codex-full/run-state.mjs validate --path {p} --require-complete-timing
```

採用狹義例外時，run-state 必須以 `run-state.mjs set` 記錄 `knownEnvironmentException.status=qualified`、固定 exceptionCode、原始 `failedTests`、absolute executor/reviewer/validation artifact paths 與 `validatedAt`。`finalize` 核對同次機器驗證與 Executor／Reviewer 後推導 `completed_with_known_environment_exception`；不由模型寫 lifecycle／terminalDecision。run-state validator 會拒絕 failedTests 為 0、狀態不一致或缺 canonical paths 的例外表示。

### Phase 5：保留 artifacts

四階段流程完成或中止後，不自動刪除本次 `.orchestrator/`。analysis、writer-result、executor-result、reviewer-result、validation evidence、run-state、workflow-result 與 usage 產物全部保留，供事後審查與證據保存；清理另依使用者授權。失敗 attempt 保留原始 evidence，不覆寫成重試結果。

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

---

## 結果整合與呈現

### 執行進度顯示規範

以下開始標題固定在各 dispatch 前輸出，不在派發後補寫：

- `## 階段 1：啟動分析（Analyzer）`
- `## 階段 2：啟動撰寫（Aspire Writer）`
- `## 階段 3：啟動執行（Aspire Executor）`
- `## 階段 4：啟動審查（Aspire Reviewer）`

各 phase 的 gates 通過、assignment 與 phase completion 寫入後，或 runtime 已完成 blocked closeout 後，照錄 phase renderer stdout；不由模型改寫摘要或計算耗時：

```bash
node .codex/scripts/dotnet-testing-codex-full/aspire-runtime/workflow-result.mjs phase --workspace-root "{workspaceRoot}" --run-state "{p}" --phase {phase}
```

完成摘要保留 `✅ 階段 N 完成（M 分 S 秒）`；Analyzer 顯示 Resource／端點／情境與技術，Writer 顯示案例數，Executor 顯示原 passed／failed／skipped 與修正次數，Reviewer 顯示審查結果。測試失敗／審查不通過使用 ⚠，blocker 使用 `⚠ 階段 N 中止`，未派發階段沒有開始或完成句。

四階段完成或提前 gate failure 已由 runtime 收尾後，最終輸出固定包含下列 8 項；資料一律來自 artifact / run-state，缺欄填「未提供」、未派發如實標示，不得省略項目，不得改成散文摘要；實際用量 HTML 由本 workflow 專屬 renderer 放在回覆最尾端，不更動下列欄位。

1. 測試檔案連結：列出 Writer 產出的所有測試檔與基礎設施檔路徑，包含 AspireAppFixture、CollectionDefinition、IntegrationTestBase、DatabaseManager、GlobalUsings 等檔案（如有）。不在 chat 中嵌入完整測試程式碼。
2. 執行結果摘要：Executor 的 `dotnet test` 結果，包含通過 / 失敗 / 略過數、`executionMethod`、`--blame-hang-timeout` 值。
3. Docker + Aspire 環境狀態：列出 `dockerStatus`、`aspireWorkloadStatus`（含使用 `Aspire.AppHost.Sdk` / NuGet SDK 時可免安裝 workload 的例外說明）、容器啟動證據與必要的 AppHost resource 狀態。
4. 品質審查摘要：Reviewer 的整體評級、blocker / warning / pass 狀態與關鍵發現。
5. 改善建議：整理 Reviewer 的 `issues` 與 `missingTestCases`，沒有則明確寫「無」。
6. 使用的 Skills 組合：列出 Writer 載入的 skills，Aspire workflow 固定應包含 `aspire-testing`，不得混入 unit、TUnit 或一般 integration skills。
7. Executor 修正紀錄：列出 `fixRounds`、`fixHistory`、`addedPackages`。生產 Bug/修改紀錄正常應為「無」；若偵測到任何 production / AppHost 改動，視為契約違反並明確標記。ContainerLifetime.Session 或 data volume 不屬於 Executor 臨時修正項目。
8. 各階段耗時摘要 + Timing Evidence：讀取 `{testProjectDir}/.orchestrator/run-state.json`，輸出「### 各階段耗時」與「### Timing Evidence」兩張表。

此外必須交付 **HTML token-usage report**。固定順序是上述八項 → `### Profiling Summary` → 最尾端獨立的 `### HTML token-usage report`，格式、內容與 Unit／TUnit／Integration 的 HTML 交付一致。原八項名稱、順序、階段開始／完成摘要與兩張耗時表不變。資料由 Aspire 自有 renderer 從本次 canonical artifacts 與 run-state 投影，不由模型改寫、估算或補造。

正常完成先通過全部 gates；提前 blocker 保存原拒絕 evidence 並完成 deterministic failure closeout。兩者都在 strict timing validation 通過後執行：

```bash
node .codex/scripts/dotnet-testing-codex-full/aspire-runtime/workflow-result.mjs --workspace-root "{workspaceRoot}" --run-state "{p}" --json-output "{testProjectDir}/.orchestrator/workflow-result/workflow-result.json" --markdown-output "{testProjectDir}/.orchestrator/workflow-result/workflow-result.md"
node .codex/scripts/dotnet-testing-codex-full/run-state.mjs validate --path "{p}" --require-complete-timing --require-presentation
node .codex/scripts/dotnet-testing-codex-full/aspire-runtime/workflow-result.mjs deliver --workspace-root "{workspaceRoot}" --run-state "{p}"
```

renderer 保存 JSON／Markdown，並在 run-state 記錄 `presentation` receipt（renderer、terminalDecision、renderedAt、absolute output paths 與 SHA-256）。receipt validation 通過後，以唯讀 `deliver` 作為最後工具輸出；它重用 strict timing／receipt validator 並照錄已保存的完整 Markdown，不重新 render、不更新 observer 或覆寫證據。最終回覆直接照錄 `deliver` stdout，保留全部固定欄位、絕對路徑 Markdown 連結及可貼到瀏覽器的 `file:///` 網址，HTML 後不得再附其他回報。renderer 不改 Executor／Reviewer artifacts、不決定例外資格，也不重跑測試。重複 render 或已存在輸出直接停止，不覆寫證據。

renderer 呼叫本地 `usage-observer.mjs link`，照錄其 `markdown`、`fileUrl`、`note`、狀態及 label；`pending` 表示主代理回合結束後背景程序更新同一檔案，不在 chat 等自己的回合結束。`unsupported`、`failed` 或尚未產生 binding 時據實保留原因，不補造連結或承諾自動恢復；用量收集狀態不改變測試 truth。

```bash
node .codex/scripts/dotnet-testing-codex-full/aspire-runtime/usage-observer.mjs link --workspace-root "{workspaceRoot}" --run-state "{p}"
```

Aspire `usage-report.mjs` 自有鎖定完整 Lite HTML 模板，包含原用量表、說明文字與選用 Standard credit 互動；各 request 依同一 turn 之前最近的 `turn_context` 分組。未知模型、非 Standard 或缺漏用量不提供合計；服務模式缺漏只能明示 Standard 前提試算。模板保留註明日期的費率，不代表帳戶實際扣抵，不跨 workflow import。

狹義例外的 execution validator stdout 必須保存為本次 `.orchestrator/` 內可讀 JSON，並以該 exact absolute path 記錄 `knownEnvironmentException.validationArtifactPath`；renderer 只核對已 qualified run-state、相同 canonical Executor／Reviewer 與已保存的機器資格結果。提前 blocker 由 failure evidence 解釋 null artifact timing，不需要未派發角色的 artifacts，仍交付固定八項、profiling、HTML 與 receipt；不得補造測試數字或時間。NuGet Phase -1 未建立 run-state 時明示「用量 observer 尚未啟動」。

採用狹義環境例外時，上述八項標題、名稱與順序不變；第 2 項必須顯示原始 passed／failed／skipped（failed 不得改成 0），第 3 項逐項列 MSSQL 未通過 assertions、exceptionCode、raw evidence links、MSSQL container internal-ready、非 MSSQL resource 狀態與 bookingapi 相依阻擋，第 4 項列 Reviewer 的 `knownEnvironmentExceptionReview`。報告結論固定顯示 `completed_with_known_environment_exception`，禁止使用「全部通過」或「MSSQL passed」。

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
