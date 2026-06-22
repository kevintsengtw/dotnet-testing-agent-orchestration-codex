namespace Practice.TUnit.Core.Interfaces;

/// <summary>
/// 通知服務介面
/// </summary>
public interface INotificationService
{
    /// <summary>發送逾期通知</summary>
    Task SendOverdueNoticeAsync(Guid memberId, string bookTitle, int overdueDays);

    /// <summary>發送預約到期通知</summary>
    Task SendReservationReadyNoticeAsync(Guid memberId, string bookTitle);

    /// <summary>發送即將到期提醒</summary>
    Task SendDueSoonReminderAsync(Guid memberId, string bookTitle, int daysRemaining);
}
