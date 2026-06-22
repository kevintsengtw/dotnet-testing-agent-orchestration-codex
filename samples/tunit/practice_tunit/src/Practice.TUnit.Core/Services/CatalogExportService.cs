using System.IO.Abstractions;
using Practice.TUnit.Core.Models;

namespace Practice.TUnit.Core.Services;

/// <summary>
/// 目錄匯出服務 — P3-5 驗證：IFileSystem 依賴、xUnit → TUnit 遷移場景
/// 使用 System.IO.Abstractions 進行檔案系統操作
/// </summary>
public class CatalogExportService
{
    private readonly IFileSystem _fileSystem;

    public CatalogExportService(IFileSystem fileSystem)
    {
        _fileSystem = fileSystem ?? throw new ArgumentNullException(nameof(fileSystem));
    }

    /// <summary>
    /// 將書籍清單匯出為 CSV 檔案
    /// </summary>
    /// <param name="books">書籍清單</param>
    /// <param name="filePath">輸出檔案路徑</param>
    /// <returns>匯出的書籍數量</returns>
    public async Task<int> ExportToCsvAsync(IEnumerable<Book> books, string filePath)
    {
        if (books == null)
            throw new ArgumentNullException(nameof(books));

        if (string.IsNullOrWhiteSpace(filePath))
            throw new ArgumentException("File path is required", nameof(filePath));

        var bookList = books.ToList();

        var directory = _fileSystem.Path.GetDirectoryName(filePath);
        if (!string.IsNullOrEmpty(directory) && !_fileSystem.Directory.Exists(directory))
        {
            _fileSystem.Directory.CreateDirectory(directory);
        }

        var lines = new List<string>
        {
            "Id,Title,Author,ISBN,Genre,PublishedDate,Price,Status,PageCount"
        };

        foreach (var book in bookList)
        {
            var line = string.Join(",",
                book.Id,
                EscapeCsvField(book.Title),
                EscapeCsvField(book.Author),
                book.Isbn,
                book.Genre,
                book.PublishedDate.ToString("yyyy-MM-dd"),
                book.Price,
                book.Status,
                book.PageCount);
            lines.Add(line);
        }

        await _fileSystem.File.WriteAllLinesAsync(filePath, lines);

        return bookList.Count;
    }

    /// <summary>
    /// 將書籍清單匯出為 JSON 檔案
    /// </summary>
    /// <param name="books">書籍清單</param>
    /// <param name="filePath">輸出檔案路徑</param>
    /// <returns>匯出的書籍數量</returns>
    public async Task<int> ExportToJsonAsync(IEnumerable<Book> books, string filePath)
    {
        if (books == null)
            throw new ArgumentNullException(nameof(books));

        if (string.IsNullOrWhiteSpace(filePath))
            throw new ArgumentException("File path is required", nameof(filePath));

        var bookList = books.ToList();

        var directory = _fileSystem.Path.GetDirectoryName(filePath);
        if (!string.IsNullOrEmpty(directory) && !_fileSystem.Directory.Exists(directory))
        {
            _fileSystem.Directory.CreateDirectory(directory);
        }

        var json = System.Text.Json.JsonSerializer.Serialize(bookList,
            new System.Text.Json.JsonSerializerOptions
            {
                WriteIndented = true,
                PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase
            });

        await _fileSystem.File.WriteAllTextAsync(filePath, json);

        return bookList.Count;
    }

