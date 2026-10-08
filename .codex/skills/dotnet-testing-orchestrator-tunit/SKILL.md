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

1. 以 `node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/workflow-entry.mjs --run-state {testProjectDir}/.orchestrator/run-state.json --workspace-root {workspaceRoot}` 執行 **TUnit entry gate**。此 gate 必須排在 NuGet preflight、Glob、cleanup 與 init 之前。
   - 回傳 `status: "fresh"`：才進入 Phase -1 與正常 Phase 0。
   - 輸出 blocked phase 與 canonical final Markdown：代表 gate 已 deterministic recovery 並完成 presentation；將 stdout 原樣回覆後停止，本 candidate identity 已消耗。
   - 非零結束或其他既有狀態：立即停止並保留現場，不得 cleanup、init 或 dispatch。
2. 執行 Phase -1 NuGet preflight；只有 `status: "ready"` 才繼續。
3. `Glob({testProjectDir}/.orchestrator/**)` — 檢查 entry gate 已證明不是中斷現場的其他殘留（Phase 0）。
4. （僅在使用者明確啟動新 workflow、且殘留不是未收口狀態時）委託 Executor 清理。
5. 建立 `{testProjectDir}/.orchestrator/run-state.json`（Phase timing truth）；init 成功後，依下述「HTML 實際用量」入口啟動 observer，再進入 Analyzer dispatch transaction。
6. 計算 `analysisOutputPath` 與 `{assignmentId}`，透過 `shell_command` 寫入 Analyzer assignment 的 `dispatchIssuedAt`、`target`、`agentDefinitionPath`、`expectedArtifactPath`、`contextForkPolicy=none`、`externalMemoryPolicy=forbid`。
7. `SpawnAgent target=".codex/agents/dotnet-testing-advanced-tunit-analyzer.toml" payload={...}` — **立即啟動 Analyzer**。
8. SpawnAgent 回傳 `agentId` 後，下一個工具呼叫必須透過 `run-state.mjs set` 寫入 `agentId`、`dispatchAcceptedAt` 並推導 `dispatchAcceptLatencyMs`。

步驟 6～8 合稱 **Analyzer dispatch transaction**，不可拆開、跳過或延後補寫。`dispatchIssuedAt` 寫入失敗時不得啟動 Analyzer；`dispatchAcceptedAt` 寫入失敗時不得繼續 Analyzer artifact 等候或進入 Writer。**除上述步驟外，在啟動 Analyzer 之前不得執行任何其他動作（尤其禁止讀原始碼／Grep 探索）。** 這是非協商性的硬性要求。

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
- 若 Analyzer / Writer / Reviewer 判定完整隔離測試需要修改 `src/**`、production `.csproj`、constructor signature、public API、加入 clock／檔案系統／外部輸出等 production seam，或新增 production 相依套件，Orchestrator 必須把它視為 `requiresUserApproval`。
- 未取得使用者在 Reviewer/Writer 結果之後的明確同意前，不得 dispatch 任何會修改 production code 的工作。
- 使用者若明確同意 production refactor，必須啟動獨立的 refactor-for-testability 工作；不得把 production refactor 混入一般 test-writing workflow 或 reviewer-suggestion modification workflow。
- final report 必須誠實呈現目前結果是 `blocked`、`characterization-only`、或 `requiresUserApproval`，不得把缺 seam 的情境包裝成完整 isolated TUnit test。

### ⚡ 快速啟動原則（MUST READ）

**Orchestrator 在啟動 Analyzer 之前，除了 TUnit entry gate、Phase -1、Glob 殘留檢查、（必要時）cleanup、run-state 初始化、初始化後的本地用量 observer 啟動、與 Analyzer dispatch transaction 必要的 `dispatchIssuedAt` 寫入外，不得有其他工具呼叫。** 你只需要：

1. 執行 TUnit entry gate；它必須在任何 cleanup 或 init 之前先處理已接受 dispatch 的未收口現場。
2. fresh 時執行 Phase -1，再以 `Glob` 檢查其他 `.orchestrator/` 殘留（Phase 0）。
3. （已證明不是中斷現場且本次是新 workflow 時，清理後）建立 `{testProjectDir}/.orchestrator/run-state.json`，成功後啟動本地用量 observer。
4. 計算 `analysisOutputPath` 與 assignment ID，寫入 Analyzer `dispatchIssuedAt`。
5. **立即啟動 Analyzer，取得 `agentId` 後立即寫入 `dispatchAcceptedAt`**。

**深度分析是 Analyzer 的職責，不是你的。** 以下行為在啟動 Analyzer 之前**嚴格禁止**：

- ❌ 讀取被測試目標原始碼（`.cs` 檔案）
- ❌ 讀取 Models、DTOs、DbContext、Repository 等原始碼
- ❌ 讀取 Program.cs 或任何設定檔
- ❌ 使用 Grep 搜尋類別定義、依賴注入、方法簽章等
- ❌ 試圖「先了解專案結構」再啟動 Analyzer

使用者提供的 absolute `workspaceRoot`、source project 目錄或 `.csproj`、被測試目標檔案、類別名稱、明確 class／method scope，以及既有測試專案的 exact `.csproj` 已足夠組裝 Analyzer prompt。Source project 若以目錄提供，只在該目錄直接解析唯一 `.csproj`；找不到或有多個候選時停止，不向上或跨 `src/` 掃描猜測。正式 payload 的 `sourceProjectPath` 使用解析後的 exact `.csproj` absolute path。只有明確沒有測試專案時才要求建立。

### workflowTarget 定義

`workflowTarget` 固定為被測類別的完整類別名稱（含 namespace），也是 run-state 頂層 `target`、各 assignment `target` 與 Analyzer payload 使用的唯一 target identity。指定方法只能放在 `requestedScope.selectors`；不得把方法名稱、方法簽章或 candidate 名稱附加到 `workflowTarget`。

### Phase -1：NuGet sandbox preflight

建立任何 `.orchestrator/` 狀態或 dispatch Analyzer 前，必須執行 TUnit 專屬 preflight。`{restoreProjectPath}` 優先使用既有 `testProjectPath`；明確尚無測試專案時才使用 `sourceProjectPath`：

```bash
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/nuget-sandbox-preflight.mjs --workspace-root {workspaceRoot} --project {restoreProjectPath}
```

