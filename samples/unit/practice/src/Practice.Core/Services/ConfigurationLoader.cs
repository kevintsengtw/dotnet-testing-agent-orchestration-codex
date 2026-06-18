using System.IO.Abstractions;

namespace Practice.Core.Services;

/// <summary>
/// 設定載入器 - Phase 4 練習：FileSystem Abstractions
/// 使用 IFileSystem 抽象化檔案系統依賴
/// </summary>
public class ConfigurationLoader
{
    private readonly IFileSystem _fileSystem;

    public ConfigurationLoader(IFileSystem fileSystem)
    {
        _fileSystem = fileSystem ?? throw new ArgumentNullException(nameof(fileSystem));
    }

    /// <summary>
    /// 載入設定檔
    /// </summary>
    /// <param name="path">檔案路徑</param>
    /// <returns>設定鍵值對</returns>
    public Dictionary<string, string> LoadConfig(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            throw new ArgumentException("Path cannot be null or empty", nameof(path));

        if (!_fileSystem.File.Exists(path))
            throw new FileNotFoundException($"Config file not found: {path}", path);

        var content = _fileSystem.File.ReadAllText(path);
        return ParseConfig(content);
    }

    /// <summary>
    /// 載入 JSON 設定檔
    /// </summary>
    /// <param name="path">檔案路徑</param>
    /// <returns>JSON 內容</returns>
    public string LoadJsonConfig(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            throw new ArgumentException("Path cannot be null or empty", nameof(path));

        if (!_fileSystem.File.Exists(path))
            throw new FileNotFoundException($"Config file not found: {path}", path);

        var extension = _fileSystem.Path.GetExtension(path);
        if (!extension.Equals(".json", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Expected JSON file but got: {extension}");

        return _fileSystem.File.ReadAllText(path);
    }

    /// <summary>
    /// 儲存設定檔
    /// </summary>
    /// <param name="path">檔案路徑</param>
    /// <param name="config">設定鍵值對</param>
    public void SaveConfig(string path, Dictionary<string, string> config)
    {
        if (string.IsNullOrWhiteSpace(path))
            throw new ArgumentException("Path cannot be null or empty", nameof(path));

        if (config == null)
            throw new ArgumentNullException(nameof(config));

        var directory = _fileSystem.Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory) && !_fileSystem.Directory.Exists(directory))
        {
            _fileSystem.Directory.CreateDirectory(directory);
        }

        var content = string.Join(Environment.NewLine,
            config.Select(kvp => $"{kvp.Key}={kvp.Value}"));

        _fileSystem.File.WriteAllText(path, content);
    }

    /// <summary>
    /// 檢查設定檔是否存在
    /// </summary>
    /// <param name="path">檔案路徑</param>
    /// <returns>是否存在</returns>
    public bool ConfigExists(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return false;

        return _fileSystem.File.Exists(path);
    }

    /// <summary>
    /// 取得設定檔的最後修改時間
    /// </summary>
    /// <param name="path">檔案路徑</param>
    /// <returns>最後修改時間</returns>
    public DateTime GetLastModifiedTime(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            throw new ArgumentException("Path cannot be null or empty", nameof(path));

        if (!_fileSystem.File.Exists(path))
            throw new FileNotFoundException($"Config file not found: {path}", path);

        return _fileSystem.File.GetLastWriteTimeUtc(path);
    }

    /// <summary>
    /// 列出目錄中的所有設定檔
    /// </summary>
    /// <param name="directory">目錄路徑</param>
    /// <param name="pattern">檔案模式（預設 *.config）</param>
    /// <returns>設定檔路徑列表</returns>
    public IEnumerable<string> ListConfigFiles(string directory, string pattern = "*.config")
    {
        if (string.IsNullOrWhiteSpace(directory))
            throw new ArgumentException("Directory cannot be null or empty", nameof(directory));

        if (!_fileSystem.Directory.Exists(directory))
            throw new DirectoryNotFoundException($"Directory not found: {directory}");

        return _fileSystem.Directory.GetFiles(directory, pattern);
    }

    /// <summary>
    /// 刪除設定檔
    /// </summary>
    /// <param name="path">檔案路徑</param>
    /// <returns>是否成功刪除</returns>
    public bool DeleteConfig(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return false;

        if (!_fileSystem.File.Exists(path))
            return false;

        _fileSystem.File.Delete(path);
        return true;
    }

    /// <summary>
    /// 備份設定檔
    /// </summary>
    /// <param name="sourcePath">來源路徑</param>
    /// <param name="backupDirectory">備份目錄</param>
    /// <returns>備份檔案路徑</returns>
    public string BackupConfig(string sourcePath, string backupDirectory)
    {
        if (string.IsNullOrWhiteSpace(sourcePath))
            throw new ArgumentException("Source path cannot be null or empty", nameof(sourcePath));

        if (string.IsNullOrWhiteSpace(backupDirectory))
            throw new ArgumentException("Backup directory cannot be null or empty", nameof(backupDirectory));

        if (!_fileSystem.File.Exists(sourcePath))
            throw new FileNotFoundException($"Source file not found: {sourcePath}", sourcePath);

        if (!_fileSystem.Directory.Exists(backupDirectory))
        {
            _fileSystem.Directory.CreateDirectory(backupDirectory);
        }

        var fileName = _fileSystem.Path.GetFileNameWithoutExtension(sourcePath);
        var extension = _fileSystem.Path.GetExtension(sourcePath);
        var timestamp = DateTime.UtcNow.ToString("yyyyMMdd_HHmmss");
        var backupFileName = $"{fileName}_{timestamp}{extension}";
        var backupPath = _fileSystem.Path.Combine(backupDirectory, backupFileName);

        _fileSystem.File.Copy(sourcePath, backupPath);

        return backupPath;
    }

    private static Dictionary<string, string> ParseConfig(string content)
    {
        if (string.IsNullOrWhiteSpace(content))
            return new Dictionary<string, string>();

        return content
            .Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries)
            .Where(line => !string.IsNullOrWhiteSpace(line) && line.Contains('=') && !line.TrimStart().StartsWith('#'))
            .Select(line =>
            {
                var parts = line.Split('=', 2);
                return new { Key = parts[0].Trim(), Value = parts.Length > 1 ? parts[1].Trim() : "" };
            })
            .Where(x => !string.IsNullOrEmpty(x.Key))
            .ToDictionary(x => x.Key, x => x.Value);
    }
}
