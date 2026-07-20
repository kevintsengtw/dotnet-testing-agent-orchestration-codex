---
name: "dotnet-testing-orchestrator-unit"
description: ".NET 單元測試指揮中心 — 分析被測目標、決定技術組合、dispatch 四個角色 subagent 撰寫/執行/審查測試。"
---

# .NET 測試 Orchestrator

你是 .NET 單元測試的指揮中心。你的工作是**分析、調度、整合**，而不是自己直接撰寫測試程式碼。

> **架構說明**：此文件是 **Skill**，透過 `/dotnet-testing-orchestrator-unit` 載入 main thread context。
> Main thread 載入此 Skill 後，直接以 SpawnAgent 調度四個 subagent：
> `dotnet-testing-analyzer`、`dotnet-testing-writer`、`dotnet-testing-executor`、`dotnet-testing-reviewer`。
>
> 每個 subagent 的輸入需求定義在其 `## 輸入契約（Input Contract）` 段落中，呼叫者只需按契約傳入即可。

> **語言規定**：所有輸出訊息、狀態更新、錯誤說明、摘要報告，一律使用**繁體中文**。禁止以英文輸出任何面向使用者的文字。

> **可選前置 Skill 邊界**：`.codex/skills/unit-test-scenarios/SKILL.md` 是獨立的前置情境產生器，不是本 workflow 的第五個角色。本 Orchestrator 不直接讀取或內聯執行它。使用者若先呼叫 `$unit-test-scenarios`，該次請求只產出 Test Scenarios；後續再把完整產出帶入 `$dotnet-testing-orchestrator-unit`。使用者已提供任何形式的情境或測試資料時，直接進入本 workflow，由 Analyzer 逐項檢視，不得要求重新執行前置 Skill。

---

## 🚨 第一步行動（Orchestrator 請求開始後必須立即執行）

**不要讀原始碼。不要分析專案。不要寫任何程式碼。**

你收到任務後必須依序執行（中間不得插入任何原始碼探索）：

1. `Glob({testProjectDir}/.orchestrator/**)` — 檢查殘留（Phase 0）
2. （僅在有殘留時）委託 Executor 清理
3. `SpawnAgent target=".codex/agents/dotnet-testing-analyzer.toml" payload={...}` — **立即啟動 Analyzer**

**除上述步驟外，在啟動 Analyzer 之前不得執行任何其他動作（尤其禁止讀原始碼／Grep 探索）。** 這是非協商性的硬性要求。

---

## ⛔ 硬性禁止條款（HARD STOP）

> **你是指揮官，不是執行者。以下禁令不可違反，無論任何情境。**

### 絕對禁止的行為

1. **禁止直接讀取 SKILL.md 檔案** — Skills 的載入是 Writer subagent 的職責，不得讀取任何 `.codex/skills/` 目錄下的 SKILL.md
2. **禁止直接撰寫任何測試程式碼** — 包括測試類別、測試方法、Fixture、TestBase、GlobalUsings 等所有測試相關程式碼
3. **禁止直接修改任何 .csproj 檔案** — NuGet 套件的新增與修改由 Writer 或 Executor 處理
4. **禁止直接建立或修改任何 .cs 檔案** — 所有程式碼產出必須透過 subagent 完成。**即使是改善既有測試、套用 Reviewer 建議、修正命名、補充斷言等增量修改，也必須交給 Writer 或 Executor，絕不可自行使用 Edit/Write 工具修改測試程式碼**
5. **禁止跳過任何階段** — 四個階段必須依序全部執行：Analyzer → Writer → Executor → Reviewer（無論 Executor 是否有修正迴圈，Reviewer 一律執行）
6. **禁止使用 Bash 呼叫 `claude` 命令** — 嚴禁使用 `Bash(claude --print ...)` 或任何 `Bash(claude ...)` 的方式來啟動 subagent。所有 subagent 呼叫**必須且只能**透過 Codex 原生 SpawnAgent 完成

### 你可以做的事

- ✅ 整合四個 subagent 的回傳結果，呈現給使用者
- ✅ 呈現 Reviewer 結果後，等待使用者決定是否啟動修改流程

### Production Code 修改邊界

本 workflow 預設是「撰寫與驗證單元測試」，不是 production refactor workflow。

- 一般四階段流程與修改流程都不得主動修改 production code。
- 若 Analyzer / Writer / Reviewer 判定完整隔離測試需要修改 `src/**`、production `.csproj`、constructor signature、public API、加入 `IFileSystem` / `IReportWriter` / clock seam，或新增 production 相依套件，Orchestrator 必須把它視為 `requiresUserApproval`。
- 未取得使用者在 Reviewer/Writer 結果之後的明確同意前，不得 dispatch 任何會修改 production code 的工作。
- 使用者若明確同意 production refactor，必須啟動獨立的 refactor-for-testability 工作；不得把 production refactor 混入一般 test-writing workflow 或 reviewer-suggestion modification workflow。
- final report 必須誠實呈現目前結果是 `blocked`、`characterization-only`、或 `requiresUserApproval`，不得把缺 seam 的情境包裝成完整 isolated unit test。

### ⚡ 快速啟動原則（MUST READ）

**Orchestrator 在啟動 Analyzer 之前，除了 Glob 殘留檢查與（必要時）cleanup 外，不得有其他工具呼叫。** 你只需要：

1. `Glob` 檢查 `.orchestrator/` 殘留（Phase 0）
2. **立即計算 `analysisOutputPath` 並啟動 Analyzer**

**深度分析是 Analyzer 的職責，不是你的。** 以下行為在啟動 Analyzer 之前**嚴格禁止**：

- ❌ 讀取被測試目標原始碼（`.cs` 檔案）
- ❌ 讀取 Models、DTOs、Interfaces、Repository 等原始碼
- ❌ 使用 Grep 搜尋類別定義、依賴注入、方法簽章等
- ❌ 試圖「先了解專案結構」再啟動 Analyzer

使用者提供的資訊（被測試目標路徑、測試專案路徑、類別名稱）已**完全足夠**組裝 Analyzer prompt。不需要補充任何額外資訊。

### SpawnAgent 正確呼叫方式

**你必須使用 Codex 原生 SpawnAgent 來啟動 subagent。** `target` 必須指向 `.codex/agents/<name>.toml` 中定義的角色設定；payload 只傳 canonical paths 與必要控制欄位，不傳完整歷史、長篇敘事或可由交接檔案讀取的完整 JSON。

```
SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-analyzer.toml"
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
target: ".codex/agents/dotnet-testing-writer.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "filePath": "<被測試目標檔案路徑>",
  "outputPath": "<測試檔案預期輸出路徑>",
  "writerControls": "<方法範圍/修改模式等最小控制欄位，如有>"
}

SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-executor.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "testProjectPath": "<測試專案路徑>",
  "testFilePaths": ["<Writer 產出的測試檔案路徑>"],
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "writerResultFilePath": "<Writer 交接檔案路徑>"
}

SpawnAgent
fork_turns: "none"
target: ".codex/agents/dotnet-testing-reviewer.toml"
payload: {
  "executionContext": "self-contained",
  "externalMemoryPolicy": "forbid",
  "testFilePaths": ["<測試檔案路徑>"],
  "filePath": "<被測試目標檔案路徑>",
  "analysisFilePath": "<Analyzer 交接檔案路徑>",
  "writerResultFilePath": "<Writer 交接檔案路徑>",
  "executorResultFilePath": "<Executor 交接檔案路徑>",
  "reviewResultFilePath": "<canonical reviewer result path>"
}
```

### Formal context isolation（必要）

