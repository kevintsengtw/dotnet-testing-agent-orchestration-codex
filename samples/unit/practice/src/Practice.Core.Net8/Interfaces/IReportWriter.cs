namespace Practice.Core.Net8.Interfaces;

/// <summary>
/// 報表寫入介面 - Phase 6 練習：重構遺留程式碼
/// 用於替代直接使用 File.WriteAllText()
/// </summary>
public interface IReportWriter
{
    /// <summary>
    /// 寫入報表內容到指定路徑
    /// </summary>
    /// <param name="path">檔案路徑</param>
    /// <param name="content">報表內容</param>
    void WriteReport(string path, string content);

    /// <summary>
    /// 確保目錄存在
    /// </summary>
    /// <param name="directoryPath">目錄路徑</param>
    void EnsureDirectoryExists(string directoryPath);

    /// <summary>
    /// 產生報表檔案名稱
    /// </summary>
    /// <param name="prefix">檔名前綴</param>
    /// <param name="timestamp">時間戳記</param>
    /// <returns>完整檔案路徑</returns>
    string GenerateFilePath(string prefix, DateTime timestamp);
}
