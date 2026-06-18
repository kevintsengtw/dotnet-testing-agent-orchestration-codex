namespace Practice.Core.Net10.Models;

/// <summary>
/// 訂單模型 - Phase 5 練習用
/// </summary>
public class Order
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string CustomerId { get; set; } = string.Empty;
    public string CustomerEmail { get; set; } = string.Empty;
    public List<OrderItem> Items { get; set; } = new();
    public OrderStatus Status { get; set; } = OrderStatus.Pending;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ProcessedAt { get; set; }

    /// <summary>
    /// 計算訂單總金額
    /// </summary>
    public decimal TotalAmount => Items.Sum(item => item.TotalPrice);
}

/// <summary>
/// 訂單項目
/// </summary>
public class OrderItem
{
    public string ProductId { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }

    /// <summary>
    /// 小計
    /// </summary>
    public decimal TotalPrice => Quantity * UnitPrice;
}

/// <summary>
/// 訂單狀態
/// </summary>
public enum OrderStatus
{
    Pending,
    Completed,
    Failed,
    Cancelled
}

/// <summary>
/// 訂單處理結果
/// </summary>
public class OrderResult
{
    public bool IsSuccess { get; set; }
    public string? ErrorMessage { get; set; }
    public Guid? OrderId { get; set; }
    public DateTimeOffset? ProcessedAt { get; set; }

    public static OrderResult Succeeded(Guid orderId, DateTimeOffset processedAt)
    {
        return new OrderResult
        {
            IsSuccess = true,
            OrderId = orderId,
            ProcessedAt = processedAt
        };
    }

    public static OrderResult Failed(string error)
    {
        return new OrderResult
        {
            IsSuccess = false,
            ErrorMessage = error
        };
    }
}

/// <summary>
/// 付款結果
/// </summary>
public class PaymentResult
{
    public bool Success { get; set; }
    public string? TransactionId { get; set; }
    public string? ErrorMessage { get; set; }
}
