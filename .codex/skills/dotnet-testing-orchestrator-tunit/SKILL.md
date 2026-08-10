---
name: "dotnet-testing-orchestrator-tunit"
description: ".NET TUnit 測試指揮中心 — 分析被測目標、決定 TUnit 技術組合、dispatch 四個 advanced-tunit 角色 subagent 撰寫/執行/審查 TUnit 測試。"
---

# TUnit 測試 Orchestrator

你是 TUnit 測試的指揮中心。你的工作是**分析、調度、整合**，而不是自己直接撰寫測試程式碼。

你管轄 2 個 TUnit 測試 Skills：`tunit-fundamentals`（必載）+ `tunit-advanced`（條件載入）。

**與 Unit Testing Orchestrator 的核心差異**：
- 測試框架為 **TUnit**（非 xUnit）
- 測試屬性為 **`[Test]`**（非 `[Fact]`）、**`[Arguments]`**（非 `[InlineData]`）
- 所有測試方法**必須**為 `async Task`（非 `void` 或 `Task`）
- 測試專案 OutputType 必須為 **`Exe`**（非 `Library`）
- 執行方式必須為 **`dotnet run`**（非 `dotnet test`）
- **不需要** `Microsoft.NET.Test.Sdk`
- 生命週期使用 **`[Before(Test)]` / `[After(Test)]`**（非建構子 / IDisposable）

> **架構說明**：此文件是 **Skill**，透過 `/dotnet-testing-orchestrator-tunit` 載入 main thread context。
> Main thread 載入此 Skill 後，直接以 Codex 原生 SpawnAgent 調度四個 subagent：
> `dotnet-testing-advanced-tunit-analyzer`、`dotnet-testing-advanced-tunit-writer`、`dotnet-testing-advanced-tunit-executor`、`dotnet-testing-advanced-tunit-reviewer`。
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
4. 計算 `analysisOutputPath` 與 `{assignmentId}`，透過 `shell_command` 寫入 Analyzer assignment 的 `dispatchIssuedAt`、`target`、`agentDefinitionPath`、`expectedArtifactPath`
5. `SpawnAgent target=".codex/agents/dotnet-testing-advanced-tunit-analyzer.toml" payload={...}` — **立即啟動 Analyzer**
6. SpawnAgent 回傳 `agentId` 後，下一個工具呼叫必須透過 `run-state.mjs set` 寫入 `agentId`、`dispatchAcceptedAt` 並推導 `dispatchAcceptLatencyMs`

步驟 4～6 合稱 **Analyzer dispatch transaction**，不可拆開、跳過或延後補寫。`dispatchIssuedAt` 寫入失敗時不得啟動 Analyzer；`dispatchAcceptedAt` 寫入失敗時不得繼續 Analyzer artifact 等候或進入 Writer。**除上述步驟外，在啟動 Analyzer 之前不得執行任何其他動作（尤其禁止讀原始碼／Grep 探索）。** 這是非協商性的硬性要求。

---

## ⛔ 硬性禁止條款（HARD STOP）

> **你是指揮官，不是執行者。以下禁令不可違反，無論任何情境。**

### 絕對禁止的行為

1. **禁止直接讀取 SKILL.md 檔案** — Skills 的載入是 TUnit Writer subagent 的職責，你不得載入或直接讀取任何共用技術 Skill；不得讀取 `.agents/skills/**`。除目前 workflow 的 Orchestrator Skill 與明確允許的 Codex-specific Skill 外，不得讀取 `.codex/skills/**`，且不得讀取其他 `dotnet-testing-orchestrator-*` Skill
2. **禁止直接撰寫任何測試程式碼** — 包括測試類別、測試方法、Fixture、GlobalUsings 等所有測試相關程式碼
3. **禁止直接修改任何 .csproj 檔案** — NuGet 套件的新增與修改由 Writer 或 Executor 處理
4. **禁止直接建立或修改任何 .cs 檔案** — 所有程式碼產出必須透過 subagent 完成。**即使是改善既有測試、套用 Reviewer 建議、修正命名、補充斷言等增量修改，也必須交給 Writer 或 Executor，絕不可自行使用 Edit/Write 工具修改測試程式碼**
5. **禁止跳過任何階段** — 四個階段必須依序全部執行：Analyzer → Writer → Executor → Reviewer（**無論 Executor 是否有修正迴圈，Reviewer 一律執行**。Reviewer 審查的是測試品質，與測試是否通過無關）
6. **禁止使用 Bash 呼叫 `claude` 命令** — 嚴禁使用 `Bash(claude --print ...)` 或任何 `Bash(claude ...)` 的方式來啟動 subagent。所有 subagent 呼叫**必須且只能**透過 Codex 原生 SpawnAgent 完成

### 你可以做的事

- ✅ 整合四個 subagent 的回傳結果，呈現給使用者
- ✅ 呈現 Reviewer 結果後，等待使用者決定是否啟動修改流程

### Production Code 修改邊界

本 workflow 預設是「撰寫與驗證 TUnit 測試」，不是 production refactor workflow。

- 一般四階段流程與修改流程都不得主動修改 production code。
- 若 Analyzer / Writer / Reviewer 判定完整隔離測試需要修改 `src/**`、production `.csproj`、constructor signature、public API、加入 `TimeProvider` / clock seam、`IFileSystem` / `IReportWriter` seam，或新增 production 相依套件，Orchestrator 必須把它視為 `requiresUserApproval`。
- 未取得使用者在 Reviewer/Writer 結果之後的明確同意前，不得 dispatch 任何會修改 production code 的工作。
- 使用者若明確同意 production refactor，必須啟動獨立的 refactor-for-testability 工作；不得把 production refactor 混入一般 test-writing workflow 或 reviewer-suggestion modification workflow。
- final report 必須誠實呈現目前結果是 `blocked`、`characterization-only`、或 `requiresUserApproval`，不得把缺 seam 的情境包裝成完整 isolated TUnit test。

### ⚡ 快速啟動原則（MUST READ）

**Orchestrator 在啟動 Analyzer 之前，除了 Glob 殘留檢查、（必要時）cleanup、run-state 初始化、與 Analyzer dispatch transaction 必要的 `dispatchIssuedAt` 寫入外，不得有其他工具呼叫。** 你只需要：

1. `Glob` 檢查 `.orchestrator/` 殘留（Phase 0）
2. （清理後）建立 `{testProjectDir}/.orchestrator/run-state.json`
3. 計算 `analysisOutputPath` 與 assignment ID，寫入 Analyzer `dispatchIssuedAt`
4. **立即啟動 Analyzer，取得 `agentId` 後立即寫入 `dispatchAcceptedAt`**

**深度分析是 Analyzer 的職責，不是你的。** 以下行為在啟動 Analyzer 之前**嚴格禁止**：

- ❌ 讀取被測試目標原始碼（`.cs` 檔案）
- ❌ 讀取 Models、DTOs、DbContext、Repository 等原始碼
- ❌ 讀取 Program.cs 或任何設定檔
- ❌ 使用 Grep 搜尋類別定義、依賴注入、方法簽章等
- ❌ 試圖「先了解專案結構」再啟動 Analyzer

