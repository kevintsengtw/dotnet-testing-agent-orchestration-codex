namespace Practice.Integration.WebApi.Net8.Configuration;

/// <summary>
/// MongoDB 連線設定
/// </summary>
public class MongoDbSettings
{
    /// <summary>
    /// 連線字串
    /// </summary>
    public string ConnectionString { get; set; } = "mongodb://localhost:27017";

    /// <summary>
    /// 資料庫名稱
    /// </summary>
    public string DatabaseName { get; set; } = "practice_integration";

    /// <summary>
    /// 客戶活動集合名稱
    /// </summary>
    public string CustomerActivitiesCollectionName { get; set; } = "customer_activities";
}