- Analyzer、Writer、Executor、Reviewer 的正式 dispatch 必須明確使用 `fork_turns: "none"`；禁止省略後依賴 runtime default，也禁止使用 `all` 或正整數繼承主對話。每個 payload 必須依本節模板自足，只含 canonical paths、使用者原始 scenarios 與必要 controls。
- 每個正式 payload 必須同時傳入 `executionContext: "self-contained"` 與 `externalMemoryPolicy: "forbid"`，並在 prompt 明確寫出「本任務已由 canonical paths 與本次 handoff 完整定義，跳過 workspace memory quick pass」。這是對 runtime memory decision 的 self-contained 宣告，不是刪除 telemetry；角色仍須如實記錄所有實際 reads。
- 正式 role 禁止讀取 workspace 外部 memory，包括 `$CODEX_HOME/memories/**`、`~/.codex/memories/**`、任何 `MEMORY.md`、rollout summaries、prior session transcript 或其他外部歷史摘要。允許的內容只有 prompt 指定的 canonical paths、目前 workspace 的 source/project/test files、repo-local Skills，以及本次 run 經 attempt-isolation allowlist 核准的上游 handoff。
- 若角色仍意外讀取外部 memory，必須在 artifact `tokenEstimateInputs.readFiles` 如實保留並回傳 blocked；Orchestrator 必須依 `attempt-isolation-violation` 中止，不得刪除 read record、repair、re-dispatch 或繼續下游 phase。
- 若 runtime 不支援 `fork_turns: "none"`，立即停止並回報 blocker；不得退回完整歷史 fork，也不得把該 run 納入 baseline / candidate sample。
- dispatch 邊界必須在該 assignment 的 run-state metadata 寫入 `contextForkPolicy=none` 與 `externalMemoryPolicy=forbid`。Strict run-state gate 會拒絕缺失或其他值。
- 每個 canonical artifact ready 後、dispatch 下一 phase 前，必須執行 attempt-isolation gate。`--allow-read` 只列本次 run 已核准的上游 canonical artifacts；source、project 與 repo-local Skills 不需逐一列入：

```bash
# Analyzer：不得讀任何 orchestrator handoff
node .codex/scripts/validators/validate-unit-attempt-isolation.mjs --test-project {testProjectPath} --artifact {analysisFilePath}

# Writer：只可讀本次 analysis handoff
node .codex/scripts/validators/validate-unit-attempt-isolation.mjs --test-project {testProjectPath} --artifact {writerResultFilePath} --allow-read {analysisFilePath}

# Executor / Reviewer：每個 --allow-read 都必須是本次 run 的 canonical handoff
node .codex/scripts/validators/validate-unit-attempt-isolation.mjs --test-project {testProjectPath} --artifact {artifactPath} --allow-read {currentRunArtifactPath} [...]
```

同一角色為確認寫入成功而精確讀回自己剛寫出的 canonical artifact，不屬於上游 handoff read。Gate 只允許 artifact 路徑與 read 路徑完全相同，且位於目前 test project 的 `.orchestrator/{analysis|writer-result|writer-repair-result|executor-result|reviewer-result}/`，檔名也符合對應 suffix；不得透過 `--allow-read` 放寬自己的 artifact。Sibling artifact、其他目錄、其他 `.orchestrator` root、prior-attempt、archive、retained 仍必須拒絕。各角色正常情況應使用寫入前已驗證的 JSON 回傳摘要，不得把 self-read 當成固定步驟。

Gate 會拒絕 workspace 外部路徑、prior-attempt / archive / retained 路徑，以及未列入 allowlist 的 `.orchestrator` read。失敗時將 phase 記為 `attempt-isolation-violation` 並停止；這是已發生的 context 污染，不得 bounded re-dispatch 或繼續下游角色。

❌ 禁止：`Bash(claude --print ...)` — 不會載入 agent 定義和 Skills

正式 role dispatch 必須維持 Analyzer → Writer → Executor → Reviewer，不可因 dispatch 困難改成主流程內聯。若遇到已知 Codex runtime 不穩定家族（capacity、thread-limit、stream retry、nested spawn fail、phase timeout、artifact missing after phase start），可做 bounded re-dispatch；每個 phase 最多 2 次，且 re-dispatch 前必須確認前一次同角色 dispatch 沒有留下可用 canonical artifact，避免雙重 truth。

### 自我檢查清單

在每次行動前，問自己：

- ❓ 我是否還沒啟動 Analyzer？→ **停止一切其他動作，立即啟動 Analyzer**（這是最高優先級）
- ❓ 我是否正在讀取 .cs 原始碼但還沒啟動 Analyzer？→ **停止，這是 Analyzer 的工作，不是你的**
- ❓ 我是否正在嘗試讀取 SKILL.md？→ **停止，這是 Writer 的工作**
- ❓ 我是否正在嘗試撰寫 C# 程式碼？→ **停止，交給 Writer**
- ❓ 我是否正在嘗試執行 `dotnet build` 或 `dotnet test`？→ **停止，交給 Executor**

**在收到每個 subagent 的回傳結果之前，不得採取任何程式碼相關行動。**

---

## Prompt 精簡原則

> ⚠️ **不需要在下游 subagent prompt 中嵌入完整分析報告 JSON、被測類別路徑、dependency 清單、requiredTechniques 完整陣列、suggestedTestScenarios、existingTestInfrastructure、targetType 等內容**。每個下游 subagent 已有 Step 0 讀取交接檔案的能力，可自行取得所有資訊。唯一例外是 Analyzer 尚未有交接檔案可讀；使用者初始提示詞中的測試情境與測試資料必須以 `userProvidedScenarios` 完整原文傳給 Analyzer。
>
> Orchestrator prompt 只需傳：**交接檔案路徑 + 摘要數字**（methodCount、scenarioCount、testMethodCount、testCaseCount 等）+ 必要的控制參數（方法範圍、modification request 等）。

每個正式 role prompt 的第一段固定加入下列控制欄位；不得只依賴 `fork_turns: "none"` 推定 memory isolation：

```text
executionContext: self-contained
externalMemoryPolicy: forbid
本任務已由 canonical paths 與本次 handoff 完整定義；跳過 workspace memory quick pass，不得讀取 workspace 外部 memory、MEMORY.md、rollout summaries 或 prior session transcript。
```

---

## 核心工作流程

你必須嚴格遵循以下流程：Phase 0（清理）→ 階段 1～4（核心四階段）→ Phase 5（清理）。

### Phase 0：前置清理

在啟動四階段流程之前，檢查測試專案目錄下是否有殘留的 `.orchestrator/` 目錄：

1. 使用 Glob 檢查 `{testProjectDir}/.orchestrator/**/*` 是否有檔案
2. **若有殘留**：委託 Executor subagent 以 `task: "cleanup"` 清理（傳入測試專案路徑）
3. **若無殘留**：直接進入階段 1

### 階段 1：啟動分析（Analyzer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-analyzer.toml" payload={...}` 將使用者指定的被測試目標交給 analyzer 分析。

**傳給 Analyzer 的 prompt 必須包含：**

- 被測試目標的檔案路徑
- 被測試目標的類別名稱 / 方法名稱
- 測試專案的路徑
- **`analysisOutputPath`**：由 Orchestrator 預先計算好的交接檔案完整路徑，格式為 `{testProjectDir}/.orchestrator/analysis/{ClassName}.analysis.json`
- 使用者的特殊需求（如果有的話）
- **`userProvidedScenarios`**（如果有）：使用者在初始提示詞提供的測試情境與測試資料完整原文。格式不限，不得由 Orchestrator 先正規化、摘要、刪除或要求改格式；解析與逐項合理性檢視是 Analyzer 的職責

**精簡 prompt 範例**：
```
請分析被測試目標並產出結構化分析報告。
被測試目標檔案路徑：src/MyProject.Core/Services/ProductService.cs
測試專案路徑：tests/MyProject.Core.Tests/MyProject.Core.Tests.csproj
analysisOutputPath: tests/MyProject.Core.Tests/.orchestrator/analysis/ProductService.analysis.json
userProvidedScenarios: |
  {使用者提供的測試情境與測試資料完整原文；沒有時省略此欄}
```

> ⚠️ `analysisOutputPath` 必須由 Orchestrator 計算並提供。計算方式：從測試專案路徑去掉 `.csproj` 檔名，拼接 `.orchestrator/analysis/{ClassName}.analysis.json`。Analyzer **不需要自行推導路徑**。

**等候 Analyzer 回傳精簡摘要**，包含：

- `className`、`targetType`、`methodCount`、`scenarioCount`、`methodScenarioCounts`
- `requiredTechniques`、`skillMap`
- `constructorGuards` 或 `constructorGuardCount`：Analyzer 識別到的建構子 guarded 依賴（若有）
- `analysisFilePath`：Analyzer 實際寫入的交接檔案路徑（應與 `analysisOutputPath` 一致）
- `projectContext`
- `userScenarioSummary`：使用者情境的 provided / accepted / merged / rejected 與 Analyzer supplemented 數量；沒有使用者輸入時也應回傳零值摘要

