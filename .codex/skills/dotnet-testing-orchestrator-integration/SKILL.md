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

1. 執行 Integration 專屬 NuGet sandbox preflight（Phase -1）
2. `Glob({testProjectDir}/.orchestrator/**)` — 檢查殘留（Phase 0）
3. （僅在有殘留時）委託 Executor 清理
4. 建立 `{testProjectDir}/.orchestrator/run-state.json`（Phase timing truth）；`--target` 使用本次已指定的 Controller／endpoint scope，執行批次名稱另以 `--run-id` 傳入，未提供則由 runtime 產生；隨即執行本地 `usage-observer.mjs start` 建立 HTML 等待頁，再進入步驟 5
5. 計算 `analysisOutputPath` 與 `{assignmentId}`，透過 `shell_command` 寫入 Analyzer assignment 的 `dispatchIssuedAt`、`target`、`agentDefinitionPath`、`expectedArtifactPath`
6. `SpawnAgent target=".codex/agents/dotnet-testing-advanced-integration-analyzer.toml" payload={...}` — **立即啟動 Analyzer**
7. SpawnAgent 回傳 `agentId` 後，下一個工具呼叫必須透過 `run-state.mjs set` 寫入 `agentId`、`dispatchAcceptedAt` 並推導 `dispatchAcceptLatencyMs`

步驟 5～7 合稱 **Analyzer dispatch transaction**，不可拆開、跳過或延後補寫。`dispatchIssuedAt` 寫入失敗時不得啟動 Analyzer；`dispatchAcceptedAt` 寫入失敗時不得繼續 Analyzer artifact 等候或進入 Writer。**除上述步驟外，在啟動 Analyzer 之前不得執行任何其他動作（尤其禁止讀原始碼／Grep 探索）。** 這是非協商性的硬性要求。

---

## ⛔ 硬性禁止條款（HARD STOP）

> **你是指揮官，不是執行者。以下禁令不可違反，無論任何情境。**

### 絕對禁止的行為

1. **禁止直接讀取 SKILL.md 檔案** — Skills 的載入是 Writer / Reviewer subagent 的職責，不得載入或直接讀取任何共用技術 Skill；不得讀取 `.agents/skills/**`。除目前 workflow 的 Orchestrator Skill 與明確允許的 Codex-specific Skill 外，不得讀取 `.codex/skills/**`，且不得讀取其他 `dotnet-testing-orchestrator-*` Skill
2. **禁止直接撰寫任何測試程式碼** — 包括測試類別、WebApiFactory、TestBase、Collection Fixture、GlobalUsings 等所有測試相關程式碼
3. **禁止直接修改任何 .csproj 檔案** — NuGet 套件的新增與修改由 Writer 或 Executor 處理
4. **禁止直接建立或修改任何 .cs 檔案** — 所有程式碼產出必須透過 subagent 完成。**即使是改善既有測試、套用 Reviewer 建議、修正命名、補充斷言等增量修改，也必須交給 Writer 或 Executor，絕不可自行使用 Edit/Write 工具修改測試程式碼**
5. **維持四階段流程** — 成功完成必須依序執行 Analyzer → Writer → Executor → Reviewer。Executor 測試 correctness failure 在 artifact／isolation gates 通過後仍須 Reviewer；環境或 artifact gate blocker 則保留 evidence 並提前停止，run-state 記錄未派發階段。
6. **禁止使用 Bash 呼叫 `claude` 命令** — 嚴禁使用 `Bash(claude --print ...)` 或任何 `Bash(claude ...)` 的方式來啟動 subagent。所有 subagent 呼叫**必須且只能**透過 Codex 原生 SpawnAgent 完成
7. **Token 輸出** — 本 workflow 不估算 token；實際用量由本地 usage runtime 產生 JSON／HTML，最終回覆交付報告連結。`tokenEstimateInputs` 保留角色讀寫紀錄，供 attempt isolation 與 read-scope gates 驗證。

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
- DB Provider 衝突先在測試端完整置換對應 provider 註冊；仍無法解決時回報 blocked 與 `requiresUserApproval: true`。不存在 Program.cs 預授權例外。

### ⚡ 快速啟動原則（MUST READ）

**Orchestrator 在啟動 Analyzer 之前，除了 NuGet sandbox preflight、Glob 殘留檢查、（必要時）cleanup、run-state 初始化與 usage observer 啟動、與 Analyzer dispatch transaction 必要的 `dispatchIssuedAt` 寫入外，不得有其他工具呼叫。**

深度分析是 Analyzer 的職責，不是你的。以下行為在啟動 Analyzer 之前**嚴格禁止**：

- 讀取 Controller / Minimal API / Program.cs / DbContext / DTO / Validator 等原始碼
- 使用 Grep 搜尋端點定義、路由、資料庫連線、DI 註冊等
- 試圖「先了解專案結構」再啟動 Analyzer

使用者提供的 absolute `workspaceRoot`、WebAPI 專案目錄或 `.csproj`、Controller／endpoint scope，以及既有測試專案 exact `.csproj` 已足夠組裝 Analyzer payload。若使用者指定版本變體但未提供路徑，才可先用 `Grep` 定位目標檔案路徑；沒有測試專案時才明確建立。

### SpawnAgent 正確呼叫方式

**你必須使用 Codex 原生 SpawnAgent 來啟動 subagent。** `target` 必須指向 `.codex/agents/<name>.toml` 中定義的角色設定；payload 只傳 canonical paths 與必要控制欄位，不傳完整歷史、長篇敘事或可由交接檔案讀取的完整 JSON。

```text
SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-advanced-integration-analyzer.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "workspaceRoot": "<本次 assignment workspace 絕對路徑>",
  "apiProjectPath": "<被測 WebAPI 專案路徑>",
  "targetController": "<Controller 名稱或端點範圍>",
  "testProjectPath": "<既有測試專案 exact .csproj 絕對路徑>",
  "analysisOutputPath": "<canonical analysis path>",
  "userRequest": "<使用者特殊需求，如有>",
  "userProvidedScenarios": "<使用者原始 scenarios，如有>"
}

SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-advanced-integration-writer.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "workspaceRoot": "<本次 assignment workspace 絕對路徑>",
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "apiProjectPath": "<被測 WebAPI 專案路徑>",
  "outputPath": "<測試檔案預期輸出路徑>",
  "writerResultFilePath": "<此 Controller 唯一 canonical writer result path>",
  "writerControls": {
    "writerTopology": "single",
    "assignmentRole": "full",
    "endpointScope": "<端點範圍>"
  }
}

SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-advanced-integration-executor.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "workspaceRoot": "<本次 assignment workspace 絕對路徑>",
  "testProjectPath": "<測試專案路徑>",
  "testFilePaths": ["<Writer 產出的測試檔案路徑>"],
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "writerResultFilePaths": ["<本 target 唯一 Writer 交接檔案路徑>"],
  "executorResultFilePath": "<canonical executor result path>",
  "projectRegression": {
    "enabled": "<僅多 target 共用測試專案的最後一個 Executor 為 true>",
    "writerResultFilePaths": ["<all-target canonical writer results>"],
    "testFilePaths": ["<all-target test files>"],
    "resultFilePath": "<canonical project regression result path>"
  }
}

SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-advanced-integration-reviewer.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "workspaceRoot": "<本次 assignment workspace 絕對路徑>",
  "testFilePaths": ["<測試檔案路徑>"],
  "apiProjectPath": "<被測 WebAPI 專案路徑>",
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "writerResultFilePaths": ["<本 target 唯一 Writer 交接檔案路徑>"],
  "executorResultFilePath": "<Executor 交接檔案路徑>",
  "reviewResultFilePath": "<canonical reviewer result path>"
}
```