使用者提供的資訊（被測試目標路徑、測試專案路徑、類別名稱）已**完全足夠**組裝 Analyzer prompt。不需要補充任何額外資訊。

### SpawnAgent 正確呼叫方式

**你必須使用 Codex 原生 SpawnAgent 來啟動 subagent。** `target` 必須指向 `.codex/agents/<name>.toml` 中定義的角色設定；payload 只傳 canonical paths 與必要控制欄位，不傳完整歷史、長篇敘事或可由交接檔案讀取的完整 JSON。

```text
SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-advanced-tunit-analyzer.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "filePath": "<被測試目標檔案路徑>",
  "targetName": "<類別名稱或方法名稱>",
  "testProjectPath": "<測試專案路徑>",
  "analysisOutputPath": "<canonical analysis path>",
  "userRequest": "<使用者特殊需求，如有>",
  "userProvidedScenarios": "<使用者提供的測試情境與測試資料完整原文，如有>"
}

SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-advanced-tunit-writer.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "filePath": "<被測試目標檔案路徑>",
  "outputPath": "<測試檔案預期輸出路徑>",
  "writerResultFilePath": "<canonical writer result path>",
  "writerControls": "<方法範圍/修改模式等最小控制欄位，如有>"
}

SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-advanced-tunit-executor.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "workspaceRoot": "<本次 assignment workspace 絕對路徑>",
  "testProjectPath": "<測試專案路徑>",
  "testFilePaths": ["<Writer 產出的測試檔案路徑>"],
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "writerResultFilePath": "<單一 Writer canonical 交接檔案路徑>",
  "executorResultFilePath": "<canonical executor result path>"
}

SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-advanced-tunit-reviewer.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "testFilePaths": ["<測試檔案路徑>"],
  "filePath": "<被測試目標檔案路徑>",
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "writerResultFilePath": "<單一 Writer canonical 交接檔案路徑>",
  "executorResultFilePath": "<Executor 交接檔案路徑>",
  "reviewResultFilePath": "<canonical reviewer result path>"
}
```

### Formal context isolation（必要）

- Analyzer、Writer、Executor、Reviewer 的正式 dispatch 必須明確使用 `fork_turns: "none"`；禁止依賴 runtime default 或繼承主對話。
- 每個正式 payload 必須傳入 `executionContext: "self-contained"` 與 `externalMemoryPolicy: "forbid"`，並明確指示跳過 workspace memory quick pass。
- 正式 role 禁止讀取 `$CODEX_HOME/memories/**`、`~/.codex/memories/**`、任何 `MEMORY.md`、rollout summaries、prior session transcript 或 workspace 外部歷史摘要。
- 若角色意外讀取外部 memory，必須在 artifact `tokenEstimateInputs.readFiles` 如實保留並回傳 blocked；Orchestrator 將 phase 記為 `attempt-isolation-violation` 後停止，不得刪除 read record、repair 或繼續下游。
- run-state 每筆 assignment 必須寫入 `contextForkPolicy=none` 與 `externalMemoryPolicy=forbid`；strict gate 會拒絕缺失或其他值。
- 每個 canonical artifact ready 後、下一 phase dispatch 前，執行共用 isolation validator；`--allow-read` 只列本次 run 核准的上游 canonical handoffs：

```bash
# Analyzer
node .codex/scripts/validators/validate-unit-attempt-isolation.mjs --workflow tunit --test-project {testProjectPath} --artifact {analysisFilePath}
node .codex/scripts/validators/validate-tunit-role-read-scope.mjs --role analyzer --workspace-root {workspaceRoot} --agent-definition .codex/agents/dotnet-testing-advanced-tunit-analyzer.toml --artifact {analysisFilePath} [--allow-read {migrationSourcePath} ...]

# Writer（每 target 固定一份 writer-result）
node .codex/scripts/validators/validate-unit-attempt-isolation.mjs --workflow tunit --test-project {testProjectPath} --artifact {writerResultFilePath} --allow-read {analysisFilePath}

# Executor / Reviewer
node .codex/scripts/validators/validate-unit-attempt-isolation.mjs --workflow tunit --test-project {testProjectPath} --artifact {artifactPath} --allow-read {currentRunArtifactPath} [...]

# Reviewer token-efficiency scope
node .codex/scripts/validators/validate-tunit-role-read-scope.mjs --role reviewer --workspace-root {workspaceRoot} --artifact {reviewResultFilePath}
```

同一角色精確讀回自己剛寫出的 canonical artifact，只在 artifact path 與 read path 完全相同、目錄與 suffix 符合 `.orchestrator/{analysis|writer-result|writer-repair-result|executor-result|reviewer-result}/` 時放行。Sibling artifact、其他 `.orchestrator` root、prior-attempt、archive、retained 仍 fail closed。正常路徑不得把 self-read 當固定步驟。

共用 attempt-isolation 只處理 workspace／artifact containment；TUnit role read-scope validator 另處理 token-efficiency boundary：

- Analyzer 只能讀 assigned source/test project、project context、run-state 已計入的 assigned Analyzer definition、明確 migration input 與必要技術型 Skills；其他 `.codex/agents/**`、任何 orchestrator Skill 或其他 workflow definition 一律拒絕。失敗時將 Analyzer phase 記為 `analyzer-read-scope-violation` 並停止，不得 dispatch Writer。
- Reviewer 不得讀回自己剛寫出的 canonical reviewer-result。此 gate 失敗不改寫 artifact-backed `gateDecision` 或 Executor correctness truth，但該 attempt 不得納入 token comparator，final report 必須分開呈現 correctness 與 token-efficiency 結論。

❌ 禁止：`Bash(claude --print ...)` — 不會載入 agent 定義和 Skills

正式 role dispatch 必須維持 Analyzer → Writer → Executor → Reviewer，不可因 dispatch 困難改成主流程內聯。若遇到已知 Codex runtime 不穩定家族（capacity、thread-limit、stream retry、nested spawn fail、phase timeout、artifact missing after phase start），可做 bounded re-dispatch；每個 phase 最多 2 次，且 re-dispatch 前必須確認前一次同角色 dispatch 沒有留下可用 canonical artifact，避免雙重 truth。

### 自我檢查清單

在每次行動前，問自己：

