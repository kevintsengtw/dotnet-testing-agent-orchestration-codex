using Practice.TUnit.Core.Models;

namespace Practice.TUnit.Core.Interfaces;

/// <summary>
/// 借閱資料存取介面
/// </summary>
public interface ILoanRepository
{
    /// <summary>依 ID 取得借閱紀錄</summary>
    Task<Loan?> GetByIdAsync(Guid id);

    /// <summary>依會員 ID 取得進行中的借閱紀錄</summary>
    Task<IReadOnlyList<Loan>> GetActiveLoansByMemberAsync(Guid memberId);

    /// <summary>依書籍 ID 取得進行中的借閱紀錄</summary>
    Task<Loan?> GetActiveLoanByBookAsync(Guid bookId);

    /// <summary>取得所有逾期借閱紀錄</summary>
    Task<IReadOnlyList<Loan>> GetOverdueLoansAsync();

    /// <summary>新增借閱紀錄</summary>
    Task AddAsync(Loan loan);

    /// <summary>更新借閱紀錄</summary>
    Task UpdateAsync(Loan loan);
}
