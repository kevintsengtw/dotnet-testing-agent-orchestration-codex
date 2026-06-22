# TUnit 測試 Orchestrator 架構說明

> 本文件依**實際 `.codex/skills/dotnet-testing-orchestrator-tunit/SKILL.md` 與 `.codex/agents/dotnet-testing-advanced-tunit-*.toml` 契約**撰寫，描述 Codex 版實際行為（含相對上游 Claude 版的 Codex-specific 強化）。

## 1. 概覽

| 項目 | 說明 |
|---|---|
| 適用場景 | TUnit 單一/多類別測試（Service / Validator）、xUnit/NUnit → TUnit 遷移 |
| Orchestrator Skill 路徑 | `.codex/skills/dotnet-testing-orchestrator-tunit/SKILL.md` |
| 觸發方式 | `$dotnet-testing-orchestrator-tunit` |
| Dispatch 機制 | Codex 原生 SpawnAgent |

Orchestrator 是**指揮中心**，調度四個 advanced-tunit Subagent，自身不撰寫測試。流程：Phase 0 前置清理 → Analyzer → Writer → Executor → Reviewer → Phase 5 後置清理。全程維護 `run-state.json`。

**與 Unit（xUnit）Orchestrator 的核心差異**：測試框架為 **TUnit**（非 xUnit）；屬性為 **`[Test]`** / **`[Arguments]`** / **`[MethodDataSource]`**（非 `[Fact]` / `[Theory]` / `[InlineData]` / `[MemberData]`）；生命週期為 **`[Before(Test)]` / `[After(Test)]`**（非建構子 / IDisposable）；所有測試方法**必須**為 `async Task`；測試專案 **`OutputType=Exe`** 且**不含** `Microsoft.NET.Test.Sdk`；執行方式為 **`dotnet run`**（非 `dotnet test`）。

---

## 2. 元件組成

| 元件 | 類型 | 路徑 |
|---|---|---|
| Orchestrator | Skill | `.codex/skills/dotnet-testing-orchestrator-tunit/` |
| Analyzer | Subagent | `.codex/agents/dotnet-testing-advanced-tunit-analyzer.toml` |
| Writer | Subagent | `.codex/agents/dotnet-testing-advanced-tunit-writer.toml` |
| Executor | Subagent | `.codex/agents/dotnet-testing-advanced-tunit-executor.toml` |
| Reviewer | Subagent | `.codex/agents/dotnet-testing-advanced-tunit-reviewer.toml` |

Orchestrator 在 SpawnAgent 時**只傳交接檔案路徑 + 摘要數字**，不嵌入完整 JSON；各 Subagent 的 Step 0 自行讀取上游交接檔案。

---

## 3. Phase 1 Analyzer

Analyzer 讀原始碼，識別目標類型、依賴與 TUnit 功能需求，產出 `analysis.json`。

**兩種目標類型：**

| 類型 | 特徵 | 處理 |
|---|---|---|
| Service | 有可注入依賴（Repository / TimeProvider / IFileSystem / 介面）| 正常 mock 流程 |
| Validator | `AbstractValidator<T>` | `forbidWriterSplit: true`，永不分割；展開巢狀 Validator 與 CrossField 規則 |

> 目標類型由繼承鏈判定：繼承 `AbstractValidator<T>` → `"validator"`，其餘 → `"service"`。Validator 跳過方法簽章分析（規則在建構子中），但仍做建構子依賴分析（如注入的 `TimeProvider`）。

**Analyzer 輸出（回傳摘要 + 寫入 analysis.json）：**

- `className`、`targetType`、`methodsToTest`、`methodCount`、`scenarioCount`、`methodScenarioCounts`
- `requiredSkills`、`tunitFeatureRequirements`、`projectContext`、`analysisFilePath`
- **`tunitFeatureRequirements`**：`basicTest` / `arguments` / `methodDataSource` / `classDataSource` / `matrixTests` / `dependencyInjection` / `notInParallel` / `retry` / `timeout` / `webApplicationFactory` / `testcontainers` 等布林旗標，每個值必須基於實際分析。
- **`requiredSkills`**：`tunit-fundamentals` **必載**；`tunit-advanced` 在需要 MethodDataSource / ClassDataSource / Matrix / DI / Retry / Timeout / Properties / WebApplicationFactory / Testcontainers，或遷移自帶進階功能時**條件載入**。
- **框架偵測（`migrationSource`）**：依**測試專案 `.csproj` 的 PackageReference** 判定 — 含 `xunit` → `"xunit"`、含 `NUnit` → `"nunit"`、僅 TUnit 或無測試框架 → `null`。偵測到遷移時額外產出 `migrationAnalysis`（屬性 / 簽章 / 生命週期 / 套件 / OutputType 轉換清單）。