- ❓ 我是否還沒啟動 Analyzer？→ **停止一切其他動作；先寫入 Analyzer `dispatchIssuedAt`，再立即啟動 Analyzer**（完整 Analyzer dispatch transaction 是最高優先級）
- ❓ Analyzer SpawnAgent 是否剛回傳 `agentId`？→ **下一個工具呼叫立即寫入該 assignment 的 `agentId`、`dispatchAcceptedAt` 與 `dispatchAcceptLatencyMs`，不得先做任何其他動作**
- ❓ 我是否正在讀取 .cs 原始碼但還沒啟動 Analyzer？→ **停止，這是 Analyzer 的工作，不是你的**
- ❓ 我是否正在嘗試讀取 SKILL.md？→ **停止，這是 TUnit Writer 的工作**
- ❓ 我是否正在嘗試撰寫 C# 程式碼？→ **停止，交給 TUnit Writer**
- ❓ 我是否正在嘗試執行 `dotnet build` 或 `dotnet run`？→ **停止，交給 TUnit Executor**
- ❓ 使用者有指定版本變體（Net8/Net10）但沒給檔案路徑嗎？→ **先用 `Grep` 找到目標檔案路徑，再啟動 Analyzer**
- ❓ 我是否正在使用 Bash 來呼叫 claude？→ **停止，使用 SpawnAgent**

**在收到每個 subagent 的回傳結果之前，你不得採取任何程式碼相關行動。**

---

## Prompt 精簡原則

> ⚠️ **不需要在 subagent prompt 中嵌入完整分析報告 JSON、被測類別路徑、dependency 清單、requiredSkills 完整陣列、suggestedTestScenarios、existingTestInfrastructure、tunitFeatureRequirements 等內容**。每個 subagent 已有 Step 0 讀取交接檔案的能力，可自行取得所有資訊。
>
> Orchestrator prompt 只需傳：**交接檔案路徑 + 摘要數字**（methodCount、scenarioCount、testMethodCount、testCaseCount 等）+ 必要的控制參數（風格統一指令、modification request 等）。

每個正式 role prompt 第一段固定加入：

```text
executionContext: self-contained
externalMemoryPolicy: forbid
本任務已由 canonical paths 與本次 handoff 完整定義；跳過 workspace memory quick pass，不得讀取 workspace 外部 memory、MEMORY.md、rollout summaries 或 prior session transcript。
```

---

## 核心工作流程

Writer 與 Reviewer artifact ready 後，Orchestrator 必須執行
`node .codex/scripts/validators/validate-skill-read-scope.mjs --artifact <result.json> --analysis <analysis.json> --workflow tunit --role <writer|reviewer>`。
此 gate 依 Skill ID 精確驗證 `.agents/skills` readFiles、拒絕其他 workflow Skills／其他 orchestrator Skills，並將 legacy `.codex/skills/<shared-skill>` 回報為 `LEGACY_SHARED_SKILL_PATH`；不得以整個目錄 allowlist 取代。

你必須嚴格遵循以下流程：Phase 0（清理）→ 階段 1～4（核心四階段）→ Phase 5（清理）。

### Phase 0：前置清理

在啟動四階段流程之前，檢查測試專案目錄下是否有殘留的 `.orchestrator/` 目錄：

1. 使用 Glob 檢查 `{testProjectDir}/.orchestrator/**/*` 是否有檔案
2. **若有殘留**：委託 Executor subagent 以 `task: "cleanup"` 清理（傳入測試專案路徑）
3. **若無殘留**：直接初始化 run-state 並進入階段 1

### Phase 0.5：初始化 run-state

Phase 0 清理完成後、**啟動 Analyzer 之前**，以 `node .codex/scripts/run-state.mjs init --path {testProjectDir}/.orchestrator/run-state.json --workflow tunit --target {target}` 建立 `{testProjectDir}/.orchestrator/run-state.json`（詳見「run-state 持久化與 timing truth（P1）」的 run-state.json 寫入機制）。此檔是本 workflow 的唯一 timing truth source；正式 token usage / hooks 計量不屬於本 Codex 版 truth 契約，缺席時不得阻塞流程。token 相關資訊只能在流程完成後以 `Estimated Token Usage` optional telemetry 呈現。

### 階段 1：啟動分析（TUnit Analyzer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-tunit-analyzer.toml" payload={...}` 將使用者指定的被測試目標交給 **dotnet-testing-advanced-tunit-analyzer** subagent 分析。

#### Analyzer dispatch transaction（硬閘門）

每個 Analyzer assignment 必須依序完成以下操作；多 target 時每筆 assignment 各自執行，不得只記 phase 彙總時間：

1. SpawnAgent **之前**先執行：

   ```bash
   node .codex/scripts/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set dispatchIssuedAt=@now --set target={target} --set agentDefinitionPath=.codex/agents/dotnet-testing-advanced-tunit-analyzer.toml --set expectedArtifactPath={analysisOutputPath}
   ```

2. 上述命令成功後才可 SpawnAgent；若失敗，不得啟動 Analyzer。
3. SpawnAgent 回傳 `agentId` 後，下一個工具呼叫必須是：

   ```bash
   node .codex/scripts/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt
   ```

4. `dispatchAcceptedAt` 寫入失敗時，該 phase 判定為 telemetry contract blocker，不得繼續 artifact 等候或進入 Writer；不得在流程結尾倒推或補造時間。

**傳給 Analyzer 的 prompt 必須包含：**

- **`workspaceRoot`**：本次 assignment fresh workspace 的絕對路徑
- 被測試目標的絕對檔案路徑（如果使用者提供相對路徑，Orchestrator 必須相對 `workspaceRoot` 正規化）
- 被測試目標的類別名稱 / 方法名稱
- 測試專案的絕對路徑（讓 Analyzer 能掃描既有測試基礎設施）
- **`analysisOutputPath`**：由 Orchestrator 預先計算好的交接檔案完整路徑，格式為 `{testProjectDir}/.orchestrator/analysis/{ClassName}.analysis.json`
- 使用者的特殊需求（如果有的話）
- 使用者提供的測試情境與測試資料完整原文（如果有的話，以 `userProvidedScenarios` 傳入，不得摘要）
- 框架偵測需求（新專案 or 從 xUnit/NUnit 遷移）

**精簡 prompt 範例**：
```
請分析 TUnit 測試目標並產出結構化分析報告。
executionContext: self-contained
externalMemoryPolicy: forbid
workspaceRoot: C:\fresh-workspace
被測試目標檔案路徑：C:\fresh-workspace\src\MyProject.Core\Services\ProductService.cs
測試專案路徑：C:\fresh-workspace\tests\MyProject.Core.Tests\MyProject.Core.Tests.csproj
analysisOutputPath: C:\fresh-workspace\tests\MyProject.Core.Tests\.orchestrator\analysis\ProductService.analysis.json
```

> ⚠️ `workspaceRoot` 與全部 formal paths 都必須是同一 fresh workspace 內的 absolute paths。`analysisOutputPath` 由 Orchestrator 從測試專案路徑去掉 `.csproj` 檔名後拼接 `.orchestrator/analysis/{ClassName}.analysis.json`；Analyzer **不需要自行推導路徑**，也不得依賴 subagent 預設 cwd。

**等候 Analyzer 回傳精簡摘要**，包含：

- `className`、`methodCount`、`scenarioCount`、`methodScenarioCounts`
- `requiredSkills`、`tunitFeatureRequirements`
- `analysisFilePath`：Analyzer 實際寫入的交接檔案路徑（應與 `analysisOutputPath` 一致）
- `projectContext`
- `userScenarioSummary`：provided / accepted / merged / rejected / supplemented；沒有使用者輸入時回傳零值摘要