正式 role dispatch 必須維持 Analyzer → Writer → Executor → Reviewer，不可因 dispatch 困難改成主流程內聯。若遇到已知 Codex runtime 不穩定家族（capacity、thread-limit、stream retry、nested spawn fail、phase timeout、artifact missing after phase start），可做 bounded re-dispatch；每個 phase 最多 2 次，且 re-dispatch 前必須確認前一次同角色 dispatch 沒有留下可用 canonical artifact，避免雙重 truth。

### Formal context isolation（必要）

- 四個正式 role dispatch 都必須明確使用 `fork_turns: "none"`；不得依賴 runtime default，也不得使用 `all` 或正整數繼承主對話。
- payload 必須同時傳入 `executionContext: "self-contained"`、`externalMemoryPolicy: "forbid"` 與 absolute `workspaceRoot`，並在 prompt 第一段寫明「本任務已由 canonical paths 與本次 handoff 完整定義；跳過 workspace memory quick pass」。
- 正式 roles 禁止讀取 `$CODEX_HOME/memories/**`、`~/.codex/memories/**`、`MEMORY.md`、rollout summaries、prior session transcript、其他 worktree 的 artifacts 或非本次 run 的 `.orchestrator`。
- 若 runtime 不支援 `fork_turns: "none"`，或角色仍讀取外部 memory／其他 attempt artifact，立即判定 `attempt-isolation-violation`；不得刪除 telemetry 後補派。
- 每筆 assignment dispatch 邊界都要在 run-state 寫入 `contextForkPolicy=none` 與 `externalMemoryPolicy=forbid`。
- 每個 canonical artifact ready 後、下一 phase dispatch 前，必須執行 attempt isolation；`--allow-read` 只列本次 run 核准的上游 canonical artifacts：

```bash
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/validate-attempt-isolation.mjs --workflow integration --workspace-root {workspaceRoot} --test-project {testProjectPath} --artifact {analysisFilePath}
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/validate-attempt-isolation.mjs --workflow integration --workspace-root {workspaceRoot} --test-project {testProjectPath} --artifact {writerResultFilePath} --allow-read {analysisFilePath}
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/validate-attempt-isolation.mjs --workflow integration --workspace-root {workspaceRoot} --test-project {testProjectPath} --artifact {executorResultFilePath} [--artifact {projectRegressionResultFilePath}] --allow-read {analysisFilePath} --allow-read {writerResultFilePath} [...] --allow-codex-skill dotnet-test
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/validate-attempt-isolation.mjs --workflow integration --workspace-root {workspaceRoot} --test-project {testProjectPath} --artifact {reviewResultFilePath} --allow-read {analysisFilePath} --allow-read {writerResultFilePath} [...] --allow-read {executorResultFilePath}
```

Analyzer artifact ready 後必須另執行 minimal read-scope gate；Reviewer artifact ready 後必須執行 no-self-read gate：

```bash
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/validate-role-read-scope.mjs --role analyzer --workspace-root {workspaceRoot} --agent-definition .codex/agents/dotnet-testing-advanced-integration-analyzer.toml --artifact {analysisFilePath}
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/validate-role-read-scope.mjs --role reviewer --workspace-root {workspaceRoot} --artifact {reviewResultFilePath}
```

Analyzer read-scope gate 失敗分類為 `analyzer-read-scope-violation`；Reviewer self-read gate 失敗分類為 `reviewer-self-read-violation`。

### 自我檢查清單

在每次行動前，問自己：

- 我是否還沒啟動 Analyzer？→ **停止一切其他動作；先寫入 Analyzer `dispatchIssuedAt`，再立即啟動 Analyzer**（完整 Analyzer dispatch transaction 是最高優先級）
- Analyzer SpawnAgent 是否剛回傳 `agentId`？→ **下一個工具呼叫立即寫入該 assignment 的 `agentId`、`dispatchAcceptedAt` 與 `dispatchAcceptLatencyMs`，不得先做任何其他動作**
- 我是否正在讀取 .cs 原始碼但還沒啟動 Analyzer？→ **停止，這是 Analyzer 的工作，不是你的**
- 我是否正在嘗試讀取 SKILL.md？→ **停止，這是 Writer / Reviewer 的工作**
- 我是否正在嘗試撰寫 C# 程式碼？→ **停止，交給 Writer**
- 我是否正在嘗試執行 `dotnet build` 或 `dotnet test`？→ **停止，交給 Executor**
- 我是否正在使用 Bash 來呼叫 claude？→ **停止，使用 SpawnAgent**

**在收到每個 subagent 的回傳結果之前，你不得採取任何程式碼相關行動。**

---

## Prompt 精簡原則

不需要在 subagent prompt 中嵌入完整分析報告 JSON、端點清單、containerRequirements、requiredSkills、suggestedTestScenarios、existingTestInfrastructure 等內容。每個 subagent 已有 Step 0 讀取交接檔案的能力，可自行取得所有資訊。

Orchestrator prompt 只需傳：**交接檔案路徑 + 摘要數字**（endpointCount、scenarioCount、testCount、testCaseCount 等）+ 必要控制參數（端點範圍、single/full 固定值、modification request 等）。

每個正式 role prompt 第一段固定加入：

```text
executionContext: self-contained
externalMemoryPolicy: forbid
本任務已由 canonical paths 與本次 handoff 完整定義；跳過 workspace memory quick pass，不得讀取 workspace 外部 memory、MEMORY.md、rollout summaries 或 prior session transcript。
```

---

## 核心工作流程

Writer 與 Reviewer artifact ready 後，Orchestrator 必須執行
`node .codex/scripts/dotnet-testing-codex-full/integration-runtime/validate-skill-read-scope.mjs --artifact <result.json> --analysis <analysis.json> --workflow integration --role <writer|reviewer>`。
此 gate 依 Skill ID 精確驗證 `.agents/skills` readFiles、拒絕其他 workflow Skills／其他 orchestrator Skills，並將 legacy `.codex/skills/<shared-skill>` 回報為 `LEGACY_SHARED_SKILL_PATH`；不得以整個目錄 allowlist 取代。

