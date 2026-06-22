using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Practice.Integration.WebApi.Net10.Models;

/// <summary>
/// 客戶活動文件 - MongoDB 文件模型
/// 記錄客戶在系統中的各種活動（瀏覽、搜尋、購買等）
/// </summary>
public class CustomerActivity
{
    /// <summary>
    /// 文件識別碼
    /// </summary>
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    /// <summary>
    /// 客戶識別碼
    /// </summary>
    [BsonElement("customerId")]
    public string CustomerId { get; set; } = string.Empty;

    /// <summary>
    /// 活動類型（View, Search, Purchase, Login）
    /// </summary>
    [BsonElement("activityType")]
    public string ActivityType { get; set; } = string.Empty;

    /// <summary>
    /// 活動描述
    /// </summary>
    [BsonElement("description")]
    public string Description { get; set; } = string.Empty;

    /// <summary>
    /// 活動時間戳記
    /// </summary>
    [BsonElement("timestamp")]
    public DateTime Timestamp { get; set; }

    /// <summary>
    /// 額外的中繼資料
    /// </summary>
    [BsonElement("metadata")]
    public Dictionary<string, string>? Metadata { get; set; }
}
