using Practice.Core.Net8.Interfaces;
using Practice.Core.Net8.Legacy;

namespace Practice.Core.Net8.Services;

/// <summary>
/// 報表產生器 - Phase 6 練習：重構後的可測試版本
/// 此類別展示如何將 LegacyReportGenerator 重構為可測試的設計：
/// 1. 使用 IUserRepository 取代 Database.GetUser()
/// 2. 使用 ITransactionRepository 取代 Database.GetTransactions()
/// 3. 使用 TimeProvider 取代 DateTime.Now
/// 4. 使用 IReportWriter 取代 File.WriteAllText()
/// </summary>
public class ReportGenerator
{
    private readonly IUserRepository _userRepository;
    private readonly ITransactionRepository _transactionRepository;
    private readonly TimeProvider _timeProvider;
    private readonly IReportWriter _reportWriter;

    public ReportGenerator(
        IUserRepository userRepository,
        ITransactionRepository transactionRepository,
        TimeProvider timeProvider,
        IReportWriter reportWriter)
    {
        _userRepository = userRepository ?? throw new ArgumentNullException(nameof(userRepository));
        _transactionRepository = transactionRepository ?? throw new ArgumentNullException(nameof(transactionRepository));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _reportWriter = reportWriter ?? throw new ArgumentNullException(nameof(reportWriter));
    }

    /// <summary>
    /// 產生使用者報表
    /// 重構後的可測試版本
    /// </summary>
    /// <param name="userId">使用者 ID</param>
    /// <returns>報表摘要訊息</returns>
    public string GenerateReport(int userId)
    {
        // ✅ 透過介面取得使用者（可 Mock）
        var user = _userRepository.GetUser(userId);
        var transactions = _transactionRepository.GetTransactions(userId);

        // ✅ 透過 TimeProvider 取得時間（可控制）
        var reportDate = _timeProvider.GetLocalNow().DateTime;

        // 計算統計資料
        var totalAmount = transactions.Sum(t => t.Amount);
        var transactionCount = transactions.Count;
        var averageAmount = transactionCount > 0 ? totalAmount / transactionCount : 0;

        // 產生報表內容
        var reportContent = GenerateReportContent(user, transactions, reportDate, totalAmount, averageAmount);

        // ✅ 透過介面寫入檔案（可驗證）
        var filePath = _reportWriter.GenerateFilePath($"report_{userId}", reportDate);
        _reportWriter.WriteReport(filePath, reportContent);

        return $"Report for {user.Name} generated on {reportDate:yyyy-MM-dd HH:mm:ss}";
    }

    /// <summary>
    /// 產生月度摘要報表
    /// </summary>
    public string GenerateMonthlySummary(int userId, int year, int month)
    {
        var user = _userRepository.GetUser(userId);

        // 使用 TimeProvider 計算日期範圍
        var startDate = new DateTime(year, month, 1);
        var endDate = startDate.AddMonths(1).AddDays(-1);

        var monthlyTransactions = _transactionRepository.GetTransactionsByDateRange(userId, startDate, endDate);
        var totalAmount = monthlyTransactions.Sum(t => t.Amount);

        var generatedAt = _timeProvider.GetLocalNow().DateTime;

        var content = $"Monthly Summary for {user.Name}\n" +
                      $"Period: {year}-{month:D2}\n" +
                      $"Total Transactions: {monthlyTransactions.Count}\n" +
                      $"Total Amount: ${totalAmount:N2}\n" +
                      $"Generated: {generatedAt:yyyy-MM-dd HH:mm:ss}";

        var filePath = _reportWriter.GenerateFilePath($"monthly_{userId}_{year}_{month:D2}", generatedAt);
        _reportWriter.WriteReport(filePath, content);

        return content;
    }

    /// <summary>
    /// 檢查使用者是否為 VIP（消費超過 $500）
    /// </summary>
    public bool IsVipUser(int userId)
    {
        var totalSpent = _transactionRepository.GetTotalSpent(userId);
        return totalSpent >= 500;
    }

    /// <summary>
    /// 獲取最近的交易紀錄
    /// </summary>
    public List<TransactionRecord> GetRecentTransactions(int userId, int days)
    {
        var now = _timeProvider.GetUtcNow().DateTime;
        var cutoffDate = now.AddDays(-days);

        var transactions = _transactionRepository.GetTransactions(userId);

        return transactions
            .Where(t => t.Date >= cutoffDate)
            .OrderByDescending(t => t.Date)
            .ToList();
    }

    /// <summary>
    /// 匯出報表到指定路徑
    /// </summary>
    public void ExportReport(int userId, string exportPath)
    {
        var user = _userRepository.GetUser(userId);
        var transactions = _transactionRepository.GetTransactions(userId);
        var exportTime = _timeProvider.GetLocalNow().DateTime;

        var content = $"Export for {user.Name} at {exportTime}\n";
        content += $"Transactions: {transactions.Count}\n";
        content += $"Total: ${transactions.Sum(t => t.Amount):N2}";

        var directory = Path.GetDirectoryName(exportPath);
        if (!string.IsNullOrEmpty(directory))
        {
            _reportWriter.EnsureDirectoryExists(directory);
        }

        _reportWriter.WriteReport(exportPath, content);
    }

    private static string GenerateReportContent(
        UserRecord user,
        List<TransactionRecord> transactions,
        DateTime reportDate,
        decimal totalAmount,
        decimal averageAmount)
    {
        var lines = new List<string>
        {
            "========================================",
            $"User Report",
            "========================================",
            $"User: {user.Name}",
            $"Email: {user.Email}",
            $"Report Date: {reportDate:yyyy-MM-dd HH:mm:ss}",
            "----------------------------------------",
            $"Total Transactions: {transactions.Count}",
            $"Total Amount: ${totalAmount:N2}",
            $"Average Amount: ${averageAmount:N2}",
            "----------------------------------------",
            "Transaction Details:"
        };

        foreach (var transaction in transactions)
        {
            lines.Add($"  [{transaction.Date:yyyy-MM-dd}] {transaction.Description}: ${transaction.Amount:N2}");
        }

        lines.Add("========================================");

        return string.Join(Environment.NewLine, lines);
    }
}
