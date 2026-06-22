using Practice.TUnit.Core.Interfaces;
using Practice.TUnit.Core.Models;

namespace Practice.TUnit.Core.Services;

/// <summary>
/// 借閱服務 — P3-3 驗證：狀態轉換邏輯、Executor dotnet run 執行
/// 管理借閱、歸還、續借、逾期等狀態流程
/// </summary>
public class LoanService
{
    private readonly ILoanRepository _loanRepository;
    private readonly IBookRepository _bookRepository;
    private readonly IMemberRepository _memberRepository;
    private readonly INotificationService _notificationService;
    private readonly TimeProvider _timeProvider;

    public LoanService(
        ILoanRepository loanRepository,
        IBookRepository bookRepository,
        IMemberRepository memberRepository,
        INotificationService notificationService,
        TimeProvider timeProvider)
    {
        _loanRepository = loanRepository ?? throw new ArgumentNullException(nameof(loanRepository));
        _bookRepository = bookRepository ?? throw new ArgumentNullException(nameof(bookRepository));
        _memberRepository = memberRepository ?? throw new ArgumentNullException(nameof(memberRepository));
        _notificationService = notificationService ?? throw new ArgumentNullException(nameof(notificationService));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
    }

    /// <summary>
    /// 借閱書籍
    /// </summary>
    /// <param name="bookId">書籍 ID</param>
    /// <param name="memberId">會員 ID</param>
    /// <returns>借閱紀錄</returns>
    public async Task<Loan> BorrowBookAsync(Guid bookId, Guid memberId)
    {
        var book = await _bookRepository.GetByIdAsync(bookId)
                   ?? throw new KeyNotFoundException($"Book '{bookId}' not found");

        if (book.Status != BookStatus.Available)
            throw new InvalidOperationException($"Book is not available (current status: {book.Status})");

        var member = await _memberRepository.GetByIdAsync(memberId)
                     ?? throw new KeyNotFoundException($"Member '{memberId}' not found");

        if (!member.IsActive)
            throw new InvalidOperationException("Member account is inactive");

        var activeLoans = await _loanRepository.GetActiveLoansByMemberAsync(memberId);
        if (activeLoans.Count >= member.MaxBooksAllowed)
            throw new InvalidOperationException(
                $"Member has reached maximum loan limit ({member.MaxBooksAllowed})");

        var now = _timeProvider.GetUtcNow();
        var loan = new Loan
        {
            Id = Guid.NewGuid(),
            BookId = bookId,
            MemberId = memberId,
            LoanDate = now,
            DueDate = now.AddDays(member.LoanPeriodDays),
            Status = LoanStatus.Active,
            MaxRenewals = member.MembershipType == MembershipType.Vip ? 3 : 2
        };

        book.Status = BookStatus.OnLoan;
        await _bookRepository.UpdateAsync(book);
        await _loanRepository.AddAsync(loan);

        return loan;
    }

    /// <summary>
    /// 歸還書籍
    /// </summary>
    /// <param name="loanId">借閱紀錄 ID</param>
    /// <returns>歸還結果（含可能的罰款）</returns>
    public async Task<ReturnResult> ReturnBookAsync(Guid loanId)
    {
        var loan = await _loanRepository.GetByIdAsync(loanId)
                   ?? throw new KeyNotFoundException($"Loan '{loanId}' not found");

        if (loan.Status == LoanStatus.Returned)
            throw new InvalidOperationException("Book has already been returned");

        var book = await _bookRepository.GetByIdAsync(loan.BookId)
                   ?? throw new KeyNotFoundException($"Book '{loan.BookId}' not found");

        var now = _timeProvider.GetUtcNow();
        loan.ReturnDate = now;
        loan.Status = LoanStatus.Returned;

        decimal fine = 0m;
        if (now > loan.DueDate)
        {
            var overdueDays = (int)(now - loan.DueDate).TotalDays;
            fine = new BookCatalog().CalculateOverdueFine(overdueDays, book.Price);
            loan.OverdueFine = fine;
        }

        book.Status = BookStatus.Available;
        await _bookRepository.UpdateAsync(book);
        await _loanRepository.UpdateAsync(loan);

        return new ReturnResult
        {
            LoanId = loanId,
            IsOverdue = fine > 0,
            OverdueDays = fine > 0 ? (int)(now - loan.DueDate).TotalDays : 0,
            Fine = fine
        };
    }

