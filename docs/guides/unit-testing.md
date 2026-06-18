# 單元測試工作流程使用指南

本文件說明如何使用 `$dotnet-testing-orchestrator-unit`，在 Codex 中自動完成 .NET 單元測試的分析、撰寫、執行與審查四個階段。

適用場景：任何需要為 .NET 類別產生 xUnit 單元測試的情境，包含純函式計算、有 Mock 依賴的服務類別、FluentValidation 驗證器，以及含時間或檔案系統抽象的類別。

測試技術棧：xUnit 2.9 + NSubstitute + AutoFixture + AwesomeAssertions + Bogus + FakeTimeProvider + MockFileSystem

---

## A. 前提條件

- **Codex 已就緒**（支援原生 SpawnAgent / multi-agent，`.codex/config.toml` 中 `multi_agent = true`）
- **dotnet-testing-agent-skills 已複製到 `.codex/skills/`**（Writer 載入技術型 Skill 所需）
- **.NET SDK 8.0 / 9.0 / 10.0 至少一個版本**（`dotnet --version` 可確認）
- **不需要 Docker**（單元測試不使用容器）

---

## B. 觸發方式與使用範例

### 基本觸發

在 Codex 工作階段中，呼叫 Orchestrator Skill：

```text
$dotnet-testing-orchestrator-unit
```

觸發後，提供目標類別的資訊給 Orchestrator，包含：

- 被測試目標的檔案路徑
- 測試專案路徑（`.csproj`）
- 簡短說明（可選，用於補充特殊需求）

Orchestrator 會透過 SpawnAgent 依序自動啟動四個 subagent：Analyzer → Writer → Executor → Reviewer，全程無需手動介入，並維護 `run-state.json` 記錄各階段耗時。

---

### 使用範例

#### 情境 1：純函式計算類別

目標類別無外部依賴，只包含純計算邏輯（如溫度轉換、數值運算）。

```text
呼叫 $dotnet-testing-orchestrator-unit，為 TemperatureConverter 撰寫單元測試。
被測試目標：samples/unit/practice/src/Practice.Core.Net8/TemperatureConverter.cs
測試專案：samples/unit/practice/tests/Practice.Core.Net8.Tests/Practice.Core.Net8.Tests.csproj
說明：純函式溫度轉換類別，無外部依賴
```

預期 Orchestrator 行為：

- Analyzer 判斷類別無建構子依賴，`requiredTechniques` 只包含基礎技能（`unit-test-fundamentals`、`awesome-assertions`）
- Writer 不引入 NSubstitute Mock，直接以 `[Fact]` / `[Theory]` 測試純計算邏輯
- 測試方法命名範例：`CelsiusToFahrenheit_攝氏0度_應回傳華氏32度`

---

#### 情境 2：有 Mock 依賴的服務類別

目標類別建構子注入一個或多個介面（如 `IWeatherService`、`INotificationService`），需要 Mock 隔離外部依賴。

```text
呼叫 $dotnet-testing-orchestrator-unit，為 WeatherAlertService 撰寫單元測試。
被測試目標：samples/unit/practice/src/Practice.Core.Net8/Services/WeatherAlertService.cs
測試專案：samples/unit/practice/tests/Practice.Core.Net8.Tests/Practice.Core.Net8.Tests.csproj
```

預期 Orchestrator 行為：

- Analyzer 偵測到 `IWeatherService`、`INotificationService` 等介面依賴，`requiredTechniques` 包含 `nsubstitute-mocking`
- Writer 使用 `NSubstitute.Substitute.For<IXxx>()` 建立 Mock 物件，並設定 Stub 行為
- 非同步方法（`async Task`）使用 `await` 正確測試

---

#### 情境 3：含 AutoFixture + Bogus 測試資料需求

目標類別操作的模型包含循環參考或複雜結構（如 `Employee`、`Department`），需要自動產生測試資料。

```text
呼叫 $dotnet-testing-orchestrator-unit，為 EmployeeService 撰寫單元測試。
被測試目標：samples/unit/practice/src/Practice.Core.Net8/Services/EmployeeService.cs
測試專案：samples/unit/practice/tests/Practice.Core.Net8.Tests/Practice.Core.Net8.Tests.csproj
說明：Employee 模型含循環參考，需要 AutoFixture + Bogus 產生測試資料
```

預期 Orchestrator 行為：

- Analyzer 偵測到複雜輸入模型，`requiredTechniques` 包含 `autofixture-basics` 與 `bogus-fake-data`
- Writer 使用 `new Fixture()` 並設定 `OmitOnRecursionBehavior` 處理循環參考
- 擬真假資料（如員工姓名、部門名稱）透過 `Bogus.Faker` 產生

---

#### 情境 4：FakeTimeProvider 時間依賴

