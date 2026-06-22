namespace Practice.Integration.WebApi.Net8.Models;

/// <summary>
/// 建立客戶活動請求
/// </summary>
public class CreateCustomerActivityRequest
{
    /// <summary>
    /// 客戶識別碼
    /// </summary>
    public string CustomerId { get; set; } = string.Empty;

    /// <summary>
    /// 活動類型（View, Search, Purchase, Login）
    /// </summary>
    public string ActivityType { get; set; } = string.Empty;

    /// <summary>
    /// 活動描述
    /// </summary>
    public string Description { get; set; } = string.Empty;

    /// <summary>
    /// 額外的中繼資料
    /// </summary>
    public Dictionary<string, string>? Metadata { get; set; }
}
