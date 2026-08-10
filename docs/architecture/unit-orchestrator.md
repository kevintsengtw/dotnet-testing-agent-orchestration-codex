# 單元測試 Orchestrator 架構說明

> 本文件依**實際 `.codex/skills/dotnet-testing-orchestrator-unit/SKILL.md` 與 `.codex/agents/*.toml` 契約**撰寫，描述 Codex 版實際行為（含相對上游 Claude 版的 Codex-specific 強化）。

## 1. 概覽

| 項目 | 說明 |
|---|---|
| 適用場景 | xUnit 單一/多類別單元測試（Service / Validator / Legacy） |
| Orchestrator Skill 路徑 | `.codex/skills/dotnet-testing-orchestrator-unit/SKILL.md` |
| 觸發方式 | `$dotnet-testing-orchestrator-unit` |
| Dispatch 機制 | Codex 原生 SpawnAgent |

Orchestrator 是**指揮中心**，調度四個 Subagent，自身不撰寫測試。流程：Phase 0 前置清理 → Analyzer → Writer → Executor → Reviewer → Phase 5 後置清理。全程維護 `run-state.json`。

---

## 2. 元件組成

| 元件 | 類型 | 路徑 |
|---|---|---|
| Orchestrator | Skill | `.codex/skills/dotnet-testing-orchestrator-unit/` |
| Analyzer | Subagent | `.codex/agents/dotnet-testing-analyzer.toml` |
| Writer | Subagent | `.codex/agents/dotnet-testing-writer.toml` |
| Executor | Subagent | `.codex/agents/dotnet-testing-executor.toml` |
| Reviewer | Subagent | `.codex/agents/dotnet-testing-reviewer.toml` |

Orchestrator 在 SpawnAgent 時**只傳交接檔案路徑 + 摘要數字**，不嵌入完整 JSON；各 Subagent 的 Step 0 自行讀取上游交接檔案。

---

## 3. Phase 1 Analyzer

Analyzer 讀原始碼，識別目標類型與依賴，產出 `analysis.json`。

**三種目標類型：**

| 類型 | 特徵 | 處理 |
|---|---|---|
| Service | 有可注入依賴（Repository / TimeProvider / IFileSystem / 介面）| 正常 mock 流程 |
| Validator | `AbstractValidator<T>` | 保留 `forbidWriterSplit: true` 相容性 metadata；正式 topology 與其他 target 相同，皆為單一 Writer |
| Legacy | 靜態依賴、裸靜態呼叫，難以隔離 | Characterization Test；需 seam 時走 production-code 邊界 |

**Analyzer 輸出（回傳摘要 + 寫入 analysis.json）：**

- `className`、`targetType`、`methodCount`、`scenarioCount`、`methodScenarioCounts`
- `requiredTechniques`、`skillMap`、`projectContext`（targetFramework）、`analysisFilePath`
- **`constructorGuards[]`**：偵測到建構子中以 `?? throw new ArgumentNullException(nameof(x))` 形式 guard 的注入依賴（Codex 強化，供 Writer 寫建構子 null-guard 測試）
- **`directIoOperations[]` / `testabilityIssues[]`**：偵測到**裸靜態**依賴時填入——靜態方法、裸 `DateTime.Now`/`UtcNow`/`DateTimeOffset.*`、裸 `File.*`/`Directory.*`。裸 `DateTime` 與裸 `File.IO` **同類處理**（皆 production-code 可測試性缺口）

> **skill 選擇按「屬性」非「類別名」**：依注入依賴型別（`IFileSystem` → filesystem skill、注入的 `TimeProvider` → datetime skill）、targetType、門檻決定，不對特定 sample 類別特判。`datetime-testing-timeprovider` **只**對「注入的 `TimeProvider`」載入；裸 `DateTime.*` 不載該技能、改標 testabilityIssue。

Orchestrator 收摘要後**驗證交接檔案確實存在**，才 SpawnAgent Writer。

### 3.1 使用者提供情境與測試資料

初始提示詞若包含測試情境或測試資料，Orchestrator 以 `userProvidedScenarios` 將完整原文傳給 Analyzer，不預先要求固定格式，也不自行裁決合理性。支援 `unit-test-scenarios` Markdown、自然語言、清單、表格、JSON、YAML、Gherkin 與混合內容。