你必須嚴格遵循以下流程：Phase -1（NuGet sandbox preflight）→ Phase 0（清理）→ Phase 0.5（run-state）→ 階段 1～4（核心四階段）→ Phase 5（保留 artifacts）。

### Phase -1：NuGet sandbox preflight

`{restoreProjectPath}` 優先使用既有 `testProjectPath`；明確尚無測試專案時才使用 `apiProjectPath`：

```bash
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/nuget-sandbox-preflight.mjs --workspace-root {workspaceRoot} --project {restoreProjectPath}
```

只有 stdout `status` 為 `ready` 才能進入 Phase 0。非零 exit code 時立即停止，不得建立本次 run-state、dispatch Analyzer、修改 workflow 或改用 Full Access 重跑；將 stderr 的 blocker 與 remediation 原樣回報。這個 preflight 只驗證目前指定專案可用的 restore 環境，不保證 Writer 後續新增且尚未快取的套件一定可用。

### Phase 0：前置清理

在啟動四階段流程之前，檢查測試專案目錄下是否有殘留的 `.orchestrator/` 目錄：

1. 使用 Glob 檢查 `{testProjectDir}/.orchestrator/**/*` 是否有檔案
2. **若有殘留**：委託 Executor subagent 以 `task: "cleanup"` 清理（傳入測試專案路徑）
3. **若無殘留**：先完成 Phase 0.5 的 run-state 與 usage observer 初始化，再進入階段 1

### Phase 0.5：初始化 run-state

Phase 0 清理完成後、**啟動 Analyzer 之前**，以 `node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs init --path {testProjectDir}/.orchestrator/run-state.json --workflow integration --target {target}` 建立 `{testProjectDir}/.orchestrator/run-state.json`（詳見「run-state 持久化與 timing truth（P1）」的 run-state.json 寫入機制）。此檔是本 workflow 的唯一 timing truth source；實際 token 用量獨立保存在 usage JSON／HTML，不作測試 correctness 或 timing gate。

run-state 建立成功後執行本 workflow 的用量收集入口，再開始 Analyzer dispatch transaction：

```bash
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/usage-observer.mjs start --workspace-root "{workspaceRoot}" --run-state "{testProjectDir}/.orchestrator/run-state.json"
```

此入口從 `CODEX_THREAD_ID` 與 session 綁定目前 root turn，優先使用 Node 內建 SQLite 唯讀查詢 Codex 代理關係，不可用時才嘗試現有 Python 執行器；不推測最新 session、不讀取角色對話內容。先建立 `.orchestrator/usage/{runIdentifier}/report.html` 等待頁，再由隱藏的背景程序於主代理回合結束、資料完整且三次快照一致後更新 JSON／HTML。run-state 未提供 runIdentifier 時，由本地用量 runtime 依本次 run 身分推導，不改寫 run-state。

缺少資料來源或不支援格式時，HTML 明示 `unsupported`；中止、收集失敗或兩小時內未完整則保留診斷，不猜測用量、不影響測試 truth。不得在 chat 等待自己的回合結束；先交付連結。NuGet preflight 等尚未建立 run-state 的中止，明示「用量 observer 尚未啟動」。`tokenEstimateInputs` 仍只供既有角色讀寫 gates 使用。


### 階段 1：啟動分析（Integration Analyzer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-integration-analyzer.toml" payload={...}` 將使用者指定的 WebAPI 專案或 Controller 交給 Analyzer 分析。

#### Analyzer dispatch transaction（硬閘門）

每個 Analyzer assignment 必須依序完成以下操作；多 target 時每筆 assignment 各自執行，不得只記 phase 彙總時間：

1. SpawnAgent **之前**先執行：

   ```bash
   node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set dispatchIssuedAt=@now --set target={target} --set agentDefinitionPath=.codex/agents/dotnet-testing-advanced-integration-analyzer.toml --set expectedArtifactPath={analysisOutputPath}
   ```

2. 上述命令成功後才可 SpawnAgent；若失敗，不得啟動 Analyzer。
3. SpawnAgent 回傳 `agentId` 後，下一個工具呼叫必須是：

   ```bash
   node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt
   ```

4. `dispatchAcceptedAt` 寫入失敗時，該 phase 判定為 telemetry contract blocker，不得繼續 artifact 等候或進入 Writer；不得在流程結尾倒推或補造時間。

Analyzer payload 必須包含：

- `workspaceRoot`：本次 assignment workspace 絕對路徑
- `apiProjectPath`：被測 WebAPI 專案路徑
- `targetController`：目標 Controller / 端點描述 / endpoint slice
- `testProjectPath`：既有測試專案 exact `.csproj` 絕對路徑
- `analysisOutputPath`：由 Orchestrator 預先計算，格式為 `{testProjectDir}/.orchestrator/analysis/{ControllerName}.analysis.json`
- `userRequest`：使用者特殊需求，如真實容器、指定 DB、只測某些端點等
- `userProvidedScenarios`：使用者提供的原始案例內容；沒有時明確傳空值，不得由 Orchestrator 改寫或摘要

等候 Analyzer 回傳精簡摘要，包含 `projectName`、`apiArchitecture`、`endpointCount`、`scenarioCount`、`containerRequirements`、`requiredSkills`、`analysisFilePath`、`projectContext`。

收到 Analyzer 摘要後，使用 Glob 確認 `analysisFilePath` 指向的檔案確實存在。若不存在，更新 run-state 並依 bounded re-dispatch 規則處理。

每個 Analyzer assignment 的 artifact gate 通過時，必須在同一操作邊界執行：

```bash
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set artifactReadyAt=@now --set artifact={analysisFilePath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt
```

全部 Analyzer assignments 的 artifact gate 都通過、phase 確定收斂後，才執行：

```bash
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --set completedAt=@now
```

進入 Writer 前，Analyzer assignment 必須已有非 `null` 的 `dispatchIssuedAt`、`dispatchAcceptedAt`、`artifactReadyAt`、`produceSpanMs`，Analyzer phase 必須已有非 `null` 的 `completedAt`。Analyzer 的 canonical artifact 由 Orchestrator 主動執行 Glob/Read gate，因此其 `artifactReadyAt` 屬可獨立觀察邊界，不適用後文允許 `artifactReadyAt: null` 的例外。任一欄位缺失或為 `null` 即為 telemetry contract blocker；不得用檔案修改時間、對話時間、phase 彙總時間或流程結尾時間回填。