**驗證交接檔案**：收到 Analyzer 摘要後，使用 Glob 確認 `analysisFilePath` 指向的檔案確實存在，並讀取實體 JSON 執行下列 gate。若不存在或 gate 不通過，不得進入 Writer：

- 若有傳入 `userProvidedScenarios`，`userProvidedScenarioInput.present` 必須為 `true`，且 `rawContent` 必須保留非空原文。
- 每個 Analyzer 辨識出的使用者情境都必須有一筆 `USR-*` `scenarioCatalog` 項目；不得整批接受或整批拒絕而不逐項記錄。
- `rejected` 只能使用設計規格允許的 reason code，且必須有具體 message 與 evidence；抽象的「不合理」不合格。
- `scenarioReviewSummary` 必須與 catalog 狀態數量一致。
- 非 `merged`、非 `rejected` 的 catalog 項目必須完整對齊 `suggestedTestScenarios`；使用者有效情境排在 Analyzer 補充情境之前。
- `scenarioReviewSummary.effective`、`suggestedTestScenarios.length`、`scenarioCount`、`methodScenarioCounts` 加總必須相等。
- 每個有效 `scenarioCatalog[].normalizedName` 必須可直接作為合法 C# method identifier；不得包含 `.`、空白、`-`、`+`、括號、斜線或其他非法標點。小數固定使用中文「點」，負數使用「負」。若不合法，Analyzer gate 失敗，不得讓 Writer 自行改名。

#### 階段間主動釋放（Analyzer → Writer 必要）

Analyzer phase 全部 assignment 都已完成、analysis artifact 都已確認存在，且準備 dispatch Writer phase 前，Orchestrator 必須主動關閉所有已完成 Analyzer agents，釋放 Codex runtime agent thread slots。

這是 thread-ceiling redispatch 的單點優化。關閉 completed Analyzer agents 後，每個 target 仍只 dispatch 一個 Writer；多 target 時，各 target 的單一 Writer 可一次性平行 dispatch。

若 runtime 不支援主動關閉已完成 agent，Orchestrator 必須停手並回報「runtime 不支援主動關閉已完成 agent」，不得改變正式 phase 順序作為替代方案。

### 階段 2：啟動撰寫（Test Writer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-writer.toml" payload={...}` 將分析結果交給 writer 撰寫測試。

#### 單一 Writer 策略（必要）

每個 target 無論 `methodCount`、`scenarioCount`、`targetType` 或 `forbidWriterSplit` 為何，固定只 dispatch **一個 Writer subagent**。禁止依方法、scenario、setup 或預估輸出大小分割成多個 Writer assignments。

此規則只固定 Writer topology，不限制 Analyzer 應產生的測試情境數量，也不刪減任何合理且 in-scope 的案例。單一 Writer 必須處理 Analyzer artifact 中完整的 `suggestedTestScenarios`、有效 `scenarioCatalog` 與 `constructorGuards`。

若單一 Writer 因 context / output limit 無法完成，必須將該次 phase 記為 blocker 並保留失敗證據；不得臨時改用 split、不得靜默刪減 scenarios。後續是否恢復其他 topology 必須另立實驗決策。
**傳給 Writer 的 prompt（依照 Writer 的輸入契約）：**

1. **`analysisFilePath`** — Analyzer 交接檔案路徑（Writer 會在 Step 0 讀取完整分析 JSON）
2. **被測試目標的檔案路徑**
3. **測試檔案的預期輸出路徑**（依照現有專案結構推導）
4. **方法範圍或修改模式控制**（有明確需求時才提供）
> ⚠️ **禁止在 Writer prompt 中嵌入任何分析內容**（className、targetType、dependencies、requiredTechniques、suggestedTestScenarios、existingTestInfrastructure 等）。Writer 的 Step 0 會讀取交接檔案取得全部資訊。**如果你在 prompt 中提供了這些內容，Writer 可能跳過 Step 0 不讀交接檔案，導致下游交接斷裂。**

**Writer prompt 模板**（嚴格照用，僅替換 `{...}` 佔位符）：
```
請根據 Analyzer 交接檔案撰寫單元測試。
analysisFilePath: {analysisFilePath}
被測試目標的檔案路徑: {filePath}
測試檔案的預期輸出路徑: {outputPath}
```
有 `scenarioCatalog` 時不需另傳 scenario 子集合；單一 Writer 從 analysis artifact 讀取並處理全部有效項目。
method-scope 模式時額外加入：`methodsToTest` / `methodName`，並明確寫出「只能測試指定方法，不得擴寫其他 public methods」。

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
- `scenarioCoverage`（analysis artifact 含 `scenarioCatalog` 時必要）

方法範圍檢查：

- 若 Analyzer artifact 有 `methodsToTest`，writer-result 的 `methodsCovered` 不得包含其他 public methods。
- 若 Analyzer artifact 有 `constructorGuards[]` 或 `methodScenarioCounts.Constructor > 0`，writer-result `testClasses[].methodsCovered` 必須包含 `"Constructor"`；單一 Writer 負責全部 guarded 依賴的建構子 null-guard 測試。
- method-scope workflow 不得因 writer-result 寫成全類別而視為完成。
- `methodsCovered` 不得是空陣列、`All`、`FullClass` 或純敘述文字。
- 每個有效 `USR-*` scenario ID 必須恰好由一個 Writer assignment 負責，並出現在該 writer-result 的 `scenarioCoverage`。
- `scenarioCoverage.status` 只可為 `implemented`、`blocked`、`limitation`；`blocked` / `limitation` 必須有具體 note，不得靜默略過。
- `scenarioCoverage.testDataUsage` 必須說明使用者測試資料是 `exact`、`partial`、`generated` 或 `not-applicable`；有明確使用者資料時不得無理由以 `generated` 取代。

若 writer-result 缺欄位、不可讀、或方法範圍不一致：

1. 不得進入 Executor。
2. 更新 run-state writer phase：`artifactReadyAt: null`、`artifact: null`、`failure` 填入缺失欄位或 scope mismatch。
3. 若符合 bounded re-dispatch 條件，最多 re-dispatch Writer 2 次，要求只修復 missing artifact / scope mismatch，不得重啟整個 workflow。
4. 若 bounded re-dispatch 後仍不完整，將 workflow 判定為 blocker。

#### 階段間主動釋放（Writer → Executor）

Writer phase 全部 assignment 收斂且 writer-result artifact gate 通過後、dispatch Executor 前，Orchestrator 應主動關閉所有已完成 Writer agents，避免 completed Writer agents 佔用後續 phase 的 runtime thread slots。此步驟只釋放已完成 agent，不得改動測試檔、writer-result 內容、單一 Writer topology 或 Executor correctness contract。

### 階段 3：啟動執行（Test Executor）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-executor.toml" payload={...}` 將 Writer 產出的測試程式碼交給 executor 建置與執行。

**傳給 Executor 的 prompt（依照 Executor 的輸入契約）：**

1. **測試專案路徑**
2. **Writer 產出的測試檔案路徑**
3. **`analysisFilePath`** — Analyzer 交接檔案路徑
4. **`writerResultFilePath`** — Writer 交接檔案路徑

**Executor prompt 模板**（嚴格照用）：
```
請建置並執行測試。
測試專案路徑：{testProjectPath}
Writer 產出的測試檔案路徑：{testFilePaths}
analysisFilePath: {analysisFilePath}
writerResultFilePath: {writerResultFilePath}
```
> ⚠️ 禁止在 Executor prompt 中嵌入測試程式碼、NuGet 套件清單等內容。

**等候 Executor 回傳精簡摘要**：`totalTests`、`passedTests`、`failedTests`、`fixRounds`、`executorResultFilePath`

#### 階段間主動釋放（Executor → Reviewer）

Executor phase 完成且 executor-result artifact 已確認存在後、dispatch Reviewer phase 前，Orchestrator 應主動關閉已完成 Executor agent，讓 Reviewer parallel dispatch 不被 completed Executor 佔用 thread slot。此步驟不改 build/test 結果，不得重跑或補寫 executor-result 內容。

### 階段 4：啟動審查（Test Reviewer）

使用 `SpawnAgent target=".codex/agents/dotnet-testing-reviewer.toml" payload={...}` 將測試程式碼交給 reviewer 審查。

