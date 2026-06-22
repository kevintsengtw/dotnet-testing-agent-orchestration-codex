# TUnit 測試工作流程使用指南

本文件說明如何使用 `$dotnet-testing-orchestrator-tunit`，在 Codex 中自動完成 .NET TUnit 測試的分析、撰寫、執行與審查四個階段。

適用場景：任何需要使用 **TUnit 框架**為 .NET 類別產生測試的情境，包含純函式計算、有 Mock 依賴的服務類別、FluentValidation 驗證器、含時間（`TimeProvider`）或檔案系統（`IFileSystem`）抽象的類別，以及 **xUnit/NUnit → TUnit 遷移**。

測試技術棧：TUnit 0.6.123 + AwesomeAssertions + NSubstitute + Bogus + FakeTimeProvider + FluentValidation

與 xUnit 工作流程最關鍵的差別：TUnit 以 **Source Generator** 驅動，測試專案 `OutputType=Exe`、**不含** `Microsoft.NET.Test.Sdk`，執行方式為 **`dotnet run`**（非 `dotnet test`），所有測試方法為 `async Task`。

---

## A. 前提條件

- **Codex 已就緒**（支援原生 SpawnAgent / multi-agent，`.codex/config.toml` 中 `multi_agent = true`）
- **dotnet-testing-agent-skills 已複製到 `.codex/skills/`**（Writer 載入 `tunit-fundamentals` / `tunit-advanced` 等技術型 Skill 所需）
- **.NET SDK 8.0 / 9.0 / 10.0 至少一個版本**（`dotnet --version` 可確認）
- **不需要 Docker**（基本 TUnit 測試不使用容器；僅 Testcontainers / WebApplicationFactory 進階場景需要）

---

## B. 觸發方式與使用範例

### 基本觸發

在 Codex 工作階段中，呼叫 Orchestrator Skill：

```text
$dotnet-testing-orchestrator-tunit
```

觸發後，提供目標類別的資訊給 Orchestrator，包含：

- 被測試目標的檔案路徑
- 測試專案路徑（`.csproj`）
- 簡短說明（可選，用於補充特殊需求；如「從 xUnit 遷移」）

Orchestrator 會透過 SpawnAgent 依序自動啟動四個 subagent：Analyzer → Writer → Executor → Reviewer，全程無需手動介入，並維護 `run-state.json` 記錄各階段耗時。

---

### 使用範例

#### 情境 1：純函式計算類別

目標類別無外部依賴，只包含純計算邏輯（如 ISBN 驗證、折扣計算）。

```text
呼叫 $dotnet-testing-orchestrator-tunit，為 BookCatalog 撰寫 TUnit 測試。
被測試目標：samples/tunit/practice_tunit/src/Practice.TUnit.Core/Services/BookCatalog.cs
測試專案：samples/tunit/practice_tunit/tests/Practice.TUnit.Core.Tests/Practice.TUnit.Core.Tests.csproj
說明：純函式類別，無外部依賴
```

預期 Orchestrator 行為：

- Analyzer 判斷類別無建構子依賴，`requiredSkills` 只包含 `tunit-fundamentals`
- Writer 不引入 NSubstitute Mock，直接以 `[Test]` / `[Arguments]` 測試純計算邏輯
- 測試方法命名範例：`IsValidIsbn13_有效ISBN_應回傳true`、`CalculateDiscountPrice_會員年資5年_應套用對應折扣`

---

#### 情境 2：有 Mock 依賴的服務類別

目標類別建構子注入一個或多個介面（如 `IBookRepository`、`IMemberRepository`），需要 Mock 隔離外部依賴。

```text
呼叫 $dotnet-testing-orchestrator-tunit，為 LibraryMemberService 撰寫 TUnit 測試。
被測試目標：samples/tunit/practice_tunit/src/Practice.TUnit.Core/Services/LibraryMemberService.cs
測試專案：samples/tunit/practice_tunit/tests/Practice.TUnit.Core.Tests/Practice.TUnit.Core.Tests.csproj
```

預期 Orchestrator 行為：

- Analyzer 偵測到介面依賴，`requiredSkills` 含 `tunit-fundamentals`，Writer 使用 NSubstitute
- Writer 在 `[Before(Test)]` 中以 `Substitute.For<IXxx>()` 建立 Mock 並組裝 SUT（依賴 ≥ 2 個時強制用類別層級欄位 + `[Before(Test)]` 統一初始化）
- 非同步方法（`async Task`）使用 `await` 正確測試