    /// <summary>
    /// 從 CSV 檔案讀取書籍清單
    /// </summary>
    /// <param name="filePath">檔案路徑</param>
    /// <returns>書籍清單</returns>
    public async Task<IReadOnlyList<Book>> ImportFromCsvAsync(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
            throw new ArgumentException("File path is required", nameof(filePath));

        if (!_fileSystem.File.Exists(filePath))
            throw new FileNotFoundException($"File not found: {filePath}", filePath);

        var lines = await _fileSystem.File.ReadAllLinesAsync(filePath);

        if (lines.Length < 2)
            return Array.Empty<Book>();

        var books = new List<Book>();

        // 跳過標題列
        for (var i = 1; i < lines.Length; i++)
        {
            var line = lines[i];
            if (string.IsNullOrWhiteSpace(line))
                continue;

            var fields = ParseCsvLine(line);
            if (fields.Length < 9)
                continue;

            try
            {
                var book = new Book
                {
                    Id = Guid.Parse(fields[0]),
                    Title = fields[1],
                    Author = fields[2],
                    Isbn = fields[3],
                    Genre = Enum.Parse<BookGenre>(fields[4]),
                    PublishedDate = DateTime.Parse(fields[5]),
                    Price = decimal.Parse(fields[6]),
                    Status = Enum.Parse<BookStatus>(fields[7]),
                    PageCount = int.Parse(fields[8])
                };
                books.Add(book);
            }
            catch (FormatException)
            {
                // 跳過格式錯誤的行
            }
        }

        return books;
    }

    /// <summary>
    /// 產生庫存統計報告並寫入檔案
    /// </summary>
    /// <param name="books">書籍清單</param>
    /// <param name="filePath">輸出檔案路徑</param>
    /// <returns>報告內容</returns>
    public async Task<string> GenerateInventoryReportAsync(IEnumerable<Book> books, string filePath)
    {
        if (books == null)
            throw new ArgumentNullException(nameof(books));

        if (string.IsNullOrWhiteSpace(filePath))
            throw new ArgumentException("File path is required", nameof(filePath));

        var bookList = books.ToList();

        var report = new System.Text.StringBuilder();
        report.AppendLine("=== 圖書館庫存統計報告 ===");
        report.AppendLine($"統計日期：{DateTime.UtcNow:yyyy-MM-dd}");
        report.AppendLine($"總藏書量：{bookList.Count} 冊");
        report.AppendLine();

        // 狀態分布
        report.AppendLine("--- 狀態分布 ---");
        var statusGroups = bookList.GroupBy(b => b.Status)
            .OrderBy(g => g.Key);
        foreach (var group in statusGroups)
        {
            report.AppendLine($"  {group.Key}: {group.Count()} 冊");
        }
        report.AppendLine();

        // 類型分布
        report.AppendLine("--- 類型分布 ---");
        var genreGroups = bookList.GroupBy(b => b.Genre)
            .OrderByDescending(g => g.Count());
        foreach (var group in genreGroups)
        {
            report.AppendLine($"  {group.Key}: {group.Count()} 冊");
        }
        report.AppendLine();

        // 價值統計
        report.AppendLine("--- 價值統計 ---");
        if (bookList.Count > 0)
        {
            report.AppendLine($"  總價值：${bookList.Sum(b => b.Price):N2}");
            report.AppendLine($"  平均單價：${bookList.Average(b => b.Price):N2}");
            report.AppendLine($"  最高單價：${bookList.Max(b => b.Price):N2}");
            report.AppendLine($"  最低單價：${bookList.Min(b => b.Price):N2}");
        }

        var reportContent = report.ToString();

        var directory = _fileSystem.Path.GetDirectoryName(filePath);
        if (!string.IsNullOrEmpty(directory) && !_fileSystem.Directory.Exists(directory))
        {
            _fileSystem.Directory.CreateDirectory(directory);
        }

        await _fileSystem.File.WriteAllTextAsync(filePath, reportContent);

        return reportContent;
    }

    private static string EscapeCsvField(string field)
    {
        if (field.Contains(',') || field.Contains('"') || field.Contains('\n'))
        {
            return $"\"{field.Replace("\"", "\"\"")}\"";
        }

        return field;
    }

    private static string[] ParseCsvLine(string line)
    {
        var fields = new List<string>();
        var current = new System.Text.StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];

            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"')
                    {
                        current.Append('"');
                        i++;
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    current.Append(c);
                }
            }
            else
            {
                if (c == '"')
                {
                    inQuotes = true;
                }
                else if (c == ',')
                {
                    fields.Add(current.ToString());
                    current.Clear();
                }
                else
                {
                    current.Append(c);
                }
            }
        }

        fields.Add(current.ToString());
        return fields.ToArray();
    }
}