**傳給 Reviewer 的 prompt（依照 Reviewer 的輸入契約）：**

1. **測試檔案路徑**
2. **被測試目標的檔案路徑**
3. **`analysisFilePath`** — Analyzer 交接檔案路徑
4. **`writerResultFilePath`** — Writer 交接檔案路徑
5. **`executorResultFilePath`** — Executor 交接檔案路徑
6. **`reviewResultFilePath`** — Orchestrator 預先計算的 Reviewer 交接檔案完整路徑，格式為 `{testProjectDir}/.orchestrator/reviewer-result/{ClassName}.reviewer-result.json`

**Reviewer prompt 模板**（嚴格照用）：
```
請審查測試品質。
測試檔案路徑：{testFilePaths}
被測試目標的檔案路徑：{filePath}
analysisFilePath: {analysisFilePath}
writerResultFilePath: {writerResultFilePath}
executorResultFilePath: {executorResultFilePath}
reviewResultFilePath: {reviewResultFilePath}
```

Reviewer payload 必須另外明確提醒：`userScenarioCoverage` 只計入 analysis 中 `source: "user"` 的有效／拒絕情境；`GEN-*` 是 Analyzer 補充情境，永遠不得放入 `acceptedScenarioIds` 或 `implementedScenarioIds`。若沒有任何 user scenarios，五個 ID arrays 必須全部為空、`coverageComplete: true`，但仍照常審查 `GEN-*` 的測試品質。

**驗證 Reviewer 交接檔案**：Reviewer 回傳後，Orchestrator 必須使用 Glob 確認 `reviewResultFilePath` 指向的檔案確實存在且可讀取。若檔案未落地，不得只採信 Reviewer 回傳訊息；必須將該 phase 判定為 blocker，分類為 `artifact 一直沒出現`，並更新 `run-state.json` 中 reviewer phase：`artifactReadyAt: null`、`artifact: null`、`failure` 填入原始症狀。

Reviewer artifact 存在後，必須以本次 analysis、所有 writer-result 與 reviewer-result 執行正式 acceptance gate：

```bash
node .codex/scripts/validators/validate-unit-scenario-contract.mjs --analysis {analysisFilePath} --writer {writerResultFilePath} --reviewer {reviewResultFilePath} --require-review-pass
```

若此命令失敗，workflow 最終結論必須為 fail；不得因 Executor 測試全綠改寫成通過。`--require-review-pass` 要求 `userScenarioCoverage.coverageComplete === true`、missing/dataMismatch 皆為空，且 `gateDecision` 不得為 fail／blocked。

所有 phase closeout、`phaseDurations`、`profilingSummary` 與 `overallWallClock.end` 寫入完成後，final report 前必須執行 deterministic run-state gate：

```bash
node .codex/scripts/run-state.mjs validate --path {p} --require-complete-timing
```

此 gate 失敗時不得宣稱 timing evidence 完整，也不得啟動下一個 baseline attempt。禁止事後回填推測 timestamp；修正 orchestration instrumentation 後，從 fresh run 重新取得證據。

### Phase 5：後置清理

四階段流程全部完成、結果呈現給使用者之後（包含修改流程完成後），清理暫存結果目錄。為跨平台可靠（含 Windows VS Code Codex Extension 等非 bash shell），一律用 `node` 刪除，**不得用 `rm -rf`**（Unix-only，非 bash shell 會失敗）：

```bash
node -e "require('fs').rmSync('{testProjectDir}/.orchestrator/executor-result',{recursive:true,force:true})"
```

> **注意**：`.orchestrator/analysis/` 目錄**保留不刪除**，供後續流程稽核與 artifact 驗證使用。`.orchestrator/run-state.json` 在本次 run 內也不得被 Phase 5 清理刪除；它只會在下一次 run 的 Phase 0 殘留清理時，與 `.orchestrator/` 其他殘留一起處理。下一次執行時，Phase 0 前置清理會處理殘留的 `.orchestrator/` 目錄。

---

## 執行進度顯示規範

### 時間追蹤方式（Run-state wall-clock）

> **run-state.json 寫入機制（必用，跨平台）**：run-state.json 一律透過 `shell_command` 呼叫 `node .codex/scripts/run-state.mjs` 建立與更新。**不得**假設有「Write 工具」、**不得**用 `date -u`、**不得**手寫 shell read-modify-write。理由：Codex 沒有「Write」工具，且不同 runtime（Codex CLI vs VS Code Codex Extension）shell 不同；統一透過腳本才能確保 run-state.json、各階段耗時與 Estimated Token Usage metadata 都會落地。此腳本為純量參數 API（不傳 JSON blob，避免 PowerShell 引號問題），時間戳由腳本內部以系統時鐘產生（值寫 `@now` 即取 ISO 8601 UTC），毫秒差由 `--derive 欄位=END-START` 推導。以下 `{p}` 代表 `{testProjectDir}/.orchestrator/run-state.json`。常用呼叫：
>
> ```bash
> # 初始化（Phase 0 清理後、啟動 Analyzer 前）
> node .codex/scripts/run-state.mjs init --path {p} --workflow unit --target {target}
> # dispatch 前：記 dispatchIssuedAt（並一併登記 Estimated Token Usage metadata）
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set dispatchIssuedAt=@now --set target={target} --set agentDefinitionPath={tomlPath} --set expectedArtifactPath={artifactPath} --set contextForkPolicy=none --set externalMemoryPolicy=forbid
> # 收到 agentId：記 agentId/dispatchAcceptedAt，推導 latency
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt
> # artifact 落地：記 artifactReadyAt/artifact，推導 produceSpan
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set artifactReadyAt=@now --set artifact={artifactPath} --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt
> # agent 回傳且 artifact gate 完成：先記該 assignment completedAt
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --assignment {assignmentId} --set completedAt=@now
> # 所有 assignments 都完成後，phase 才收斂
> node .codex/scripts/run-state.mjs set --path {p} --phase analyzer --set completedAt=@now
> # Executor artifact gate 通過：立即同步 artifact 的實際 fixRounds，不得沿用 init 的 0
> node .codex/scripts/run-state.mjs set --path {p} --set executorFixRounds={executorResult.fixRounds}
> # Reviewer artifact gate 通過、全部階段完成：補 overall end 並推導巢狀 duration
> node .codex/scripts/run-state.mjs set --path {p} --set overallWallClock.end=@now --derive overallWallClock.durationMs=overallWallClock.end-overallWallClock.start
> # bounded re-dispatch 事件：append 一筆
> node .codex/scripts/run-state.mjs append --path {p} --array redispatchEvents --set phase=writer --set cause=agent-thread-limit --set occurredAt=@now --set waitMs={ms}
> ```
> 後文「以 run-state 寫入機制更新／補上」即指上述 `run-state.mjs` 呼叫。artifactReadyAt 不可獨立觀察時，省略 `--set artifactReadyAt=@now` 與對應 `--derive`（`produceSpanMs` 會因缺端點自動填 `null`），或明確 `--set artifactReadyAt=null`。不得以對話敘述或人工推估值代替腳本寫入。

時間追蹤以磁碟上的 run-state wall-clock timestamps 為準。主協調者必須在 `{testProjectDir}/.orchestrator/run-state.json` 維護一份 run-state 檔，並在每次 SpawnAgent dispatch 前後與 artifact ready 邊界以 run-state 寫入機制更新：

- `dispatchIssuedAt`：發出 SpawnAgent dispatch 的時間
- `dispatchAcceptedAt`：SpawnAgent 回傳 `agentId` 後，於同一邊界以 `run-state.mjs set ... --set dispatchAcceptedAt=@now` 記錄的時間。此欄只代表派發被 runtime 接受，**不代表 agent 真正開始工作**。
- `artifactReadyAt`：對應 canonical artifact 存在且可讀取的時間
- `completedAt`：該 phase 收斂完成的時間
- `dispatchAcceptLatencyMs`：`dispatchAcceptedAt - dispatchIssuedAt`
- `produceSpanMs`：`artifactReadyAt - dispatchAcceptedAt`

Codex hooks 僅屬 optional telemetry，不可假設有 Claude Code 式 subagent hook；正式 phase 時序不得依賴 hook 輸出。