---

#### 情境 3：多維參數組合（Matrix 候選）

目標方法有多參數笛卡爾組合（如會員等級 × 訂單金額 × 是否續約）。

```text
呼叫 $dotnet-testing-orchestrator-tunit，為 LoanService 的 BorrowBookAsync 方法撰寫 TUnit 測試。
被測試目標：samples/tunit/practice_tunit/src/Practice.TUnit.Core/Services/LoanService.cs
測試專案：samples/tunit/practice_tunit/tests/Practice.TUnit.Core.Tests/Practice.TUnit.Core.Tests.csproj
說明：依會員等級決定借閱期限與續借上限，多種組合
```

預期 Orchestrator 行為：

- Analyzer 將多參數組合方法標 `matrixCandidate: true`，`suggestedTestScenarios` 只列**一個批次場景**（避免重複實作）
- Writer 改用 **`[MethodDataSource]` 搭配巢狀迴圈**產生組合（TUnit 0.6.123 **沒有** `[MatrixDataSource]` / `[Matrix]`），資料來源方法為 `public static` 回傳 `IEnumerable<(...)>`
- 測試方法命名範例：`BorrowBookAsync_依MembershipType借閱_借閱期限應符合會員等級規則`

---

#### 情境 4：FakeTimeProvider 時間依賴

目標類別建構子注入 `TimeProvider`，方法依賴目前時間判斷（如預約到期、保留期限）。

```text
呼叫 $dotnet-testing-orchestrator-tunit，為 ReservationService 撰寫 TUnit 測試。
被測試目標：samples/tunit/practice_tunit/src/Practice.TUnit.Core/Services/ReservationService.cs
測試專案：samples/tunit/practice_tunit/tests/Practice.TUnit.Core.Tests/Practice.TUnit.Core.Tests.csproj
```

預期 Orchestrator 行為：

- Analyzer 偵測到 `TimeProvider` 建構子依賴，標記 FakeTimeProvider 需求
- Writer 在 `[Before(Test)]` 以 `new FakeTimeProvider()` 並 `SetUtcNow(...)` 初始化為**最早合理時間（預設 06:00 UTC）**，確保 `Advance()` 永遠向前，不觸發 `Cannot go back in time`
- FakeTimeProvider 欄位統一命名 `_timeProvider`
- 測試方法命名範例：`IsExpiringSoon_即將到期_應回傳true`、`GetRemainingTime_已過期_應回傳零`

> **命名空間陷阱**：FakeTimeProvider 套件名是 `Microsoft.Extensions.TimeProvider.Testing`，命名空間卻是 `Microsoft.Extensions.Time.Testing`（少了 `Provider`）。

---

#### 情境 5：IFileSystem 檔案系統抽象

目標類別建構子注入 `IFileSystem`，操作檔案讀寫或目錄處理。

```text
呼叫 $dotnet-testing-orchestrator-tunit，為 CatalogExportService 的所有公開方法撰寫 TUnit 測試。
被測試目標：samples/tunit/practice_tunit/src/Practice.TUnit.Core/Services/CatalogExportService.cs
測試專案：samples/tunit/practice_tunit/tests/Practice.TUnit.Core.Tests/Practice.TUnit.Core.Tests.csproj
```

預期 Orchestrator 行為：

- Analyzer 偵測到 `IFileSystem` 建構子依賴，標記 MockFileSystem 需求
- Writer 使用 `System.IO.Abstractions.TestingHelpers.MockFileSystem` 在記憶體中建立虛擬檔案與目錄
- 測試涵蓋檔案存在/不存在、匯出/匯入成功/失敗、路徑異常等情境

---

#### 情境 6：FluentValidation 驗證器

目標類別繼承 `AbstractValidator<T>`，需使用 FluentValidation TestHelper 模式測試驗證規則。

```text
呼叫 $dotnet-testing-orchestrator-tunit，為 LibraryMemberValidator 撰寫 TUnit 測試。
被測試目標：samples/tunit/practice_tunit/src/Practice.TUnit.Core/Validators/LibraryMemberValidator.cs
測試專案：samples/tunit/practice_tunit/tests/Practice.TUnit.Core.Tests/Practice.TUnit.Core.Tests.csproj
```

預期 Orchestrator 行為：

