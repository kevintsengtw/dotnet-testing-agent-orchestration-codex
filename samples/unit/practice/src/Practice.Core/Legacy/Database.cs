namespace Practice.Core.Legacy;

/// <summary>
/// 模擬的靜態資料庫存取類別 - Phase 6 練習
/// 這是一個反模式示範 - 靜態方法無法被 Mock
/// </summary>
public static class Database
{
    private static readonly Dictionary<int, UserRecord> _users = new()
    {
        { 1, new UserRecord { Id = 1, Name = "Alice Chen", Email = "alice@example.com" } },
        { 2, new UserRecord { Id = 2, Name = "Bob Wang", Email = "bob@example.com" } },
        { 3, new UserRecord { Id = 3, Name = "Carol Liu", Email = "carol@example.com" } }
    };

    private static readonly Dictionary<int, List<TransactionRecord>> _transactions = new()
    {
        { 1, new List<TransactionRecord>
            {
                new() { Id = 101, UserId = 1, Amount = 100.00m, Date = new DateTime(2024, 1, 15), Description = "Purchase A" },
                new() { Id = 102, UserId = 1, Amount = 250.50m, Date = new DateTime(2024, 2, 20), Description = "Purchase B" }
            }
        },
        { 2, new List<TransactionRecord>
            {
                new() { Id = 201, UserId = 2, Amount = 75.00m, Date = new DateTime(2024, 1, 10), Description = "Purchase C" }
            }
        },
        { 3, new List<TransactionRecord>() }
    };

    /// <summary>
    /// 靜態方法 - 無法被 Mock
    /// </summary>
    public static UserRecord GetUser(int userId)
    {
        if (!_users.TryGetValue(userId, out var user))
            throw new InvalidOperationException($"User {userId} not found");
        return user;
    }

    /// <summary>
    /// 靜態方法 - 無法被 Mock
    /// </summary>
    public static List<TransactionRecord> GetTransactions(int userId)
    {
        if (!_transactions.TryGetValue(userId, out var transactions))
            return new List<TransactionRecord>();
        return transactions;
    }
}

public class UserRecord
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
}

public class TransactionRecord
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public decimal Amount { get; set; }
    public DateTime Date { get; set; }
    public string Description { get; set; } = string.Empty;
}