### 3.1 `.slnx` 版本感知選取（強制）

Analyzer 從 `.csproj` 取得 `<TargetFramework>`，再向上查找方案檔，**依版本選對應 `.slnx`**：

| TargetFramework | 選取的方案檔 |
|---|---|
| `net8.0` | 含 `Net8` 的 `.slnx`（如 `Practice.TUnit.Net8.slnx`）|
| `net9.0` | **不含**版本後綴的 `.slnx`（如 `Practice.TUnit.slnx`）|
| `net10.0` | 含 `Net10` 的 `.slnx`（如 `Practice.TUnit.Net10.slnx`）|

確認存在的相對路徑填入 `projectContext.solutionPath`，供 Executor 建置使用；找不到時設 `"UNKNOWN"` 並警告。

### 3.2 Matrix 與 Arguments 的 TUnit 限制

- **Matrix**：TUnit 0.6.123 **沒有** `[MatrixDataSource]` / `[Matrix]`。多參數笛卡爾組合方法標 `matrixCandidate: true`，實作改用 **`[MethodDataSource]` 搭配巢狀迴圈**（`public static` 回傳 `IEnumerable<(...)>`）。
- **`matrixCandidate` 互斥原則**：`matrixCandidate: true` 的方法在 `suggestedTestScenarios` **只列一個批次場景**（涵蓋所有組合），不得同時逐一列出個別組合，避免 Writer 重複實作。邊界 / 例外場景仍個別列出。
- **`suggestedTestScenarios` 命名**：中文三段式 `方法_情境_預期`，第三段描述**業務預期行為**，**禁止引用測試機制**（如 `MethodDataSource`、`Arguments`）。

Orchestrator 收摘要後**驗證交接檔案確實存在**，才 SpawnAgent Writer。

---

## 4. Phase 2 Writer

Writer 在 Step 0 讀 analysis.json，按 `requiredSkills` 載入 Agent Skills（`tunit-fundamentals` 必載、`tunit-advanced` 條件載入），撰寫測試。

**測試命名**：中文三段式 `方法名_情境描述_預期結果`。
**斷言**：優先用 AwesomeAssertions（`.Should()`）；Validator 用 FluentValidation TestHelper（`ShouldHaveValidationErrorFor` / `ShouldNotHaveValidationErrorFor`）。
**TUnit 硬規則**：所有 `[Test]` 方法為 `async Task`（無 await 時尾端補 `await Task.CompletedTask`）；`.csproj` 設 `<OutputType>Exe</OutputType>`、**禁** `Microsoft.NET.Test.Sdk` / `xunit` / `<OutputType>Library</OutputType>`；生命週期用 `[Before(Test)]` / `[After(Test)]`。

### 4.1 大型類別 Writer 分割策略

**觸發條件**（須同時滿足）：`methodCount > 5` 或 `scenarioCount > 20`，**且** `forbidWriterSplit != true`。觸發後啟動**最多 2 個平行 Writer**。

**分組規則（greedy 均衡）：**

1. 將 `methodScenarioCounts` 按 scenario 數量由多至少排序。
2. 貪婪地將方法分配至兩組，讓兩組 scenario 總數盡量均衡。
3. Writer 1 負責第一組、Writer 2 負責第二組；同一方法的所有測試案例絕不跨組。
4. 兩個 Writer **平行**啟動（單一 Agent tool 呼叫 message）。

**輸出檔案命名：** Writer 1（主要組）`{ClassName}Tests.cs`；Writer 2（分割組）`{ClassName}_{代表方法/群組}Tests.cs`。

### 4.2 多 Writer 風格統一指令（分割時加入每個 Writer prompt）

這是 Codex 版針對「split 多檔風格漂移」的強化。分割時所有 Writer 必守逐檔一致：