- Analyzer 偵測到繼承 `AbstractValidator<LibraryMember>`，設定 `targetType: "validator"` 與 `forbidWriterSplit: true`，並產出 `validBaseObjectHint`
- Writer 以 `validBaseObjectHint` 建立 `CreateValidLibraryMember()` helper，測試用 `_sut.TestValidate(model)` 搭配 `ShouldHaveValidationErrorFor()` / `ShouldNotHaveValidationErrorFor()`（Validator 測試**不需要** AwesomeAssertions `.Should()`，Reviewer 不視為警告）
- Validator 類別**永不分割**（無論 scenarioCount 多大都用單一 Writer，確保 CrossField 與一般規則一致、不重複）

---

#### 情境 7：xUnit → TUnit 遷移

將既有 xUnit 測試遷移為 TUnit。

```text
呼叫 $dotnet-testing-orchestrator-tunit，為 BookCatalog 撰寫 TUnit 測試，遷移自既有 xUnit 測試。
被測試目標：samples/tunit/practice_tunit/src/Practice.TUnit.Core/Services/BookCatalog.cs
測試專案：samples/tunit/practice_tunit/tests/Practice.TUnit.Core.Tests/Practice.TUnit.Core.Tests.csproj
遷移來源：samples/tunit/practice_tunit/migration_source/BookCatalogXunitTests.cs
```

預期 Orchestrator 行為：

- Analyzer 偵測 `migrationSource`（依**測試專案 `.csproj` PackageReference**判定），產出 `migrationAnalysis` 轉換清單
- Writer 執行轉換：`[Fact]`→`[Test]`、`[Theory]`+`[InlineData]`→`[Test]`+`[Arguments]`、`[MemberData]`→`[MethodDataSource]`、`[ClassData]`→`[ClassDataSource]`、`[Trait]`→`[Properties]`；簽章改 `async Task`；建構子→`[Before(Test)]`、`IDisposable.Dispose`→`[After(Test)]`、`IAsyncLifetime`→`[Before(Test)]`/`[After(Test)]`；移除 `xunit`/`Microsoft.NET.Test.Sdk`、加入 `TUnit`、`OutputType` `Library`→`Exe`

---

#### 情境 8：多目標類別平行處理

一次指定多個目標類別，Orchestrator 自動以平行方式分析與撰寫。

```text
呼叫 $dotnet-testing-orchestrator-tunit，為 LoanService、ReservationService 撰寫 TUnit 測試。
被測試目標：samples/tunit/practice_tunit/src/Practice.TUnit.Core/Services/LoanService.cs, samples/tunit/practice_tunit/src/Practice.TUnit.Core/Services/ReservationService.cs
測試專案：samples/tunit/practice_tunit/tests/Practice.TUnit.Core.Tests/Practice.TUnit.Core.Tests.csproj
```

預期 Orchestrator 行為：

- Orchestrator 偵測到 2 個目標，平行 SpawnAgent 2 個 Analyzer
- 2 個 Writer 同樣平行啟動，各自載入自己需要的 Skills
- Executor **循序執行**（共用同一個方案，避免 `dotnet build` / `dotnet run` 衝突）
- 2 個 Reviewer 平行啟動，最後彙整呈現概覽表格與各目標詳細結果

> 平行的 SpawnAgent 數量受 `.codex/config.toml` 的 `[agents] max_threads` 限制。

---

## C. 練習專案

### 目錄結構

練習專案位於 `samples/tunit/practice_tunit/`，結構如下：

```text
samples/tunit/practice_tunit/
├── Practice.TUnit.slnx            # 解決方案檔（net9.0，無版本後綴）
├── Practice.TUnit.Net8.slnx       # net8.0 方案檔
├── Practice.TUnit.Net10.slnx      # net10.0 方案檔
├── migration_source/              # xUnit → TUnit 遷移來源（BookCatalogXunitTests.cs）
├── src/
│   └── Practice.TUnit.Core/       # 待測試的應用程式碼（Orchestrator 的分析目標）
│       ├── Interfaces/            # 介面定義（IBookRepository 等）
│       ├── Models/                # 資料模型（Book、Loan、Reservation 等）
│       ├── Services/              # 服務類別（LoanService、ReservationService 等）
│       └── Validators/            # 驗證器（LibraryMemberValidator）
└── tests/
    └── Practice.TUnit.Core.Tests/ # 空白測試專案目錄（由 Orchestrator 產生測試）
```