目標類別建構子注入 `TimeProvider`，方法內部依賴目前時間進行判斷（如訂閱有效期、排程觸發）。

```text
呼叫 $dotnet-testing-orchestrator-unit，為 SubscriptionService 撰寫單元測試。
被測試目標：samples/unit/practice/src/Practice.Core.Net8/Services/SubscriptionService.cs
測試專案：samples/unit/practice/tests/Practice.Core.Net8.Tests/Practice.Core.Net8.Tests.csproj
```

預期 Orchestrator 行為：

- Analyzer 偵測到 `TimeProvider` 建構子依賴，`requiredTechniques` 包含 `datetime-testing-timeprovider`
- Writer 使用 `Microsoft.Extensions.Time.Testing.FakeTimeProvider`，在測試中凍結或快轉時間
- 測試方法命名範例：`IsSubscriptionActive_訂閱期間內_應回傳true`、`GetRemainingDays_訂閱已過期_應回傳零`

---

#### 情境 5：MockFileSystem 檔案系統抽象

目標類別建構子注入 `IFileSystem`，操作檔案讀寫或目錄處理。

```text
呼叫 $dotnet-testing-orchestrator-unit，為 ConfigurationLoader 的所有公開方法撰寫單元測試。
被測試目標：samples/unit/practice/src/Practice.Core.Net8/Services/ConfigurationLoader.cs
測試專案：samples/unit/practice/tests/Practice.Core.Net8.Tests/Practice.Core.Net8.Tests.csproj
```

預期 Orchestrator 行為：

- Analyzer 偵測到 `IFileSystem` 建構子依賴，`requiredTechniques` 包含 `filesystem-testing-abstractions`
- Writer 使用 `System.IO.Abstractions.TestingHelpers.MockFileSystem` 模擬檔案系統，在記憶體中建立虛擬檔案與目錄
- 測試涵蓋檔案存在/不存在、讀寫成功/失敗、路徑異常等情境

---

#### 情境 6：FluentValidation 驗證器

目標類別繼承 `AbstractValidator<T>`，需使用 FluentValidation TestHelper 模式測試驗證規則。

```text
呼叫 $dotnet-testing-orchestrator-unit，為 OrderValidator 撰寫單元測試。
被測試目標：samples/unit/practice/src/Practice.Core.Net8/Validators/OrderValidator.cs
測試專案：samples/unit/practice/tests/Practice.Core.Net8.Tests/Practice.Core.Net8.Tests.csproj
```

預期 Orchestrator 行為：

- Analyzer 偵測到繼承 `AbstractValidator<Order>`，設定 `targetType: "validator"`
- Writer 使用 FluentValidation TestHelper 模式：`validator.TestValidate(model)` 搭配 `ShouldHaveValidationErrorFor()` / `ShouldNotHaveValidationErrorFor()`
- Validator 類別不會被分割為多個 Writer（永遠使用單一 Writer 以確保驗證規則一致性）

---

#### 情境 7：多目標類別平行處理

一次指定多個目標類別，Orchestrator 自動以平行方式分析與撰寫，加速整體完成時間。

```text
呼叫 $dotnet-testing-orchestrator-unit，為 OrderProcessingService、WeatherAlertService 撰寫單元測試。
被測試目標：samples/unit/practice/src/Practice.Core.Net8/Services/OrderProcessingService.cs, samples/unit/practice/src/Practice.Core.Net8/Services/WeatherAlertService.cs
測試專案：samples/unit/practice/tests/Practice.Core.Net8.Tests/Practice.Core.Net8.Tests.csproj
```

預期 Orchestrator 行為：

- Orchestrator 偵測到 2 個目標，平行 SpawnAgent 2 個 Analyzer
- 2 個 Writer 同樣平行啟動，各自載入自己需要的 Skills
- Executor **循序執行**（共用同一個測試專案，避免 `dotnet build` 衝突）
- 2 個 Reviewer 平行啟動，最後彙整呈現概覽表格與各目標詳細結果

> 平行的 SpawnAgent 數量受 `.codex/config.toml` 的 `[agents] max_threads` 限制。

---

## C. 練習專案

### 目錄結構

練習專案位於 `samples/unit/practice/`，結構如下：

```text
samples/unit/practice/
├── Practice.Samples.slnx          # 解決方案檔
├── src/
│   └── Practice.Core.Net8/        # 待測試的應用程式碼（Orchestrator 的分析目標）
│       ├── Interfaces/            # 介面定義（IWeatherService 等）
│       ├── Models/                # 資料模型（Order、Employee 等）
│       ├── Services/              # 服務類別（SubscriptionService 等）
│       ├── Validators/            # 驗證器（OrderValidator 等）
│       └── Legacy/                # 遺留程式碼（LegacyReportGenerator）
└── tests/
    └── Practice.Core.Net8.Tests/  # 空白測試專案目錄（由 Orchestrator 產生測試）
```