- **例外斷言**：統一 `.Throw<T>()`，禁 `.ThrowExactly<T>()`
- **lambda 委派**：統一 `var act = () =>`，禁 `Action act = () =>`
- **物件比較**：統一 `BeEquivalentTo()`
- **FakeTimeProvider 欄位命名**：統一 `_timeProvider`（禁混用 `_fakeTimeProvider`）
- **`using` 排列順序**：AwesomeAssertions → AutoFixture → TimeProvider → NSubstitute → 介面 → Model → Service

> 跨檔案一致性由 **Writer 風格統一指令 + Orchestrator artifact gate** 強制，並由 Reviewer §4h（多 Writer 分割時）顯式把關。

### 4.3 方法範圍硬約束（Codex 強化）

Writer Step 0.5 建立 `effectiveMethodsToTest`（來源優先序：split assignment 方法清單 > prompt `methodsToTest` / `methodName` / `assignedMethods` / `writerControls.methods` > Analyzer artifact `methodsToTest` > 全類別）。若非空，只能撰寫這些方法的測試，method-scope 不得擴寫成整個 class。建構子 null-guard 只有 assignment 明確含 `Constructor` 的 Writer 可寫，split 時不得各自重複。`effectiveMethodsToTest` 必須落到 `testClasses[].methodsCovered`。

### 4.4 Writer Artifact 完整性 Gate

Writer 回傳後 Orchestrator **不只採信摘要**，必須讀實體 `writer-result.json` 驗欄位齊全（`writerResultFilePath`、`testFilePaths`、`testCaseCount`、`testMethodCount`、`testClasses[].className/filePath/methodsCovered`、`skillsLoaded`）+ 方法範圍檢查（`methodsCovered` 必為明確方法名清單，不得用 `All`/`FullClass`/空陣列/敘述文字；split / method-scope 不得溢寫；ctor 測試只能在單一 assignment）。缺欄 / 不一致 → 不進 Executor，可 **bounded re-dispatch Writer 最多 2 次**（只補缺漏，**不重啟整個 workflow**），仍不行則判 blocker。

### 4.5 階段間主動釋放 agent（Codex 強化）

Writer 全部收斂且 gate 通過後、dispatch Executor 前，Orchestrator **主動關閉已完成 Writer agents**，釋放後續 phase 的 runtime thread slots（Analyzer→Writer、Executor→Reviewer 同樣處理）。若 runtime 不支援主動關閉已完成 agent，Orchestrator 須停手並回報，不得改用限制 Writer 並行數或 serialize Writer 作為替代。此舉只釋放已完成 agent，不改測試 / 分割 / correctness。

---

## 5. Phase 3 Executor

建置 + 執行 + **bounded 修正迴圈（最多 3 輪）**。

- **建置**：`dotnet build <solution-path> -p:WarningLevel=0 /clp:ErrorsOnly --verbosity minimal`。TUnit 用 **Source Generator**，首次建置較慢；遇 Source Generator 錯誤先 `dotnet clean` 再 build。
- **執行（唯一允許方式）**：`dotnet run --project <test-project-path> --no-build`（TUnit 原生）。**絕不可使用 `dotnet test`** — 會讓 Source Generator / Testing Platform 行為失真。篩選用 `-- --treenode-filter`。
- 常見修正：補 `using`、**add-only 補齊缺少的測試套件**、`OutputType=Exe` 缺失、移除 `Microsoft.NET.Test.Sdk` 衝突、`async Task` 簽章、`[MatrixDataSource]`/`[Matrix]` → `[MethodDataSource]`、`[ClassDataSource<T>]` 誤用 → `[MethodDataSource]` 包裝。**禁升級或降級既有套件版本**修 build（版本管理屬專案維護者，根因為版本過舊則回報 **blocker**）。**禁** restart 整個流程 / 拼湊·偽造 artifact / 假綠。

輸出：`totalTests`、`passedTests`、`failedTests`、`skippedTests`、`fixRounds`、`executionMethod`、`engineMode`、`executorResultFilePath`。TUnit 結果由 `✓`/`x`/`↓` 或 run summary 解讀，**不得套用 xUnit `dotnet test` parser**。

