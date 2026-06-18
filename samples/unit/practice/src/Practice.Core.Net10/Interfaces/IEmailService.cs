using Practice.Core.Net10.Models;

namespace Practice.Core.Net10.Interfaces;

/// <summary>
/// 電子郵件服務介面 - 用於訂單確認與通知
/// </summary>
public interface IEmailService
{
    /// <summary>
    /// 發送訂單確認信
    /// </summary>
    /// <param name="order">訂單</param>
    Task SendOrderConfirmationAsync(Order order);

    /// <summary>
    /// 發送訂單失敗通知
    /// </summary>
    /// <param name="order">訂單</param>
    /// <param name="reason">失敗原因</param>
    Task SendOrderFailedNotificationAsync(Order order, string reason);
}
