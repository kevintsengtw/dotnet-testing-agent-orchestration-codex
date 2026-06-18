namespace Practice.Core.Net10.Legacy;

/// <summary>
/// 舊版報表產生器 - Phase 6 練習
/// 這是一個「不可測試」的範例：
/// 1. 直接呼叫 Database.GetUser()（靜態依賴）
/// 2. 直接呼叫 Database.GetTransactions()（靜態依賴）
/// 3. 使用 DateTime.Now（不可控制的時間）
/// 4. 直接寫入檔案系統（副作用）
/// 
/// 重構後的版本請參考 Services/ReportGenerator.cs
/// </summary>
public class LegacyReportGenerator
{
    /// <summary>
    /// 產生使用者報表
    /// ⚠️ 此方法因為直接依賴靜態方法和外部資源，難以撰寫單元測試
    /// </summary>
    /// <param name="userId">使用者 ID</param>
    /// <returns>報表儲存路徑</returns>
    public string GenerateReport(int userId)
    {
        // ❌ 直接使用靜態方法（無法 Mock）
        var user = Database.GetUser(userId);
        var transactions = Database.GetTransactions(userId);

        // ❌ 直接使用 DateTime.Now（無法控制時間）
        var reportDate = DateTime.Now;

        // 計算統計
        var totalAmount = transactions.Sum(t => t.Amount);
        var transactionCount = transactions.Count;

        // 產生報表內容
        var report = $"Report for {user.Name}\n";
        report += $"Date: {reportDate}\n";
        report += $"Transactions: {transactionCount}\n";
        report += $"Total: ${totalAmount}\n";

        // ❌ 直接寫入檔案系統（副作用）
        var filePath = $"C:\\Reports\\report_{userId}_{reportDate:yyyyMMdd}.txt";
        File.WriteAllText(filePath, report);

        return filePath;
    }
}
