namespace Practice.Integration.WebApi.Models;

/// <summary>
/// 建立訂單請求
/// </summary>
public class CreateOrderRequest
{
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
    /// 備註
    /// </summary>
    public string? Notes { get; set; }
}

/// <summary>
/// 更新訂單請求
/// </summary>
public class UpdateOrderRequest
{
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
    /// 備註
    /// </summary>
    public string? Notes { get; set; }
}