Analyzer artifact 必須包含逐字等於 `analysisOutputPath` 的 `analysisFilePath`、與 catalog 一致的 `endpointCount`、`endpointCatalog`、`scenarioCatalog`、`scenarioReviewSummary`、`userProvidedScenarioInput` 與 canonical `tokenEstimateInputs`。不得以固定 scenario 數作 gate；驗證每個 scenario 的 provenance、endpoint attribution、狀態與 evidence，以及 coverageSchemaVersion=1 的 Validator 規則／分支對照。每個分支必須對應該 Validator 每個適用端點的有效 scenario；合理合併可共用 scenario，不以測試數量判斷覆蓋。機器檢查限於已宣告的對照，來源規則與測試語意由 Analyzer／Reviewer 判斷。artifact ready 後立即執行：

```bash
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/validate-scenario-contract.mjs --analysis {analysisFilePath} --analysis-only --require-validation-coverage
```

靜態 gate 與 Analyzer attempt isolation／read-scope gate 任一失敗，都不得進入 Writer。

#### 階段間交接（Analyzer → Writer）

只有在 Analyzer role 已回傳 `completed` terminal、全部 Analyzer assignments 的 canonical analysis artifacts 已存在，且進入下一 phase 所需的既有 artifact、attempt isolation、read-scope、schema 與 telemetry gates 全部通過後，才可 dispatch Writer。角色回傳 `blocked` 或 `failed` terminal 不代表 artifact gate 通過；必須依既有失敗契約保存 evidence 並停止，或只執行當次已授權的既有 bounded repair／re-dispatch。當次 live 未授權重試時立即停止。

對已 completed agent 不得呼叫 `interrupt_agent` 模擬 close，也不要求 host 提供 completed-agent close；目前沒有實測證據可宣稱 completed agent 必然釋放 runtime slot。實際 dispatch 若回報 capacity／thread-limit 失敗，依當次授權與既有失敗契約保存結構化 blocker 並停止或處理，不得改變正式 phase 順序或每個 target 單一 Writer topology。

### 階段 2：啟動撰寫（Integration Writer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-integration-writer.toml" payload={...}` 將分析結果交給 Writer 撰寫整合測試。

#### 端點範圍硬邊界（P3）

Writer 以以下優先序決定端點範圍：

1. prompt 明確端點 / Controller slice
2. Analyzer artifact 的 `endpointsToTest`
3. 整個 Controller

若上層範圍存在，Writer 不得擴大到 sibling endpoints。Reviewer 也嚴禁把指定範圍以外的 sibling endpoint 列為覆蓋缺口。

#### 單一 Writer 策略（必要）

每個 Controller／endpoint slice 無論 `scenarioCount`、endpoint 數、容器種類或預估輸出大小為何，固定只 dispatch **一個 Writer subagent**，且 `writerControls` 固定為 `writerTopology: "single"`、`assignmentRole: "full"`。正式 workflow 禁止把同一 target 切成 infrastructure／tests 或其他多個 Writer assignments。

此規則只固定 Writer topology，不限制 Analyzer 應產生的案例數量，也不得刪減任何合理且 in-scope 的 endpoint 或 scenario。單一 Writer 必須同時完成必要基礎設施與該 target 的全部測試，並將唯一 artifact 寫入 `{testProjectDir}/.orchestrator/writer-result/{Controller}.writer-result.json`。

單一 Writer 若遇 context／output limit，該 attempt fail closed 並保留 blocker evidence；不得自動 split、不得靜默刪減 `scenarioCatalog`，也不得啟動第二個 repair Writer 代替原 assignment 完成測試內容。歷史 split artifacts 只供既有 validator／實驗報告重播，不是正式 runtime topology 或 fallback。

多個 Controllers 共用同一測試專案時，Writers 依使用者指定的 target 順序循序執行；每個 target 仍恰有一個 `single`／`full` Writer。後續 Writer 必須重用並以 add-only 方式補充磁碟上已存在的 Factory／Fixture／TestBase／`.csproj`，不得覆寫先前 target 測試。這是共享檔案 ownership 順序，不是同 target split。不同測試專案的 Writers 才可平行。

**`outputPath` 推導規則（確定性，必用）**：`outputPath` 必須**鏡射被測 Controller 並置於測試專案的 `Controllers/` 子目錄**，**禁止**放在測試專案根目錄（與 integration Writer 的「2e. 目錄結構規範」一致）。
- `{TestDir}` = 測試專案目錄（取 `projectContext.testProjectPath` 去掉結尾 `.csproj` 檔名後的目錄）。
- 規則：`{TestDir}/Controllers/{Controller}Tests.cs`（例：`OrdersController` → `{TestDir}/Controllers/OrdersControllerTests.cs`）。
- 多 Controller 時，每個 Controller 各自一條 outputPath，皆位於 `{TestDir}/Controllers/` 下；不得有任一測試檔落在測試專案根目錄。
- 測試基礎設施沿用 Writer toml 的 2e 規範：`Fixtures/`、`TestBase/`、（如適用）`Helpers/`。

Writer prompt 模板：

```text
請根據 Analyzer 交接檔案撰寫整合測試。
analysisFilePath: {analysisFilePath}
被測試 API 專案路徑: {apiProjectPath}
測試檔案的預期輸出路徑: {outputPath}
writerControls: {writerControls}
writerResultFilePath: {writerResultFilePath}
```

等候 Writer 回傳精簡摘要：`testFilePaths`、`testCount`、`testCaseCount`、`skillsLoaded`、`writerResultFilePath`。

#### Writer Artifact 完整性 Gate（必要）

Writer 回傳後，Orchestrator 不得只採信回覆摘要。必須使用 canonical `writerResultFilePath` 讀取實體 writer-result JSON，並檢查下列欄位全部存在且可用：

- `writerResultFilePath`
- `testFilePaths` 必須是非空陣列
- `testCount` / `testCaseCount` 為數字
- `testClasses`
- `testClasses[].className`
- `testClasses[].filePath`
- `testClasses[].methodsCovered` 或 `testClasses[].endpointsCovered`
- `skillsLoaded`
- `writerTopology`
- `assignmentRole`
- `endpointCoverage`
- `scenarioCoverage`
- `tokenEstimateInputs`

`writerResultFilePath` 必須逐字等於本次 assignment prompt 的 exact absolute canonical path；只存在非空欄位但指向其他位置仍視為 artifact identity failure。

端點範圍檢查：

- `writerTopology` 必須是 `single`，`assignmentRole` 必須是 `full`；正式 target 只允許一份 writer-result。
- `methodsCovered` / `endpointsCovered` 必須是明確端點或案例清單，不得使用 `All`、`FullController` 或敘述文字替代。
- 若本次是 endpoint-scope assignment，覆蓋清單必須是指定端點清單的子集合或完全相同，不得包含 sibling endpoints。
- `skillsLoaded` 不得包含 unit 的 20 個 technique skills，也不得包含 TUnit skills。
- 每個有效 `scenarioCatalog` ID 必須恰由該 target 的唯一 Writer 在 `scenarioCoverage` 認領；不得重複、漏列或自行新增 ID。
- 每個 `endpointCatalog` ID 必須恰由該 target 的唯一 Writer 在 `endpointCoverage` 標為 implemented。