練習專案支援三個 .NET 版本，以子專案形式存在同一目錄內：`net8.0` / `net9.0` / `net10.0`（對應 `Practice.TUnit.Net8.Core` / `Practice.TUnit.Core` / `Practice.TUnit.Net10.Core`）。Analyzer 會依被測專案的 `<TargetFramework>` **版本感知選取** `.slnx`：net8 → `*Net8.slnx`、net9 → 無後綴 `.slnx`、net10 → `*Net10.slnx`。

### 各目標類別說明

| 目標類別 | 學習重點 |
| ------- | ------- |
| `BookCatalog` | 純函式、`[Test]` / `[Arguments]`、AwesomeAssertions、xUnit → TUnit 遷移 |
| `LibraryMemberService` | NSubstitute Mock/Stub、`[Before(Test)]` 統一初始化、非同步方法測試 |
| `LoanService` | 多會員等級組合 → `[MethodDataSource]` 巢狀迴圈（Matrix 候選） |
| `ReservationService` | FakeTimeProvider 時間凍結與快轉（06:00 UTC 起點、forward-advance） |
| `CatalogExportService` | MockFileSystem 檔案系統抽象、匯出/匯入測試 |
| `LibraryMemberValidator` | FluentValidation TestHelper、`CreateValid{Model}()` helper、永不分割 |

### 還原測試專案

Orchestrator 產生的測試檔案與 `.orchestrator/` artifacts 僅供練習使用，屬 byproduct，**不應 commit**（已由 `.gitignore` 排除）。若要還原初始空白狀態：

```bash
git checkout -- samples/tunit/practice_tunit/tests/
git clean -fd samples/tunit/practice_tunit/tests/
```

> **注意**：所有 `samples/*/tests/` 下產生的測試類別檔案、`.orchestrator/`（含 `run-state.json`）與 `.csproj` 修改，請在練習完成後還原。

---

## D. 常見問題排查

### 1. Agent Skills 未載入

**症狀**：Orchestrator SpawnAgent 啟動 Writer 時，Writer 找不到 `dotnet-testing-advanced-tunit-fundamentals` 等技能。

**解法**：確認 `dotnet-testing-agent-skills` 的技術型 skill 目錄都已複製到 `.codex/skills/`（每個目錄下需有 `SKILL.md`）。TUnit 工作流程至少需要 `dotnet-testing-advanced-tunit-fundamentals`（必載）與 `dotnet-testing-advanced-tunit-advanced`（條件載入）。重新啟動 Codex 工作階段後再次嘗試。

---

### 2. `dotnet test` 跑不出 TUnit 測試

**說明**：TUnit 以 Source Generator + Microsoft.Testing.Platform 驅動，**必須用 `dotnet run` 執行**：

```bash
dotnet run --project <test-project-path> --no-build
```

`dotnet test` 會讓 TUnit Source Generator / Testing Platform 行為失真，本 workflow 視為禁止。Executor 與 Reviewer 都只用 `dotnet run`；篩選特定測試用 `-- --treenode-filter`。若 executor-result 顯示用了 `dotnet test`，該 phase 會被判定為 blocker。

---

### 3. `OutputType must be Exe` 或缺少 Main method

**症狀**：建置時出現 `outputType must be Exe` 或找不到進入點。

**解法**：TUnit 測試專案的 `.csproj` 必須設定 `<OutputType>Exe</OutputType>`，且**不得**引用 `Microsoft.NET.Test.Sdk`（與 TUnit 衝突）：

```xml
<PropertyGroup>
  <OutputType>Exe</OutputType>
  <IsTestProject>true</IsTestProject>
  <LangVersion>latest</LangVersion>
</PropertyGroup>
```

---

### 4. `[MatrixDataSource]` / `[Matrix]` 編譯錯誤

**說明**：TUnit 0.6.123 **不存在** `[MatrixDataSource]` / `[Matrix]` 屬性。即使 `tunit-advanced` Skill 文件提及 Matrix Tests，實作時必須改用 `[MethodDataSource]` 搭配巢狀迴圈：

```csharp
public static IEnumerable<(int level, int orderAmount)> GetMatrixCases()
{
    foreach (var level in new[] { 0, 1, 2 })
        foreach (var amount in new[] { 100, 500, 1000 })
            yield return (level, amount);
}

[Test]
[MethodDataSource(nameof(GetMatrixCases))]
public async Task Calculate_不同等級與金額組合_應正確計算(int level, int orderAmount)
{
    // 自動產生 3 × 3 = 9 組測試案例
    await Task.CompletedTask;
}
```