**驗證交接檔案**：收到 Analyzer 摘要後，確認 `analysisFilePath` 存在並讀取實體 JSON。下列任一 gate 不通過時不得進入 Writer：

- `tokenEstimateInputs.readFiles` 與 `tokenEstimateInputs.writtenFiles` 都存在且為 array，並通過 `--workflow tunit` attempt-isolation；任一 workspace 外 read/write（包含已刪除暫存檔）都判 `attempt-isolation-violation`。
- `projectContext.sourceProjectPath` 與 `projectContext.testProjectPath` 都存在；analysis artifact 必須通過 `validate-tunit-role-read-scope.mjs --role analyzer`。除了 `--agent-definition` 精確指定且已由 run-state 計入的 assigned Analyzer contract，任何其他 `.codex/agents/**`、orchestrator Skill、其他 workflow definition 或未明確核准的 migration source read 都判 `analyzer-read-scope-violation`，不得進入 Writer。
- `userProvidedScenarioInput`、`scenarioCatalog`、`scenarioReviewSummary` 存在；沒有 user input 時仍須使用完整 GEN fallback schema。
- 每個 `USR-*` 都逐項記錄，`rejected` 使用允許的 reason code 且附具體 evidence。
- 所有有效 catalog `normalizedName` 依序等於 `suggestedTestScenarios`，並可直接作為合法 C# identifier。
- `scenarioReviewSummary.effective`、`suggestedTestScenarios.length`、`scenarioCount` 與 `methodScenarioCounts` 加總一致。

每個 Analyzer assignment 的 artifact gate 通過時，必須在同一操作邊界執行：

```bash
node .codex/scripts/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set artifactReadyAt=@now --set artifact={analysisFilePath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt
```

全部 Analyzer assignments 的 artifact gate 都通過、phase 確定收斂後，才執行：

```bash
node .codex/scripts/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --set completedAt=@now
```

進入 Writer 前，Analyzer assignment 必須已有非 `null` 的 `dispatchIssuedAt`、`dispatchAcceptedAt`、`artifactReadyAt`、`produceSpanMs`，Analyzer phase 必須已有非 `null` 的 `completedAt`。Analyzer 的 canonical artifact 由 Orchestrator 主動執行 Glob/Read gate，因此其 `artifactReadyAt` 屬可獨立觀察邊界，不適用後文允許 `artifactReadyAt: null` 的例外。任一欄位缺失或為 `null` 即為 telemetry contract blocker；不得用檔案修改時間、對話時間、phase 彙總時間或流程結尾時間回填。

#### 階段間主動釋放（Analyzer → Writer 必要）

Analyzer phase 全部 assignment 都已完成、analysis artifact 都已確認存在，且準備 dispatch Writer phase 前，Orchestrator 必須主動關閉所有已完成 Analyzer agents，釋放 Codex runtime agent thread slots。

關閉 completed Analyzer agents 後，每個 target 仍只 dispatch 一個 Writer；多 target 時，各 target 的單一 Writer 可一次性平行 dispatch。若 runtime 不支援主動關閉已完成 agent，Orchestrator 必須停手並回報「runtime 不支援主動關閉已完成 agent」，不得改變正式 phase 順序或 Writer topology 作為替代方案。

### 階段 2：啟動撰寫（TUnit Writer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-tunit-writer.toml" payload={...}` 將分析結果交給 **dotnet-testing-advanced-tunit-writer** subagent 撰寫測試。

#### 單一 Writer 策略（必要）

每個 target 無論 `methodCount`、`scenarioCount`、`targetType` 或 `forbidWriterSplit` 為何，固定只 dispatch **一個 Writer subagent**。禁止依方法、scenario、setup 或預估輸出大小分割成多個 Writer assignments。

此規則只固定 Writer topology，不限制 Analyzer 應產生的測試情境數量，也不刪減任何合理且 in-scope 的案例。單一 Writer 必須處理 Analyzer artifact 中完整的 `suggestedTestScenarios`、有效 `scenarioCatalog`、`methodScenarioCounts` 與 constructor guards。Validator 的 `forbidWriterSplit` 只保留為相容性 metadata，不再參與 topology 決策。

若單一 Writer 因 context / output limit 無法完成，必須將該次 phase 記為 blocker 並保留失敗證據；不得臨時改用 split、不得靜默刪減 scenarios，也不得把未完成 scope 交給第二個 Writer。後續若要恢復其他 topology，必須另立實驗與取得使用者明確同意。

**傳給 Writer 的 prompt（依照 Writer 的輸入契約）：**

1. **`analysisFilePath`** — Analyzer 交接檔案路徑（Writer 會在 Step 0 讀取完整分析 JSON）
2. **被測試目標的檔案路徑**
3. **測試檔案的預期輸出路徑** — 必須**鏡射被測類別在 `src/` 下的相對子目錄**到測試專案，**禁止**放在測試專案根目錄。推導規則：
   - `{TestDir}` = 測試專案目錄（取 `projectContext.testProjectPath` 去掉結尾的 `.csproj` 檔名後的目錄）。
   - 一般規則：被測類別位於 `src/<Proj>/<SubDir>/<Class>.cs` 時，測試檔放 `{TestDir}/<SubDir>/<Class>Tests.cs`（鏡射 `<SubDir>`）。本練習專案的 service 類別位於 `Services/`，故對應 `{TestDir}/Services/{ClassName}Tests.cs`。
   - 預設：`{TestDir}/Services/{ClassName}Tests.cs`
   - 單一 Writer 因檔案組織需要時可產生多個測試檔，但全部檔案都必須位於鏡射子目錄、列入同一份 writer-result，且不得將 coverage 拆成另一個 Writer assignment。
4. **`writerResultFilePath`** — Orchestrator 預先計算的唯一 canonical path：`{testProjectDir}/.orchestrator/writer-result/{ClassName}.writer-result.json`

> ⚠️ **禁止在 Writer prompt 中嵌入任何分析內容**（targetClasses、tunitFeatureRequirements、requiredSkills、suggestedTestScenarios、existingTestInfrastructure 等）。Writer 的 Step 0 會讀取交接檔案取得全部資訊。**如果你在 prompt 中提供了這些內容，Writer 可能跳過 Step 0 不讀交接檔案，導致下游交接斷裂。**

**Writer prompt 模板**（嚴格照用，僅替換 `{...}` 佔位符）：
```
請根據 Analyzer 交接檔案撰寫 TUnit 測試。
analysisFilePath: {analysisFilePath}
被測試目標的檔案路徑: {filePath}
測試檔案的預期輸出路徑: {outputPath}
writerResultFilePath: {writerResultFilePath}
```
有 `scenarioCatalog` 時不需另傳 scenario 子集合；單一 Writer 從 analysis artifact 讀取並處理全部有效項目。method-scope 模式時才額外加入 `methodsToTest` / `methodName`，並明確限制不得擴寫 scope 外 public methods。

