namespace Practice.Core.Net10.Models;

/// <summary>
/// 訂閱模型 - Phase 4 練習：TimeProvider
/// </summary>
public class Subscription
{
    /// <summary>
    /// 訂閱識別碼
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// 使用者識別碼
    /// </summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>
    /// 訂閱方案名稱
    /// </summary>
    public string PlanName { get; set; } = string.Empty;

    /// <summary>
    /// 訂閱開始日期
    /// </summary>
    public DateTimeOffset StartDate { get; set; }

    /// <summary>
    /// 訂閱結束日期
    /// </summary>
    public DateTimeOffset EndDate { get; set; }

    /// <summary>
    /// 是否為自動續訂
    /// </summary>
    public bool AutoRenew { get; set; }

    /// <summary>
    /// 訂閱價格
    /// </summary>
    public decimal Price { get; set; }
}
