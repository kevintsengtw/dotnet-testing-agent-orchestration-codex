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
| Validator | `AbstractValidator<T>` | `forbidWriterSplit: true`，永不分割 |
| Legacy | 靜態依賴、裸靜態呼叫，難以隔離 | Characterization Test；需 seam 時走 production-code 邊界 |

**Analyzer 輸出（回傳摘要 + 寫入 analysis.json）：**

- `className`、`targetType`、`methodCount`、`scenarioCount`、`methodScenarioCounts`
- `requiredTechniques`、`skillMap`、`projectContext`（targetFramework）、`analysisFilePath`
- **`constructorGuards[]`**：偵測到建構子中以 `?? throw new ArgumentNullException(nameof(x))` 形式 guard 的注入依賴（Codex 強化，供 Writer 寫建構子 null-guard 測試）
- **`directIoOperations[]` / `testabilityIssues[]`**：偵測到**裸靜態**依賴時填入——靜態方法、裸 `DateTime.Now`/`UtcNow`/`DateTimeOffset.*`、裸 `File.*`/`Directory.*`。裸 `DateTime` 與裸 `File.IO` **同類處理**（皆 production-code 可測試性缺口）

> **skill 選擇按「屬性」非「類別名」**：依注入依賴型別（`IFileSystem` → filesystem skill、注入的 `TimeProvider` → datetime skill）、targetType、門檻決定，不對特定 sample 類別特判。`datetime-testing-timeprovider` **只**對「注入的 `TimeProvider`」載入；裸 `DateTime.*` 不載該技能、改標 testabilityIssue。

Orchestrator 收摘要後**驗證交接檔案確實存在**，才 SpawnAgent Writer。

---

## 4. Phase 2 Writer

Writer 在 Step 0 讀 analysis.json，按 `requiredTechniques` 載入 Agent Skills，撰寫測試。

**測試命名**：中文三段式 `方法名_情境描述_預期結果`。
**斷言**：必用 AwesomeAssertions（`.Should()`），禁 `Assert.Equal` 等 xUnit 內建斷言。

### 4.1 大型類別 Writer 分割策略

**觸發條件**（須同時滿足）：`methodCount > 5` 或 `scenarioCount > 20`，**且** `forbidWriterSplit` 不為 `true`。觸發後啟動**最多 2 個平行 Writer**（agent 數固定為 2，不因平衡而增減）。

**分組規則（setup 親和優先，非純貪心）：**

1. **setup 親和優先**：先依 dependency / requiredTechniques / suggestedTestScenarios 判斷每個方法需要的 SUT / mock / TimeProvider / AutoFixture / 資料建構設定，**將共用同一套 setup 的方法盡量分到同一組**；`methodScenarioCounts` 僅作**次要**平衡。
2. **不為了 scenario 數平均而拆散共用 setup 的方法**；同一方法的所有測試案例絕不跨組。
3. **建構子 null-guard 測試集中單一檔**：若有 `constructorGuards[]`，`Constructor` 測試完整放入單一 assignment（預設 Writer 1 / 主要組），不分散、不重複。

**輸出檔案命名：**

- Writer 1（主要組）：`{ClassName}Tests.cs`
- Writer 2（分割組）：1～2 方法 → `{ClassName}_{代表方法}Tests.cs`；3+ 方法 → 語意化群組名 `{ClassName}_{Group}Tests.cs`

### 4.2 跨檔 fixture 一致契約（Codex 強化，分割時所有 Writer 必守）

這是 Codex 版針對「split 多檔 fixture 漂移」的強化（上游 Claude 版有此問題）。風格統一指令要求 split 出的多檔**逐檔一致**：

- **時間錨**：用**具名常數**（如 `private static readonly DateTimeOffset InitialNow = ...`），所有 split 檔同名同值；禁一檔 inline、一檔具名
- **AutoFixture 遞迴行為**：所有 Writer 一致（先移除 `ThrowingRecursionBehavior` 再加 `OmitOnRecursionBehavior`）；禁一檔只加 Omit、另一檔做完整清理
- **欄位/區域變數命名**：`_fixture`/`_timeProvider`/`_sut`、per-test 時間變數（兩檔都 `now` 或都 `currentTime`）逐檔一致
- **SUT 建構模式一致**；**未使用的 fixture 禁止宣告**（不留 dead field/using）

> 以上完整一致性由 **Writer / Orchestrator 契約**強制（Writer 風格統一指令 + Orchestrator artifact gate）。Reviewer 目前的明文 checklist 涵蓋部分項目（見 §6），尚未逐條列出全部 fixture 一致面向；如需 Reviewer 端完整顯式把關，須先補強 `dotnet-testing-reviewer.toml`。