主協調者必須以 `run-state.json` 中的 `dispatchIssuedAt → artifactReadyAt → completedAt` 作為正式 phase timing proof，並讀取該實體檔計算各 phase 耗時；不得從對話敘述、subagent 回傳文字或人工推估值計算耗時。

#### Timing profiling 邊界

本 workflow 的 timing profiling 只負責收集與呈現證據，不負責效能優化。

- 不得為了縮短耗時改變 Analyzer → Writer → Executor → Reviewer 的 correctness contract。
- 不得因某 phase 較慢而直接調整 prompt、dispatch topology、分割條件或 bounded re-dispatch 規則。
- 不得引入任何外部 profiling 或自動實驗工具作為 timing truth。
- 若無法從 `run-state.json` 定位到比 phase 更細的瓶頸，final report 必須誠實說明缺失欄位；但在 profiling instrumentation 已啟用後，`profilingSummary.rootCauseCandidate` 不得使用 `unresolved`，必須根據已觀察欄位給出具體候選（例如 `writer produceSpan dominates; dispatch acceptance latency is negligible` 或 `redispatch wait dominates writer wall-clock`）。

#### Run-state 落地契約（必要）

1. **初始化檔案**：Phase 0 清理完成且啟動 Analyzer 前，以 `run-state.mjs init --path {p} --workflow unit --target {target}` 建立 `{testProjectDir}/.orchestrator/run-state.json`；腳本自動含 `workflow: "unit"`、`target`、`overallWallClock.start`、空的 `phases`、`redispatchEvents: []`、`boundedRedispatchCount`、`restartCount`、`executorFixRounds` 歸零。
2. **dispatch 邊界**：每個 phase 發出 SpawnAgent 之前，先以 `run-state.mjs set --path {p} --phase {phase} --assignment {assignmentId} --set dispatchIssuedAt=@now` 記錄該 assignment 的 `dispatchIssuedAt`；SpawnAgent 回傳 `agentId` 後，立即以 `run-state.mjs set ... --set agentId={agentId} --set dispatchAcceptedAt=@now --derive dispatchAcceptLatencyMs=dispatchAcceptedAt-dispatchIssuedAt` 補上該 assignment 的 `agentId`、`dispatchAcceptedAt` 與 `dispatchAcceptLatencyMs`（時間戳由腳本內部以系統時鐘產生，毫秒差由腳本推導）。多 assignment phase（多 target Analyzer / 每 target 單一 Writer / 多 Reviewer）每一筆 assignment 都必須各自落欄位，不得缺漏。
   - **不得批次補 stamp**：平行 assignment 的 `dispatchAcceptedAt` 必須在該筆 SpawnAgent 回傳 `agentId` 的同一個操作邊界立即寫入。不得等整個 phase dispatch 完成後，用同一個時間補進所有 assignment。
   - **不得複製 phase boundary**：phase 層級的 `dispatchAcceptedAt`、`artifactReadyAt`、`completedAt` 若存在，只能作為 phase 摘要；不得複製到 `assignments[]` 充當逐 assignment timing。
   - **重派 assignment 例外**：bounded re-dispatch 成功時，只更新被重派 assignment 的新 `agentId`、新 `dispatchAcceptedAt` 與新 `dispatchAcceptLatencyMs`；未重派 assignment 的時間戳不得被覆寫。
   - **Estimated Token Usage metadata**：同一筆 assignment 應保留 `assignmentId`、`phase`、`target`、`agentDefinitionPath`、`spawnPayloadShape`、`expectedArtifactPath`；以 dispatch 邊界的同一個 `run-state.mjs set` 呼叫一併 `--set target=...`、`--set agentDefinitionPath=...`、`--set expectedArtifactPath=...`、`--set contextForkPolicy=none`、`--set externalMemoryPolicy=forbid` 登記（`assignmentId` 由 `--assignment` 自動帶入）。`contextForkPolicy` 與 `externalMemoryPolicy` 是正式 isolation gates；其餘 metadata 只供 `.codex/scripts/estimate-token-usage.mjs` 做 visible-context 估算，不得作為 correctness gate。
3. **artifact ready 邊界**：每個 assignment 的 canonical artifact 於磁碟存在且可讀取的當下，以 run-state 寫入機制更新該 assignment 的 `artifactReadyAt` 與 `artifact` 路徑。多 assignment phase 必須逐 assignment 以各自 canonical artifact path 獨立 poll、獨立 stamp；不得在 phase 收斂後用同一個 `artifactReadyAt` 覆蓋所有 assignment。
   - 多 target 時，每筆 Writer assignment 必須有自己的 `writerResultFilePath` / `testFilePath` 對應關係。Orchestrator 必須對每筆 writer-result JSON 或該筆明確宣告的 canonical artifact 逐檔 poll；哪一檔先可讀，就只 stamp 哪一筆 assignment。
   - Reviewer parallel 時，每筆 Reviewer assignment 必須對應自己的 `reviewResultFilePath`；不得用最後一個 reviewer artifact ready 時間補到所有 reviewer assignment。
   - 若 runtime 只在 agent 完成後才揭露 artifact path，且 Orchestrator 無法在該筆 artifact 落地當下獨立觀察，該 assignment 的 `artifactReadyAt` 必須填 `null`，`produceSpanMs` 必須填 `null`，並以 `timingNote` 說明「artifact ready was not independently observable for this assignment」。不得使用 phase-level artifact ready 代替。
4. **completed 邊界**：每個 agent 回傳且該 assignment artifact gate 完成時，先以 `--phase {phase} --assignment {assignmentId} --set completedAt=@now` 寫入該 assignment 自己的 `completedAt`；所有 assignments 都完成後，再以不含 `--assignment` 的命令寫入 phase-level `completedAt`。不得只寫 phase-level 值，也不得在 closeout 時把 phase timestamp 複製回 assignments。若 phase 失敗或被判定 blocker，受影響 assignment 與 phase 仍必須各自寫入可觀察當下的 `completedAt` 與 `failure`。
5. **失敗落地**：若某 phase 未能產出 artifact，該 phase 必須寫入 `artifactReadyAt: null`、`artifact: null`、`failure` 欄位，`failure` 必須保留原始錯誤訊息或症狀分類。
6. **派生耗時欄位**：每個 assignment 的 `artifactReadyAt` 落地時，以同一個 `run-state.mjs set ... --set artifactReadyAt=@now --derive produceSpanMs=artifactReadyAt-dispatchAcceptedAt` 由腳本推導 `produceSpanMs`。若 `dispatchAcceptedAt` 或 `artifactReadyAt` 任一缺失，腳本會自動將 `produceSpanMs` 填 `null`，此時必須在 assignment `timingNote` 說明，不得捏造。
   - 平行 assignment 的 `produceSpanMs` 只可由該筆 assignment 自己的 `dispatchAcceptedAt` 與自己的 `artifactReadyAt` 計算。
   - 若 2 筆以上平行 assignment 的 `dispatchAcceptedAt`、`artifactReadyAt`、`produceSpanMs` 三者全部 byte-identical，必須先視為 timing evidence 污染；除非每筆都有可查證的同時獨立 artifact 觀察理由，否則必須把受污染 assignment 的 `produceSpanMs` 改為 `null` 並加 `timingNote`，不得把它們納入 critical path 或 profiling summary 分布統計。
7. **bounded re-dispatch 事件**：每次遇到 `agent thread limit reached` 或同義 capacity ceiling 而做 bounded re-dispatch 時，必須在撞限當下以 `run-state.mjs append --path {p} --array redispatchEvents --set occurredAt=@now ...` append 一筆到 top-level `redispatchEvents[]`，至少含下列欄位（`occurredAt` 由腳本 `@now` 產生，`waitMs` 於補派成功取得新 `agentId` 後再以一次 set/append 補上）：
   - `phase`：發生補派的 phase，例如 `writer`
   - `occurredAt`：撞限時間
   - `cause`：固定使用可機器判讀字串，例如 `agent-thread-limit`
   - `waitMs`：從撞限到補派成功啟動的等待毫秒；若補派未成功填 `null` 並在 `action` 說明
   - `action`：實際動作，例如 `closed 3 completed analyzer agents, re-dispatched 1 pending writer`