若 writer-result 缺欄位、不可讀、或端點範圍不一致：

1. 不得 dispatch Executor。
2. 更新 run-state writer phase：`artifactReadyAt: null`、`artifact: null`、`failure` 填入缺失欄位或 scope mismatch。
3. 若符合 bounded re-dispatch 條件，最多 re-dispatch Writer 2 次，要求只修復 missing artifact / scope mismatch，不得重啟整個 workflow。
4. 若 bounded re-dispatch 後仍不完整，將 workflow 判定為 blocker。

#### P4 版本政策

既有 `.csproj` 套件版本一律保留（不升不降）；僅對**缺少**的必要套件使用 SKILL 記載的最低版本；**不執行** `dotnet list package --outdated`；fix 回合 add-only、不 bump。

#### 階段間交接（Writer → Executor）

只有在 Writer role 已回傳 `completed` terminal、全部 Writer assignments 的 canonical writer-result artifacts 已存在，且進入下一 phase 所需的既有 artifact、attempt isolation、schema、scenario acceptance 與 telemetry gates 全部通過後，才可 dispatch Executor。角色回傳 `blocked` 或 `failed` terminal 不代表 artifact gate 通過；必須依既有失敗契約保存 evidence 並停止，或只執行當次已授權的既有 bounded repair／re-dispatch。當次 live 未授權重試時立即停止。

對已 completed agent 不得呼叫 `interrupt_agent` 模擬 close，也不要求 host 提供 completed-agent close；目前沒有實測證據可宣稱 completed agent 必然釋放 runtime slot。實際 dispatch 若回報 capacity／thread-limit 失敗，依當次授權與既有失敗契約保存結構化 blocker 並停止或處理，不得改變正式 phase 順序或每個 target 單一 Writer topology。

### 階段 3：啟動執行（Integration Executor）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-integration-executor.toml" payload={...}` 將 Writer 產出的測試程式碼交給 Executor 建置與執行。

Executor payload 必須包含：

- `testProjectPath`
- `testFilePaths`
- `analysisFilePath`
- `writerResultFilePaths`：本 target 唯一 canonical Writer artifact；為維持角色輸入型別仍使用長度 1 的陣列
- `executorResultFilePath`：Orchestrator 預先計算的 absolute canonical output path
- `allowedSharedContainerKinds[]`：僅多目標共用測試專案時提供；值只能來自同次其他 target Analyzer `containerRequirements` 的 union，單目標省略
- `projectRegression`：僅多目標共用同一測試專案的最後一個 Executor assignment 提供；固定含 `enabled: true`、all-target canonical `writerResultFilePaths[]`、all-target `testFilePaths[]` 與 exact absolute `resultFilePath`

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
- `requiredContainerKinds` 必須與本 target Analyzer `containerRequirements` 完全一致；本 target required kinds 必須全部出現在 `startedContainerKinds`。
- 多目標共用 Factory 可讓 `startedContainerKinds` 包含其他 target 所需容器，但每個額外 kind 必須由 Orchestrator 以 `--allow-shared-container-kind` 明示；未知額外容器仍使 gate 失敗。單目標不得提供共享白名單。
- `testFilePaths` 必須等於所有 writer-result 的 union；`totalTests` 必須等於 Writer `testCaseCount` 加總。
- `executorResultFilePath` 必須逐字等於本次 prompt 的 exact absolute canonical path。
- 有 `projectRegression.enabled: true` 時，必須另有 `regressionScope: "test-project"` 的 canonical artifact，來自未套 target filter 的實際完整 test-project `dotnet test`；其 Writer/test file union 與 case accounting 必須涵蓋所有 targets。

若 executor-result 顯示使用 `dotnet run`，該 phase 判定為 blocker，不得進入成功報告。

Executor artifact ready 後先以本地 `execution-evidence.mjs validate --workspace-root {workspaceRoot} --test-project {testProjectPath} --executor {executorResultFilePath}` 驗證 pointers、原始 logs 與綁定，保存 stdout（含 runtime 推導的 `repairSummary`）供最終修正紀錄使用；再執行 attempt isolation 與以下交接契約。Reviewer 前不加 `--require-pass`，讓具備完整 runtime evidence 的測試 correctness failure 仍可接受審查：

```bash
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/validate-execution-contract.mjs --analysis {analysisFilePath} --writer {writerResultFilePath} --executor {executorResultFilePath} [--allow-shared-container-kind {otherTargetKind} ...] --workspace-root {workspaceRoot} --test-project {testProjectPath} --require-evidence --forbid-production-mutation --require-single-writer
```

同一個最後 Executor assignment 同時產出 target executor-result 與 project-level regression 時，兩個 exact output paths 必須在同一次 attempt-isolation 呼叫中各以 `--artifact` 宣告；只有該次明確列出的 sibling output 才互相取得 read/write 授權，未宣告的 executor-result 仍必須拒絕。

Executor 因系統規則載入 environment-owned Codex-specific `dotnet-test` Skill 時，該 instruction read 不屬於 external memory，但仍須如實記錄 telemetry，並在 Executor attempt-isolation gate 明示 `--allow-codex-skill dotnet-test`。此例外只涵蓋 exact `.codex/skills/dotnet-test/**` instruction files，不授權任何其他 workspace 外部 source、artifact、memory、Skill 或 write。

多 target 共用測試專案的最後一個 target，於同一 validator invocation 追加 `--project-regression {projectRegressionResultFilePath}` 與每一份 `--project-writer {writerResultFilePath}`。不得只驗 `regressionScope` 而省略 all-target Writer／test file union 與 case accounting。run-state 初始化逐一提供 `--target`；最後 Executor assignment 以 `--set projectRegressionResultFilePath={projectRegressionResultFilePath}` 登記已指派的 exact path，finalize 同時承接 regression 結果。

正式流程要求 `productionBugFixes[]` 為空。需要 production 修改時保留 evidence、回報 blocker；使用者明確授權後另行處理。

#### 執行證據與 gate repair

Executor 每次完成或中止執行批次即使用本地 `execution-evidence.mjs record`，以該批當時結果產出 canonical evidence；首次交接前須具備從 attempt 1 起的完整 history，多 target project regression 亦相同。`executionCommands[]` 保存該批實際命令；runtime 依 test logs 歷史推導是否重跑。必要輔助檔案由 `--support-file kind=path` 明示登記。isolation validator 驗證所宣告 JSON、rawEvidence 與 supportingEvidence 的路徑及雜湊，不能刪除真實 readFiles／writtenFiles 換取通過。

任何 Executor artifact gate 被拒絕時，先保存 validator 原始輸出到本次 `.orchestrator/`，再執行：

