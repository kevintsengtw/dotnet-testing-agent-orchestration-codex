# Practice Aspire — Aspire 整合測試驗證專案

本目錄為 `dotnet-testing-advanced-aspire-orchestrator` 的驗證專案，用於驗證 Aspire Testing Orchestrator 及其 4 個 Subagent 的泛化能力。

## 設計原則

不使用 `samples/aspire/` 既有範例專案，改為在根目錄下建立全新的 `practice_aspire/` 目錄進行驗證，以確保 Orchestrator 的泛化能力（參考 `practice/` 和 `practice_integration/` 的設計原則）。

## 專案結構

```plaintext
practice_aspire/
├── Practice.Aspire.slnx                     # Solution 檔案
├── README.md                                # 本檔案
├── src/
│   ├── Practice.Aspire.AppHost/             # Aspire AppHost（編排中心）
│   │   ├── Practice.Aspire.AppHost.csproj
│   │   └── Program.cs                      # Resource 定義（SQL Server + Redis + WebAPI）
│   └── Practice.Aspire.WebApi/              # 被編排的 WebAPI 專案
│       ├── Practice.Aspire.WebApi.csproj
│       ├── Program.cs                       # WebAPI 入口點
│       ├── appsettings.json
│       ├── Controllers/
│       │   └── BookingsController.cs        # 預約 CRUD + 狀態轉換 API
│       ├── Data/
│       │   └── BookingDbContext.cs           # EF Core DbContext（SQL Server）
│       ├── Handlers/
│       │   ├── FluentValidationExceptionHandler.cs
│       │   └── GlobalExceptionHandler.cs
│       ├── Models/
│       │   ├── Booking.cs                   # 預約實體 + BookingStatus 列舉
│       │   └── BookingRequests.cs           # Create/Update 請求 DTO
│       └── Validators/
│           └── BookingValidators.cs         # FluentValidation 驗證器
└── tests/
    └── Practice.Aspire.AppHost.Tests/       # 測試專案（由 Orchestrator 填充）
        └── Practice.Aspire.AppHost.Tests.csproj
```

## AppHost Resource 拓撲

| Resource     | 類型       | 方法                                                        | 說明                  |
| ------------ | ---------- | ----------------------------------------------------------- | --------------------- |
| `sql`        | SQL Server | `AddSqlServer("sql")`                                       | 資料庫容器            |
| `BookingsDb` | Database   | `sqlServer.AddDatabase("BookingsDb")`                       | SQL Server 上的資料庫 |
| `cache`      | Redis      | `AddRedis("cache")`                                         | 快取容器              |
| `bookingapi` | Project    | `AddProject<Projects.Practice_Aspire_WebApi>("bookingapi")` | 被編排的 WebAPI 專案  |

## API 端點

| HTTP Method | Route                             | 說明             |
| ----------- | --------------------------------- | ---------------- |
| GET         | `api/bookings`                    | 取得所有預約     |
| GET         | `api/bookings/{id}`               | 根據 ID 取得預約 |
| GET         | `api/bookings/by-status/{status}` | 根據狀態查詢預約 |
| POST        | `api/bookings`                    | 建立新預約       |
| PUT         | `api/bookings/{id}`               | 更新預約         |
| PATCH       | `api/bookings/{id}/confirm`       | 確認預約         |
| PATCH       | `api/bookings/{id}/checkin`       | 辦理入住         |
| PATCH       | `api/bookings/{id}/cancel`        | 取消預約         |
| DELETE      | `api/bookings/{id}`               | 刪除預約         |

## 驗證場景

本專案設計為驗證 Aspire Testing Orchestrator 的端對端流程：

| 場景 | 描述                              | 驗證重點                                                       |
| ---- | --------------------------------- | -------------------------------------------------------------- |
| P2-1 | 完整四階段端對端測試              | Resource 擷取完整性、DistributedApplicationTestingBuilder 使用 |
| P2-2 | Writer 產出符合 Skill 模式的測試  | AspireAppFixture + CollectionDefinition + TestBase             |
| P2-3 | Executor 成功建置與執行           | Docker + Aspire workload 檢查、長超時設定                      |
| P2-4 | Reviewer 正確審查 Aspire 特定項目 | 無 WebApplicationFactory、有 Collection Fixture                |

## 與 samples/aspire/ 的差異

| 面向        | samples/aspire/           | practice_aspire/（本專案）  |
| ----------- | ------------------------- | --------------------------- |
| 目的        | Aspire Testing Skill 範例 | Orchestrator 泛化能力驗證   |
| 既有測試    | 有（7 個測試）            | 無（Orchestrator 從零產生） |
| WebAPI 來源 | 共用 Integration.WebApi   | 獨立 Practice.Aspire.WebApi |
| 領域        | Products（產品管理）      | Bookings（預約管理）        |
| 服務名稱    | `webapi`                  | `bookingapi`                |
| DB 名稱     | `ProductsDb`              | `BookingsDb`                |
| Redis 名稱  | `redis`                   | `cache`                     |

## 建置與測試

```powershell
# 建置
dotnet build practice_aspire/Practice.Aspire.slnx -p:WarningLevel=0 /clp:ErrorsOnly --verbosity minimal

# 測試（需要 Docker + Aspire workload）
dotnet test practice_aspire/Practice.Aspire.slnx --no-build --verbosity minimal
```