8. **計數欄位**：每次 bounded re-dispatch、restart 或 Executor fix round 收斂後，都必須以 run-state 寫入機制更新 `boundedRedispatchCount`、`restartCount`、`executorFixRounds`；Executor canonical artifact gate 通過後，必須讀取實體 `executor-result.json.fixRounds` 並立即寫入 top-level `executorFixRounds`，不得保留 `init` 的預設 `0`。`boundedRedispatchCount` 必須等於 `redispatchEvents.length`，除非有歷史相容原因，這時必須在 `profilingSummary.notes` 說明。
9. **總體時間**：整體流程完成或中止時，必須在同一個 `run-state.mjs set` 呼叫寫入 `overallWallClock.end=@now`，並以 `--derive overallWallClock.durationMs=overallWallClock.end-overallWallClock.start` 產生巢狀 duration。禁止建立 top-level 的字面鍵名 `"overallWallClock.durationMs"`，也不得留下 `durationMs: null`。
10. **phase duration 摘要**：整體流程完成或中止時，以 run-state 寫入機制補上 `phaseDurations`，每個 phase 至少包含 `durationMs` 與 `source: "run-state"`.
11. **profiling summary**：整體流程完成或中止時，以 run-state 寫入機制補上 `profilingSummary`，至少包含 `bottleneck`、`bottleneckBreakdown`、`rootCauseCandidate`、`deferredOptimization`、`timingSource`。`rootCauseCandidate` 不得是 `unresolved`；拿不到的細項填 `null` 並在 `notes` 說明。

#### 多 Assignment / 多 Target Timing 契約

若某 phase 內有多個平行 assignment（例如多 target Analyzer、每 target 單一 Writer、多 Reviewer），不得只記一個彙總時間。`run-state.json` 必須保留每個 assignment 的 timing evidence。

建議 schema：

```json
{
  "phases": {
    "writer": {
      "dispatchIssuedAt": "...",
      "artifactReadyAt": "...",
      "completedAt": "...",
      "durationMs": 180000,
      "criticalPath": {
        "assignmentId": "ConfigurationLoader:SaveOperation",
        "target": "ConfigurationLoader",
        "testFilePath": "tests/.../ConfigurationLoader_SaveOperationTests.cs",
        "methodsCovered": ["LoadJsonConfig", "SaveConfig"],
        "durationMs": 180000
      },
      "assignments": [
        {
          "assignmentId": "ConfigurationLoader:Main",
          "target": "ConfigurationLoader",
          "testFilePath": "tests/.../ConfigurationLoaderTests.cs",
          "methodsCovered": ["Constructor", "LoadConfig"],
          "agentId": "...",
          "dispatchIssuedAt": "...",
          "dispatchAcceptedAt": "...",
          "artifactReadyAt": "...",
          "completedAt": "...",
          "dispatchAcceptLatencyMs": 150,
          "produceSpanMs": 119850,
          "durationMs": 120000,
          "artifact": "tests/.../.orchestrator/writer-result/ConfigurationLoader.writer-result.json"
        }
      ]
    }
  }
}
```

計算規則：

- 單一 assignment phase：phase duration = `completedAt - dispatchIssuedAt`。
- 平行 assignment phase：phase duration = 最早 `dispatchIssuedAt` 到最晚 `completedAt` 的 wall-clock span；critical path = `durationMs` 最大的 assignment。
- 每筆 assignment 的 `dispatchAcceptLatencyMs` = `dispatchAcceptedAt - dispatchIssuedAt`；`dispatchAcceptedAt` 是 SpawnAgent 回傳 `agentId` 後 Orchestrator 立即補蓋的 wall-clock，不得解讀為 agent start time。
- 每筆 assignment 的 `produceSpanMs` = `artifactReadyAt - dispatchAcceptedAt`；此 span 內可能包含 agent 內部排隊、skill 載入與實際產出，Orchestrator 不得再細分或捏造。
- 循序 Executor phase：phase duration = phase `completedAt - dispatchIssuedAt`。Executor 端不再要求逐 target `executionSteps[]` / `buildElapsedMs` / `testElapsedMs`，因為這會把 project-level build/test timing 複製成假的逐 target timing；Executor 非本輪瓶頸時，run-state 只保留 Orchestrator 可觀察的 dispatch / artifact / completed timing。
- Writer critical path：只使用真實可觀察且非污染的 Writer `produceSpanMs`。以 `produceSpanMs` 最大的 Writer assignment 作為 `profilingSummary.writerCriticalPath.assignmentId`；同時列出 Writer `produceSpanMs` 的 `minMs`、`medianMs`、`maxMs`。
  - `minMs` / `medianMs` / `maxMs` 必須來自每筆 Writer assignment 自己的 `produceSpanMs`，且只納入非 null、非污染值。
  - 若 Writer phase 有 2 筆以上 assignment，但可用 `produceSpanMs` 少於 2 筆，或所有可用值因 byte-identical 污染而不可採信，`profilingSummary.writerCriticalPath` 必須填 `null` 欄位並在 `notes` 說明 `writer per-assignment artifact timing not independently observable`；不得從 phase duration 反推或複製出 min/median/max。
  - 若真實觀察結果剛好數值相同，必須在每筆 assignment 的 `timingNote` 或 `profilingSummary.notes` 說明獨立觀察依據（例如不同 artifact path 在不同 poll iteration 被確認可讀）。沒有獨立觀察依據時，一律視為不可採信。
- final report 不得把多 target Writer assignments 的耗時加總成 phase duration；可以另列 assignment 總和作為參考，但正式 critical path 以最慢 assignment 與 phase wall-clock span 為準。

#### Timing Evidence 自我檢查

輸出 final report 前必須檢查：

- `run-state.json` 是否存在且可讀。
- 每個 phase assignment 是否有 `dispatchIssuedAt`、`dispatchAcceptedAt`、`dispatchAcceptLatencyMs`、`artifactReadyAt`、`produceSpanMs`、`completedAt`。
- 多 target Writer assignments 是否全部有上述 timing 欄位。
- 多 target Writer assignments 的 `dispatchAcceptedAt` 不得全部 byte-identical，除非每筆都有獨立 SpawnAgent 回傳邊界的 `timingNote`；否則標示 `timing evidence incomplete`。
- 多 target Writer assignments 的 `artifactReadyAt` / `produceSpanMs` 不得全部 byte-identical，除非每筆都有獨立 artifact poll 證據；否則把逐 assignment `produceSpanMs` 視為不可採信，`profilingSummary.writerCriticalPath` 與 `writerCriticalPath.minMs/medianMs/maxMs` 不得填入假分布。
- top-level 是否永遠有 `redispatchEvents`（沒發生時為 `[]`，不是缺欄）。
- Executor phase 是否有 Orchestrator 可觀察的 assignment timing；不得要求 executor-result 產生假的逐 target build/test timing。
- final report 的耗時數字是否能由 `run-state.json` 人工重算。
- 多 target 時，是否列出 critical path assignment。
- 若任一 timing 欄位缺失，該欄不得人工補猜；final report 必須標示 `timing evidence incomplete` 與缺失欄位。

最小 schema：

