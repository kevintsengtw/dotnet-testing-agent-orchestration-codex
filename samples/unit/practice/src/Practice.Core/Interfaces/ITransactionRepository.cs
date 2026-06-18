using Practice.Core.Legacy;

namespace Practice.Core.Interfaces;

/// <summary>
/// 交易資料存取介面 - Phase 6 練習：重構遺留程式碼
/// 用於替代靜態 Database.GetTransactions() 方法
/// </summary>
public interface ITransactionRepository
{
    /// <summary>
    /// 取得使用者的所有交易記錄
    /// </summary>
    /// <param name="userId">使用者 ID</param>
    /// <returns>交易記錄列表</returns>
    List<TransactionRecord> GetTransactions(int userId);

    /// <summary>
    /// 取得使用者在指定期間的交易記錄
    /// </summary>
    /// <param name="userId">使用者 ID</param>
    /// <param name="startDate">開始日期</param>
    /// <param name="endDate">結束日期</param>
    /// <returns>交易記錄列表</returns>
    List<TransactionRecord> GetTransactionsByDateRange(int userId, DateTime startDate, DateTime endDate);

    /// <summary>
    /// 取得使用者的總消費金額
    /// </summary>
    /// <param name="userId">使用者 ID</param>
    /// <returns>總金額</returns>
    decimal GetTotalSpent(int userId);
}