第一次 preflight 前，依本次 session／工具明示的 sandbox 與核准政策選擇執行方式；不另跑網路 probe、不讀取 workspace 外設定或快取來判定。一般環境依現有權限執行。若 sandbox 禁止 NuGet feed 連線或所需預設快取存取，且本次沒有可完成 restore 的離線環境證據，只有工具支援且政策允許時，對上述原始完整命令提出單次工具核准：使用 `exec_command` 的 `sandbox_permissions="require_escalated"`，`workdir` 固定為 `{workspaceRoot}`，`justification` 說明允許本次 TUnit NuGet preflight 使用原有 NuGet 設定完成還原，省略 `prefix_rule`。核准由 Orchestrator 處理，不要求使用者在提示詞補寫權限操作；提出核准不等於已獲核准。

核准遭拒、工具不支援或政策禁止時，保留原始原因並停止。核准通過後只執行第一次 preflight，程序未結束就等待同一程序；不得先在 sandbox 執行再換權限重試，不設定永久命令核准、不切換全域 Full Access。`NUGET_PACKAGES` 維持選用，沿用原有 NuGet 設定與預設快取，不改 workspace／user config、不指定固定 cache、不加入 CLI NuGet override。

只有 stdout `status` 為 `ready` 才能進入 Phase 0。非零 exit code 時立即停止，不得建立本次 run-state、dispatch Analyzer、修改 workflow 或改用 Full Access 重跑；將原始命令、核准結果（如有）、exit code、stderr 的 blocker 與 remediation 原樣回報。成功輸出的 `restoreDiagnostics` 是 Phase -1 的 canonical 環境事實，必須保留其 absolute `project.assets.json` source、warning/error 計數與 entries，供 observations 與後續 Executor／Reviewer 對照；不得抑制或丟棄 NU1900。這個 preflight 只驗證目前指定專案在該次實際執行權限下可用的 restore 環境，不保證後續 sandbox 或 Writer 新增且尚未快取的套件一定可用；Executor 依自己的 build／run 迴圈處理 NuGet 權限失敗，不能沿用 preflight 核准作為其他命令的核准。

### HTML 實際用量

run-state init 成功後、Analyzer dispatch transaction 前，執行一次本 workflow 自有入口：

```bash
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/usage-observer.mjs start --workspace-root "{workspaceRoot}" --run-state "{testProjectDir}/.orchestrator/run-state.json"
```

入口以 CODEX_THREAD_ID 綁定目前 root turn，依 SQLite 唯讀代理關係與 run-state agentId 收集逐請求用量；只保存允許的 metadata 與用量欄位至本次 `.orchestrator/usage/{runIdentifier}/`。四角色不讀取 session、SQLite 或 usage artifacts；角色的 `tokenEstimateInputs` 仍是原有 read-scope／isolation 契約，不改為 Unit 的 declaredAccess，也不作 token 估算。

先交付等待頁；不能在 chat 等待自己的回合結束。背景程序在回合完成、資料完整且三次快照一致後更新同一份 HTML，最多收集兩小時。unsupported、failed、incomplete、interrupted 保留原因與已取得資料，不補零、不改測試裁決、不自動重啟。中斷恢復不啟動新 collector；歷史現場沒有 binding 時明列 unavailable。fresh entry 在 Phase 0 處理殘留前確認舊 collector 已停止，無法確認就保留現場；不終止程序，不要求用量成功。

### SpawnAgent 正確呼叫方式

**你必須使用 Codex 原生 SpawnAgent 來啟動 subagent。** `target` 必須指向 `.codex/agents/<name>.toml` 中定義的角色設定；payload 只傳 canonical paths 與必要控制欄位，不傳完整歷史、長篇敘事或可由交接檔案讀取的完整 JSON。