### 4.3 建構子 null-guard 覆蓋（Codex 強化）

若 analysis 有 `constructorGuards[]`，負責 `Constructor` 的 Writer 必須**為每個 guarded 依賴**寫一個 null-guard 測試：`new XxxService(...該依賴傳 null...)` 應 `Throw<ArgumentNullException>().WithParameterName("<dep>")`。guard 本就存在於 production，**不需修改 production code**。

### 4.4 Writer Artifact 完整性 Gate

Writer 回傳後 Orchestrator **不只採信摘要**，必須讀實體 `writer-result.json` 驗欄位齊全（`testFilePaths`、`testCaseCount`、`testClasses[].methodsCovered`、`skillsLoaded` 等）+ 方法範圍檢查（method-scope 不得溢寫全類別；split assignment 的 `methodsCovered` 可回溯；ctor 測試只能在單一檔）。缺欄/不一致 → 不進 Executor，可 **bounded re-dispatch Writer 最多 2 次**（只補缺漏，**不重啟整個 workflow**），仍不行則判 blocker。

### 4.5 階段間主動釋放 agent（Codex 強化）

Writer 全部收斂且 gate 通過後、dispatch Executor 前，Orchestrator **主動關閉已完成 Writer agents**，釋放後續 phase 的 runtime thread slots（Analyzer→Writer、Executor→Reviewer 同樣處理）。此舉是 thread-ceiling 的單點優化，只釋放已完成 agent，不改測試/分割/correctness。

---

## 5. Phase 3 Executor

建置 + 執行 + **bounded 修正迴圈（最多 3 輪）**。常見修正：補 `using`、**新增缺少的必要測試套件 / 移除錯誤套件**、型別/命名衝突。**禁升級或降級既有套件版本**來修 build——若根因是既有套件版本過舊或相容性不足，回報 **blocker**（版本管理屬專案維護者）。**禁** restart 整個流程 / 拼湊·偽造 artifact / 塌回內聯 / 假綠（測試沒真跑成功不得宣稱通過）。

輸出：`totalTests`、`passedTests`、`failedTests`、`fixRounds`、`executorResultFilePath`。
> 驗收以 `buildResult` + `fixHistory` 為準；不得因舊 build 輸出的 `dotnet test --no-build` 假綠。

---

## 6. Phase 4 Reviewer

讀測試碼 + 三個交接檔（analysis/writer-result/executor-result），品質審查。Reviewer 有完整審查 / re-review 兩模式。**reviewer.toml 目前明文 checklist** 涵蓋：命名（中文三段式）、斷言風格（AwesomeAssertions、例外斷言、lambda、物件斷言）、`using` 排序、`_timeProvider` 設定、測試隔離、Mock 設定、覆蓋完整性（含邊界）。

> 註：§4.2 的完整跨檔 fixture 一致面向（`InitialNow` 具名常數、AutoFixture 遞迴行為、`_fixture`/`_sut` 命名、SUT 建構模式、per-test 時間變數命名）目前主要由 **Writer 風格統一指令 + Orchestrator artifact gate** 保證；reviewer.toml 尚未逐條顯式列出全部。若要 Reviewer 端完整把關，須補強該 toml。

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
| Writer artifact（逐 assignment 唯一）| Writer | `.orchestrator/writer-result/`；**每個 Writer assignment 各自一份可獨立 poll 的 canonical artifact**，路徑須能回溯該 assignment 與其 `testFilePath`（split 時非單一 `{ClassName}.writer-result.json`）|
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
| Writer | 平行（逐 target，且各 target 仍可 per-class 分割）| 獨立撰寫；dispatch 單位是「Writer assignment」非 target，故三目標可產生 > 3 個 Writer |
| Executor | 循序 | 同專案 `dotnet build` 不可並行 |
| Reviewer | 平行（逐 target）| 獨立審查 |

- 並行 SpawnAgent 數受 `.codex/config.toml` `[agents] max_threads` 限制。
- **thread-ceiling 自癒**：分割使並行 Writer 變多時可能逼近 agent thread limit；遇到時做 **bounded re-dispatch**（關閉已完成 agents 後補派，`restartCount=0`），`run-state.redispatchEvents` 記錄該事件。配合 §4.5 階段間主動釋放降低撞限機率。

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

> 技術型 `dotnet-testing-*` Skills 由外部 repo [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 提供，需直接複製到 `.codex/skills/`。
