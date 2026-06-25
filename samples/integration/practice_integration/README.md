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
│       │   ├── OrdersController.cs        # 訂單 CRUD + 狀態轉換 API
│       │   └── CustomerActivitiesController.cs  # 顧客活動（MongoDB）
│       ├── Data/
│       │   └── OrderDbContext.cs           # EF Core DbContext (PostgreSQL / Npgsql)
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

本專案以**容器化資料庫**為主（無 InMemory 退路），設計為可觸發以下整合測試場景：

1. **PostgreSQL Testcontainers** — `OrderDbContext`（Npgsql）以 PostgreSQL 容器執行訂單 CRUD + 狀態轉換
2. **MongoDB Testcontainers** — `CustomerActivitiesController` 以 MongoDB 容器執行文件操作
3. **Redis Testcontainers** — 以 Redis 容器執行快取場景
4. **FluentValidation** — 驗證請求驗證與 `ValidationProblemDetails` 回傳
5. **資料隔離** — 搭配 Respawn 於測試間重置容器資料庫狀態

> 需 Docker 環境（容器由 Testcontainers 啟動）。

## 建置與測試

```powershell
# 建置
dotnet build practice_integration/Practice.Integration.slnx -p:WarningLevel=0 /clp:ErrorsOnly --verbosity minimal

# 測試
dotnet test practice_integration/Practice.Integration.slnx --no-build --verbosity minimal
```