    /// <summary>
    /// 續借書籍
    /// </summary>
    /// <param name="loanId">借閱紀錄 ID</param>
    /// <returns>更新後的借閱紀錄</returns>
    public async Task<Loan> RenewLoanAsync(Guid loanId)
    {
        var loan = await _loanRepository.GetByIdAsync(loanId)
                   ?? throw new KeyNotFoundException($"Loan '{loanId}' not found");

        if (loan.Status == LoanStatus.Returned)
            throw new InvalidOperationException("Cannot renew a returned loan");

        if (loan.Status == LoanStatus.Overdue)
            throw new InvalidOperationException("Cannot renew an overdue loan");

        if (loan.RenewalCount >= loan.MaxRenewals)
            throw new InvalidOperationException(
                $"Maximum renewal limit reached ({loan.MaxRenewals})");

        var member = await _memberRepository.GetByIdAsync(loan.MemberId)
                     ?? throw new KeyNotFoundException($"Member '{loan.MemberId}' not found");

        loan.DueDate = loan.DueDate.AddDays(member.LoanPeriodDays);
        loan.RenewalCount++;
        loan.Status = LoanStatus.Renewed;

        await _loanRepository.UpdateAsync(loan);

        return loan;
    }

    /// <summary>
    /// 檢查並標記逾期借閱
    /// </summary>
    /// <returns>被標記為逾期的借閱數量</returns>
    public async Task<int> CheckAndMarkOverdueLoansAsync()
    {
        var now = _timeProvider.GetUtcNow();
        var overdueCount = 0;

        // 此方法取得所有 Active/Renewed 的借閱紀錄，不只是已標記 Overdue 的
        var allMembers = await _memberRepository.GetAllAsync();

        foreach (var member in allMembers)
        {
            var activeLoans = await _loanRepository.GetActiveLoansByMemberAsync(member.Id);
            foreach (var loan in activeLoans)
            {
                if (loan.Status is LoanStatus.Active or LoanStatus.Renewed && now > loan.DueDate)
                {
                    loan.Status = LoanStatus.Overdue;
                    await _loanRepository.UpdateAsync(loan);

                    var book = await _bookRepository.GetByIdAsync(loan.BookId);
                    if (book != null)
                    {
                        var overdueDays = (int)(now - loan.DueDate).TotalDays;
                        await _notificationService.SendOverdueNoticeAsync(
                            member.Id, book.Title, overdueDays);
                    }

                    overdueCount++;
                }
            }
        }

        return overdueCount;
    }

    /// <summary>
    /// 取得會員借閱摘要
    /// </summary>
    /// <param name="memberId">會員 ID</param>
    /// <returns>借閱摘要</returns>
    public async Task<LoanSummary> GetMemberLoanSummaryAsync(Guid memberId)
    {
        var member = await _memberRepository.GetByIdAsync(memberId)
                     ?? throw new KeyNotFoundException($"Member '{memberId}' not found");

        var activeLoans = await _loanRepository.GetActiveLoansByMemberAsync(memberId);

        var now = _timeProvider.GetUtcNow();

        return new LoanSummary
        {
            MemberId = memberId,
            MemberName = member.Name,
            ActiveLoanCount = activeLoans.Count,
            MaxAllowed = member.MaxBooksAllowed,
            RemainingSlots = member.MaxBooksAllowed - activeLoans.Count,
            OverdueCount = activeLoans.Count(l => l.Status == LoanStatus.Overdue),
            DueSoonCount = activeLoans.Count(l =>
                l.Status is LoanStatus.Active or LoanStatus.Renewed &&
                (l.DueDate - now).TotalDays <= 3 && l.DueDate >= now)
        };
    }
}

/// <summary>
/// 歸還結果
/// </summary>
public class ReturnResult
{
    public Guid LoanId { get; set; }
    public bool IsOverdue { get; set; }
    public int OverdueDays { get; set; }
    public decimal Fine { get; set; }
}

/// <summary>
/// 借閱摘要
/// </summary>
public class LoanSummary
{
    public Guid MemberId { get; set; }
    public string MemberName { get; set; } = string.Empty;
    public int ActiveLoanCount { get; set; }
    public int MaxAllowed { get; set; }
    public int RemainingSlots { get; set; }
    public int OverdueCount { get; set; }
    public int DueSoonCount { get; set; }
}
