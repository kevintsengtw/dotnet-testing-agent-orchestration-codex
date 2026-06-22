# Practice Integration — 整合測試驗證專案

本目錄為 `dotnet-testing-advanced-integration-orchestrator` 的驗證專案，用於驗證 Integration Testing Orchestrator 及其 4 個 Subagent 的泛化能力。

## 專案結構

```plaintext
practice_integration/
├── Practice.Integration.slnx              # Solution 檔案
├── README.md                              # 本檔案
├── src/
│   └── Practice.Integration.WebApi/       # 待測試的 WebAPI 專案
│       ├── Controllers/
│       │   └── OrdersController.cs        # 訂單 CRUD + 狀態轉換 API
│       ├── Data/
│       │   └── OrderDbContext.cs           # EF Core DbContext (InMemory)
│       ├── Handlers/
│       │   ├── FluentValidationExceptionHandler.cs
│       │   └── GlobalExceptionHandler.cs
│       ├── Models/
│       │   ├── Order.cs                   # 訂單實體 + OrderStatus 列舉
│       │   └── OrderRequests.cs           # Create/Update 請求 DTO
│       ├── Validators/
│       │   └── OrderValidators.cs         # FluentValidation 驗證器
│       └── Program.cs                     # WebAPI 入口點
└── tests/
    └── Practice.Integration.WebApi.Tests/ # 測試專案（由 Orchestrator 填充）
        └── Practice.Integration.WebApi.Tests.csproj
```

## API 端點

| HTTP Method | Route | 說明 |
|-------------|-------|------|
| GET | `api/orders` | 取得所有訂單 |
| GET | `api/orders/{id}` | 根據 ID 取得訂單 |
| GET | `api/orders/by-status/{status}` | 根據狀態查詢訂單 |
| POST | `api/orders` | 建立新訂單 |
| PUT | `api/orders/{id}` | 更新訂單 |
| PATCH | `api/orders/{id}/confirm` | 確認訂單 |
| PATCH | `api/orders/{id}/cancel` | 取消訂單 |
| DELETE | `api/orders/{id}` | 刪除訂單 |

## 驗證場景

本專案設計為可觸發以下 5 個整合測試場景：

1. **InMemory DB** — 使用 EF Core InMemory Provider 的基本整合測試
2. **SQL Server Testcontainers** — 使用 SQL Server 容器替換 InMemory
3. **FluentValidation** — 驗證請求驗證與 ValidationProblemDetails 回傳
4. **PostgreSQL Testcontainers** — 使用 PostgreSQL 容器替換 InMemory
5. **MongoDB/Redis NoSQL** — NoSQL 容器整合（進階場景）

## 建置與測試

```powershell
# 建置
dotnet build practice_integration/Practice.Integration.slnx -p:WarningLevel=0 /clp:ErrorsOnly --verbosity minimal

# 測試
dotnet test practice_integration/Practice.Integration.slnx --no-build --verbosity minimal
```
