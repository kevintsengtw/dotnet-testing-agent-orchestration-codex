using Practice.Core.Net10.Legacy;

namespace Practice.Core.Net10.Interfaces;

/// <summary>
/// 交易資料儲存庫介面 - Phase 6 用於取代 Database.GetTransactions()
/// </summary>
public interface ITransactionRepository
{
    /// <summary>
    /// 取得使用者的所有交易紀錄
    /// </summary>
    /// <param name="userId">使用者 ID</param>
    /// <returns>交易紀錄列表</returns>
    List<TransactionRecord> GetTransactions(int userId);

    /// <summary>
    /// 取得使用者在指定日期範圍內的交易紀錄
    /// </summary>
    /// <param name="userId">使用者 ID</param>
    /// <param name="startDate">開始日期</param>
    /// <param name="endDate">結束日期</param>
    /// <returns>交易紀錄列表</returns>
    List<TransactionRecord> GetTransactionsByDateRange(int userId, DateTime startDate, DateTime endDate);

    /// <summary>
    /// 取得使用者總消費金額
    /// </summary>
    /// <param name="userId">使用者 ID</param>
    /// <returns>總消費金額</returns>
    decimal GetTotalSpent(int userId);
}
