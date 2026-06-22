namespace Practice.TUnit.Core.Models;

/// <summary>
/// 借閱狀態
/// </summary>
public enum LoanStatus
{
    /// <summary>借閱中</summary>
    Active,

    /// <summary>已歸還</summary>
    Returned,

    /// <summary>已逾期</summary>
    Overdue,

    /// <summary>已續借</summary>
    Renewed
}

/// <summary>
/// 借閱紀錄模型
/// </summary>
public class Loan
{
    /// <summary>借閱紀錄唯一識別碼</summary>
    public Guid Id { get; set; }

    /// <summary>書籍 ID</summary>
    public Guid BookId { get; set; }

    /// <summary>會員 ID</summary>
    public Guid MemberId { get; set; }

    /// <summary>借閱日期</summary>
    public DateTimeOffset LoanDate { get; set; }

    /// <summary>到期日期</summary>
    public DateTimeOffset DueDate { get; set; }

    /// <summary>實際歸還日期</summary>
    public DateTimeOffset? ReturnDate { get; set; }

    /// <summary>借閱狀態</summary>
    public LoanStatus Status { get; set; } = LoanStatus.Active;

    /// <summary>已續借次數</summary>
    public int RenewalCount { get; set; }

    /// <summary>最大可續借次數</summary>
    public int MaxRenewals { get; set; } = 2;

    /// <summary>逾期罰款金額</summary>
    public decimal? OverdueFine { get; set; }
}