```text
SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-advanced-tunit-analyzer.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "workspaceRoot": "<本次 assignment workspace 絕對路徑>",
  "sourceProjectPath": "<被測 source project 的 exact .csproj 絕對路徑>",
  "filePath": "<被測試目標檔案路徑>",
  "workflowTarget": "<完整類別名稱（含 namespace）>",
  "requestedScope": { "kind": "class" },
  "testProjectPath": "<既有測試專案 exact .csproj 絕對路徑>",
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
  "workspaceRoot": "<本次 assignment workspace 絕對路徑>",
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
  "testProjectPath": "<既有測試專案 exact .csproj 絕對路徑>",
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
  "workspaceRoot": "<本次 assignment workspace 絕對路徑>",
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
- 每個正式 payload 必須傳入 absolute `workspaceRoot`、`executionContext: "self-contained"` 與 `externalMemoryPolicy: "forbid"`，並明確指示跳過 workspace memory quick pass。
- 正式 role 禁止讀取 `$CODEX_HOME/memories/**`、`~/.codex/memories/**`、任何 `MEMORY.md`、rollout summaries、prior session transcript 或 workspace 外部歷史摘要。
- 若角色意外讀取外部 memory，必須在 artifact `tokenEstimateInputs.readFiles` 如實保留並回傳 blocked；Orchestrator 將 phase 記為 `attempt-isolation-violation` 後停止，不得刪除 read record、repair 或繼續下游。
- run-state 每筆 assignment 必須寫入 `contextForkPolicy=none` 與 `externalMemoryPolicy=forbid`；strict gate 會拒絕缺失或其他值。
- 每個 canonical artifact ready 後、下一 phase dispatch 前，執行共用 isolation validator；`--allow-read` 只列本次 run 核准的上游 canonical handoffs：

```bash
# Analyzer
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-attempt-isolation.mjs --workflow tunit --test-project {testProjectPath} --artifact {analysisFilePath}
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-role-read-scope.mjs --role analyzer --workspace-root {workspaceRoot} --agent-definition .codex/agents/dotnet-testing-advanced-tunit-analyzer.toml --artifact {analysisFilePath} [--allow-read {migrationSourcePath} ...]

# Writer（每 target 固定一份 writer-result）
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-attempt-isolation.mjs --workflow tunit --test-project {testProjectPath} --artifact {writerResultFilePath} --allow-read {analysisFilePath}

# Executor / Reviewer
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-attempt-isolation.mjs --workflow tunit --test-project {testProjectPath} --artifact {artifactPath} --allow-read {currentRunArtifactPath} [...]

# Reviewer token-efficiency scope
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-role-read-scope.mjs --role reviewer --workspace-root {workspaceRoot} --artifact {reviewResultFilePath}
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
- ❓ `.orchestrator/run-state.json` 是否已存在？→ **先執行 TUnit entry gate；不得先 cleanup、Phase -1 或 init。若 gate 完成 recovery，原樣回覆 canonical stdout 後停止**
- ❓ Analyzer SpawnAgent 是否剛回傳 `agentId`？→ **下一個工具呼叫立即寫入該 assignment 的 `agentId`、`dispatchAcceptedAt` 與 `dispatchAcceptLatencyMs`，不得先做任何其他動作**
- ❓ 我是否正在讀取 .cs 原始碼但還沒啟動 Analyzer？→ **停止，這是 Analyzer 的工作，不是你的**
- ❓ 我是否正在嘗試讀取 SKILL.md？→ **停止，這是 TUnit Writer 的工作**
- ❓ 我是否正在嘗試撰寫 C# 程式碼？→ **停止，交給 TUnit Writer**
- ❓ 我是否正在嘗試執行 `dotnet build` 或 `dotnet run`？→ **停止，交給 TUnit Executor**
- ❓ 使用者沒有提供被測試目標的 canonical absolute path 嗎？→ **停止並向使用者確認；不得使用 `Grep`，也不得以類別名、target framework、版本字樣或檔名自行定位**
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
角色所需技術型 Skills 必須直接讀取本次 fresh workspace 內的 canonical Skill paths；不得透過全域 Skill discovery 或 `$skill` 語法解析到其他 repository／worktree。
```

---

## 核心工作流程

Writer 與 Reviewer artifact ready 後，Orchestrator 必須執行
`node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-skill-read-scope.mjs --artifact <result.json> --analysis <analysis.json> --workflow tunit --role <writer|reviewer>`。
此 gate 依 Skill ID 精確驗證 `.agents/skills` readFiles；同一 workflow 前綴的技術型 Skill 一律允許並如實記錄，不受 Analyzer `requiredSkills` 限制。其他 workflow Skills／其他 orchestrator Skills 仍拒絕，legacy `.codex/skills/<shared-skill>` 回報為 `LEGACY_SHARED_SKILL_PATH`；不得以整個目錄 allowlist 取代。

你必須嚴格遵循以下流程：TUnit entry gate → Phase -1（NuGet sandbox preflight）→ Phase 0（僅處理已證明不是中斷現場的殘留）→ 階段 1～4（核心四階段）→ Phase 5（證據保留）。

### TUnit entry gate：中斷偵測與 deterministic recovery

任何 Phase -1、Glob、cleanup 或 init 之前，固定執行：

```bash
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/workflow-entry.mjs --run-state {testProjectDir}/.orchestrator/run-state.json --workspace-root {workspaceRoot}
```

此 gate 是正式流程入口，不是維護提示或可選診斷：

- run-state 不存在時輸出 `status: "fresh"`，才可進入 Phase -1。
- run-state 存在、最後一個已派發 phase 有 `dispatchIssuedAt`／`dispatchAcceptedAt`、assignment 尚未完成且沒有 canonical artifact 時，wrapper 必須自行呼叫 `recover-interrupted`，接著依序完成 strict timing validate、blocked phase renderer、final renderer 與 presentation validate。Orchestrator 不得先查 agent 是否仍可承接，也不得把「保留現場」解讀為禁止正式 recovery。
- wrapper 完成 recovery 時，stdout 已包含 canonical phase 與 final Markdown；Orchestrator 必須原樣回覆並停止，不得 cleanup、init、重新派發或開始下游角色。
- run-state 已 terminal、presentation 不完整、workflow 不符或殘留形狀無法安全分類時，必須停止並保留現場；不得以 cleanup 讓錯誤消失。
- 唯讀維護檢查可加 `--inspect`；`status: "interrupted-recovery-required"` 是「存在中斷現場但尚未 recovery」的 machine truth。正式 workflow 不得只 inspect 後停止，必須執行不帶 `--inspect` 的 entry gate。

### Phase 0：前置清理

entry gate 回傳 `status: "fresh"` 且 Phase -1 通過後，才檢查測試專案目錄下是否有其他殘留的 `.orchestrator/` 內容：

1. 使用 Glob 檢查 `{testProjectDir}/.orchestrator/**/*` 是否有檔案。
2. **若有殘留**：只有使用者明確啟動新 workflow，且 entry gate 已證明不是未收口或 presentation 不完整現場時，才委託 Executor subagent 以 `task: "cleanup"` 清理（傳入測試專案路徑）。
3. **若無殘留**：直接初始化 run-state 並進入階段 1

### Phase 0.5：初始化 run-state

Phase 0 清理完成後、**啟動 Analyzer 之前**，以 `node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs init --path {testProjectDir}/.orchestrator/run-state.json --workflow tunit --target {workflowTarget}` 建立 `{testProjectDir}/.orchestrator/run-state.json`（詳見「run-state 持久化與 timing truth（P1）」的 run-state.json 寫入機制）。此檔是本 workflow 的唯一 timing truth source；HTML 用量是獨立的 runtime 觀測值；缺席時不得阻塞測試流程，亦不得取代 run-state 計時或 correctness truth。

### 階段 1：啟動分析（TUnit Analyzer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-tunit-analyzer.toml" payload={...}` 將使用者指定的被測試目標交給 **dotnet-testing-advanced-tunit-analyzer** subagent 分析。

#### Analyzer dispatch transaction（硬閘門）

每個 Analyzer assignment 必須依序完成以下操作；多 target 時每筆 assignment 各自執行，不得只記 phase 彙總時間：

1. SpawnAgent **之前**先執行：

   ```bash
   node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set dispatchIssuedAt=@now --set target={workflowTarget} --set agentDefinitionPath=.codex/agents/dotnet-testing-advanced-tunit-analyzer.toml --set expectedArtifactPath={analysisOutputPath} --set contextForkPolicy=none --set externalMemoryPolicy=forbid
   ```

2. 上述命令成功後才可 SpawnAgent；若失敗，不得啟動 Analyzer。
3. SpawnAgent 回傳 `agentId` 後，下一個工具呼叫必須是：

   ```bash
   node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt
   ```

4. `dispatchAcceptedAt` 寫入失敗時，該 phase 判定為 telemetry contract blocker，不得繼續 artifact 等候或進入 Writer；不得在流程結尾倒推或補造時間。

**傳給 Analyzer 的 prompt 必須包含：**

