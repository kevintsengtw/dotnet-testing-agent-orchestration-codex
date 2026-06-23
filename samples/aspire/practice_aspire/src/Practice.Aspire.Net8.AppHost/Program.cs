/// <summary>
/// .NET Aspire AppHost - 預約管理系統編排中心（Net8.0 跨版本驗證用）
///
/// AppHost 負責：
/// 1. 定義分散式應用程式的拓撲結構
/// 2. 編排服務之間的依賴關係
/// 3. 配置容器化資源（SQL Server、Redis）
/// 4. 提供服務發現和設定
/// </summary>
/// 
var builder = DistributedApplication.CreateBuilder(args);

// 1. 加入 SQL Server 資料庫容器
var sqlServer = builder.AddSqlServer("sql")
    .WithDataVolume("practice-aspire-net8-sql-data");

var bookingsDb = sqlServer.AddDatabase("BookingsDb");

// 2. 加入 Redis 快取容器
var cache = builder.AddRedis("cache")
    .WithDataVolume("practice-aspire-net8-redis-data");

// 3. 加入 WebAPI 專案並設定依賴
builder.AddProject<Projects.Practice_Aspire_Net8_WebApi>("bookingapi")
    .WithReference(bookingsDb)
    .WithReference(cache)
    .WithExternalHttpEndpoints();

builder.Build().Run();