> 資料來源方法必須為 `public static`，回傳 `IEnumerable<T>` 或 `IEnumerable<(T1, T2, ...)>`。

---

### 5. `[ClassDataSource<T>]` 沒有逐筆展開

**說明**：TUnit 0.6.123 的 `[ClassDataSource<T>]` 會把**整個 T 實例**作為單一參數傳入，**不會**迭代 `IEnumerable<T>` 元素。

**解法**：需要「每筆資料一個測試案例」時，改用 `[MethodDataSource]` 搭配 `public static` 靜態包裝方法回傳 `IEnumerable<T>`。`[ClassDataSource<T>]` 只適用於把 T 本身作為完整 fixture / configuration 物件傳入的情境。

---

### 6. `[Arguments]` 無法放 `decimal` 或非常數

**說明**：`[Arguments]` 屬性引數必須是編譯時常數，`decimal` 與非常數字面值會出現 `An attribute argument must be a constant expression` 錯誤。

**解法**：改用 `[MethodDataSource]` 傳遞 `decimal` 參數：

```csharp
public static IEnumerable<(decimal, decimal, decimal)> DecimalCases()
{
    yield return (1.5m, 2.5m, 4.0m);
    yield return (0.1m, 0.2m, 0.3m);
}

[Test]
[MethodDataSource(nameof(DecimalCases))]
public async Task Calculate_有效輸入_應回傳正確結果(decimal a, decimal b, decimal expected)
{
    // ...
    await Task.CompletedTask;
}
```

---

### 7. `Cannot go back in time`（FakeTimeProvider）

**症狀**：使用 FakeTimeProvider 的測試在 `Advance()` 時擲出例外。

**解法**：`[Before(Test)]` 中將 FakeTimeProvider 初始化為最早合理時間（預設 06:00 UTC），確保所有 `Advance()` 都向前推進：

```csharp
_timeProvider = new FakeTimeProvider();
_timeProvider.SetUtcNow(new DateTimeOffset(2024, 1, 15, 6, 0, 0, TimeSpan.Zero));
```

---

## E. 工作流程細節

### Phase 1：Analyzer 分析

TUnit Analyzer subagent 接收 Orchestrator 委派後，執行以下工作：

- 讀取被測試目標的原始碼（`.cs` 檔案）
- 判斷類別類型（`"service"` / `"validator"`），決定後續測試策略；Validator 設 `forbidWriterSplit: true` 並產出 `validBaseObjectHint`
- 識別建構子依賴（介面 → NSubstitute、`TimeProvider` → FakeTimeProvider、`IFileSystem` → MockFileSystem）
- **框架偵測**：依測試專案 `.csproj` PackageReference 判定 `migrationSource`（xUnit / NUnit / null），遷移時產出 `migrationAnalysis`
- 判斷 TUnit 功能需求（`tunitFeatureRequirements`），決定 `requiredSkills`（`tunit-fundamentals` 必載、`tunit-advanced` 條件載入）
- **版本感知選取 `.slnx`**：依 `<TargetFramework>` 選 net8/net9/net10 對應方案檔，填入 `projectContext.solutionPath`
- 估算各方法測試情境數量（`methodScenarioCounts`），決定是否需要分割 Writer
- 產出結構化 JSON 分析報告（compact JSON），寫入 `.orchestrator/analysis/{ClassName}.analysis.json`

Analyzer 完成後回傳摘要（方法數、情境數、`requiredSkills`、`tunitFeatureRequirements`、`projectContext`），Orchestrator 驗證交接檔案存在後進入 Phase 2。

---

### Phase 2：Writer 撰寫

TUnit Writer subagent 接收 Orchestrator 委派後，執行以下工作：

- 讀取 Analyzer 交接的 JSON 分析報告，取得 `requiredSkills`、`suggestedTestScenarios`、`tunitFeatureRequirements` 等
- 依 `requiredSkills` 載入對應的 Skills（`tunit-fundamentals` 必載）
- 確認 `.csproj`：`<OutputType>Exe</OutputType>`、無 `Microsoft.NET.Test.Sdk`、無 `xunit`；既有套件版本沿用不升不降，缺套件才用 SKILL.md 最低保證版本新增
- 按中文三段式命名（`方法_情境_預期`）撰寫測試；所有 `[Test]` 方法為 `async Task`（無 await 時補 `await Task.CompletedTask`）；生命週期用 `[Before(Test)]` / `[After(Test)]`
- 斷言優先 AwesomeAssertions（`.Should()`）；Validator 用 FluentValidation TestHelper

