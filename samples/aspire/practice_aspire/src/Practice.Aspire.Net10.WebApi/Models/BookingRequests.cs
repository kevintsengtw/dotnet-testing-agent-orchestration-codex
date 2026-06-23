namespace Practice.Aspire.Net10.WebApi.Models;

/// <summary>
/// 建立預約請求
/// </summary>
public class CreateBookingRequest
{
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
    /// 備註
    /// </summary>
    public string? Notes { get; set; }
}

/// <summary>
/// 更新預約請求
/// </summary>
public class UpdateBookingRequest
{
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
    /// 備註
    /// </summary>
    public string? Notes { get; set; }
}
