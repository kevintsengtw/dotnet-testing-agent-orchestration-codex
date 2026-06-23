namespace Practice.Aspire.Net10.WebApi.Models;

/// <summary>
/// 預約實體
/// </summary>
public class Booking
{
    /// <summary>
    /// 預約識別碼
    /// </summary>
    public int Id { get; set; }

    /// <summary>
    /// 旅客姓名
    /// </summary>
    public string GuestName { get; set; } = string.Empty;

    /// <summary>
    /// 旅客電子郵件
    /// </summary>
    public string GuestEmail { get; set; } = string.Empty;

    /// <summary>
    /// 房間號碼
    /// </summary>
    public string RoomNumber { get; set; } = string.Empty;

    /// <summary>
    /// 入住日期
    /// </summary>
    public DateTime CheckInDate { get; set; }

    /// <summary>
    /// 退房日期
    /// </summary>
    public DateTime CheckOutDate { get; set; }

    /// <summary>
    /// 總金額
    /// </summary>
    public decimal TotalPrice { get; set; }

    /// <summary>
    /// 預約狀態
    /// </summary>
    public BookingStatus Status { get; set; } = BookingStatus.Pending;

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
/// 預約狀態列舉
/// </summary>
public enum BookingStatus
{
    Pending = 0,
    Confirmed = 1,
    CheckedIn = 2,
    CheckedOut = 3,
    Cancelled = 4
}
