namespace Practice.Core.Models;

/// <summary>
/// 訂單模型 - Phase 5 練習：跨技能整合
/// </summary>
public class Order
{
    /// <summary>
    /// 訂單識別碼
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// 客戶識別碼
    /// </summary>
    public string CustomerId { get; set; } = string.Empty;

    /// <summary>
    /// 客戶電子郵件
    /// </summary>
    public string CustomerEmail { get; set; } = string.Empty;

    /// <summary>
    /// 訂單項目
    /// </summary>
    public List<OrderItem> Items { get; set; } = new();

    /// <summary>
    /// 訂單總金額
    /// </summary>
    public decimal TotalAmount => Items.Sum(i => i.Quantity * i.UnitPrice);

    /// <summary>
    /// 訂單建立時間
    /// </summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>
    /// 訂單處理時間
    /// </summary>
    public DateTimeOffset? ProcessedAt { get; set; }

    /// <summary>
    /// 訂單狀態
    /// </summary>
    public OrderStatus Status { get; set; } = OrderStatus.Pending;
}

/// <summary>
/// 訂單項目
/// </summary>
public class OrderItem
{
    /// <summary>
    /// 產品識別碼
    /// </summary>
    public string ProductId { get; set; } = string.Empty;

    /// <summary>
    /// 產品名稱
    /// </summary>
    public string ProductName { get; set; } = string.Empty;

    /// <summary>
    /// 數量
    /// </summary>
    public int Quantity { get; set; }

    /// <summary>
    /// 單價
    /// </summary>
    public decimal UnitPrice { get; set; }
}

/// <summary>
/// 訂單狀態
/// </summary>
public enum OrderStatus
{
    Pending,
    Processing,
    Completed,
    Failed,
    Cancelled
}

/// <summary>
/// 訂單處理結果
/// </summary>
public class OrderResult
{
    /// <summary>
    /// 是否成功
    /// </summary>
    public bool Success { get; set; }

    /// <summary>
    /// 訂單識別碼
    /// </summary>
    public Guid? OrderId { get; set; }

    /// <summary>
    /// 錯誤訊息
    /// </summary>
    public string? ErrorMessage { get; set; }

    /// <summary>
    /// 處理時間
    /// </summary>
    public DateTimeOffset? ProcessedAt { get; set; }

    public static OrderResult Succeeded(Guid orderId, DateTimeOffset processedAt)
        => new() { Success = true, OrderId = orderId, ProcessedAt = processedAt };

    public static OrderResult Failed(string errorMessage)
        => new() { Success = false, ErrorMessage = errorMessage };
}

/// <summary>
/// 付款結果
/// </summary>
public class PaymentResult
{
    /// <summary>
    /// 是否成功
    /// </summary>
    public bool Success { get; set; }

    /// <summary>
    /// 交易識別碼
    /// </summary>
    public string? TransactionId { get; set; }

    /// <summary>
    /// 錯誤訊息
    /// </summary>
    public string? ErrorMessage { get; set; }

    public static PaymentResult Succeeded(string transactionId)
        => new() { Success = true, TransactionId = transactionId };

    public static PaymentResult Failed(string errorMessage)
        => new() { Success = false, ErrorMessage = errorMessage };
}