- **`workspaceRoot`**：本次 assignment fresh workspace 的絕對路徑
- **`sourceProjectPath`**：被測 source project 的 exact `.csproj` 絕對路徑；不得由 Analyzer 向上或掃描 `src/` 猜測
- 被測試目標的絕對檔案路徑（如果使用者提供相對路徑，Orchestrator 必須相對 `workspaceRoot` 正規化）
- 被測試目標的完整類別名稱，以及 Orchestrator 在入口建立的明確 `requestedScope`；全類別為 `{ "kind": "class" }`，指定方法為 `{ "kind": "methods", "selectors": ["<原始方法 selector>"] }`
- 既有測試專案 exact `.csproj` 絕對路徑（讓 Analyzer 能掃描既有測試基礎設施）
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
sourceProjectPath: C:\fresh-workspace\src\MyProject.Core\MyProject.Core.csproj
被測試目標檔案路徑：C:\fresh-workspace\src\MyProject.Core\ProductService.cs
完整類別名稱：MyProject.Core.ProductService
requestedScope: { "kind": "class" }
測試專案路徑：C:\fresh-workspace\tests\MyProject.Core.Tests\MyProject.Core.Tests.csproj
analysisOutputPath: C:\fresh-workspace\tests\MyProject.Core.Tests\.orchestrator\analysis\ProductService.analysis.json
```

`requestedScope` 由 Orchestrator 依使用者指定範圍建立一次並原樣傳入 Analyzer。不得由 candidate identity、target 字串、Analyzer `methodsToTest` 或 scenario 名稱反推 scope。方法 scope 的 `selectors` 保留使用者選取字串；Analyzer 負責解析，Orchestrator 不先改寫成方法清單。

> ⚠️ `workspaceRoot` 與全部 formal paths 都必須是同一 fresh workspace 內的 absolute paths。`analysisOutputPath` 由 Orchestrator 從測試專案路徑去掉 `.csproj` 檔名後拼接 `.orchestrator/analysis/{ClassName}.analysis.json`；Analyzer **不需要自行推導路徑**，也不得依賴 subagent 預設 cwd。

**等候 Analyzer 回傳精簡摘要**，包含：

- `className`、`methodCount`、`scenarioCount`、`methodScenarioCounts`
- `requiredSkills`、`tunitFeatureRequirements`
- `analysisFilePath`：Analyzer 實際寫入的交接檔案路徑（應與 `analysisOutputPath` 一致）
- `projectContext`
- `userScenarioSummary`：provided / accepted / merged / rejected / supplemented；沒有使用者輸入時回傳零值摘要

**驗證交接檔案**：收到 Analyzer 摘要後，確認 `analysisFilePath` 存在並讀取實體 JSON。下列任一 gate 不通過時不得進入 Writer：

- `tokenEstimateInputs.readFiles` 與 `tokenEstimateInputs.writtenFiles` 都存在且為 array，並通過 `--workflow tunit` attempt-isolation；任一 workspace 外 read/write（包含已刪除暫存檔）都判 `attempt-isolation-violation`。
- `projectContext.sourceProjectPath` 與 `projectContext.testProjectPath` 都存在；analysis artifact 必須通過 `tunit-runtime/validate-role-read-scope.mjs --role analyzer`。除了 `--agent-definition` 精確指定且已由 run-state 計入的 assigned Analyzer contract，任何其他 `.codex/agents/**`、orchestrator Skill、其他 workflow definition 或未明確核准的 migration source read 都判 `analyzer-read-scope-violation`，不得進入 Writer。
- `userProvidedScenarioInput`、`scenarioCatalog`、`scenarioReviewSummary` 存在；沒有 user input 時仍須使用完整 GEN fallback schema。
- artifact 的 `requestedScope` 必須與 Analyzer dispatch 完全一致；methods scope 的 `scopeResolution` 必須逐一解析 selectors，解析結果聯集等於 artifact `methodsToTest`，所有有效 scenarios 均屬於解析後方法。class scope 下 `methodsToTest` 只是已分析 public methods 的資訊，不得縮小 constructor guards 或其他有效 scenarios。
- 每個 `USR-*` 都逐項記錄，`rejected` 使用允許的 reason code 且附具體 evidence。
- 所有有效 catalog `normalizedName` 依序等於 `suggestedTestScenarios`，並可直接作為合法 C# identifier。
- `scenarioReviewSummary.effective`、`suggestedTestScenarios.length`、`scenarioCount` 與 `methodScenarioCounts` 加總一致。
- scope 內每個方法的參數 metadata 都包含 `isOptional` 與 `defaultValueExpression`；含 optional 參數的方法至少有一個有效 scenario，其 `optionalParameterDefaultBinding` 一次列出並省略全部 optional 參數。

在標記 Analyzer assignment 完成前，以同一份 dispatch scope 執行 deterministic gate：

```bash
# class scope
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-scenario-contract.mjs --workflow tunit --analysis {analysisFilePath} --requested-scope-kind class

# methods scope；每個 selector 重複一個參數
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-scenario-contract.mjs --workflow tunit --analysis {analysisFilePath} --requested-scope-kind methods --requested-scope-selector {selector}

# 兩種 scope 都必須另外通過 TUnit optional-parameter gate；失敗時由 wrapper deterministic closeout 並執行 canonical renderer
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-optional-parameter-gate.mjs --analysis {analysisFilePath} --run-state {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --workspace-root {workspaceRoot}
```

每個 Analyzer assignment 的 artifact gate 通過時，必須在同一操作邊界執行：

```bash
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --assignment {assignmentId} --set artifactReadyAt=@now --set artifact={analysisFilePath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt
```

全部 Analyzer assignments 的 artifact gate 都通過、phase 確定收斂後，才執行：

```bash
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs set --path {testProjectDir}/.orchestrator/run-state.json --phase analyzer --set completedAt=@now
```

進入 Writer 前，Analyzer assignment 必須已有非 `null` 的 `dispatchIssuedAt`、`dispatchAcceptedAt`、`artifactReadyAt`、`produceSpanMs`，Analyzer phase 必須已有非 `null` 的 `completedAt`。Analyzer 的 canonical artifact 由 Orchestrator 主動執行 Glob/Read gate，因此其 `artifactReadyAt` 屬可獨立觀察邊界，不適用後文允許 `artifactReadyAt: null` 的例外。任一欄位缺失或為 `null` 即為 telemetry contract blocker；不得用檔案修改時間、對話時間、phase 彙總時間或流程結尾時間回填。

#### 階段間交接（Analyzer → Writer）

只有在 Analyzer role 已回傳 `completed` terminal、全部 Analyzer assignments 的 canonical analysis artifacts 已存在，且進入下一 phase 所需的既有 artifact、attempt isolation、read-scope、schema 與 telemetry gates 全部通過後，才可 dispatch Writer。角色回傳 `blocked` 或 `failed` terminal 不代表 artifact gate 通過；必須依既有失敗契約保存 evidence 並停止，或只執行當次已授權的既有 bounded repair／re-dispatch。當次 live 未授權重試時立即停止。

對已 completed agent 不得呼叫 `interrupt_agent` 模擬 close，也不要求 host 提供 completed-agent close；目前沒有實測證據可宣稱 completed agent 必然釋放 runtime slot。實際 dispatch 若回報 capacity／thread-limit 失敗，依當次授權與既有失敗契約保存結構化 blocker 並停止或處理，不得改變正式 phase 順序或每個 target 單一 Writer topology。

### 階段 2：啟動撰寫（TUnit Writer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-advanced-tunit-writer.toml" payload={...}` 將分析結果交給 **dotnet-testing-advanced-tunit-writer** subagent 撰寫測試。

#### 單一 Writer 策略（必要）

每個 target 無論 `methodCount`、`scenarioCount`、`targetType` 或 `forbidWriterSplit` 為何，固定只 dispatch **一個 Writer subagent**。禁止依方法、scenario、setup 或預估輸出大小分割成多個 Writer assignments。

此規則只固定 Writer topology，不限制 Analyzer 應產生的測試情境數量，也不刪減任何合理且 in-scope 的案例。單一 Writer 必須處理 Analyzer artifact 中完整的 `suggestedTestScenarios`、有效 `scenarioCatalog`、`methodScenarioCounts` 與 constructor guards。Validator 的 `forbidWriterSplit` 只保留為相容性 metadata，不再參與 topology 決策。

若單一 Writer 因 context / output limit 無法完成，必須將該次 phase 記為 blocker 並保留失敗證據；不得臨時改用 split、不得靜默刪減 scenarios，也不得把未完成 scope 交給第二個 Writer。後續若要恢復其他 topology，必須另立實驗與取得使用者明確同意。

**傳給 Writer 的 prompt（依照 Writer 的輸入契約）：**

1. **`analysisFilePath`** — Analyzer 交接檔案路徑（Writer 會在 Step 0 讀取完整分析 JSON）
2. **被測試目標的檔案路徑**
3. **測試檔案的預期輸出路徑** — 只能依使用者指定路徑或目前測試專案已證實的慣例決定。推導規則：
   - `{TestDir}` = 測試專案目錄（取 `projectContext.testProjectPath` 去掉結尾的 `.csproj` 檔名後的目錄）。
   - 使用者明確指定測試檔路徑時採用該 canonical path。
   - 未指定時，若既有測試專案呈現單一且一致的目錄慣例，依該慣例放置；空白專案或慣例不唯一時，預設為 `{TestDir}/{ClassName}Tests.cs`。
   - 不得從 repository sample、source 的特定目錄名稱或歷史 fixture 結構推導測試輸出目錄。
   - 單一 Writer 因檔案組織需要時可產生多個測試檔，但全部檔案都必須列入同一份 writer-result，且不得將 coverage 拆成另一個 Writer assignment。
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
有 `scenarioCatalog` 時不需另傳 scenario 子集合；單一 Writer 從 analysis artifact 的 `requestedScope` 取得唯一範圍並處理全部有效項目。不得在 Writer prompt 另傳 `methodsToTest`、`methodName`、`assignedMethods` 或 `writerControls.methods` 建立第二套範圍來源。

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

明確範圍檢查：

- `methodsCovered` 必須是明確方法名稱清單，不得使用 `All`、`FullClass`、空陣列或敘述文字替代。
- `requestedScope.kind === "methods"` 時，`methodsCovered` 只能包含 `scopeResolution` 解析出的 methods，不得包含其他 public methods；`requestedScope.kind === "class"` 時，artifact `methodsToTest` 只供描述已分析 public methods，不可用來排除有效 scenarios。
- class scope 若有 constructor guards、`methodScenarioCounts.Constructor > 0` 或有效 catalog 的 `methodName === "Constructor"`，`methodsCovered` 必須包含 `"Constructor"`；單一 Writer 負責全部 constructor guard 測試。methods scope 只有 selector 明確解析到 `Constructor` 時才納入。
- `scenarioCoverage` 必須恰好涵蓋目前 `requestedScope` 下 analysis 的全部有效 scenario IDs，任何 missing、duplicate 或越界都失敗；不得只認領部分 methods 或 scenarios。
- `scenarioCoverage.status` 只可為 `implemented`、`blocked`、`limitation`；後兩者必須有具體 note。
- `scenarioCoverage.normalizedName` 必須逐字等於 catalog，`implemented.testMethodNames` 必須包含該名稱。
- analysis scenario 含 `optionalParameterDefaultBinding` 時，對應 `scenarioCoverage` 必須為 `implemented` 並逐欄複製 marker；Writer 必須在對應測試呼叫中真正省略 marker 列出的全部 optional 參數，明示傳入同值不算完成。
- `testCaseCount` 必須反映 `[Arguments]`／`[MethodDataSource]` 預期展開數，不得只複製 scenario 數。

在 dispatch Executor 前執行 TUnit 專屬 artifact-chain gate：

```bash
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-optional-parameter-gate.mjs --analysis {analysisFilePath} --writer {writerResultFilePath} --run-state {testProjectDir}/.orchestrator/run-state.json --phase writer --assignment {assignmentId} --workspace-root {workspaceRoot}
```

此 gate 驗證 Analyzer marker 與 Writer coverage claim 完整一致，但不解析 C#。若 Writer 虛報 marker、實際呼叫仍明示 optional 參數，這個 artifact gate 無法辨識；此限制必須保留在驗證紀錄，不得把 artifact 通過描述成語法層保證。Wrapper 在 validator 非零結束時固定呼叫 TUnit `fail-gate` transition，完成 assignment／phase failure、空 artifact timing、finalize、strict validate、失敗 phase renderer、final renderer 與 presentation receipt 驗證；Orchestrator 不得再以 `set` 手動補欄位，也不得用模型摘要取代 renderer stdout。

若 writer-result 缺欄位、不可讀、或方法範圍不一致：

1. 不得 dispatch Executor。
2. 更新 run-state writer phase：`artifactReadyAt: null`、`artifact: null`、`failure` 填入缺失欄位或 scope mismatch。
3. 若符合 bounded re-dispatch 條件，最多 re-dispatch Writer 2 次，要求只修復 missing artifact / scope mismatch，不得重啟整個 workflow。
4. 若 bounded re-dispatch 後仍不完整，將 workflow 判定為 blocker。

#### 階段間交接（Writer → Executor）

只有在 Writer role 已回傳 `completed` terminal、全部 Writer assignments 的 canonical writer-result artifacts 已存在，且進入下一 phase 所需的既有 artifact、attempt isolation、schema、scenario acceptance 與 telemetry gates 全部通過後，才可 dispatch Executor。角色回傳 `blocked` 或 `failed` terminal 不代表 artifact gate 通過；必須依既有失敗契約保存 evidence 並停止，或只執行當次已授權的既有 bounded repair／re-dispatch。當次 live 未授權重試時立即停止。

對已 completed agent 不得呼叫 `interrupt_agent` 模擬 close，也不要求 host 提供 completed-agent close；目前沒有實測證據可宣稱 completed agent 必然釋放 runtime slot。實際 dispatch 若回報 capacity／thread-limit 失敗，依當次授權與既有失敗契約保存結構化 blocker 並停止或處理，不得改變正式 phase 順序或每個 target 單一 Writer topology。

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
- `commandExecutions` 逐次保存實際 clean/build/run 命令原文、absolute test project path、working directory、attempt、exit code 與輸出片段；不得事後重建或覆寫舊紀錄。成功時至少一筆 build，run 筆數必須等於 `executionAttempts`。
- `diagnostics.restore` 必須逐字反映 test project `project.assets.json.logs[]`；`diagnostics.compile` 必須另行保存 build 輸出中的編譯診斷。NuGet 還原診斷與編譯警告不得混為一談，也不得用 `WarningLevel=0` 等方式抑制。
- `fixRounds` / `executorFixRounds` 必須落入 run-state，不得只寫在對話摘要。
- `tokenEstimateInputs` 必須存在並通過 isolation。

若 executor-result 顯示使用 `dotnet test`，該 phase 判定為 blocker，不得進入成功報告。

以 deterministic TUnit adapter 驗證單一 Writer artifact、case accounting 與 runtime truth。Validator 仍支援多個 `--writer` 參數，只用於讀取歷史實驗 artifacts；正式 workflow 必須只傳一份：

```bash
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-execution-contract.mjs --analysis {analysisFilePath} --writer {writerResultFilePath} --executor {executorResultFilePath} --require-pass
```

此 gate 失敗時記錄 Executor correctness failure，仍必須依核心四階段規則執行 Reviewer；最終結果不得標為通過，也不得納入 baseline/candidate comparator。

#### 階段間交接（Executor → Reviewer）

只有在 Executor role 已回傳 `completed` terminal、canonical executor-result artifact 已存在，且進入 Reviewer 所需的既有 artifact、attempt isolation 與 schema gates 已通過、execution evidence 已保存後，才可 dispatch Reviewer。角色回傳 `blocked` 或 `failed` terminal 不代表 artifact gate 通過；必須依既有失敗契約保存 evidence 並停止，或只執行當次已授權的既有 bounded repair。Executor correctness failure 仍依前述規則執行 Reviewer，不等於略過 artifact gate。當次 live 未授權重試時立即停止。

對已 completed agent 不得呼叫 `interrupt_agent` 模擬 close，也不要求 host 提供 completed-agent close；目前沒有實測證據可宣稱 completed agent 必然釋放 runtime slot。實際 dispatch 若回報 capacity／thread-limit 失敗，依當次授權與既有失敗契約保存結構化 blocker 並停止或處理，不得改變正式 phase 順序。

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
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-role-read-scope.mjs --role reviewer --workspace-root {workspaceRoot} --artifact {reviewResultFilePath}
```

此 read-scope gate 拒絕 Reviewer 讀回自己的 canonical reviewer-result。失敗時保留 Reviewer correctness artifact 與 `gateDecision`，但將本次 token comparison 判為 ineligible。

接著由 deterministic TUnit execution contract 對照 canonical executor-result 與 reviewer-result。validator 會檢查每次實際命令、`project.assets.json` 與 restore diagnostics 的逐項一致性，以及 Reviewer `diagnosticAssessment` 是否逐字對應 Executor 的 restore／compile 分流證據。任一 warning 存在時，Reviewer 不得使用 `pass` 或宣稱沒有 warning；沒有其他失敗時使用 `pass_with_warnings` 並列出診斷 code。若 `buildResult` 不是 `success`，Reviewer 必須使用 `upstream-build-blocked` 固定契約，不得宣稱未經編譯的測試程式碼已通過靜態品質審查；若 build 成功但 tests 失敗，仍維持完整品質審查：

```bash
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-execution-contract.mjs --analysis {analysisFilePath} --writer {writerResultFilePath} --executor {executorResultFilePath} --reviewer {reviewResultFilePath}
```

此 gate 驗證的是 Reviewer artifact 與上游 Executor truth 的一致性，不改寫既有 `gateDecision`。gate 失敗時，Reviewer phase 以 artifact contract failure 收尾，不得採信其品質判語。

接著以 analysis、單一 writer-result 與 reviewer-result 執行正式 acceptance gate：

```bash
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/validate-scenario-contract.mjs --workflow tunit --analysis {analysisFilePath} --requested-scope-kind {class|methods} [--requested-scope-selector {selector} ...] --writer {writerResultFilePath} --reviewer {reviewResultFilePath} --require-review-pass
```

Reviewer canonical artifact 的結構、情境或 isolation 契約無效時，Reviewer phase 必須以 `failed` 與非空 `failure.kind` 收尾。若 artifact 本身契約有效，只是 `--require-review-pass` 因受支援的 `gateDecision: "fail"` 或 `"blocked"` 拒絕 acceptance，Reviewer phase 仍是 `completed`；workflow terminal 由該 canonical `gateDecision` 決定，不得改寫成 operational phase failure，也不得因 `dotnet run` 全綠改寫成通過。Reviewer canonical artifact 與各 phase 的觀測邊界寫入完成後、final report 前執行：

```bash
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs finalize --path {p}
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs validate --path {p} --require-complete-timing
```

TUnit 的 `phaseDurations`、`overallWallClock.end`／`durationMs`、頂層 `terminalDecision`、`terminalCloseout` 與 `profilingSummary` 全部由 `finalize` 從 phase boundaries 與 canonical reviewer-result 推導。Orchestrator 不得用 `set`、`derive` 或手寫 JSON 宣告這些欄位；完整四階段的公開 terminal decision 必須原樣保留 Reviewer `gateDecision`（`pass`／`pass_with_warnings`／`fail`／`blocked`），並在 `terminalCloseout.lifecycle` 另記錄 operational lifecycle。

任何 TUnit phase 以 `blocked` 或 `failed`（含相容狀態）結束時，phase 或 assignment 必須先寫入非空 `failure.kind`；artifact 已存在也不構成省略理由。缺少時 finalize 與 validate 都必須拒絕。

Analyzer artifact gate 拒絕 `run-state.mjs set` 時，runtime 會在回傳錯誤前以 `analyzer_artifact_gate_rejected` 寫入 assignment／phase failure、完成時間及空 artifact timing truth，並自動 finalize；Orchestrator 不得手動補寫 terminal 欄位。Optional-parameter gate 拒絕時必須由 `validate-optional-parameter-gate.mjs` 呼叫固定的 `fail-gate` transition，並在同一 wrapper 內完成 strict validate 與 canonical phase／final renderer；不得拆回模型管理。若已接受 dispatch 的 agent 因 host／session 中斷而未回傳，控制權恢復後必須由正式 TUnit entry gate 呼叫 `recover-interrupted` 並完成 renderer／presentation；runtime 固定以 `agent_response_missing` 收口未完成 assignment，不得由模型自行選擇 failure kind、status 或 timestamp。外部 host 已停止期間 repository runtime 無法執行；不得把中斷後尚未經 entry gate recovery 的檔案宣稱為 terminal truth。

strict run-state gate 失敗時不得宣稱 timing evidence 完整，也不得把該 attempt 納入 baseline/candidate comparator；禁止事後以推測 timestamp 補值。

### Phase 5：證據保留

四階段流程全部完成後，保留本次 `.orchestrator/executor-result/` canonical artifact，不得在結果呈現後刪除或覆寫。`.orchestrator/analysis/`、`.orchestrator/writer-result/`、`.orchestrator/executor-result/`、`.orchestrator/reviewer-result/` 與 `.orchestrator/run-state.json` 必須一併保留，供驗收與 benchmark 讀取；只有下一次 workflow 的 Phase 0 在既有授權下才可處理前次殘留。

---

## run-state 持久化與 timing truth（P1）

> **run-state.json 寫入機制（必用，跨平台）**：run-state.json 一律透過 `shell_command` 呼叫 `node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs` 建立與更新。**不得**假設有「Write 工具」、**不得**用 `date -u`、**不得**手寫 shell read-modify-write。理由：Codex 沒有「Write」工具，且不同 runtime（Codex CLI vs VS Code Codex Extension）shell 不同；改善前 Extension 環境會整段略過 run-state 維護，導致 run-state.json 從不產生、各階段耗時全空。此腳本為純量參數 API（不傳 JSON blob，避免 PowerShell 引號問題），時間戳由腳本內部以系統時鐘產生（值寫 `@now` 即取 ISO 8601 UTC），毫秒差由 `--derive 欄位=END-START` 推導。以下 `{p}` 代表 `{testProjectDir}/.orchestrator/run-state.json`。常用呼叫：
>
> ```bash
> # 初始化（Phase 0 清理後、啟動 Analyzer 前）
> node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs init --path {p} --workflow tunit --target {workflowTarget}
> # dispatch 前：記 dispatchIssuedAt
> node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set dispatchIssuedAt=@now --set target={workflowTarget} --set agentDefinitionPath={tomlPath} --set expectedArtifactPath={artifactPath} --set contextForkPolicy=none --set externalMemoryPolicy=forbid
> # 收到 agentId：記 agentId/dispatchAcceptedAt，推導 latency
> node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt
> # artifact 落地：記 artifactReadyAt/artifact，推導 produceSpan
> node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set artifactReadyAt=@now --set artifact={artifactPath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt
> # assignment gate 完成：逐筆記 completedAt，不得只寫 phase-level 值
> node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set completedAt=@now
> # phase 收斂：記 completedAt
> node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs set --path {p} --phase analyzer --set completedAt=@now
> # 計數；TUnit terminal/timing closeout 由 finalize 推導
> node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs set --path {p} --set executorFixRounds={n}
> # bounded re-dispatch 事件：append 一筆
> node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs append --path {p} --array redispatchEvents --set phase=writer --set cause=agent-thread-limit --set occurredAt=@now --set waitMs={ms}
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

1. **初始化檔案**：Phase 0 清理完成且啟動 Analyzer 前，以 `run-state.mjs init --path {p} --workflow tunit --target {workflowTarget}` 建立 `{testProjectDir}/.orchestrator/run-state.json`；腳本自動含 `workflow: "tunit"`、`target`、`overallWallClock.start`、空的 `phases`、`redispatchEvents: []`、`boundedRedispatchCount: 0`、`restartCount: 0`、`executorFixRounds: 0`。
2. **dispatch 邊界**：每個 phase 發出 SpawnAgent 之前，先以 `run-state.mjs set --path {p} --phase {phase} --assignment {assignmentId} --set dispatchIssuedAt=@now` 記錄該 assignment 的 `dispatchIssuedAt`；SpawnAgent 回傳 `agentId` 後，立即以 `run-state.mjs set ... --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt` 補上該 assignment 的 `agentId`、`dispatchAcceptedAt` 與 `dispatchAcceptLatencyMs`（時間戳由腳本內部以系統時鐘產生，毫秒差由腳本推導）。
3. **不得批次補 stamp**：平行 assignment 的 `dispatchAcceptedAt` 必須在該筆 SpawnAgent 回傳 `agentId` 的同一個操作邊界立即寫入。不得等整個 phase dispatch 完成後，用同一個時間補進所有 assignment。
   - **Assignment metadata**：同一筆 assignment 應保留 `assignmentId`、`phase`、`target`、`agentDefinitionPath`、`spawnPayloadShape`、`expectedArtifactPath`；以 dispatch 邊界的同一個 `run-state.mjs set` 呼叫一併 `--set target=...`、`--set agentDefinitionPath=...`、`--set expectedArtifactPath=...`、`--set contextForkPolicy=none`、`--set externalMemoryPolicy=forbid` 登記。兩個 policy 是 correctness gates。
4. **artifact gate 邊界**：每個 canonical artifact 通過 Glob/Read 驗證後，立即以 `run-state.mjs set ... --set artifactReadyAt=@now --set artifact={artifactPath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt` 寫入 `artifactReadyAt`、`artifact` 並推導 `produceSpanMs`。
5. **assignment / phase complete 邊界**：每個 assignment artifact、isolation 與 schema gate 完成時逐筆寫入 assignment `completedAt`；全部收斂後才寫 phase `completedAt` 與 status。不得只寫 phase-level 值，也不得在 closeout 時把 phase timestamp 複製回 assignments。
6. **deterministic closeout**：整體流程完成時執行 `run-state.mjs finalize`；Analyzer artifact gate 拒絕時由該次 `set` 自動寫入 failure 並 finalize，optional-parameter gate 拒絕時由 TUnit wrapper 呼叫固定 `fail-gate` transition，已接受 dispatch 卻未回傳時由 TUnit entry gate 呼叫 `recover-interrupted` 並原子完成 strict validate、phase／final renderer 與 presentation validate。runtime 以已派發 phases 的 `completedAt - earliest dispatchIssuedAt` 推導 `phaseDurations`，以 terminal phase `completedAt` 推導 `overallWallClock.end`／`durationMs`，並從 canonical reviewer-result 或 early-terminal failure truth 推導 terminal。不得由模型補寫或覆寫 failure kind、status、timestamp 或 terminal 欄位。

若某 phase 內有多個平行 assignment（例如多 target Analyzer、每 target 各一個 Writer、多 Reviewer），run-state 必須保留每個 assignment 的 timing evidence，不得只記一個彙總時間。同一 target 的 Writer phase 必須只有一個正式 assignment。

## 執行進度顯示規範

四個開始標題固定由 Orchestrator 在 dispatch 前輸出：

- `## 階段 1：啟動分析（Analyzer）`
- `## 階段 2：啟動撰寫（Test Writer）`
- `## 階段 3：啟動執行（Test Executor）`
- `## 階段 4：啟動審查（Test Reviewer）`

每個 phase 的 canonical artifact gate 通過、assignment 與 phase `completedAt`／`status` 已寫入後，必須呼叫 TUnit renderer，並將 stdout 原樣輸出；不得自行重寫、摘要、改名或省略欄位：

```bash
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/workflow-result.mjs phase --run-state {p} --phase analyzer
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/workflow-result.mjs phase --run-state {p} --phase writer
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/workflow-result.mjs phase --run-state {p} --phase executor
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/workflow-result.mjs phase --run-state {p} --phase reviewer
```

Renderer 從 run-state 與該 phase canonical artifacts 推導固定完成句；多 target 時彙總所有 assignments。Renderer 失敗即為 presentation contract blocker，不得改用模型自行組字替代。

---

## 結果整合與呈現

`finalize` 與 render 前 strict `validate` 都成功後，執行 canonical renderer；renderer 會把 output path、SHA-256、terminal decision 與 `renderedAt` 寫入 run-state `presentation` receipt。接著必須以 `--require-presentation` 再驗證一次：

```bash
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/workflow-result.mjs final --run-state {p} --workspace-root {workspaceRoot} --json-output {testProjectDir}/.orchestrator/workflow-result/tunit-workflow-result.json --markdown-output {testProjectDir}/.orchestrator/workflow-result/tunit-workflow-result.md
node .codex/scripts/dotnet-testing-codex-full/tunit-runtime/run-state.mjs validate --path {p} --require-complete-timing --require-presentation
```

Renderer 只讀 run-state 記錄的 canonical Analyzer、Writer、Executor、Reviewer artifacts，並同步產生 machine JSON、固定 Markdown 與受雜湊保護的 presentation receipt。stdout 就是 canonical Markdown，Orchestrator 必須原樣作為最終回覆，不得另行拼裝或在前後加入另一份結果摘要。既有輸出檔不得覆寫；若已存在，停止並回報 presentation contract blocker。TUnit `init` 會先建立 `presentation.status: "pending"`；terminal run 缺少 completed receipt 時，`--require-presentation` 必須失敗，使「renderer 未執行」成為可機檢狀態。

Renderer 在 Profiling Summary 之後，以尾端獨立的 `### HTML token-usage report` 提供報告連結、可複製 fileUrl、目前收集狀態與工具回傳 note；正常 final、optional-parameter failure closeout 與 interrupted recovery 都傳入同一 canonical workspace。HTML 格式、文字、表格、狀態與選用 Standard credit 互動沿用鎖定完整 Lite 模板，runtime 只匯入 TUnit 自有模組。pending／observing 可於回合結束後重新整理；缺少 run-state 或 binding 時如實明列未產生，不補造連結。用量收齊不等於測試成功，也不可直接與 CLI 只列主代理的退出摘要比較。

固定 Markdown 依序只有七個 `##` 區塊：`測試結果總覽`、`情境覆蓋`、`Reviewer 結論`、`修正、異常與交付`、`各階段耗時`、`Timing Evidence`、`Profiling Summary`。TUnit 執行欄位必須是 `dotnet run`、`SourceGenerated` 與 TUnit case accounting；不得虛構 Unit 專屬 TRX、Cobertura 或程式碼 coverage 欄位。`pass_with_warnings` 必須保留 Reviewer `issues` 內的 warnings，不得把它簡化為無異常通過。


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

修改流程結果呈現後，同樣只回報 artifact-backed 結果與 run-state timing。

---

## 錯誤處理

### Analyzer 失敗

如果 Analyzer 找不到被測試目標或分析失敗：

1. 保留 Analyzer 的原始 blocker 與 canonical path 證據
2. 向使用者確認被測試類別／方法的 canonical absolute path 是否正確
3. 使用者提供正確 canonical path 且另行授權重試後，才以新的 candidate identity 重新啟動 Analyzer；不得自行使用 `Grep`、類別名、target framework、版本字樣或檔名搜尋替代目標

### Executor 修正後仍有失敗

如果 Executor 經過 3 輪修正後仍有測試失敗：

1. 將失敗訊息和 Executor 的分析一併傳給 Reviewer
2. 在最終結果中明確標示哪些測試失敗
3. 區分「Source Generator 問題」、「TUnit 版本相容性問題」和「測試邏輯問題」

---

## 多目標支援

當使用者一次指定多個類別或多種測試場景時，執行以下策略：

### Step 0：確認每個目標的 canonical path（強制執行）

啟動 Analyzer 前，每個目標都必須有使用者提供且位於同一 `workspaceRoot`／`sourceProjectPath` 內的絕對檔案路徑、完整類別名稱與明確 class／method scope。

1. 正規化並驗證每個 target path 的存在性與 workspace containment。
2. 驗證 target path 屬於指定的 exact `sourceProjectPath`，不得向上、跨專案或掃描版本目錄猜測。
3. 任一目標缺少 canonical path、類別名稱或 scope 時立即停止，向使用者確認；不得以類別名、target framework、版本字樣、檔名或 sample 目錄結構推導。

> ⛔ **不得在找不到目標檔案時嘗試自行撰寫程式碼**。

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