> **TUnit Executor 驗收 Gate**：Orchestrator 讀 `executorResultFilePath`，確認 `executionMethod === "dotnet run"`、`engineMode`（或 `engineModeEvidence`）記錄 `SourceGenerated`、通過/失敗/略過數來自 TUnit 輸出、`fixRounds` 落入 run-state。若顯示用 `dotnet test`，該 phase 判 blocker，不得進入成功報告。

---

## 6. Phase 4 Reviewer

讀測試碼 + 三個交接檔（analysis/writer-result/executor-result），品質審查。Reviewer 一律執行，不因 Executor 全綠而跳過；有完整審查 / re-review 兩模式。Reviewer **無 `Edit` 工具**，只記錄不修改。

**reviewer.toml 明文 7 大審查面向**：

| 面向 | 重點 |
|---|---|
| 4a 命名規範 | 中文三段式 `方法_情境_預期` |
| 4b 斷言品質 | AwesomeAssertions；TUnit 原生斷言須 `await Assert.That(...)` |
| 4c 測試結構 | AAA、`async Task`、`await Task.CompletedTask`、`[Before(Test)]`/`[After(Test)]` |
| 4d **TUnit 合規性**（核心差異）| `OutputType=Exe`、無 `Microsoft.NET.Test.Sdk`、`[Test]`/`[Arguments]`/`[MethodDataSource]`、無 xUnit 殘留（零容忍 FAIL）|
| 4e 資料驅動測試 | `[MethodDataSource]` 為 `public static` 回 `IEnumerable<T>`；Matrix 用巢狀迴圈；`[ClassDataSource<T>]` 傳整個 T 實例不迭代 |
| 4f 並行與執行控制 | `[NotInParallel]` / `[Retry]` / `[Timeout]` 合理性 |
| 4g 覆蓋率 | Happy / 邊界 / 例外 / 分支；建構子 null-guard；§4g-scope 只針對 `methodsToTest`；§4g-2 Validator 巢狀 + CrossField 覆蓋 |

> §4h 跨檔案一致性（`_timeProvider` 命名、`.Throw<T>()`、`var act = () =>`、`BeEquivalentTo()`、`using` 排序）僅在多 Writer 分割時檢查。

**修改流程（post-review approval gate）**：Reviewer 回傳後 Orchestrator 呈現完整報告（`overallScore` / `issues` / `missingTestCases`）並**等待使用者明確指示**才啟動修改流程（Writer 修改 → Executor → Reviewer re-review）。**禁止自動觸發、禁止預先授權**（即使初始請求含「跑完後套用全部建議」，後半段只視為意圖說明）。

---

## 7. Production-code 邊界（Codex 與 Claude 共有政策）

本 workflow 預設**只寫/驗測試，不主動改 production code**：

- 若完整隔離測試需要 seam（加 `TimeProvider` / clock seam、`IFileSystem` / `IReportWriter`、改 constructor signature / public API、加 production 套件）→ Orchestrator 標 **`requiresUserApproval`**，未經同意不得 dispatch 改 production code 的工作。
- production refactor 必須走獨立的 refactor-for-testability 工作，不得混入一般 test-writing 或 reviewer-suggestion 修改流程。
- final report 誠實標 `blocked` / `characterization-only` / `requiresUserApproval`，不把缺 seam 包裝成完整 isolated TUnit test。

---

## 8. 交接檔案與 run-state instrumentation

| 交接檔 | 寫入者 | 路徑 |
|---|---|---|
| `{ClassName}.analysis.json` | Analyzer | `.orchestrator/analysis/` |
| Writer artifact（逐 assignment 唯一）| Writer | `.orchestrator/writer-result/`；split 時每個 assignment 各自一份可獨立 poll 的 canonical artifact，路徑須能回溯該 assignment 與其 `testFilePath`|
| `*.executor-result.json` | Executor | `.orchestrator/executor-result/` |
| `{ClassName}.reviewer-result.json` | Reviewer | `.orchestrator/reviewer-result/` |
| `run-state.json` | Orchestrator | `.orchestrator/` |

**`run-state.json` 是官方耗時的唯一真實來源**（wall-clock，不依賴 narration），且含 Codex 強化的階段內 instrumentation：