練習專案支援三個 .NET 版本，以子專案形式存在同一目錄內：`net8.0` / `net9.0` / `net10.0`（對應 `Practice.Core.Net8` / `Practice.Core.Net10` 等）。

### 各 Phase 說明

練習專案分為 6 個學習階段，由淺入深涵蓋各種測試技術：

| Phase   | 目標類別                                     | 學習重點                                                                |
| ------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| Phase 1 | `TemperatureConverter`                       | 3A Pattern、xUnit `[Fact]` / `[Theory]`、AwesomeAssertions 流暢斷言     |
| Phase 2 | `WeatherAlertService`                        | NSubstitute Mock/Stub、非同步方法測試                                   |
| Phase 3 | `EmployeeService`                            | AutoFixture 自動資料產生、循環參考處理、Bogus 擬真假資料                |
| Phase 4 | `SubscriptionService`、`ConfigurationLoader` | FakeTimeProvider 時間凍結與快轉、MockFileSystem 檔案系統抽象            |
| Phase 5 | `OrderProcessingService`                     | 整合 NSubstitute + AutoFixture + TimeProvider，複雜業務邏輯多 Mock 協調 |
| Phase 6 | `LegacyReportGenerator`                      | 識別不可測試的遺留程式碼、依賴注入重構策略、Characterization Test       |

### 還原測試專案

Orchestrator 產生的測試檔案與 `.orchestrator/` artifacts 僅供練習使用，屬 byproduct，**不應 commit**（已由 `.gitignore` 排除）。若要還原初始空白狀態：

```bash
git checkout -- samples/unit/practice/tests/
git clean -fd samples/unit/practice/tests/
```

> **注意**：所有 `samples/*/tests/` 下產生的測試類別檔案、`.orchestrator/`（含 `run-state.json`）與 `.csproj` 修改，請在練習完成後還原。

---

## D. 常見問題排查

### 1. Agent Skills 未載入

**症狀**：Orchestrator SpawnAgent 啟動 Writer 時，Writer 找不到 `dotnet-testing-autofixture-basics` 等技能。

**解法**：確認 `dotnet-testing-agent-skills` 的 29 個技術型 skill 目錄都已複製到 `.codex/skills/`（每個目錄下需有 `SKILL.md`）。重新啟動 Codex 工作階段後再次嘗試。

---

### 2. Writer 沒有觸發分割策略

**說明**：當目標類別的公開方法數量超過 5 個，或建議測試情境數量超過 20 個時，Orchestrator 應自動將任務分割為兩個平行 Writer subagent（各負責不同方法群組）。

**若沒有分割**，可能原因是 Analyzer 分析結果中 `methodScenarioCounts` 數值偏低，未達觸發門檻。可嘗試在指令中補充說明，提示 Orchestrator 該類別的複雜度：

```text
說明：OrderProcessingService 包含 8 個公開方法，請完整涵蓋所有方法的測試情境
```

> 例外：`targetType` 為 `"validator"` 的類別（FluentValidation 驗證器）永遠使用單一 Writer，不會分割。
>
> 提醒：Codex 多 subagent dispatch 的產出具非決定性，同一輸入下測試數 / 分割分組可能有 run-to-run 波動，屬已知限制。

---

### 3. AutoFixture circular reference 錯誤

**症狀**：執行 `dotnet test` 時出現 `AutoFixture` 相關例外，訊息包含 `ObjectCreationException` 或循環參考相關說明。

**解法**：在 Fixture 初始化時加入 `OmitOnRecursionBehavior`：

```csharp
var fixture = new Fixture();
fixture.Behaviors.OfType<ThrowingRecursionBehavior>().ToList()
    .ForEach(b => fixture.Behaviors.Remove(b));
fixture.Behaviors.Add(new OmitOnRecursionBehavior());
```

或改用 Builder 方式手動建立含循環參考的物件，而非全自動產生。

---

### 4. AwesomeAssertions 版本不符

**症狀**：測試專案編譯時出現 AwesomeAssertions 相關錯誤，如方法不存在或命名空間找不到。

**解法**：確認測試專案的 `.csproj` 中 `AwesomeAssertions` NuGet 套件版本正確。Writer 採保守策略，使用專案既有版本；若版本偏舊，由專案維護者手動升級：

```bash
dotnet list package samples/unit/practice/tests/Practice.Core.Net8.Tests/
```

確認版本後，若需升級，直接編輯 `.csproj` 的 `PackageReference` 版本號。

---

### 5. xUnit Theory 參數型別問題

**說明**：`decimal` 型別無法直接用於 `[InlineData]` 屬性（xUnit 限制），編譯時會出現 `An attribute argument must be a constant expression` 錯誤。

**解法**：改用 `[MemberData]` 傳遞 `decimal` 參數：