Analyzer 必須逐項解析及檢視：合理項目優先保留；格式或命名問題只做正規化；重複項以 `merged` 保留 provenance；只有與原始碼、scope 或 unit-test 邊界有具體衝突的單一項目才能 `rejected`。缺 production seam 時優先標示 limitation，不可把整批使用者輸入棄用。

analysis artifact 保留既有 `suggestedTestScenarios: string[]`，並新增：

- `userProvidedScenarioInput`：是否有輸入、完整原文與偵測格式。
- `scenarioCatalog[]`：`USR-*` / `GEN-*` ID、來源、原文、正規化名稱、方法、狀態、Arrange/Act/Assert、測試資料、拒絕理由與 limitation。
- `scenarioReviewSummary`：使用者情境各狀態與 Analyzer 補充數量。

Orchestrator 的 Analyzer artifact gate 必須驗證 catalog、summary、`suggestedTestScenarios`、`methodScenarioCounts` 與 `scenarioCount` 一致；有效使用者情境必須排在 Analyzer 補充情境之前。

`unit-test-scenarios` 是 workspace 內可獨立觸發的前置 Skill，不加入四角色 dispatch topology。它遵守「只輸出 Test Scenarios、不撰寫測試」的契約，因此使用方式是先完成該 Skill 請求，再把完整 Markdown 產出交給後續 unit orchestrator。Orchestrator 不直接讀取此外部 Skill，也不在使用者已提供情境時強制重跑。

---

## 4. Phase 2 Writer

Writer 在 Step 0 讀 analysis.json，按 `requiredTechniques` 載入 Agent Skills，撰寫測試。

**測試命名**：中文三段式 `方法名_情境描述_預期結果`。
**斷言**：必用 AwesomeAssertions（`.Should()`），禁 `Assert.Equal` 等 xUnit 內建斷言。

### 4.1 每 Target 單一 Writer 策略

每個 target 固定只 dispatch **一個 Writer subagent**，不受 `methodCount`、`scenarioCount`、`targetType` 或 `forbidWriterSplit` 影響。正式流程不再依方法、scenario、setup 或預估輸出大小切割 Writer。

這項 topology 決策不限制 Analyzer 應產生的案例數量，也不設定「正常案例」上限。單一 Writer 必須處理 analysis artifact 中全部有效的 `suggestedTestScenarios`、`scenarioCatalog` 與 `constructorGuards`。

單一 Writer 可依可讀性產生一個或多個測試檔，但這些檔案仍屬同一 assignment，並由同一份 writer-result 回溯 `testFilePaths`、`testClasses[].filePath`、`methodsCovered` 與 `scenarioCoverage`。

若 Writer 因 context 或 output limit 無法完成，該 phase 必須保留證據並回報 blocker；不得臨時回退 split，也不得靜默刪減 scenarios。Split topology 僅保留在歷史實驗資料與比較器中，不是正式 runtime fallback。

### 4.2 多檔輸出一致契約

單一 Writer 若為同一 target 產出多個測試檔，仍須維持逐檔一致：

- **時間錨**：使用一致的具名常數或固定時間策略，避免一檔 inline、一檔具名
- **AutoFixture 遞迴行為**：所有檔案採一致設定
- **欄位/區域變數命名**：`_fixture`、`_timeProvider`、`_sut` 與 per-test 時間變數維持一致
- **SUT 建構模式一致**；未使用的 fixture、欄位與 using 不得保留

Writer-result 與 final report 必須逐檔列出對應的方法範圍，讓多檔輸出仍可稽核。

### 4.3 建構子 null-guard 覆蓋（Codex 強化）

若 analysis 有 `constructorGuards[]`，該 target 的單一 Writer 必須**為每個 guarded 依賴**寫一個 null-guard 測試：`new XxxService(...該依賴傳 null...)` 應 `Throw<ArgumentNullException>().WithParameterName("<dep>")`。guard 本就存在於 production，**不需修改 production code**。

### 4.4 Writer Artifact 完整性 Gate

Writer 回傳後 Orchestrator **不只採信摘要**，必須讀實體 `writer-result.json` 驗欄位齊全（`testFilePaths`、`testCaseCount`、`testClasses[].methodsCovered`、`skillsLoaded` 等）+ 方法範圍檢查（method-scope 不得溢寫全類別；每個輸出檔的 `methodsCovered` 必須可回溯；建構子 guard 不得遺漏）。缺欄/不一致 → 不進 Executor，可 **bounded re-dispatch Writer 最多 2 次**（只補缺漏，**不重啟整個 workflow**），仍不行則判 blocker。

