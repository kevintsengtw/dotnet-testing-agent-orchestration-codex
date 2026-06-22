namespace Practice.Integration.WebApi.Models;

/// <summary>
/// 訂單實體
/// </summary>
public class Order
{
    /// <summary>
    /// 訂單識別碼
    /// </summary>
    public int Id { get; set; }

    /// <summary>
    /// 客戶名稱
    /// </summary>
    public string CustomerName { get; set; } = string.Empty;

    /// <summary>
    /// 客戶電子郵件
    /// </summary>
    public string CustomerEmail { get; set; } = string.Empty;

    /// <summary>
    /// 訂單總金額
    /// </summary>
    public decimal TotalAmount { get; set; }

    /// <summary>
    /// 訂單狀態
    /// </summary>
    public OrderStatus Status { get; set; } = OrderStatus.Pending;

    /// <summary>
    /// 備註
    /// </summary>
    public string? Notes { get; set; }

    /// <summary>
    /// 建立時間
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// 更新時間
    /// </summary>
    public DateTime? UpdatedAt { get; set; }
}

/// <summary>
/// 訂單狀態列舉
/// </summary>
public enum OrderStatus
{
    Pending = 0,
    Confirmed = 1,
    Shipped = 2,
    Delivered = 3,
    Cancelled = 4
}