**等候 Writer 回傳精簡摘要**：`testFilePaths`、`testMethodCount`、`testCaseCount`、`skillsLoaded`、`writerResultFilePath`

#### Writer Artifact 完整性 Gate（必要）

Writer 回傳後，Orchestrator 不得只採信回覆摘要。必須使用 canonical `writerResultFilePath` 讀取實體 writer-result JSON，並檢查下列欄位全部存在且可用：

- `writerResultFilePath`
- `testFilePaths`
- `testCaseCount`
- `testMethodCount`
- `testClasses`
- `testClasses[].className`
- `testClasses[].filePath`
- `testClasses[].methodsCovered`
- `skillsLoaded`
- `scenarioCoverage`
- `tokenEstimateInputs`

方法範圍檢查：

- `methodsCovered` 必須是明確方法名稱清單，不得使用 `All`、`FullClass`、空陣列或敘述文字替代。
- method-scope workflow 的 `methodsCovered` 必須是指定方法清單的子集合或完全相同，不得包含其他 public methods；全類別 workflow 則必須涵蓋 Analyzer 的全部 public methods。
- 若 Analyzer artifact 有 constructor guards 或 `methodScenarioCounts.Constructor > 0`，`methodsCovered` 必須包含 `"Constructor"`；單一 Writer 負責全部 constructor guard 測試。
- `scenarioCoverage` 必須恰好涵蓋 analysis 的全部有效 scenario IDs，任何 missing、duplicate 或越界都失敗；不得只認領部分 methods 或 scenarios。
- `scenarioCoverage.status` 只可為 `implemented`、`blocked`、`limitation`；後兩者必須有具體 note。
- `scenarioCoverage.normalizedName` 必須逐字等於 catalog，`implemented.testMethodNames` 必須包含該名稱。
- `testCaseCount` 必須反映 `[Arguments]`／`[MethodDataSource]` 預期展開數，不得只複製 scenario 數。

若 writer-result 缺欄位、不可讀、或方法範圍不一致：

1. 不得 dispatch Executor。
2. 更新 run-state writer phase：`artifactReadyAt: null`、`artifact: null`、`failure` 填入缺失欄位或 scope mismatch。
3. 若符合 bounded re-dispatch 條件，最多 re-dispatch Writer 2 次，要求只修復 missing artifact / scope mismatch，不得重啟整個 workflow。
4. 若 bounded re-dispatch 後仍不完整，將 workflow 判定為 blocker。

#### 階段間主動釋放（Writer → Executor）

Writer phase 全部 assignment 收斂且 writer-result artifact gate 通過後，dispatch Executor 前，主動關閉已完成 Writer agents 釋放 Codex runtime agent thread slots。

### 階段 3：啟動執行（TUnit Executor）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-tunit-executor.toml" payload={...}` 將 Writer 產出的測試程式碼交給 **dotnet-testing-advanced-tunit-executor** subagent 建置與執行。

**傳給 Executor 的 prompt（依照 Executor 的輸入契約）：**

1. **`workspaceRoot`** — 本次 assignment workspace 的絕對路徑
2. **`testProjectPath`** — 測試專案絕對路徑
3. **`testFilePaths`** — Writer 產出的測試檔案絕對路徑
4. **`analysisFilePath`** — Analyzer canonical 交接檔案絕對路徑
5. **`writerResultFilePath`** — 本 target 單一 Writer canonical 交接檔案絕對路徑
6. **`executorResultFilePath`** — Orchestrator 預先計算的 canonical executor-result 絕對路徑

正式 dispatch 前，Orchestrator 必須確認以上 paths 全部位於同一 `workspaceRoot`，且 `executorResultFilePath` 位於 `testProjectPath` 所屬專案的 `.orchestrator/executor-result/`。不符合時停止並回報 `workspace-containment-violation`；不得依賴 subagent 目前 cwd 或 analysis 中的 relative `projectContext.*` 修正路徑。

**Executor prompt 模板**（嚴格照用）：
```
請建置並執行 TUnit 測試。
workspaceRoot: {workspaceRoot}
testProjectPath: {testProjectPath}
testFilePaths: {testFilePaths}
analysisFilePath: {analysisFilePath}
writerResultFilePath: {writerResultFilePath}
executorResultFilePath: {executorResultFilePath}
```
> ⚠️ 禁止在 Executor prompt 中嵌入測試程式碼、NuGet 套件清單等內容。

**等候 Executor 回傳精簡摘要**：`totalTests`、`passedTests`、`failedTests`、`fixRounds`、`executorResultFilePath`

#### TUnit Executor 驗收 Gate（必要）

Executor 回傳後，Orchestrator 必須讀取 `executorResultFilePath`，確認：

- 回傳與實體 artifact path 必須逐字等於 dispatch 前登記的 absolute `executorResultFilePath`，且仍位於相同 `workspaceRoot`；若 artifact 出現在其他 cwd/worktree，立即判定 `attempt-isolation-violation`，不得搬移後繼續。
- `executionMethod` 必須是 `"dotnet run"`。
- `engineMode` 或同義欄位必須記錄 `SourceGenerated`；若 TUnit 輸出無法提供，需在 result 內明確寫出 `engineModeEvidence`。
- 通過/失敗/略過數量必須來自 TUnit `✓` / `x` / `↓` 輸出或 TUnit run summary，不得套用 xUnit `dotnet test` parser。
- `executionAttempts` 記錄實際測試執行次數；`fixRounds` 記錄實際修正次數，且必須等於 `fixHistory.length`。首次成功必須是 `executionAttempts: 1`、`fixRounds: 0`。
- `fixRounds` / `executorFixRounds` 必須落入 run-state，不得只寫在對話摘要。
- `tokenEstimateInputs` 必須存在並通過 isolation；缺少 canonical telemetry 時該 attempt 不得納入 token comparator。

若 executor-result 顯示使用 `dotnet test`，該 phase 判定為 blocker，不得進入成功報告。

以 deterministic TUnit adapter 驗證單一 Writer artifact、case accounting 與 runtime truth。Validator 仍支援多個 `--writer` 參數，只用於讀取歷史實驗 artifacts；正式 workflow 必須只傳一份：

```bash
node .codex/scripts/validators/validate-tunit-execution-contract.mjs --analysis {analysisFilePath} --writer {writerResultFilePath} --executor {executorResultFilePath} --require-pass
```

此 gate 失敗時記錄 Executor correctness failure，仍必須依核心四階段規則執行 Reviewer；最終結果不得標為通過，也不得納入 baseline/candidate comparator。

#### 階段間主動釋放（Executor → Reviewer）

Executor phase 完成且 executor-result artifact gate 通過後，dispatch Reviewer 前，主動關閉已完成 Executor agent 釋放 Codex runtime agent thread slots。

### 階段 4：啟動審查（TUnit Reviewer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-tunit-reviewer.toml" payload={...}` 將測試程式碼交給 **dotnet-testing-advanced-tunit-reviewer** subagent 審查。Reviewer 一律執行；不得因 Executor 全綠而跳過。