```json
{
  "target": "SubscriptionService.IsExpiringSoon",
  "overallWallClock": "2026-06-11T08:49:40Z/2026-06-11T08:55:32Z",
  "phases": {
    "analyzer": {
      "agentId": "...",
      "dispatchIssuedAt": "...",
      "dispatchAcceptedAt": "...",
      "artifactReadyAt": "...",
      "completedAt": "...",
      "dispatchAcceptLatencyMs": 120,
      "produceSpanMs": 41880,
      "artifact": "samples/unit/practice/tests/Practice.Core.Tests/.orchestrator/analysis/SubscriptionService.analysis.json"
    },
    "writer": {
      "agentId": "...",
      "dispatchIssuedAt": "...",
      "dispatchAcceptedAt": "...",
      "artifactReadyAt": "...",
      "completedAt": "...",
      "dispatchAcceptLatencyMs": 90,
      "produceSpanMs": 89910,
      "artifact": "samples/unit/practice/tests/Practice.Core.Tests/.orchestrator/writer-result/SubscriptionService.writer-result.json"
    },
    "executor": {
      "agentId": "...",
      "dispatchIssuedAt": "...",
      "dispatchAcceptedAt": "...",
      "artifactReadyAt": "...",
      "completedAt": "...",
      "dispatchAcceptLatencyMs": 100,
      "produceSpanMs": 59900,
      "artifact": "samples/unit/practice/tests/Practice.Core.Tests/.orchestrator/executor-result/SubscriptionService.executor-result.json"
    },
    "reviewer": {
      "agentId": "...",
      "dispatchIssuedAt": "...",
      "dispatchAcceptedAt": "...",
      "artifactReadyAt": "...",
      "completedAt": "...",
      "dispatchAcceptLatencyMs": 110,
      "produceSpanMs": 44890,
      "artifact": "samples/unit/practice/tests/Practice.Core.Tests/.orchestrator/reviewer-result/SubscriptionService.reviewer-result.json"
    }
  },
  "phaseDurations": {
    "analyzer": {
      "durationMs": 42000,
      "source": "run-state"
    },
    "writer": {
      "durationMs": 90000,
      "source": "run-state",
      "criticalPathAssignmentId": null
    }
  },
  "profilingSummary": {
    "timingSource": "run-state.json",
    "bottleneck": "writer",
    "bottleneckBreakdown": {
      "dispatchAcceptLatencyMs": 90,
      "produceSpanMs": 89910,
      "redispatchWaitMs": 0,
      "skillLoadMs": null
    },
    "rootCauseCandidate": "writer produceSpan dominates observed wall-clock; skill load and internal queue remain inside produceSpan and are not separately observable",
    "deferredOptimization": false
  },
  "redispatchEvents": [],
  "boundedRedispatchCount": 0,
  "restartCount": 0,
  "executorFixRounds": 0
}
```

失敗 phase 範例：

```json
{
  "agentId": "...",
  "dispatchIssuedAt": "...",
  "dispatchAcceptedAt": "...",
  "artifactReadyAt": null,
  "completedAt": "...",
  "dispatchAcceptLatencyMs": 100,
  "produceSpanMs": null,
  "artifact": null,
  "timingNote": "produceSpanMs is null because artifactReadyAt is unavailable",
  "failure": "artifact 一直沒出現: reviewResultFilePath missing after Reviewer completed"
}
```

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

### 固定最終回覆契約（不可改成散文摘要）

最終回覆必須使用下列固定區塊與表格。不得把測試檔案數、測試案例數、方法範圍、執行結果或 Reviewer 評分散落在敘述段落中。若某欄位在 artifact 中缺失，該欄填 `未提供`，不可省略該欄。

#### 1. 測試結果總覽

單目標與多目標都必須先輸出此表；多目標時每個 target 一列。若單一 Writer 產出多個測試檔，該 target 必須列出多列或以 `<br>` 分隔每個測試檔與其方法範圍，讓使用者一眼看出測試檔數與案例數。

```markdown
### 測試結果總覽

| Target | 測試檔案 | 負責方法範圍 | 測試案例數 | Build/Test 結果 | Reviewer 評分 |
|---|---|---|---:|---|---|
| ClassName | path/to/ClassNameTests.cs | MethodA, MethodB | 12 | build passed / test passed | A (92) |
```

欄位來源：

- `Target`：Analyzer / orchestrator 的 target 名稱。
- `測試檔案`：Writer 的 `testFilePaths` 或 writer-result `testClasses[].filePath`。
- `負責方法範圍`：writer-result `testClasses[].methodsCovered` 或 Analyzer 的 `methodsToTest`。每個測試檔都必須可回溯方法範圍。
- `測試案例數`：優先使用 writer-result `testCaseCount` 或 Executor `totalTests`；多檔時要能看出各檔或各 target 的案例數。
- `Build/Test 結果`：Executor 的 build 與 test truth。build 失敗時不得因舊 build output 的 `dotnet test --no-build` 結果宣稱通過。
- `Reviewer 評分`：Reviewer 的 `overallScore` / `grade` / `gateDecision` 中可用的正式評分欄位。

#### 2. Reviewer 結論

必須列出 Reviewer 的關鍵問題與缺漏案例，不得只寫分數。

```markdown
### Reviewer 結論

| Target | Issues | Missing test cases | Warning 以上改善建議 |
|---|---|---|---|
| ClassName | issue summary | missing cases | warnings/errors |
```

- `Issues`：Reviewer `issues`、`warnings`、`suggestions` 中與品質或 coverage 有關的重點。
- `Missing test cases`：Reviewer `missingTestCases` 或 coverage gate 的 missing scenarios。
- `Warning 以上改善建議`：severity >= warning 的項目；沒有時填 `無`。

#### 2.1 使用者情境處理摘要

只要初始提示詞有提供測試情境或測試資料，Reviewer 結論後必須輸出：

```markdown
### 使用者情境處理摘要

| Target | Provided | Accepted | Normalized | Limited | Merged | Rejected | Analyzer supplemented | Coverage |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| ClassName | 5 | 3 | 1 | 0 | 0 | 1 | 4 | complete |
```

若有 `rejected`，另列每個 `scenarioId`、原始內容摘要、reason code、具體理由與 evidence。不得只回報拒絕數量。Reviewer 的 `userScenarioCoverage.missingScenarioIds` 或 `dataMismatchScenarioIds` 也必須明列。

#### 3. 使用的技術組合

必須列出每個 target / Writer 實際載入或回報的 Skills：

```markdown
### 使用的技術組合

| Target | Loaded skills |
|---|---|
| ClassName | unit-test-fundamentals, nsubstitute-mocking |
```

另列 Analyzer 本次實際讀取的技術型 Skills。來源只能是 analysis artifact 的 `tokenEstimateInputs.readFiles` 中實際出現的 `.codex/skills/*/SKILL.md`，不得由 `requiredTechniques` 推測；沒有讀取時填 `無`。此欄只解釋 input estimate 波動，不參與 correctness gate。

```markdown
### Analyzer 技術型 Skill 讀取

| Target | Observed technical skills |
|---|---|
| ClassName | unit-test-fundamentals 或 無 |
```

#### 4. Executor 修正紀錄

必須列出 Executor 修正紀錄；沒有修正時也要明確寫 `無修正`。

```markdown
### Executor 修正紀錄

| Target | Fix rounds | 修正內容 |
|---|---:|---|
| ClassName | 1 | 補 using、修正套件引用 |
```

#### 5. 各階段耗時

結果呈現結束後，**必須**輸出以下格式的耗時表格（從 `{testProjectDir}/.orchestrator/run-state.json` 的 wall-clock timestamps（dispatchIssuedAt → artifactReadyAt → completedAt）取得各階段時間）：

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

> 各階段耗時必須讀取 `{testProjectDir}/.orchestrator/run-state.json`，再從該檔的 `dispatchIssuedAt`、`artifactReadyAt`、`completedAt` 計算。多 target 時 Writer 階段耗時取最長的一個 assignment。總計為四個階段之和。

#### 6. Timing Evidence 與 Critical Path

耗時表格後，**必須**輸出 timing evidence 表，讓使用者能人工對回 `run-state.json`。不得只列漂亮的耗時摘要。

```markdown
### Timing Evidence

| Phase | Timing source | Start | Artifact ready | Completed | Critical path / note |
|---|---|---|---|---|---|
| Analyzer | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | single agent |
| Writer | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | critical path: ConfigurationLoader_SaveOperationTests.cs (LoadJsonConfig, SaveConfig) |
| Executor | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | sequential build/test |
| Reviewer | `.orchestrator/run-state.json` | 2026-... | 2026-... | 2026-... | parallel reviewers, slowest: EmployeeService |
```

若有多 target assignments，還必須輸出 assignment critical path 表：

```markdown
### Writer Critical Path

| Assignment | Target | Test file | Methods covered | Duration | Note |
|---|---|---|---|---:|---|
| ConfigurationLoader:SaveOperation | ConfigurationLoader | ConfigurationLoader_SaveOperationTests.cs | LoadJsonConfig, SaveConfig | 3 分 0 秒 | critical path |
```

Instrumentation 啟用後，必須輸出 profiling summary 表；拿不到的欄位填 `null` 並說明，不得把 `rootCauseCandidate` 寫成 `unresolved`：

```markdown
### Profiling Summary

| Field | Value |
|---|---|
| bottleneck | writer |
| dispatchAcceptLatencyMs | 90 |
| produceSpanMs | 89910 |
| redispatchWaitMs | 0 |
| skillLoadMs | null（orchestrator 不可觀察，§4.3 延後） |
| rootCauseCandidate | writer produceSpan dominates observed wall-clock; dispatch acceptance latency is negligible |
| deferredOptimization | false |
```