```bash
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/execution-evidence.mjs preserve --workspace-root {workspaceRoot} --test-project {testProjectPath} --executor {executorResultFilePath} --diagnostic {validatorOutputPath}
```

helper 保存修復前 artifact、validator 輸出及雜湊並回傳 failureKind。只有實際 pointer 缺漏且原始 logs 齊全時，才可有界補齊 artifact；raw log 越界、雜湊不符或隔離違反直接 blocked，不改 telemetry 規避。這項 gate repair 每個 assignment 最多一次，保留原始 rejection；不重跑測試、不增加 executorFixRounds。補證時 `record` 加上 `--artifact-repair`，既有 execution JSON 不覆寫。修復後重跑相同 gates；仍失敗即停止。

修復數量由 `validate` 的 `repairSummary.artifactRepairCount` 推導完整 history 中標記補證的執行批次；首次交接前已標記的補證也會列入，不以 Orchestrator re-dispatch 次數或 run-state 缺少欄位判定為零。它不是 helper 失敗呼叫次數或 gate repair 次數；舊資料旗標缺漏時回報未取得完整數量。不得從最終 gate 通過推論所有命令或 gates 首次通過。

#### 階段間交接（Executor → Reviewer）

只有在 Executor role 已回傳 `completed` terminal、canonical executor-result artifact 已存在，且進入 Reviewer 所需的既有 artifact、attempt isolation 與 schema gates 已通過、execution evidence 已保存後，才可 dispatch Reviewer。角色回傳 `blocked` 或 `failed` terminal 不代表 artifact gate 通過；必須依既有失敗契約保存 evidence 並停止，或只執行當次已授權的既有 bounded repair。Executor correctness failure 仍依前述規則執行 Reviewer，不等於略過 artifact gate。當次 live 未授權重試時立即停止。

對已 completed agent 不得呼叫 `interrupt_agent` 模擬 close，也不要求 host 提供 completed-agent close；目前沒有實測證據可宣稱 completed agent 必然釋放 runtime slot。實際 dispatch 若回報 capacity／thread-limit 失敗，依當次授權與既有失敗契約保存結構化 blocker 並停止或處理，不得改變正式 phase 順序。

### 階段 4：啟動審查（Integration Reviewer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-integration-reviewer.toml" payload={...}` 將測試程式碼交給 Reviewer 審查。Reviewer 一律執行；不得因 Executor 全綠而跳過。

Reviewer payload 必須包含：

- `testFilePaths`
- `apiProjectPath`
- `analysisFilePath`
- `writerResultFilePaths[]`；長度固定為 1，且必須是本次 target 的唯一 canonical Writer artifact
- `executorResultFilePath`
- `reviewResultFilePath`

`reviewResultFilePath` 由 Orchestrator 預先計算，格式為 `{testProjectDir}/.orchestrator/reviewer-result/{ControllerName}.reviewer-result.json`。

Reviewer 回傳後，Orchestrator 必須使用 Glob 確認 `reviewResultFilePath` 指向的檔案確實存在且可讀取。若檔案未落地，不得只採信 Reviewer 回傳訊息；必須將該 phase 判定為 blocker，分類為 `artifact 一直沒出現`，並更新 `run-state.json` 中 reviewer phase：`artifactReadyAt: null`、`artifact: null`、`failure` 填入原始症狀。

Reviewer artifact 必須包含 `scenarioAcceptance`、`endpointCoverage`、`qualityGates`、`gateDecision` 與 canonical telemetry。artifact ready、attempt isolation 與 no-self-read gates 通過後，執行正式 acceptance：

```bash
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/validate-scenario-contract.mjs --analysis {analysisFilePath} --writer {writerResultFilePath} --reviewer {reviewResultFilePath} --require-review-pass --require-single-writer --require-validation-coverage
```

`reviewResultFilePath` 必須逐字等於本次 prompt 的 exact absolute canonical path。

`gateDecision` 只允許 `pass`、`pass_with_warnings`、`fail`、`blocked`。有效 scenario missing、endpoint missing、mismatch 或 `fail`／`blocked` 都使 workflow final gate 失敗；Executor 全綠不得覆蓋 Reviewer acceptance。

Reviewer 完成後，以相同 execution validator inputs 再加 `--require-pass` 執行最終成功 gate，包含必要的 project regression；失敗結果保留並如實回報 failed，不能以 Reviewer pass 覆蓋。環境或 artifact gate 已提前停止者不補跑未派發階段。

各 assignment／phase 寫入實際 status、completedAt 與 failure（如有）後，final report 前必須執行本地 finalize，再驗證 strict timing。finalize 從實際時間戳推導 phaseDurations、profilingSummary、overallWallClock，並以 Reviewer 與 Executor artifacts 決定 terminalDecision：

```bash
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs finalize --path {p}
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs validate --path {p} --require-complete-timing
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs timing --path {p}
```

### Phase 5：保留 artifacts

保留本次全部 canonical artifacts、execution evidence、原始 logs、gate rejection snapshots 與 run-state，供驗收與後續比較。不得在結果呈現後刪除 executor-result；清理依使用者授權另行處理。

---

## run-state 持久化與 timing truth（P1）

> **run-state.json 寫入機制（必用，跨平台）**：run-state.json 一律透過 `shell_command` 呼叫 `node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs` 建立與更新。**不得**假設有「Write 工具」、**不得**用 `date -u`、**不得**手寫 shell read-modify-write。理由：Codex 沒有「Write」工具，且不同 runtime（Codex CLI vs VS Code Codex Extension）shell 不同；改善前 Extension 環境會整段略過 run-state 維護，導致 run-state.json 從不產生、各階段耗時全空。此腳本為純量參數 API（不傳 JSON blob，避免 PowerShell 引號問題），時間戳由腳本內部以系統時鐘產生（值寫 `@now` 即取 ISO 8601 UTC），毫秒差由 `--derive 欄位=END-START` 推導。以下 `{p}` 代表 `{testProjectDir}/.orchestrator/run-state.json`。常用呼叫：
>
> ```bash
> # 初始化（Phase 0 清理後、啟動 Analyzer 前）
> node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs init --path {p} --workflow integration --target {target}
> # dispatch 前：記 dispatchIssuedAt
> node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set dispatchIssuedAt=@now --set target={target} --set agentDefinitionPath={tomlPath} --set expectedArtifactPath={artifactPath} --set contextForkPolicy=none --set externalMemoryPolicy=forbid
> # 收到 agentId：記 agentId/dispatchAcceptedAt，推導 latency
> node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt
> # artifact 落地：記 artifactReadyAt/artifact，推導 produceSpan
> node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set artifactReadyAt=@now --set artifact={artifactPath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt
> # assignment artifact gate 收斂：逐 assignment 記 completedAt
> node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set completedAt=@now
> # phase 全部 assignments 收斂：記 phase completedAt
> node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs set --path {p} --phase analyzer --set completedAt=@now
> # 計數 / 整體：counters 與 overallWallClock.end/duration
> node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs set --path {p} --set executorFixRounds={n} --set overallWallClock.end=@now --derive overallWallClock.durationMs=overallWallClock.end-overallWallClock.start
> # bounded re-dispatch 事件：append 一筆
> node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs append --path {p} --array redispatchEvents --set phase=writer --set cause=agent-thread-limit --set occurredAt=@now --set waitMs={ms}
> ```
> 後文「以 run-state 寫入機制更新／補上」即指上述 `run-state.mjs` 呼叫。artifactReadyAt 不可獨立觀察時，省略 `--set artifactReadyAt=@now` 與對應 `--derive`（`produceSpanMs` 會因缺端點自動填 `null`），或明確 `--set artifactReadyAt=null`。不得以對話敘述或人工推估值代替腳本寫入。