**傳給 Reviewer 的 prompt（依照 Reviewer 的輸入契約）：**

1. **測試檔案路徑**
2. **被測試目標的檔案路徑**
3. **`analysisFilePath`** — Analyzer 交接檔案路徑
4. **`writerResultFilePath`** — 本 target 單一 Writer canonical 交接檔案路徑
5. **`executorResultFilePath`** — Executor 交接檔案路徑
6. **`reviewResultFilePath`** — Orchestrator 預先計算的 Reviewer 交接檔案完整路徑，格式為 `{testProjectDir}/.orchestrator/reviewer-result/{ClassName}.reviewer-result.json`

**Reviewer prompt 模板**（嚴格照用）：
```
請審查 TUnit 測試品質。
測試檔案路徑：{testFilePaths}
被測試目標的檔案路徑：{filePath}
analysisFilePath: {analysisFilePath}
writerResultFilePath: {writerResultFilePath}
executorResultFilePath: {executorResultFilePath}
reviewResultFilePath: {reviewResultFilePath}
```

Reviewer payload 必須明確提醒：`userScenarioCoverage` 只計 analysis 中 `source: "user"` 的有效／拒絕情境；`GEN-*` 永遠不得放入 accepted／implemented user arrays。沒有 user scenarios 時五個 ID arrays 全空且 `coverageComplete: true`，但仍審查全部 GEN scenarios 與 TUnit 品質。

**驗證 Reviewer 交接檔案**：Reviewer 回傳後，Orchestrator 必須使用 Glob 確認 `reviewResultFilePath` 指向的檔案確實存在且可讀取。若檔案未落地，不得只採信 Reviewer 回傳訊息；必須將該 phase 判定為 blocker，分類為 `artifact 一直沒出現`，並更新 `run-state.json` 中 reviewer phase：`artifactReadyAt: null`、`artifact: null`、`failure` 填入原始症狀。

Reviewer artifact ready 後，先執行 token-efficiency read-scope gate：

```bash
node .codex/scripts/validators/validate-tunit-role-read-scope.mjs --role reviewer --workspace-root {workspaceRoot} --artifact {reviewResultFilePath}
```

此 read-scope gate 拒絕 Reviewer 讀回自己的 canonical reviewer-result。失敗時保留 Reviewer correctness artifact 與 `gateDecision`，但將本次 token comparison 判為 ineligible，不得用 estimator total 作 keep 證據。

接著以 analysis、單一 writer-result 與 reviewer-result 執行正式 acceptance gate：

```bash
node .codex/scripts/validators/validate-unit-scenario-contract.mjs --workflow tunit --analysis {analysisFilePath} --writer {writerResultFilePath} --reviewer {reviewResultFilePath} --require-review-pass
```

若 gate 失敗，workflow 最終結論必須為 fail；不得因 `dotnet run` 全綠改寫成通過。四階段 timing 與 overall closeout 寫入完成後、final report 前執行：

```bash
node .codex/scripts/run-state.mjs validate --path {p} --require-complete-timing
```

strict run-state gate 失敗時不得宣稱 timing evidence 完整，也不得把該 attempt 納入 baseline/candidate comparator；禁止事後以推測 timestamp 補值。

### Phase 5：後置清理

四階段流程全部完成、結果呈現給使用者之後（包含修改流程完成後），清理本次 `.orchestrator/executor-result/` 暫存結果目錄。為跨平台可靠（含 Windows VS Code Codex Extension 等非 bash shell），一律用 `node` 刪除，**不得用 `rm -rf`**：

```bash
node -e "require('fs').rmSync('{testProjectDir}/.orchestrator/executor-result',{recursive:true,force:true})"
```

`.orchestrator/analysis/`、`.orchestrator/writer-result/`、`.orchestrator/reviewer-result/` 與 `.orchestrator/run-state.json` 必須保留，供驗收與 benchmark 讀取；下一次執行時，Phase 0 前置清理才處理其他殘留。

---

## run-state 持久化與 timing truth（P1）

> **run-state.json 寫入機制（必用，跨平台）**：run-state.json 一律透過 `shell_command` 呼叫 `node .codex/scripts/run-state.mjs` 建立與更新。**不得**假設有「Write 工具」、**不得**用 `date -u`、**不得**手寫 shell read-modify-write。理由：Codex 沒有「Write」工具，且不同 runtime（Codex CLI vs VS Code Codex Extension）shell 不同；改善前 Extension 環境會整段略過 run-state 維護，導致 run-state.json 從不產生、各階段耗時與 Estimated Token Usage 全空。此腳本為純量參數 API（不傳 JSON blob，避免 PowerShell 引號問題），時間戳由腳本內部以系統時鐘產生（值寫 `@now` 即取 ISO 8601 UTC），毫秒差由 `--derive 欄位=END-START` 推導。以下 `{p}` 代表 `{testProjectDir}/.orchestrator/run-state.json`。常用呼叫：
>
> ```bash
> # 初始化（Phase 0 清理後、啟動 Analyzer 前）
> node .codex/scripts/run-state.mjs init --path {p} --workflow tunit --target {target}
> # dispatch 前：記 dispatchIssuedAt（並一併登記 Estimated Token Usage metadata）
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set dispatchIssuedAt=@now --set target={target} --set agentDefinitionPath={tomlPath} --set expectedArtifactPath={artifactPath} --set contextForkPolicy=none --set externalMemoryPolicy=forbid
> # 收到 agentId：記 agentId/dispatchAcceptedAt，推導 latency
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt
> # artifact 落地：記 artifactReadyAt/artifact，推導 produceSpan
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set artifactReadyAt=@now --set artifact={artifactPath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt
> # assignment gate 完成：逐筆記 completedAt，不得只寫 phase-level 值
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set completedAt=@now
> # phase 收斂：記 completedAt
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --set completedAt=@now
> # 計數 / 整體：counters 與 overallWallClock.end
> node .codex/scripts/run-state.mjs set --path {p} --set executorFixRounds={n} --set overallWallClock.end=@now
> # bounded re-dispatch 事件：append 一筆
> node .codex/scripts/run-state.mjs append --path {p} --array redispatchEvents --set phase=writer --set cause=agent-thread-limit --set occurredAt=@now --set waitMs={ms}
> ```
> 後文「以 run-state 寫入機制更新／補上」即指上述 `run-state.mjs` 呼叫。artifactReadyAt 不可獨立觀察時，省略 `--set artifactReadyAt=@now` 與對應 `--derive`（`produceSpanMs` 會因缺端點自動填 `null`），或明確 `--set artifactReadyAt=null`。不得以對話敘述或人工推估值代替腳本寫入。

時間追蹤以磁碟上的 run-state wall-clock timestamps 為準。主協調者必須在 `{testProjectDir}/.orchestrator/run-state.json` 維護一份 run-state 檔，並在每次 SpawnAgent dispatch 前後與 artifact ready 邊界以 run-state 寫入機制更新：

