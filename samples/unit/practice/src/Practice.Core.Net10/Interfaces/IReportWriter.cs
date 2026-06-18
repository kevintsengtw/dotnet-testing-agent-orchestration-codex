namespace Practice.Core.Net10.Interfaces;

/// <summary>
/// 報表寫入器介面 - Phase 6 用於取代直接的檔案系統操作
/// </summary>
public interface IReportWriter
{
    /// <summary>
    /// 寫入報表到指定路徑
    /// </summary>
    /// <param name="filePath">檔案路徑</param>
    /// <param name="content">報表內容</param>
    void WriteReport(string filePath, string content);

    /// <summary>
    /// 產生報表檔案路徑
    /// </summary>
    /// <param name="baseName">基本檔名</param>
    /// <param name="reportDate">報表日期</param>
    /// <returns>完整檔案路徑</returns>
    string GenerateFilePath(string baseName, DateTime reportDate);

    /// <summary>
    /// 確保目錄存在
    /// </summary>
    /// <param name="directoryPath">目錄路徑</param>
    void EnsureDirectoryExists(string directoryPath);
}