時間追蹤以磁碟上的 run-state wall-clock timestamps 為準。主協調者必須在 `{testProjectDir}/.orchestrator/run-state.json` 維護一份 run-state 檔，並在每次 SpawnAgent dispatch 前後與 artifact ready 邊界以 run-state 寫入機制更新：

- `dispatchIssuedAt`：發出 SpawnAgent dispatch 的時間
- `dispatchAcceptedAt`：SpawnAgent 回傳 `agentId` 後，於同一邊界以 `run-state.mjs set ... --set dispatchAcceptedAt=@now` 記錄的時間。此欄只代表派發被 runtime 接受，**不代表 agent 真正開始工作**。
- `artifactReadyAt`：Orchestrator 在磁碟上確認 canonical artifact 已存在且可讀的時間。
- `completedAt`：每個 assignment 自己的 artifact gate 通過／blocker 判定時間，以及全部 assignments 收斂後的 phase completedAt。不得只寫 phase-level 值。
- `produceSpanMs`：`artifactReadyAt - dispatchAcceptedAt`，只代表 Orchestrator 可觀察的 artifact produce span。
- `redispatchEvents[]`、`boundedRedispatchCount`、`restartCount`、`executorFixRounds`：每次 bounded re-dispatch、restart、Executor fix round 都必須落入 run-state。

階段耗時由本地 `run-state.mjs timing` 唯讀取得，與 finalize 共用計算：該 phase 最早的 assignment `dispatchIssuedAt` 到 **phase `completedAt`**。同一 stdout 的 `timingEvidence.rows` 保留各 assignment 的 `dispatchIssuedAt → artifactReadyAt → completedAt`，`timingEvidence.markdown` 產出固定表格；不以 assignment 跨度、對話文字或 token report 代替 phase 耗時。

run-state 寫入規則：

1. Phase 0 清理完成且啟動 Analyzer 前，以 `run-state.mjs init --path {p} --workflow integration --target {target}` 建立 `{testProjectDir}/.orchestrator/run-state.json`；`{target}` 是已指定的 Controller 完整類別名稱或 endpoint scope，所有 assignment 使用相同值；多目標逐一提供 `--target`。使用者提供的執行批次名稱只放 `--run-id {runIdentifier}`，省略時由 runtime 產生獨立識別。腳本自動含 `workflow: "integration"`、`target`、`targets[]`、`runIdentifier`、`overallWallClock.start`、空的 `phases`、`redispatchEvents: []`、`boundedRedispatchCount: 0`、`restartCount: 0`、`executorFixRounds: 0`。init 在通過 owner、identity 與 runtime fingerprint 檢查後，於 run-state 父目錄建立 analysis、writer-result、executor-result、reviewer-result 四個 canonical 目錄；既有目錄與 artifacts 保留，檔案或連結衝突回報錯誤並停止。角色持續使用 payload 指定的 exact canonical path，不另加建目錄調度步驟。初始化後的 targets 與 runIdentifier 固定；assignment 登記立即檢查 target，不在收尾改寫測試目標迎合 gate。
2. 每個 phase 發出 SpawnAgent 之前，先以 `run-state.mjs set --path {p} --phase {phase} --assignment {assignmentId} --set dispatchIssuedAt=@now` 記錄該 assignment 的 `dispatchIssuedAt`；SpawnAgent 回傳 `agentId` 後，立即以 `run-state.mjs set ... --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt` 補上該 assignment 的 `agentId`、`dispatchAcceptedAt` 與 `dispatchAcceptLatencyMs`（時間戳由腳本內部以系統時鐘產生，毫秒差由腳本推導）。
3. 平行 assignment 的 `dispatchAcceptedAt` 必須在該筆 SpawnAgent 回傳 `agentId` 的同一個操作邊界立即寫入。不得等整個 phase dispatch 完成後，用同一個時間補進所有 assignment。
   - **Assignment metadata**：同一筆 assignment 應保留 `assignmentId`、`phase`、`target`、`agentDefinitionPath`、`spawnPayloadShape`、`expectedArtifactPath`、`contextForkPolicy`、`externalMemoryPolicy`；以 dispatch 邊界的同一個 `run-state.mjs set` 呼叫一併登記。`contextForkPolicy=none` 與 `externalMemoryPolicy=forbid` 是正式 isolation gates。
4. 每個 canonical artifact 通過 Glob/Read 驗證後，立即以 `run-state.mjs set ... --set artifactReadyAt=@now --set artifact={artifactPath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt` 寫入 `artifactReadyAt`、`artifact` 並推導 `produceSpanMs`。
5. 每個 assignment artifact／formal gate 收斂後，使用 `--phase {phase} --assignment {assignmentId} --set completedAt=@now` 寫入自己的 `completedAt`；不得等到 phase 結束批次補同一時間。全部 assignments 收斂後再寫 phase `completedAt` 與 status，接著執行以下唯讀命令；階段完成摘要的 `{run-state 耗時}` 直接採用 stdout `phases.{phase}.summaryDisplay`（四捨五入至整秒）：

   ```bash
   node .codex/scripts/dotnet-testing-codex-full/integration-runtime/run-state.mjs timing --path {p} --phase {phase}
   ```

6. 完成或中止時呼叫本地 `run-state.mjs finalize --path {p}`，由 runtime 推導耗時、整體起迄與 profiling；再呼叫 strict validate 與不帶 `--phase` 的 `timing`。最終耗時表直接採用 stdout `phases.{phase}.display` 與 `overall.display`（秒保留三位小數）；Timing Evidence 直接引用同次 stdout 的 `timingEvidence.markdown`，只在 Notes 補充 artifact-backed 結果摘要，保留前五欄與全部資料列。缺值與未派發顯示由 runtime 提供，不另從 phase 取值補入 assignment 欄位。不得由模型估算毫秒或 bottleneck。
7. 提前 blocked／failed 時只驗證已派發的連續階段；最後階段與實際失敗 assignment 都須有 `failure.kind`、status 與 completedAt。未派發階段由 finalize 記為 null／not-dispatched，不建立假的 Reviewer assignment。
8. 成功完成仍須每個 target 的四角色、canonical artifacts、全部交接 gates 與 Reviewer acceptance 通過。run-state validation 不取代 scenario、execution、read-scope 與 isolation gates。

