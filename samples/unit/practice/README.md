# .NET Testing Skills 練習專案

這是一個專門為練習 .NET 測試技能設計的專案。此目錄包含待測試的程式碼，但**不包含測試專案**，讓你可以從頭開始練習撰寫單元測試。

## 專案結構

```plaintext
practice/
├── Practice.Samples.slnx        # 解決方案檔
├── src/
│   └── Practice.Core/           # 待測試的程式碼
│       ├── Interfaces/          # 介面定義
│       ├── Models/              # 資料模型
│       ├── Services/            # 服務類別
│       └── Legacy/              # 遺留程式碼（用於重構練習）
└── tests/
    └── Practice.Core.Tests/     # 空的測試專案（待你填充）
```

> **說明：** 此練習專案與 `samples/` 目錄分開，是專門為使用者練習使用 Skills 與 GitHub Copilot Prompts 設計的環境。`samples/` 目錄則包含完整的技能驗證範例。

## 練習階段

### Phase 1: 基礎單元測試

**目標類別：** `TemperatureConverter`

**學習重點：**

- 3A Pattern (Arrange, Act, Assert)
- xUnit 基本使用 (`[Fact]`, `[Theory]`)
- AwesomeAssertions 流暢斷言

**觸發技能：**

- Claude Code: `/dotnet-testing-unit-test-fundamentals`
- GitHub Copilot: `使用 SKILL: dotnet-testing-unit-test-fundamentals`

---

### Phase 2: Mock 依賴

**目標類別：** `WeatherAlertService`

**相關介面：** `IWeatherService`, `INotificationService`

**學習重點：**

- NSubstitute 基本使用
- Stub vs Mock 的差異
- 非同步方法測試

**觸發技能：**

- Claude Code: `/dotnet-testing-nsubstitute-mocking`
- GitHub Copilot: `使用 SKILL: dotnet-testing-nsubstitute-mocking`

---

### Phase 3: AutoFixture 和 Bogus

**目標類別：** `EmployeeService`

**相關模型：** `Employee`, `Department`（包含循環參考）

**學習重點：**

- AutoFixture 自動產生測試資料
- 處理循環參考
- Bogus 產生擬真假資料

**觸發技能：**

- Claude Code: `/dotnet-testing-autofixture-basics`
- GitHub Copilot: `使用 SKILL: dotnet-testing-autofixture-basics`

---

### Phase 4: TimeProvider 和 FileSystem

**目標類別：** `SubscriptionService`, `ConfigurationLoader`

**學習重點：**

- TimeProvider 控制時間
- System.IO.Abstractions 模擬檔案系統
- FakeTimeProvider 時間凍結與快轉

**觸發技能：**

- Claude Code: `/dotnet-testing-datetime-testing-timeprovider`
- GitHub Copilot: `使用 SKILL: dotnet-testing-datetime-testing-timeprovider`

---

### Phase 5: 跨技能整合

**目標類別：** `OrderProcessingService`

**學習重點：**

- 整合 NSubstitute + AutoFixture + TimeProvider
- 複雜業務邏輯測試
- 多個 Mock 的協調

**觸發技能：**

- 組合使用 Phase 2-4 的所有技能

---

### Phase 6: 重構遺留程式碼

**目標類別：** `LegacyReportGenerator` → `ReportGenerator`

**學習重點：**

- 識別不可測試的程式碼
- 依賴注入重構策略
- 比較重構前後的測試性

**相關檔案：**

- `Legacy/LegacyReportGenerator.cs` - 遺留程式碼（反模式示範）
- `Services/ReportGenerator.cs` - 重構後的可測試版本

---

## 快速開始

### 1. 建立測試專案

測試專案已經建立好框架，包含所有必要的 NuGet 套件。你可以直接在 `tests/Practice.Core.Tests/` 中開始撰寫測試。

### 2. 建立第一個測試

```csharp
using Practice.Core;
using AwesomeAssertions;
using Xunit;

namespace Practice.Core.Tests;

public class TemperatureConverterTests
{
    [Fact]
    public void CelsiusToFahrenheit_攝氏0度_應回傳華氏32度()
    {
        // Arrange
        var converter = new TemperatureConverter();

        // Act
        var result = converter.CelsiusToFahrenheit(0);

        // Assert
        result.Should().Be(32);
    }
}
```

### 3. 執行測試

```bash
cd practice
dotnet test
```

## 已安裝的 NuGet 套件

測試專案已包含以下套件：

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

- **完整範例：** 參考 `../samples/verification/` 目錄，包含完整的測試實作
- **技能文件：** 參考 `../.claude/skills/` 目錄中的各項技能說明
- **主要指南：** 參考 `../docs/skills/DOTNET_TESTING_SKILLS_GUIDE.md`
- **GitHub Copilot Prompts：** 參考 `../.github/prompts/` 目錄