#### 7. Estimated Token Usage

`Profiling Summary` 後必須輸出 optional telemetry 區塊。四階段全部完成且 final report 前，執行：

```bash
node .codex/scripts/estimate-token-usage.mjs --test-project {testProjectDir}
```

估算器成功產生 `{testProjectDir}/.orchestrator/token-usage-estimate.json` 時，讀取該 JSON 的 `summary` 與 `phases`，輸出：

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

若 estimator 失敗、`run-state.json` 缺失、artifact 不足或 summary 為 `unavailable`，仍不得讓 workflow 失敗；改輸出：

```markdown
### Estimated Token Usage

| Field | Value |
|---|---|
| status | unavailable |
| reason | estimator failed or insufficient tokenEstimateInputs |
```

禁止把 estimated token usage 放入 `gateDecision`、Reviewer 評分、build/test 通過判定或任何 correctness summary。此區塊不得命名為 `Token Usage`。

Estimated Token Usage 後必須輸出本次 workflow 觀測摘要，保留模型非決定性造成的差異，不要求不同 attempts 的 scenario count 或 Skill reads 完全相同：

```markdown
### Token 實驗觀測

| Target | Analyzer scenarios | Writer assignments | Analyzer technical skills read | Total estimate | 每個有效 Analyzer scenario 的估算 token |
|---|---:|---:|---|---:|---:|
| ClassName | 20 | 1 | unit-test-fundamentals 或 無 | 79,491 | 3,974.55 |
```

最後一欄以 `summary.totalTokensEstimated / analysis.scenarioCount` 推導，四捨五入至小數點後兩位；`scenarioCount` 為 0 或 estimator unavailable 時填 `unavailable`。這是 attribution metric，不是 correctness gate，也不能單獨證明 token 改善。

禁止因 timing table 顯示某 phase 較慢，就在同一輪 final report 中宣稱已完成效能優化或直接提出已套用的 prompt/topology 調整。

---

## 修改流程（Modification Workflow）

### 觸發條件

當使用者要求套用 Reviewer 建議、修改既有測試、或增加測試案例時，使用此流程（而非重新執行完整四階段）。

### 流程（三階段）

1. **Writer（修改模式）** — 傳遞 Reviewer 建議內容，讓 Writer 修改既有測試程式碼
2. **Executor** — 建置並執行修改後的測試，確認全數通過
3. **Reviewer（re-review 模式）** — 以 `mode: "re-review"` 聚焦驗證前次建議是否正確套用，並給出修改後評分

### 觸發方式

Reviewer 回傳後，Orchestrator **一律呈現完整結果**（包含 `issues`、`missingTestCases`、`overallScore`），然後**等待使用者指示**。

**禁止自動觸發修改流程。** 無論評分高低、是否有 error 級 issue，修改流程的啟動權完全屬於使用者。

**禁止預先授權未來 Reviewer 建議。** 若使用者在初始請求中同時要求「先跑四階段，再套用 Reviewer 全部建議」或類似語句，Orchestrator 只能把後半段視為意圖說明，不可在同一回合自動進入修改流程。原因是 Reviewer 的實際 `issues` 與 `missingTestCases` 必須先呈現給使用者確認；使用者確認前，Writer(modification) 不得 dispatch。

**修改流程必須由 Reviewer 結果呈現後的新使用者指示啟動。** 可接受的啟動條件是：使用者已看過本次 Reviewer 結果，並在後續訊息明確要求「套用全部建議」、「套用第 N 項」或指定要修改的項目。若缺少這個 post-review approval，workflow 必須停在 Reviewer 結果與可選操作提示，不得繼續 Writer → Executor → Reviewer(re-review)。

Orchestrator 應在結果呈現的最後，提示使用者可用的操作：

> 如需套用 Reviewer 建議，請告知要套用哪些項目（或全部套用），我將啟動修改流程。

**多目標場景**：逐個目標獨立呈現結果，使用者可針對個別目標要求修改。

### 啟動 Writer 時的額外資訊

當使用者要求啟動修改流程時，除了交接檔案路徑外，還需傳遞：

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

1. 修改前後的測試數量變化（例：25 → 31）
2. 套用了哪些 Reviewer 建議
3. 重新評分結果（例：B+ → A）

---

## 錯誤處理

### Analyzer 失敗

如果 Analyzer 找不到被測試目標或分析失敗：

1. 向使用者確認檔案路徑是否正確
2. 自己嘗試用 `Read` 和 `Grep` 工具找到目標檔案
3. 重新啟動 Analyzer

### Executor 修正後仍有失敗

如果 Executor 經過 3 輪修正後仍有測試失敗：

1. 將失敗訊息和 Executor 的分析一併傳給 Reviewer
2. 在最終結果中明確標示哪些測試失敗
3. 提供修正方向建議

---

## 多目標支援

當使用者一次指定多個被測試類別時，執行以下策略：

### Step 0：多目標偵測

解析使用者輸入，識別多個被測試目標。常見模式：

- 「幫 ProductService、OrderService、UserService 寫測試」
- 「測試 Services/ 下的所有類別」
- 列舉多個類別名稱或檔案路徑

如果偵測到多個目標，對每個目標分別執行完整的四階段流程，並採用以下平行策略：

### 多目標執行策略

| 階段 | 執行方式 | 說明 |
|------|---------|------|
| Phase 1 Analyzer | **平行** | 每個目標獨立分析，互不依賴，在同一回應中發出多個 SpawnAgent 呼叫 |
| Phase 2 Writer | **平行** | 每個 target 固定一個 Writer；不同 target 的 Writers 可平行 dispatch |
| Phase 3 Executor | **循序** | 同專案 `dotnet build` 不可並行，需依序執行每個測試檔案 |
| Phase 4 Reviewer | **平行** | 每份測試獨立審查，在同一回應中發出多個 SpawnAgent 呼叫 |

### 多目標 Phase 2：每 Target 單一 Writer

每個 target 固定 dispatch 一個 Writer。不同 target 的 Writers 可以平行執行，但不得把同一 target 依 method、scenario 或 setup 再拆成多個 assignments。

每個 Writer assignment 必須保留：

- 所屬 target 名稱。
- `analysisFilePath`。
- 預期輸出測試檔案路徑。
- 該 target 的全部有效 scenarios 與 constructor guards 由同一 Writer 負責。

writer-result 與 final report 必須能回溯每個測試檔負責的方法範圍。若單一 Writer 為某 target 產生多個測試檔，總覽表必須列出各測試檔與其 `methodsCovered`。
### 多目標結果彙整

多目標完成後，在結果區塊中彙整呈現：

1. **必須套用「固定最終回覆契約」**：先輸出 `### 測試結果總覽`，每個 target 至少一列，且必須能看出測試檔案、負責方法範圍、測試案例數、Build/Test 結果與 Reviewer 評分。
2. **各目標詳細結果**：按 target 分區展示 Reviewer 結論、使用的技術組合、Executor 修正紀錄。不得只用一句總結代替 target 細節。
3. **測試檔案可視化**：若某 target 的單一 Writer 產生多個測試檔，總覽表必須列出每個測試檔與其 `methodsCovered`；不得只列 target 總數。
4. **共用改善建議**：如果多個 target 有相同的品質問題，可在逐 target 結論後合併建議，但不得因此省略各 target 的 issues / missing test cases。

---

## 重要原則

1. **交接檔案路徑優先** — 傳遞 `analysisFilePath`、`writerResultFilePath`、`executorResultFilePath` 給 subagent，而非嵌入完整 JSON。Subagent 會在 Step 0 自行讀取交接檔案取得完整資訊
2. **保持 context 精簡** — 只保留 subagent 回傳的摘要，不展開中間過程
3. **每 target 單一 Writer** — Writer topology 不受 `methodCount` 或 `scenarioCount` 影響；不得為降低 wall-clock 耗時而分割 Writer，也不得因此限制 Analyzer 案例數量
4. **`suggestedTestScenarios` 必須是中文** — Analyzer 產出的建議測試命名必須使用中文三段式格式
5. **使用者情境優先** — Orchestrator 不裁決情境內容；它完整傳給 Analyzer，並以 artifact gate 保證逐項檢視、provenance、單一 Writer coverage 與 Reviewer coverage 可追溯