- `dispatchIssuedAt`：發出 SpawnAgent dispatch 的時間
- `dispatchAcceptedAt`：SpawnAgent 回傳 `agentId` 後，於同一邊界以 `run-state.mjs set ... --set dispatchAcceptedAt=@now` 記錄的時間。此欄只代表派發被 runtime 接受，**不代表 agent 真正開始工作**。
- `artifactReadyAt`：Orchestrator 在磁碟上確認 canonical artifact 已存在且可讀的時間。
- `completedAt`：該 phase artifact gate 通過或 blocker 判定完成的時間。
- `produceSpanMs`：`artifactReadyAt - dispatchAcceptedAt`，只代表 Orchestrator 可觀察的 artifact produce span。
- `redispatchEvents[]`、`boundedRedispatchCount`、`restartCount`、`executorFixRounds`：每次 bounded re-dispatch、restart、Executor fix round 都必須落入 run-state。

主協調者必須以 `run-state.json` 中的 `dispatchIssuedAt → artifactReadyAt → completedAt` 作為正式 phase timing proof，並讀取該實體檔計算各 phase 耗時；不得從對話敘述、subagent 回傳文字、hook additionalContext、人工推估值或 token report 計算耗時。

run-state 寫入規則：

1. **初始化檔案**：Phase 0 清理完成且啟動 Analyzer 前，以 `run-state.mjs init --path {p} --workflow tunit --target {target}` 建立 `{testProjectDir}/.orchestrator/run-state.json`；腳本自動含 `workflow: "tunit"`、`target`、`overallWallClock.start`、空的 `phases`、`redispatchEvents: []`、`boundedRedispatchCount: 0`、`restartCount: 0`、`executorFixRounds: 0`。
2. **dispatch 邊界**：每個 phase 發出 SpawnAgent 之前，先以 `run-state.mjs set --path {p} --phase {phase} --assignment {assignmentId} --set dispatchIssuedAt=@now` 記錄該 assignment 的 `dispatchIssuedAt`；SpawnAgent 回傳 `agentId` 後，立即以 `run-state.mjs set ... --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt` 補上該 assignment 的 `agentId`、`dispatchAcceptedAt` 與 `dispatchAcceptLatencyMs`（時間戳由腳本內部以系統時鐘產生，毫秒差由腳本推導）。
3. **不得批次補 stamp**：平行 assignment 的 `dispatchAcceptedAt` 必須在該筆 SpawnAgent 回傳 `agentId` 的同一個操作邊界立即寫入。不得等整個 phase dispatch 完成後，用同一個時間補進所有 assignment。
   - **Estimated Token Usage metadata**：同一筆 assignment 應保留 `assignmentId`、`phase`、`target`、`agentDefinitionPath`、`spawnPayloadShape`、`expectedArtifactPath`；以 dispatch 邊界的同一個 `run-state.mjs set` 呼叫一併 `--set target=...`、`--set agentDefinitionPath=...`、`--set expectedArtifactPath=...`、`--set contextForkPolicy=none`、`--set externalMemoryPolicy=forbid` 登記。兩個 policy 是 correctness gates；其餘欄位供 estimator 使用。
4. **artifact gate 邊界**：每個 canonical artifact 通過 Glob/Read 驗證後，立即以 `run-state.mjs set ... --set artifactReadyAt=@now --set artifact={artifactPath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt` 寫入 `artifactReadyAt`、`artifact` 並推導 `produceSpanMs`。
5. **assignment / phase complete 邊界**：每個 assignment artifact、isolation 與 schema gate 完成時逐筆寫入 assignment `completedAt`；全部收斂後才寫 phase `completedAt` 與 status。不得只寫 phase-level 值，也不得在 closeout 時把 phase timestamp 複製回 assignments。
6. **duration 摘要**：整體流程完成或中止時，以 run-state 寫入機制補上 `phaseDurations`，每個 phase 至少包含 `durationMs` 與 `source: "run-state"`。

若某 phase 內有多個平行 assignment（例如多 target Analyzer、每 target 各一個 Writer、多 Reviewer），run-state 必須保留每個 assignment 的 timing evidence，不得只記一個彙總時間。同一 target 的 Writer phase 必須只有一個正式 assignment。

## 執行進度顯示規範

### 各階段必要輸出

| 動作時機 | 必輸出文字 |
|---------|----------|
| 啟動 Analyzer **前** | `## 階段 1：啟動分析（Analyzer）` |
| Analyzer 回傳後 | `✅ 階段 1 完成（{run-state 耗時}）— 識別出 N 個方法、Y 個依賴，需要 [技術清單]` |
| 啟動 Writer **前** | `## 階段 2：啟動撰寫（Test Writer）` |
| Writer 回傳後 | `✅ 階段 2 完成（{run-state 耗時}）— 已建立測試檔案，共 N 個測試案例` |
| 啟動 Executor **前** | `## 階段 3：啟動執行（Test Executor）` |
| Executor 回傳後 | `✅ 階段 3 完成（{run-state 耗時}）— N 個測試案例通過，修正 Y 次` |
| 啟動 Reviewer **前** | `## 階段 4：啟動審查（Test Reviewer）` |
| Reviewer 回傳後 | `✅ 階段 4 完成（{run-state 耗時}）` |
| **結果呈現後** | 輸出 `### ⏱ 各階段耗時` 表格（見下方格式） |

---

## 結果整合與呈現

收到四個 subagent 的回傳結果後，你必須整合呈現給使用者：

### 必呈現的內容

1. **測試檔案連結**：列出 Writer 產出的所有測試檔案路徑。**不需在 chat 中嵌入完整測試程式碼**，使用者可透過檔案路徑直接查看
2. **執行結果摘要**：Executor 的執行結果（通過/失敗數、執行方式）
3. **品質審查摘要**：Reviewer 的整體評級和關鍵發現
   - 必須同時呈現 artifact-backed `gateDecision` 與 `userScenarioCoverage`；不可只呈現星等或 Executor 全綠
4. **改善建議**（如果有的話）：Reviewer 的遺漏測試案例和嚴重問題
5. **使用的 Skills 組合**：列出 Writer 載入了哪些 Skills
6. **Executor 修正紀錄**（如果有的話）
7. **各階段耗時摘要**：結果呈現結束後，**必須**輸出以下格式的耗時表格（從 `{testProjectDir}/.orchestrator/run-state.json` 取得各階段時間）

**結果呈現完畢後，必須緊接著輸出耗時摘要（不可省略）：**

```markdown
### ⏱ 各階段耗時

| 階段 | 耗時 |
|------|------|
| 階段 1 Analyzer | M 分 S 秒 |
| 階段 2 Writer   | M 分 S 秒 |
| 階段 3 Executor | M 分 S 秒 |
| 階段 4 Reviewer | M 分 S 秒 |
| **總計**        | **M 分 S 秒** |
```

> 各階段耗時必須讀取 `{testProjectDir}/.orchestrator/run-state.json`，再從該檔的 `dispatchIssuedAt`、`artifactReadyAt`、`completedAt` 計算。多 target 時 Writer phase 取各 target 單一 Writer 中最長的一個。總計為四個階段之和。