**分割策略**：當 `methodCount > 5` 或 `scenarioCount > 20`（且 `forbidWriterSplit != true`）時，Orchestrator 同時 SpawnAgent 兩個 Writer subagent 平行撰寫：

- Writer 1（主要組）：輸出至 `{ClassName}Tests.cs`
- Writer 2（分割組）：輸出至 `{ClassName}_{代表方法/群組}Tests.cs`
- 兩個 Writer 接收相同的風格統一指令（例外斷言 `.Throw<T>()`、lambda `var act = () =>`、物件比較 `BeEquivalentTo()`、FakeTimeProvider 欄位 `_timeProvider`、`using` 排序），確保多檔逐檔一致

Writer 回傳後 Orchestrator 讀實體 `writer-result.json` 驗欄位齊全與方法範圍（artifact gate），缺欄或不一致可 bounded re-dispatch 最多 2 次。

---

### Phase 3：Executor 建置與執行

TUnit Executor subagent 接收 Orchestrator 委派後，執行以下工作：

- 優先執行 `dotnet build <solution-path> -p:WarningLevel=0 /clp:ErrorsOnly --verbosity minimal` 確認可成功編譯（TUnit 用 Source Generator，首次建置較慢；遇 Source Generator 錯誤先 `dotnet clean`）
- 編譯成功後以 **`dotnet run --project <test-project-path> --no-build`** 執行（**絕不用 `dotnet test`**）
- 解讀 TUnit 輸出格式（`✓` 通過 / `x` 失敗 / `↓` 略過 + run summary），不套用 xUnit parser
- 若出現編譯錯誤或測試失敗，自行修正測試程式碼（補 using、add-only 補套件、修 `OutputType`、`async Task`、`[MatrixDataSource]`→`[MethodDataSource]` 等）；**禁升降既有套件版本**、**禁改 production code**
- 最多進行 3 輪修正，超過則回報失敗原因

Executor 完成後回傳摘要：`totalTests`、`passedTests`、`failedTests`、`fixRounds`、`executionMethod`（固定 `dotnet run`）、`engineMode`（`SourceGenerated`）。Orchestrator 讀 executor-result 驗收 — 若顯示用 `dotnet test` 則判 blocker。

---

### Phase 4：Reviewer 審查

TUnit Reviewer subagent 接收 Orchestrator 委派後，審查以下項目（無 `Edit` 工具，只記錄不修改）：

| 審查項目 | 說明 |
| ------- | ---- |
| 命名規範 | 測試方法是否使用中文三段式（`方法_情境_預期`） |
| 斷言品質 | 是否使用 AwesomeAssertions（`.Should()`）；TUnit 原生斷言須 `await Assert.That(...)` |
| 測試結構 | AAA、所有 `[Test]` 為 `async Task`、`[Before(Test)]` / `[After(Test)]` |
| **TUnit 合規性** | `OutputType=Exe`、無 `Microsoft.NET.Test.Sdk`、`[Test]`/`[Arguments]`/`[MethodDataSource]`、無 xUnit 殘留（零容忍） |
| 資料驅動測試 | `[MethodDataSource]` 為 `public static` 回 `IEnumerable<T>`；Matrix 用巢狀迴圈；`[ClassDataSource<T>]` 不迭代元素 |
| 並行與執行控制 | `[NotInParallel]` / `[Retry]` / `[Timeout]` 合理性 |
| 覆蓋完整性 | Happy path、邊界、例外、分支；建構子 null-guard；Validator 巢狀 + CrossField 覆蓋 |

Reviewer 完成後回傳品質評分報告（`overallScore`）與具體改善建議（`issues`、`missingTestCases`），寫入 `.orchestrator/reviewer-result/{ClassName}.reviewer-result.json`。

Orchestrator 呈現完整結果後**等待使用者決定**是否啟動修改流程（**禁止自動觸發、禁止預先授權**）。若需套用建議，告知 Orchestrator 後進入三階段修改流程（Writer 修改 → Executor 重新執行 → Reviewer re-review）。各階段耗時取自 `run-state.json` 的 wall-clock 時間戳；Token 用量不提供（de-scoped）。
