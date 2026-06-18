namespace Practice.Core.Legacy;

/// <summary>
/// 舊式報表產生器 - Phase 6 練習：識別並重構遺留程式碼
/// 此類別包含多個測試性問題：
/// 1. 直接使用靜態方法 (Database.GetUser, Database.GetTransactions)
/// 2. 直接使用 DateTime.Now
/// 3. 直接使用 File.WriteAllText 寫入檔案
/// 4. 沒有依賴注入，所有依賴都是硬編碼的
/// </summary>
public class LegacyReportGenerator
{
    /// <summary>
    /// 產生使用者報表
    /// 此方法有多個無法測試的問題
    /// </summary>
    /// <param name="userId">使用者 ID</param>
    /// <returns>報表內容</returns>
    public string GenerateReport(int userId)
    {
        // 問題 1: 直接呼叫靜態方法，無法 Mock
        var user = Database.GetUser(userId);
        var transactions = Database.GetTransactions(userId);

        // 問題 2: 直接使用 DateTime.Now，無法控制時間
        var reportDate = DateTime.Now;

        // 計算統計資料
        var totalAmount = transactions.Sum(t => t.Amount);
        var transactionCount = transactions.Count;
        var averageAmount = transactionCount > 0 ? totalAmount / transactionCount : 0;

        // 產生報表內容
        var reportContent = GenerateReportContent(user, transactions, reportDate, totalAmount, averageAmount);

        // 問題 3: 直接寫入檔案系統，無法驗證
        var filePath = $"report_{userId}_{reportDate:yyyyMMdd_HHmmss}.txt";
        File.WriteAllText(filePath, reportContent);

        return $"Report for {user.Name} generated on {reportDate:yyyy-MM-dd HH:mm:ss}";
    }

    /// <summary>
    /// 產生月度摘要報表
    /// 同樣有多個測試性問題
    /// </summary>
    public string GenerateMonthlySummary(int userId, int year, int month)
    {
        // 問題: 直接使用靜態方法
        var user = Database.GetUser(userId);
        var allTransactions = Database.GetTransactions(userId);

        // 篩選指定月份的交易
        var monthlyTransactions = allTransactions
            .Where(t => t.Date.Year == year && t.Date.Month == month)
            .ToList();

        var totalAmount = monthlyTransactions.Sum(t => t.Amount);

        // 問題: 直接使用 DateTime.Now
        var generatedAt = DateTime.Now;

        // 問題: 直接寫入檔案
        var filePath = $"monthly_{userId}_{year}_{month:D2}.txt";
        var content = $"Monthly Summary for {user.Name}\n" +
                      $"Period: {year}-{month:D2}\n" +
                      $"Total Transactions: {monthlyTransactions.Count}\n" +
                      $"Total Amount: ${totalAmount:N2}\n" +
                      $"Generated: {generatedAt:yyyy-MM-dd HH:mm:ss}";

        File.WriteAllText(filePath, content);

        return content;
    }

    /// <summary>
    /// 檢查使用者是否為 VIP（消費超過 $500）
    /// 這個方法也有靜態依賴問題
    /// </summary>
    public bool IsVipUser(int userId)
    {
        // 問題: 直接使用靜態方法
        var transactions = Database.GetTransactions(userId);
        var totalSpent = transactions.Sum(t => t.Amount);

        return totalSpent >= 500;
    }

    /// <summary>
    /// 獲取最近的交易紀錄
    /// 有時間依賴問題
    /// </summary>
    public List<TransactionRecord> GetRecentTransactions(int userId, int days)
    {
        // 問題: 直接使用靜態方法
        var transactions = Database.GetTransactions(userId);

        // 問題: 直接使用 DateTime.Now
        var cutoffDate = DateTime.Now.AddDays(-days);

        return transactions
            .Where(t => t.Date >= cutoffDate)
            .OrderByDescending(t => t.Date)
            .ToList();
    }

    /// <summary>
    /// 匯出報表到指定路徑
    /// 有檔案系統依賴問題
    /// </summary>
    public void ExportReport(int userId, string exportPath)
    {
        // 問題: 直接使用靜態方法
        var user = Database.GetUser(userId);
        var transactions = Database.GetTransactions(userId);

        // 問題: 直接使用 DateTime.Now
        var exportTime = DateTime.Now;

        var content = $"Export for {user.Name} at {exportTime}\n";
        content += $"Transactions: {transactions.Count}\n";
        content += $"Total: ${transactions.Sum(t => t.Amount):N2}";

        // 問題: 直接檢查和建立目錄
        var directory = Path.GetDirectoryName(exportPath);
        if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
        {
            Directory.CreateDirectory(directory);
        }

        // 問題: 直接寫入檔案
        File.WriteAllText(exportPath, content);
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