analysis 有 `scenarioCatalog` 時，單一 Writer 讀取全部有效 scenario。每個有效 `USR-*` 必須在 `scenarioCoverage[]` 恰好出現一次，Writer 優先實作並優先採用使用者指定資料。writer-result 記錄 scenario ID、測試檔／方法、`implemented|blocked|limitation` 及 `exact|partial|generated|not-applicable` 資料使用狀態；任何有效使用者情境都不得靜默略過。

Writer artifact gate 也會逐 ID 比對 catalog `normalizedName`、`testMethodNames` 與 `testDataEvidence`。這可在 Executor 前攔截「ID 數量正確、但實際配到另一個情境」的錯誤。Reviewer 完成後再以 `--require-review-pass` 執行正式 acceptance；coverage incomplete 或 Reviewer fail 不得被全綠測試結果覆蓋。

Reviewer 的 missing-test 判定嚴格受 `methodsToTest` 限制；method-scope 未包含 `Constructor` 時，不得把建構子防禦列為缺漏。

### 4.5 階段間主動釋放 agent（Codex 強化）

Writer 全部收斂且 gate 通過後、dispatch Executor 前，Orchestrator **主動關閉已完成 Writer agents**，釋放後續 phase 的 runtime thread slots（Analyzer→Writer、Executor→Reviewer 同樣處理）。此舉是 thread-ceiling 的單點優化，只釋放已完成 agent，不改測試、Single Writer topology 或 correctness contract。

---

## 5. Phase 3 Executor

建置 + 執行 + **bounded 修正迴圈（最多 3 輪）**。常見修正：補 `using`、**新增缺少的必要測試套件 / 移除錯誤套件**、型別/命名衝突。**禁升級或降級既有套件版本**來修 build——若根因是既有套件版本過舊或相容性不足，回報 **blocker**（版本管理屬專案維護者）。**禁** restart 整個流程 / 拼湊·偽造 artifact / 塌回內聯 / 假綠（測試沒真跑成功不得宣稱通過）。

輸出：`totalTests`、`passedTests`、`failedTests`、`fixRounds`、`executorResultFilePath`。
> 驗收以 `buildResult` + `fixHistory` 為準；不得因舊 build 輸出的 `dotnet test --no-build` 假綠。

---

## 6. Phase 4 Reviewer

讀測試碼 + 三個交接檔（analysis/writer-result/executor-result），品質審查。Reviewer 有完整審查 / re-review 兩模式。**reviewer.toml 目前明文 checklist** 涵蓋：命名（中文三段式）、斷言風格（AwesomeAssertions、例外斷言、lambda、物件斷言）、`using` 排序、`_timeProvider` 設定、測試隔離、Mock 設定、覆蓋完整性（含邊界）。

有使用者情境時，Reviewer 先以 `scenarioCatalog` 的有效 `USR-*` 集合作 coverage 權威，交叉驗證 writer-result `scenarioCoverage` 與實際測試碼。它必須檢查指定測試資料與預期結果是否落實、排除已拒絕情境、確認 merged 情境由目標情境承接，並輸出 `userScenarioCoverage`。缺少 P0 使用者情境視為 error；coverage 不完整不得評為 A/A+。

> 註：單一 Writer 產生多檔時，§4.2 的跨檔 fixture 一致面向主要由 **Writer 契約 + Orchestrator artifact gate** 保證；Reviewer 仍負責以實際測試碼檢查品質與 coverage。

**修改流程（post-review approval gate）**：Reviewer 回傳後 Orchestrator 呈現完整報告（`overallScore` / `issues` / `missingTestCases`）並**等待使用者明確指示**才啟動修改流程（Writer 修改 → Executor → Reviewer re-review）。**禁止自動觸發、禁止預先授權**。

---

## 7. Production-code 邊界（Codex 與 Claude 共有政策）

本 workflow 預設**只寫/驗測試，不主動改 production code**：

