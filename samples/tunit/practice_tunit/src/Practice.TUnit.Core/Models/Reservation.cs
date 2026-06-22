namespace Practice.TUnit.Core.Models;

/// <summary>
/// 預約狀態
/// </summary>
public enum ReservationStatus
{
    /// <summary>等待中</summary>
    Active,

    /// <summary>已完成（取書）</summary>
    Fulfilled,

    /// <summary>已過期</summary>
    Expired,

    /// <summary>已取消</summary>
    Cancelled
}

/// <summary>
/// 書籍預約模型
/// </summary>
public class Reservation
{
    /// <summary>預約唯一識別碼</summary>
    public Guid Id { get; set; }

    /// <summary>書籍 ID</summary>
    public Guid BookId { get; set; }

    /// <summary>會員 ID</summary>
    public Guid MemberId { get; set; }

    /// <summary>預約時間</summary>
    public DateTimeOffset ReservedAt { get; set; }

    /// <summary>預約到期時間</summary>
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>預約狀態</summary>
    public ReservationStatus Status { get; set; } = ReservationStatus.Active;
}
