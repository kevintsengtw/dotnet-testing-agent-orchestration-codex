namespace Practice.Core.Net8.Interfaces;

/// <summary>
/// 通知服務介面 - Phase 2 練習：Mock 依賴
/// </summary>
public interface INotificationService
{
    /// <summary>
    /// 發送警報訊息
    /// </summary>
    /// <param name="message">警報訊息</param>
    Task SendAlertAsync(string message);

    /// <summary>
    /// 發送警報給指定收件者
    /// </summary>
    /// <param name="recipient">收件者</param>
    /// <param name="message">警報訊息</param>
    Task SendAlertToAsync(string recipient, string message);

    /// <summary>
    /// 檢查通知服務是否可用
    /// </summary>
    /// <returns>是否可用</returns>
    Task<bool> IsAvailableAsync();
}
