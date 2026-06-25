# .NET Testing 練習專案（unit）

這是一個專門為練習 .NET 單元測試設計的專案，作為 **`dotnet-testing-orchestrator-unit`** 工作流程的練習素材。`src/` 為待測程式碼；`tests/` 已備妥**測試專案 scaffold（csproj，含必要 NuGet 套件，但不含預先產生的測試碼）**，測試由工作流程產生。

## 專案結構

```plaintext
practice/
├── Practice.Samples.slnx        # 解決方案檔
├── src/
│   ├── Practice.Core/           # 待測試的程式碼
│   │   ├── Interfaces/          # 介面定義
│   │   ├── Models/              # 資料模型
│   │   ├── Services/            # 服務類別
│   │   └── Legacy/              # 遺留程式碼（用於重構練習）
│   ├── Practice.Core.Net8/      # net8.0 變體
│   └── Practice.Core.Net10/     # net10.0 變體
└── tests/
    ├── Practice.Core.Tests/         # 測試專案 scaffold（待工作流程填充）
    ├── Practice.Core.Net8.Tests/    # net8.0 測試 scaffold
    └── Practice.Core.Net10.Tests/   # net10.0 測試 scaffold
```

> 測試專案僅含 csproj scaffold 與必要套件，**不含預先產生的測試碼**——測試由工作流程產生。

## 練習階段

呼叫 `$dotnet-testing-orchestrator-unit` 並指定目標類別即可。各階段下方列出 Writer 會依 Analyzer 判定**自動載入**的對應技術型 Skill（技術型 Skill 由 [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 提供）。

### Phase 1: 基礎單元測試

**目標類別：** `TemperatureConverter`

**學習重點：** 3A Pattern（Arrange, Act, Assert）、xUnit 基本使用（`[Fact]`, `[Theory]`）、AwesomeAssertions 流暢斷言

**對應技術型 Skill：** `dotnet-testing-unit-test-fundamentals`

---

### Phase 2: Mock 依賴

**目標類別：** `WeatherAlertService`（相關介面：`IWeatherService`, `INotificationService`）

**學習重點：** NSubstitute 基本使用、Stub vs Mock 的差異、非同步方法測試

**對應技術型 Skill：** `dotnet-testing-nsubstitute-mocking`

---

### Phase 3: AutoFixture 和 Bogus

**目標類別：** `EmployeeService`（相關模型：`Employee`, `Department`，包含循環參考）

**學習重點：** AutoFixture 自動產生測試資料、處理循環參考、Bogus 產生擬真假資料

**對應技術型 Skill：** `dotnet-testing-autofixture-basics`、`dotnet-testing-bogus-fake-data`

---

### Phase 4: TimeProvider 和 FileSystem

**目標類別：** `SubscriptionService`, `ConfigurationLoader`

**學習重點：** TimeProvider 控制時間、System.IO.Abstractions 模擬檔案系統、FakeTimeProvider 時間凍結與快轉

**對應技術型 Skill：** `dotnet-testing-datetime-testing-timeprovider`、`dotnet-testing-filesystem-testing-abstractions`

---

### Phase 5: 跨技能整合

**目標類別：** `OrderProcessingService`

**學習重點：** 整合 NSubstitute + AutoFixture + TimeProvider、複雜業務邏輯測試、多個 Mock 的協調

---

### Phase 6: 重構遺留程式碼

**目標類別：** `LegacyReportGenerator` → `ReportGenerator`

**學習重點：** 識別不可測試的程式碼、依賴注入重構策略、比較重構前後的測試性

**相關檔案：**

- `Legacy/LegacyReportGenerator.cs` - 遺留程式碼（反模式示範）
- `Services/ReportGenerator.cs` - 重構後的可測試版本

---

## 快速開始

在 Codex 中呼叫 Orchestrator：

```text
呼叫 $dotnet-testing-orchestrator-unit，為 samples/unit/practice/src/Practice.Core 的
TemperatureConverter 撰寫單元測試。
```

工作流程會：分析目標 → 載入對應 Skills 撰寫測試 → 建置執行（含修正迴圈）→ 審查並回報。

## 已安裝的 NuGet 套件

測試專案 scaffold 已包含以下套件：

| 套件                                        | 用途             |
| ------------------------------------------- | ---------------- |
| `xunit`                                     | 測試框架         |
| `AwesomeAssertions`                         | 流暢斷言         |
| `NSubstitute`                               | Mock 框架        |
| `AutoFixture`                               | 測試資料自動產生 |
| `AutoFixture.Xunit2`                        | xUnit 整合       |
| `AutoFixture.AutoNSubstitute`               | NSubstitute 整合 |
| `Bogus`                                     | 擬真假資料產生   |
| `Microsoft.Extensions.TimeProvider.Testing` | FakeTimeProvider |
| `System.IO.Abstractions.TestingHelpers`     | MockFileSystem   |

## 參考資源

- **安裝與環境設定：** 參考 [docs/SETUP.md](../../../docs/SETUP.md)
- **單元測試指南：** 參考 [docs/guides/unit-testing.md](../../../docs/guides/unit-testing.md)
- **技術型 Skills：** 由 [`dotnet-testing-agent-skills`](https://github.com/kevintsengtw/dotnet-testing-agent-skills) 提供，安裝後位於 `.codex/skills/`