若某 phase 內有多個 assignment（例如多 Controller Analyzer、每 Controller 一個 Writer、多 Reviewer），run-state 必須保留每個 assignment 的 timing evidence，不得只記一個彙總時間。

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
| 結果呈現後 | 輸出 `### ⏱ 各階段耗時` 與 `### Timing Evidence` |

---

## 結果整合與呈現

完成或提前中止後，都保留以下七項內容；尚未執行的角色明示「未派發」：

1. 測試檔案連結：列出 Writer 產出的所有測試檔案路徑。**不需在 chat 中嵌入完整測試程式碼**
2. 執行結果摘要：Executor 的 `dotnet test` 結果（通過/失敗/略過數、Docker 狀態、容器需求）
3. 品質審查摘要：Reviewer 的整體評級和關鍵發現
4. 改善建議：Reviewer 的遺漏測試案例和嚴重問題
5. 使用的 Skills 組合：列出 Writer 載入了哪些 integration skills
6. Executor 修正紀錄：測試端修正、artifact repair 與未解 blocker 分開列示；測試端修正沿用 Executor `fixRounds`／`fixHistory`，artifact repair 照錄每份 canonical Executor 最後一次成功 `validate` 的 `repairSummary.markdown`（含 target 與 project regression，不重複同一路徑）。沒有成功驗證的 summary 時明示未取得；不可由空白欄位補成未執行
7. 各階段耗時摘要與 Timing Evidence：耗時採用上述 `timing` 輸出；逐 assignment 的時間證據引用同次 `timingEvidence.markdown`，Notes 保留結果摘要

此外必須交付 **HTML token-usage report**。保留上述原有項目，執行下列入口並在最終回覆照錄 stdout 的 `markdown`、`fileUrl`、`note` 與目前狀態；`pending` 表示回合結束後自動更新，不可宣稱用量已收齊。`unsupported` 表示未啟動背景收集，不能承諾重新整理後自動恢復；依 `note` 與診斷回報。若啟動失敗或尚未建立 run-state，回報原因，不補造連結。

```bash
node .codex/scripts/dotnet-testing-codex-full/integration-runtime/usage-observer.mjs link --workspace-root "{workspaceRoot}" --run-state "{testProjectDir}/.orchestrator/run-state.json"
```

固定表格欄位：結果總覽使用 `目標 | 端點 | 情境／方法 | 可執行案例 | Target 執行 | Reviewer`；各階段耗時使用 `階段 | 耗時`（四階段及總計）；Timing Evidence 使用 `Phase | Source | dispatchIssuedAt | artifactReadyAt | completedAt | Notes`。保留開始標題、順序與完成摘要格式；blocked／failed 不顯示成功勾選，未派發階段不補造時間戳。

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

修改流程結果呈現後，同樣只回報 artifact-backed 結果與 run-state timing。

---

## 錯誤處理

| 錯誤情境 | 處理方式 |
| --- | --- |
| Analyzer 找不到專案 | 向使用者確認路徑，用 Read/Grep 找到目標，重新啟動 Analyzer |
| Docker 未啟動 | 在結果中告知需啟動 Docker Desktop；若測試不涉及容器則繼續 |
| Writer 回應超出長度限制 | 將該 single-Writer attempt 判定為 blocker；不得在同一 attempt 自動 split 或刪減 scenarios |
| Executor 3 輪修正後仍失敗 | 將失敗訊息傳給 Reviewer，在結果中標示失敗，區分環境問題與邏輯問題 |
| reviewer-result 未落地 | 判定 Reviewer phase blocker，不採信回傳文字 |

---

## 多目標支援

當使用者一次指定多個 Controller 時，對每個目標分別執行完整四階段流程：

| 階段 | 執行方式 | 說明 |
| --- | --- | --- |
| Phase 1 Analyzer | 平行 | 每個 Controller / endpoint slice 獨立分析 |
| Phase 2 Writer | 共用測試專案時循序 | 每個 Controller／endpoint slice 恰有一個 `single`／`full` Writer；後續 Writer 重用並補充共享 infrastructure，不得 split |
| Phase 3 Executor | 循序 | `dotnet build` 不可並行，容器避免 port 衝突 |
| Phase 4 Reviewer | 平行 | 每份測試獨立審查 |

多目標的所有 Writers 完成後，最後一個 Executor assignment 必須接收 `projectRegression.enabled: true`、all-target canonical Writer／test file 清單與預先計算的 `{testProjectDir}/.orchestrator/executor-result/test-project.regression.executor-result.json`，額外產出 `regressionScope: "test-project"` 的完整未過濾 `dotnet test` evidence。Orchestrator 以 `--project-regression` 與每份 `--project-writer` 傳給 execution contract validator，驗證 all-target union 與 case accounting，避免後建立或補充的共享 Factory／Fixture／TestBase 使較早 target 的 green result 失效。多目標完成後彙整：概覽表格 + 各目標詳細結果 + 共用改善建議。

---

## 重要原則

1. **交接檔案路徑優先** — 傳 `analysisFilePath`、`writerResultFilePaths[]`、`executorResultFilePath`、`reviewResultFilePath`，而非嵌入 JSON。Subagent 會在 Step 0 自行讀取交接檔案
2. **保持主 context 精簡** — 只保留 subagent 回傳的摘要，不展開中間過程
3. **端點粒度** — 整合測試以 HTTP endpoint 為粒度，`suggestedTestScenarios` 使用中文三段式（`端點_情境_預期`）
4. **執行模型固定** — `dotnet test` + xUnit + Docker/Testcontainers；不得改成 TUnit `dotnet run`
5. **技術技能固定** — 只載入 `.agents/skills/dotnet-testing-advanced-webapi-integration-testing/`、`.agents/skills/dotnet-testing-advanced-aspnet-integration-testing/`、`.agents/skills/dotnet-testing-advanced-testcontainers-database/`、`.agents/skills/dotnet-testing-advanced-testcontainers-nosql/`
6. **版本相依性** — 既有版本不升不降；缺少套件才依 integration skill 最低版本 add-only
7. **保留 artifacts** — `.orchestrator/` 是驗收與 benchmark evidence，不在 Phase 5 自動清理
8. **案例數不固定** — 不限制 Analyzer scenario 數；以 `endpointCatalog`、`scenarioCatalog`、`scenarioCoverage` 與 Reviewer acceptance 驗證品質
9. **Canonical telemetry** — 四角色 `tokenEstimateInputs.readFiles` / `writtenFiles` 是 attempt isolation 與 read-scope gates 的必要證據；保留實際讀寫紀錄，不作 token 估算。
