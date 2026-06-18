namespace Practice.Core.Net10.Legacy;

/// <summary>
/// 資料庫靜態類別 - Phase 6 練習
/// 模擬舊版的靜態資料庫存取
/// 此類別代表難以測試的遺留程式碼
/// </summary>
public static class Database
{
    /// <summary>
    /// 取得使用者資料（靜態方法，難以 Mock）
    /// </summary>
    public static UserRecord GetUser(int userId)
    {
        // 模擬資料庫存取
        return new UserRecord
        {
            Id = userId,
            Name = $"User_{userId}",
            Email = $"user{userId}@example.com"
        };
    }

    /// <summary>
    /// 取得交易紀錄（靜態方法，難以 Mock）
    /// </summary>
    public static List<TransactionRecord> GetTransactions(int userId)
    {
        // 模擬資料庫存取
        return new List<TransactionRecord>
        {
            new() { Id = 1, UserId = userId, Amount = 100.50m, Description = "Purchase A", Date = DateTime.Now.AddDays(-5) },
            new() { Id = 2, UserId = userId, Amount = 200.75m, Description = "Purchase B", Date = DateTime.Now.AddDays(-3) },
            new() { Id = 3, UserId = userId, Amount = 50.00m, Description = "Purchase C", Date = DateTime.Now.AddDays(-1) }
        };
    }
}

/// <summary>
/// 使用者紀錄
/// </summary>
public class UserRecord
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
}

/// <summary>
/// 交易紀錄
/// </summary>
public class TransactionRecord
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public decimal Amount { get; set; }
    public string Description { get; set; } = string.Empty;
    public DateTime Date { get; set; }
}