- `phases.{analyzer,writer,executor,reviewer}.assignments[]`：逐 assignment 的 `dispatchIssuedAt` / `dispatchAcceptedAt` / `artifactReadyAt` / `completedAt` / `dispatchAcceptLatencyMs` / `produceSpanMs`（每筆獨立量測；平行 assignment 不得批次補 stamp）
- `phaseDurations.{phase}.durationMs`（+ `source: "run-state"`）
- `redispatchEvents[]`（撞 agent thread-limit / capacity / stream retry / nested spawn fail / phase timeout / artifact missing 等已知 runtime 不穩定家族的補派事件）、`boundedRedispatchCount`、`restartCount`、`executorFixRounds`
- 量不到的細項一律填 `null` + `notes`，不得省略欄位或改用短名

正式 phase timing proof 必須讀實體 `run-state.json` 的 `dispatchIssuedAt → artifactReadyAt → completedAt` 計算；不得從對話敘述、subagent 回傳文字、人工推估或 token report 推導。

> **Token 用量不提供（de-scoped）**：Codex native SpawnAgent subagent 的全流程 token 無可靠 truth source（實證確認），本 workflow 不回報、不執行 token report、不以估算 / hook / transcript 推導。

---

## 9. 多目標並行策略

| 階段 | 執行方式 | 原因 |
|---|---|---|
| Analyzer | 平行（逐 target）| 互不依賴 |
| Writer | 平行（逐 target，且各 target 仍可 per-class 分割）| dispatch 單位是「Writer assignment」非 target，故多目標可產生 > target 數的 Writer |
| Executor | 循序 | 同方案 `dotnet build` / `dotnet run` 不可並行 |
| Reviewer | 平行（逐 target）| 獨立審查 |

- 並行 SpawnAgent 數受 `.codex/config.toml` `[agents] max_threads` 限制。
- **thread-ceiling 自癒**：分割使並行 Writer 變多時可能逼近 agent thread limit；遇已知 runtime 不穩定家族時做 **bounded re-dispatch**（每 phase 最多 2 次，re-dispatch 前須確認前一次同角色 dispatch 沒留下可用 canonical artifact 避免雙重 truth，`restartCount=0`），`run-state.redispatchEvents` 記錄。配合 §4.5 階段間主動釋放降低撞限機率。
- **多目標 Step 0**：使用者未提供檔案路徑時，Orchestrator 先用 `Grep` 定位目標（指定版本變體則限定對應目錄）；找不到不得自行撰寫程式碼。

---

## 10. Phase 0 / Phase 5 清理

- **Phase 0**：啟動 Analyzer 前，`Glob({testProjectDir}/.orchestrator/**)` 檢查殘留；有殘留則委託 Executor `task: "cleanup"` 清理，並初始化 `run-state.json`（含 `target`、`overallWallClock` 起點、空 `phases`、`redispatchEvents: []`、計數歸零）。
- **Phase 5**：四階段完成並呈現結果後（含修改流程完成後），**不自動清理**本次 `.orchestrator/` artifacts。`analysis/`、`writer-result/`、`executor-result/`、`reviewer-result/` 與 `run-state.json` 都保留供驗收與 benchmark，於**下一次 run 的 Phase 0** 殘留清理時一併處理。
- 生成測試碼 + `.orchestrator/` 皆為 byproduct，**不進版控**。

---

## 11. 支援的測試技術棧

```text
TUnit 0.6.123（meta-package，內含 Microsoft.Testing.Platform 等傳遞依賴，版本鏈鎖定）
AwesomeAssertions 9.x（基於 FluentAssertions）/ NSubstitute / Bogus
Microsoft.Extensions.TimeProvider.Testing（FakeTimeProvider）
FluentValidation 11.x（含 TestHelper API，不需另裝 FluentValidation.TestHelper）
```

> 執行模型：Microsoft.Testing.Platform + TUnit **Source Generator**（engineMode `SourceGenerated`），以 `dotnet run` 驅動，測試專案 `OutputType=Exe`、無 `Microsoft.NET.Test.Sdk`。
>
> **命名空間陷阱**：FakeTimeProvider 套件名為 `Microsoft.Extensions.TimeProvider.Testing`，命名空間卻是 `Microsoft.Extensions.Time.Testing`（少了 `Provider`）。
>
> 技術型 `dotnet-testing-*` Skills 由外部 repo [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 提供，需直接複製到 `.codex/skills/`。