- 若完整隔離測試需要 seam（加 `IFileSystem` / `IReportWriter` / clock seam、改 constructor signature / public API、加 production 套件）→ Orchestrator 標 **`requiresUserApproval`**，未經同意不得 dispatch 改 production code 的工作。
- **裸 `DateTime.Now/UtcNow` 比照裸 `File.IO`**：屬可測試性缺口，標 `testabilityIssues`，不硬測、不用 FakeTimeProvider 假裝可控（FakeTimeProvider 只能控注入的 TimeProvider）。
- Legacy 用 Characterization Test，禁硬編機器路徑（`C:\`、`/Users/`）作 I/O、禁硬編天數。
- final report 誠實標 `blocked` / `characterization-only` / `requiresUserApproval`，不把缺 seam 包裝成完整 isolated test。

---

## 8. 交接檔案與 run-state instrumentation

| 交接檔 | 寫入者 | 路徑 |
|---|---|---|
| `{ClassName}.analysis.json` | Analyzer | `.orchestrator/analysis/` |
| `{ClassName}.writer-result.json` | Writer | `.orchestrator/writer-result/`；每 target 一份 canonical artifact，可列出一個或多個 `testFilePaths` |
| `*.executor-result.json` | Executor | `.orchestrator/executor-result/` |
| `{ClassName}.reviewer-result.json` | Reviewer | `.orchestrator/reviewer-result/` |
| `run-state.json` | Orchestrator | `.orchestrator/` |

**`run-state.json` 是官方耗時的唯一真實來源**（wall-clock，不依賴 narration），且含 Codex 強化的階段內 instrumentation：

- `phases.{analyzer,writer,executor,reviewer}.assignments[]`：逐 assignment 的 `dispatchIssuedAt` / `dispatchAcceptedAt` / `artifactReadyAt` / `completedAt` / `dispatchAcceptLatencyMs` / `produceSpanMs`（每筆獨立量測；無法獨立觀察時填 `null`+`timingNote`，**禁複製 phase 邊界充數**）
- `phaseDurations.{phase}.durationMs`（+ `criticalPathAssignmentId`）
- `redispatchEvents[]`（撞 agent thread-limit 補派事件：`occurredAt` / `cause` / `redispatchWaitMs`）、`boundedRedispatchCount`、`restartCount`、`executorFixRounds`
- `profilingSummary`：`bottleneck`、`bottleneckBreakdown`（`dispatchAcceptLatencyMs` / `produceSpanMs` / `redispatchWaitMs`）、`writerCriticalPath`（min/median/max `produceSpanMs`）、`rootCauseCandidate`、`timingSource`、`deferredOptimization`
- 量不到的細項一律填 `null` + `notes`（缺值語義說明），**不得省略欄位或改用短名**

> **Token 用量口徑**：Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source（實證確認），不回報正式 token usage。流程完成後可輸出 `Estimated Token Usage` optional telemetry，僅作 visible-context 相對成本比較，不可用於 billing 或 correctness gate。

---

## 9. 多目標並行策略

| 階段 | 執行方式 | 原因 |
|---|---|---|
| Analyzer | 平行（逐 target）| 互不依賴 |
| Writer | 平行（逐 target）| 每 target 固定一個 Writer；三目標最多產生 3 個正式 Writer assignments |
| Executor | 循序 | 同專案 `dotnet build` 不可並行 |
| Reviewer | 平行（逐 target）| 獨立審查 |

- 並行 SpawnAgent 數受 `.codex/config.toml` `[agents] max_threads` 限制。
- **thread-ceiling 自癒**：多 target 平行 dispatch 仍可能逼近 agent thread limit；遇到時做 **bounded re-dispatch**（關閉已完成 agents 後補派，`restartCount=0`），`run-state.redispatchEvents` 記錄該事件。配合 §4.5 階段間主動釋放降低撞限機率，且不得改成同 target split。

---

## 10. Phase 0 / Phase 5 清理

- **Phase 0**：啟動 Analyzer 前，若有殘留 `.orchestrator/` 委託 Executor `cleanup` 清理，並初始化 `run-state.json`。
- **Phase 5**：四階段完成並呈現結果後清理 `.orchestrator/executor-result/`。**`run-state.json` 與 `analysis/` 在本次 run 內不刪**（供 review 當證據），於**下一次 run 的 Phase 0** 殘留清理時一併處理。
- 生成測試碼 + `.orchestrator/` 皆為 byproduct，**不進版控**。

---

## 11. 支援的測試技術棧

```text
xUnit 2.9+ / NSubstitute 5.x / AutoFixture 4.x
AwesomeAssertions（基於 FluentAssertions）/ Bogus
Microsoft.Extensions.TimeProvider.Testing（FakeTimeProvider）
TestableIO.System.IO.Abstractions.TestingHelpers（MockFileSystem）
```

> 技術型 `dotnet-testing-*` Skills 由外部 repo [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 提供，需由 standalone installer 以精確 Release tag 安裝到 `.agents/skills/`。
