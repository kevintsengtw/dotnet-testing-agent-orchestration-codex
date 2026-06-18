using Practice.Core.Interfaces;
using Practice.Core.Models;

namespace Practice.Core.Services;

/// <summary>
/// 訂單處理服務 - Phase 5 練習：跨技能整合
/// 需要同時使用：
/// - NSubstitute Mock (4 個依賴)
/// - AutoFixture (生成測試資料)
/// - AwesomeAssertions (流暢斷言)
/// - TimeProvider (時間控制)
/// </summary>
public class OrderProcessingService
{
    private readonly IOrderRepository _orderRepository;
    private readonly IPaymentGateway _paymentGateway;
    private readonly IEmailService _emailService;
    private readonly TimeProvider _timeProvider;

    // 營業時間設定
    private const int BusinessHoursStart = 9;
    private const int BusinessHoursEnd = 21;

    public OrderProcessingService(
        IOrderRepository orderRepository,
        IPaymentGateway paymentGateway,
        IEmailService emailService,
        TimeProvider timeProvider)
    {
        _orderRepository = orderRepository ?? throw new ArgumentNullException(nameof(orderRepository));
        _paymentGateway = paymentGateway ?? throw new ArgumentNullException(nameof(paymentGateway));
        _emailService = emailService ?? throw new ArgumentNullException(nameof(emailService));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
    }

    /// <summary>
    /// 處理訂單
    /// </summary>
    /// <param name="order">訂單</param>
    /// <returns>處理結果</returns>
    public async Task<OrderResult> ProcessOrderAsync(Order order)
    {
        if (order == null)
            throw new ArgumentNullException(nameof(order));

        // 驗證訂單
        if (order.Items.Count == 0)
            return OrderResult.Failed("Order has no items");

        if (string.IsNullOrWhiteSpace(order.CustomerId))
            return OrderResult.Failed("Customer ID is required");

        if (string.IsNullOrWhiteSpace(order.CustomerEmail))
            return OrderResult.Failed("Customer email is required");

        // 檢查是否在營業時間
        var now = _timeProvider.GetLocalNow();
        if (!IsWithinBusinessHours(now))
        {
            return OrderResult.Failed($"Outside business hours (9:00-21:00). Current time: {now.Hour}:{now.Minute:D2}");
        }

        // 處理付款
        var paymentResult = await _paymentGateway.ChargeAsync(order.CustomerId, order.TotalAmount);

        if (!paymentResult.Success)
        {
            order.Status = OrderStatus.Failed;
            await _orderRepository.UpdateStatusAsync(order.Id, OrderStatus.Failed);
            await _emailService.SendOrderFailedNotificationAsync(order, paymentResult.ErrorMessage ?? "Payment failed");
            return OrderResult.Failed(paymentResult.ErrorMessage ?? "Payment processing failed");
        }

        // 更新訂單狀態和處理時間
        order.ProcessedAt = _timeProvider.GetUtcNow();
        order.Status = OrderStatus.Completed;

        // 儲存訂單
        await _orderRepository.SaveAsync(order);

        // 發送確認信
        await _emailService.SendOrderConfirmationAsync(order);

        return OrderResult.Succeeded(order.Id, order.ProcessedAt.Value);
    }

    /// <summary>
    /// 取消訂單
    /// </summary>
    /// <param name="orderId">訂單識別碼</param>
    /// <param name="transactionId">交易識別碼（用於退款）</param>
    /// <returns>是否成功取消</returns>
    public async Task<bool> CancelOrderAsync(Guid orderId, string? transactionId)
    {
        var order = await _orderRepository.GetByIdAsync(orderId);
        if (order == null)
            return false;

        if (order.Status != OrderStatus.Completed && order.Status != OrderStatus.Pending)
            return false;

        // 如果有交易識別碼，進行退款
        if (!string.IsNullOrEmpty(transactionId))
        {
            var refundResult = await _paymentGateway.RefundAsync(transactionId, order.TotalAmount);
            if (!refundResult.Success)
                return false;
        }

        order.Status = OrderStatus.Cancelled;
        await _orderRepository.UpdateStatusAsync(orderId, OrderStatus.Cancelled);

        return true;
    }

    /// <summary>
    /// 檢查是否在營業時間
    /// </summary>
    /// <returns>是否在營業時間</returns>
    public bool IsWithinBusinessHours()
    {
        var now = _timeProvider.GetLocalNow();
        return IsWithinBusinessHours(now);
    }

    /// <summary>
    /// 取得下次營業時間
    /// </summary>
    /// <returns>下次營業開始時間</returns>
    public DateTimeOffset GetNextBusinessHoursStart()
    {
        var now = _timeProvider.GetLocalNow();

        if (now.Hour < BusinessHoursStart)
        {
            // 今天還沒開始營業
            return new DateTimeOffset(now.Year, now.Month, now.Day, BusinessHoursStart, 0, 0, now.Offset);
        }
        else if (now.Hour >= BusinessHoursEnd)
        {
            // 今天已經結束營業，返回明天
            var tomorrow = now.AddDays(1);
            return new DateTimeOffset(tomorrow.Year, tomorrow.Month, tomorrow.Day, BusinessHoursStart, 0, 0, tomorrow.Offset);
        }
        else
        {
            // 現在就在營業時間
            return now;
        }
    }

    /// <summary>
    /// 計算訂單金額（含稅）
    /// </summary>
    /// <param name="order">訂單</param>
    /// <param name="taxRate">稅率</param>
    /// <returns>含稅金額</returns>
    public decimal CalculateTotalWithTax(Order order, decimal taxRate)
    {
        if (order == null)
            throw new ArgumentNullException(nameof(order));

        if (taxRate < 0)
            throw new ArgumentException("Tax rate cannot be negative", nameof(taxRate));

        return order.TotalAmount * (1 + taxRate);
    }

    private static bool IsWithinBusinessHours(DateTimeOffset time)
    {
        return time.Hour >= BusinessHoursStart && time.Hour < BusinessHoursEnd;
    }
}
