# Practice TUnit - 圖書館管理系統

> **用途**：TUnit Orchestrator（Phase 5 P3）驗證專案
> **設計原則**：不使用 `samples/tunit/` 既有範例專案，改為在根目錄下建立全新的 `practice_tunit/` 目錄進行驗證，以確保 Orchestrator 的泛化能力

## 專案結構

```plaintext
practice_tunit/
├── Practice.TUnit.slnx
├── migration_source/                  # P3-5 xUnit → TUnit 遷移來源
│   └── BookCatalogXunitTests.cs       # xUnit 測試檔（含 Fact/Theory/MemberData/IDisposable）
├── src/
│   └── Practice.TUnit.Core/          # 被測專案（圖書館管理領域）
│       ├── Models/                    # 領域模型
│       ├── Interfaces/                # 介面定義
│       └── Services/                  # 業務邏輯服務
└── tests/
    └── Practice.TUnit.Core.Tests/     # TUnit 測試專案（由 Orchestrator 產生）
```

## 領域說明

以「圖書館管理系統」為主題，涵蓋書籍管理、會員管理、借閱管理、預約管理、報表匯出等功能。

### 被測類別與 TUnit 驗證場景對應

| 類別                   | 驗證場景 | 測試技術需求                               |
| ---------------------- | -------- | ------------------------------------------ |
| `BookCatalog`          | P3-1     | 純函式、`[Test]` + `[Arguments]` 參數化    |
| `LibraryMemberService` | P3-2     | Mock、`[MethodDataSource]` / `[Matrix]`    |
| `LoanService`          | P3-3     | Mock、狀態轉換、Executor `dotnet run` 驗證 |
| `ReservationService`   | P3-4     | TimeProvider、Reviewer 合規性審查          |
| `CatalogExportService` | P3-5     | IFileSystem、xUnit → TUnit 遷移場景        |

## 建置與測試

```powershell
# 建置
dotnet build practice_tunit/Practice.TUnit.slnx -p:WarningLevel=0 /clp:ErrorsOnly --verbosity minimal

# 執行 TUnit 測試（使用 dotnet run）
dotnet run --project practice_tunit/tests/Practice.TUnit.Core.Tests/Practice.TUnit.Core.Tests.csproj
```

## 注意事項

- TUnit 測試專案使用 `OutputType=Exe`，不使用 `Microsoft.NET.Test.Sdk`
- 測試執行優先使用 `dotnet run`，而非 `dotnet test`
- 所有測試方法必須為 `async Task`
