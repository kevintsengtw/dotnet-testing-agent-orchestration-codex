using Practice.TUnit.Core.Interfaces;
using Practice.TUnit.Core.Models;

namespace Practice.TUnit.Core.Services;

/// <summary>
/// 預約服務 — P3-4 驗證：TimeProvider 時間依賴、Reviewer 合規性審查
/// 使用 TimeProvider 管理預約到期、保留期限等時間敏感邏輯
/// </summary>
public class ReservationService
{
    private readonly IBookRepository _bookRepository;
    private readonly IMemberRepository _memberRepository;
    private readonly INotificationService _notificationService;
    private readonly TimeProvider _timeProvider;

    /// <summary>預約保留天數</summary>
    private const int ReservationHoldDays = 3;

    public ReservationService(
        IBookRepository bookRepository,
        IMemberRepository memberRepository,
        INotificationService notificationService,
        TimeProvider timeProvider)
    {
        _bookRepository = bookRepository ?? throw new ArgumentNullException(nameof(bookRepository));
        _memberRepository = memberRepository ?? throw new ArgumentNullException(nameof(memberRepository));
        _notificationService = notificationService ?? throw new ArgumentNullException(nameof(notificationService));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
    }

    /// <summary>
    /// 建立書籍預約
    /// </summary>
    /// <param name="bookId">書籍 ID</param>
    /// <param name="memberId">會員 ID</param>
    /// <returns>預約紀錄</returns>
    public async Task<Reservation> ReserveBookAsync(Guid bookId, Guid memberId)
    {
        var book = await _bookRepository.GetByIdAsync(bookId)
                   ?? throw new KeyNotFoundException($"Book '{bookId}' not found");

        if (book.Status != BookStatus.OnLoan)
            throw new InvalidOperationException(
                "Book can only be reserved when it is currently on loan");

        var member = await _memberRepository.GetByIdAsync(memberId)
                     ?? throw new KeyNotFoundException($"Member '{memberId}' not found");

        if (!member.IsActive)
            throw new InvalidOperationException("Member account is inactive");

        var now = _timeProvider.GetUtcNow();
        var reservation = new Reservation
        {
            Id = Guid.NewGuid(),
            BookId = bookId,
            MemberId = memberId,
            ReservedAt = now,
            ExpiresAt = now.AddDays(ReservationHoldDays),
            Status = ReservationStatus.Active
        };

        book.Status = BookStatus.Reserved;
        await _bookRepository.UpdateAsync(book);

        return reservation;
    }

    /// <summary>
    /// 檢查預約是否已過期
    /// </summary>
    /// <param name="reservation">預約</param>
    /// <returns>是否已過期</returns>
    public bool IsReservationExpired(Reservation reservation)
    {
        if (reservation == null)
            throw new ArgumentNullException(nameof(reservation));

        if (reservation.Status != ReservationStatus.Active)
            return false;

        var now = _timeProvider.GetUtcNow();
        return now > reservation.ExpiresAt;
    }

    /// <summary>
    /// 計算預約剩餘時間
    /// </summary>
    /// <param name="reservation">預約</param>
    /// <returns>剩餘時間；已過期回傳 TimeSpan.Zero</returns>
    public TimeSpan GetRemainingTime(Reservation reservation)
    {
        if (reservation == null)
            throw new ArgumentNullException(nameof(reservation));

        if (reservation.Status != ReservationStatus.Active)
            return TimeSpan.Zero;

        var now = _timeProvider.GetUtcNow();
        var remaining = reservation.ExpiresAt - now;

        return remaining > TimeSpan.Zero ? remaining : TimeSpan.Zero;
    }

    /// <summary>
    /// 完成預約（會員前來取書）
    /// </summary>
    /// <param name="reservation">預約</param>
    /// <returns>完成後的預約</returns>
    public async Task<Reservation> FulfillReservationAsync(Reservation reservation)
    {
        if (reservation == null)
            throw new ArgumentNullException(nameof(reservation));

        if (reservation.Status != ReservationStatus.Active)
            throw new InvalidOperationException(
                $"Can only fulfill active reservations (current: {reservation.Status})");

        if (IsReservationExpired(reservation))
            throw new InvalidOperationException("Reservation has expired");

        reservation.Status = ReservationStatus.Fulfilled;

        var book = await _bookRepository.GetByIdAsync(reservation.BookId);
        if (book != null)
        {
            book.Status = BookStatus.Available;
            await _bookRepository.UpdateAsync(book);
        }

        return reservation;
    }

    /// <summary>
    /// 取消預約
    /// </summary>
    /// <param name="reservation">預約</param>
    /// <returns>取消後的預約</returns>
    public async Task<Reservation> CancelReservationAsync(Reservation reservation)
    {
        if (reservation == null)
            throw new ArgumentNullException(nameof(reservation));

        if (reservation.Status != ReservationStatus.Active)
            throw new InvalidOperationException(
                $"Can only cancel active reservations (current: {reservation.Status})");

        reservation.Status = ReservationStatus.Cancelled;

        var book = await _bookRepository.GetByIdAsync(reservation.BookId);
        if (book != null)
        {
            book.Status = BookStatus.Available;
            await _bookRepository.UpdateAsync(book);
        }

        return reservation;
    }

    /// <summary>
    /// 檢查預約是否即將過期（剩餘 24 小時內）
    /// </summary>
    /// <param name="reservation">預約</param>
    /// <returns>是否即將過期</returns>
    public bool IsExpiringSoon(Reservation reservation)
    {
        if (reservation == null)
            throw new ArgumentNullException(nameof(reservation));

        if (reservation.Status != ReservationStatus.Active)
            return false;

        var remaining = GetRemainingTime(reservation);
        return remaining > TimeSpan.Zero && remaining <= TimeSpan.FromHours(24);
    }

    /// <summary>
    /// 處理過期預約並發送通知
    /// </summary>
    /// <param name="reservations">待檢查的預約列表</param>
    /// <returns>被標記為過期的預約數量</returns>
    public async Task<int> ProcessExpiredReservationsAsync(IEnumerable<Reservation> reservations)
    {
        if (reservations == null)
            throw new ArgumentNullException(nameof(reservations));

        var expiredCount = 0;

        foreach (var reservation in reservations)
        {
            if (IsReservationExpired(reservation))
            {
                reservation.Status = ReservationStatus.Expired;

                var book = await _bookRepository.GetByIdAsync(reservation.BookId);
                if (book != null)
                {
                    book.Status = BookStatus.Available;
                    await _bookRepository.UpdateAsync(book);
                }

                expiredCount++;
            }
        }

        return expiredCount;
    }
}