```csharp
public static IEnumerable<object[]> DecimalTestData =>
[
    [1.5m, 2.5m, 4.0m],
    [0.1m, 0.2m, 0.3m],
];

[Theory]
[MemberData(nameof(DecimalTestData))]
public void Calculate_有效輸入_應回傳正確結果(decimal a, decimal b, decimal expected)
{
    // ...
}
```

---

## E. 工作流程細節

### Phase 1：Analyzer 分析

Analyzer subagent 接收 Orchestrator 委派後，執行以下工作：

- 讀取被測試目標的原始碼（`.cs` 檔案）
- 判斷類別類型（`"service"` 服務類別 / `"validator"` 驗證器 / `"legacy"` 遺留程式碼），決定後續測試策略
- 識別建構子中的外部依賴，分類處理方式：
  - `I*` 介面 → 需要 NSubstitute Mock
  - `TimeProvider` → 特殊處理，使用 FakeTimeProvider
  - `IFileSystem` → 特殊處理，使用 MockFileSystem
- 評估需要載入哪些 Agent Skills（`autofixture-basics`、`nsubstitute-mocking`、`datetime-testing-timeprovider` 等）
- 估算各方法的測試情境數量（`methodScenarioCounts`），決定是否需要分割 Writer
- 產出結構化 JSON 分析報告，寫入 `.orchestrator/analysis/{ClassName}.analysis.json`

Analyzer 分析完成後，將摘要回傳給 Orchestrator（方法數、情境數、技術清單），Orchestrator 驗證交接檔案存在後進入 Phase 2。

---

### Phase 2：Writer 撰寫

Writer subagent 接收 Orchestrator 委派後，執行以下工作：

- 讀取 Analyzer 交接的 JSON 分析報告，取得 `requiredTechniques`、`suggestedTestScenarios` 等資訊
- 依 `requiredTechniques` 載入對應的 Agent Skills（SKILL.md）
- 掃描測試專案中既有的輔助類別（`AutoDataWithCustomization`、`FakeTimeProviderExtensions` 等），優先重用
- 按照中文三段式命名慣例產生測試方法名稱：`方法名_情境描述_預期結果`
- 所有斷言使用 AwesomeAssertions（`.Should()` 系列），禁止使用 xUnit 原生 `Assert.*`

**分割策略**：當 `methodCount > 5` 或 `scenarioCount > 20` 時，Orchestrator 同時 SpawnAgent 兩個 Writer subagent 平行撰寫：

- Writer 1（主要組）：負責情境數較多的方法群組，輸出至 `{ClassName}Tests.cs`
- Writer 2（分割組）：負責其餘方法群組，輸出至 `{ClassName}_{代表方法名}Tests.cs`
- 兩個 Writer 接收相同的風格統一指令，確保產出的斷言風格、using 排列、初始化方式完全一致

---

### Phase 3：Executor 建置與執行

Executor subagent 接收 Orchestrator 委派後，執行以下工作：

- 優先執行 `dotnet build` 確認測試專案可成功編譯
- 編譯成功後執行 `dotnet test`，確認所有測試通過
- 若出現編譯錯誤，自行分析錯誤訊息並修正測試程式碼（如調整 using、修正型別不符、補充套件引用）
- 若測試執行失敗（紅燈），分析失敗原因並修正測試邏輯或斷言
- 最多進行 3 輪修正，超過則回報失敗原因給 Orchestrator

Executor 完成後回傳摘要：總測試數、通過數、失敗數、修正輪數。

---

### Phase 4：Reviewer 審查

Reviewer subagent 接收 Orchestrator 委派後，審查以下項目：

| 審查項目           | 說明                                                             |
| ------------------ | ---------------------------------------------------------------- |
| 命名規範           | 測試方法是否使用中文三段式（`方法名_情境描述_預期結果`）         |
| 斷言品質           | 是否使用 AwesomeAssertions（`.Should()`），而非 xUnit `Assert.*` |
| 單一行為原則       | 每個測試方法是否只驗證一個行為                                   |
| Mock 設定正確性    | NSubstitute 的 Stub 設定是否合理，是否有多餘的 `Received()` 驗證 |
| AutoFixture 一致性 | Fixture 初始化方式是否在同一個測試類別中保持一致                 |
| 覆蓋完整性         | 是否涵蓋 happy path、邊界條件、例外處理三種情境                  |

Reviewer 完成後回傳品質評分報告（`overallScore`）與具體改善建議（`issues`、`missingTestCases`）。

Orchestrator 呈現完整結果後等待使用者決定是否啟動修改流程。若需套用 Reviewer 建議，告知 Orchestrator 後會自動進入三階段修改流程（Writer 修改 → Executor 重新執行 → Reviewer 重新審查）。各階段耗時取自 `run-state.json` 的 wall-clock 時間戳。