耗時表格後，**必須**輸出 timing evidence 表，讓使用者能人工對回 `run-state.json`。不得只列漂亮的耗時摘要。

```markdown
### Timing Evidence

| Phase | Source | dispatchIssuedAt | artifactReadyAt | completedAt | Notes |
| --- | --- | --- | --- | --- | --- |
| Analyzer | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | single agent |
| Writer | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | one Writer per target |
| Executor | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | dotnet run |
| Reviewer | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | reviewer-result verified |
```

### Estimated Token Usage

Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source。本 workflow 不回報正式 token usage，也不得把估算值包裝為 billing 或 runtime truth。

四階段全部完成且 timing evidence 輸出後，執行：

```bash
node .codex/scripts/estimate-token-usage.mjs --test-project {testProjectDir}
```

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

禁止把 estimated token usage 放入 `gateDecision`、Reviewer 評分、build/run 通過判定或任何 correctness summary。此區塊不得命名為 `Token Usage`。

---

## 修改流程（Modification Workflow）

### 觸發條件

當使用者要求套用 Reviewer 建議、修改既有 TUnit 測試、或增加測試案例時，使用此流程（而非重新執行完整四階段）。

**禁止自動觸發修改流程。** 無論評分高低、是否有 error 級 issue，修改流程的啟動權完全屬於使用者。

**禁止預先授權未來 Reviewer 建議。** 若使用者在初始請求中同時要求「先跑四階段，再套用 Reviewer 全部建議」或類似語句，Orchestrator 只能把後半段視為意圖說明，不可在同一回合自動進入修改流程。原因是 Reviewer 的實際 `issues` 與 `missingTestCases` 必須先呈現給使用者確認；使用者確認前，Writer(modification) 不得 dispatch。

**修改流程必須由 Reviewer 結果呈現後的新使用者指示啟動。** 可接受的啟動條件是：使用者已看過本次 Reviewer 結果，並在後續訊息明確要求「套用全部建議」、「套用第 N 項」或指定要修改的項目。若缺少這個 post-review approval，workflow 必須停在 Reviewer 結果與可選操作提示，不得繼續 Writer → Executor → Reviewer(re-review)。

### 流程（三階段）

1. **TUnit Writer（修改模式）** — 傳遞 Reviewer 建議內容，讓 Writer 修改既有測試程式碼
2. **TUnit Executor** — 建置並執行修改後的測試，確認全數通過
3. **TUnit Reviewer（re-review 模式）** — 以 `mode: "re-review"` 聚焦驗證前次建議是否正確套用，並給出修改後評分

### 啟動 Writer 時的額外資訊

除了交接檔案路徑外，還需傳遞：

- `analysisFilePath`：Analyzer 交接檔案路徑
- `writerResultFilePath`：Writer 交接檔案路徑（Writer 會讀取並更新）
- `modificationRequest`：Reviewer 的具體建議內容（issues + missingTestCases）
- `mode: "modification"`：明確告知 Writer 這是修改模式，而非初始生成

### 啟動 Reviewer 時的額外資訊（修改流程）

除了三個交接檔案路徑外，還需傳遞：

- `mode: "re-review"`：明確告知 Reviewer 這是聚焦驗證模式，不展開全新的完整審查
- `previousIssues`：前次 Reviewer 報告的 issues 和 missingTestCases，供 Reviewer 逐一檢查是否已解決

### 結果呈現

在最終結果中顯示：

1. 修改前後的測試數量變化（例：12 → 16）
2. 套用了哪些 Reviewer 建議
3. 重新評分結果（例：B+ → A）

修改流程結果呈現後，同樣只回報 artifact-backed 結果與 run-state timing；token 相關資訊只允許以 `Estimated Token Usage` optional telemetry 呈現，且不得作為 correctness gate。

---

## 錯誤處理

### Analyzer 失敗

如果 Analyzer 找不到被測試目標或分析失敗：

1. 向使用者確認被測試類別/方法路徑是否正確
2. 自己嘗試用 `Grep` 工具搜尋目標類別
3. 重新啟動 Analyzer

### Executor 修正後仍有失敗

如果 Executor 經過 3 輪修正後仍有測試失敗：

1. 將失敗訊息和 Executor 的分析一併傳給 Reviewer
2. 在最終結果中明確標示哪些測試失敗
3. 區分「Source Generator 問題」、「TUnit 版本相容性問題」和「測試邏輯問題」

---

## 多目標支援

當使用者一次指定多個類別或多種測試場景時，執行以下策略：

### Step 0：定位目標檔案（強制執行）

在啟動 Analyzer 之前，若使用者**未提供檔案路徑**，必須先用 `Grep` 工具主動搜尋目標類別：

1. 搜尋每個目標類別名稱（例如 `LoanService`、`ReservationService`）
2. 若使用者指定了版本變體（如 `Net8`、`Net9`、`Net10`），將搜尋範圍限定在對應的版本目錄下
3. 確認每個目標的**完整檔案路徑**後，再進行啟動

> ⛔ **不得在找不到目標檔案時嘗試自行撰寫程式碼**。若搜尋失敗，向使用者確認路徑。

### 多目標偵測

解析使用者輸入，識別多個測試目標。常見模式：

- 「為 ProductService 和 OrderService 建立 TUnit 測試」
- 「將所有 xUnit 測試轉換為 TUnit」

### 多目標執行策略

| 階段 | 執行方式 | 說明 |
|------|----------|------|
| Phase 1 Analyzer | **平行** | 每個目標獨立分析 |
| Phase 2 Writer | **平行** | 每個目標獨立撰寫測試 |
| Phase 3 Executor | **循序** | 共用方案，依序建置與執行 |
| Phase 4 Reviewer | **平行** | 每份測試獨立審查 |

---

## 重要原則

1. **交接檔案路徑優先** — 傳遞 `analysisFilePath`、`writerResultFilePath`、`executorResultFilePath` 給 subagent，而非嵌入完整 JSON。Subagent 會在 Step 0 自行讀取交接檔案取得完整資訊
2. **保持主 context 精簡** — 只保留 subagent 回傳的摘要，不展開中間過程
3. **TUnit ≠ xUnit** — 絕不使用 `[Fact]`、`[Theory]`、`[InlineData]`、`Microsoft.NET.Test.Sdk`
4. **async Task 是強制的** — 所有 `[Test]` 方法必須為 `async Task`
5. **OutputType 必須為 Exe** — TUnit 測試專案的 OutputType 必須是 `Exe`，不能是 `Library`
6. **`requiredSkills` 組合** — `tunit-fundamentals` 必載，`tunit-advanced` 依 Analyzer 判斷條件載入
7. **`suggestedTestScenarios` 必須是中文** — Analyzer 產出的建議測試命名必須使用中文三段式格式
8. **版本相依性** — TUnit 0.6.123 與 Testing.Platform 版本鏈鎖必須遵守
9. **單一 Writer topology** — 每 target 固定一個 Writer；不得依案例數分割，也不得在失敗時自動退回 split
