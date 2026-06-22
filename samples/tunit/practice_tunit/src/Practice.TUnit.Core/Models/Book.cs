namespace Practice.TUnit.Core.Models;

/// <summary>
/// 書籍狀態
/// </summary>
public enum BookStatus
{
    /// <summary>可借閱</summary>
    Available,

    /// <summary>已借出</summary>
    OnLoan,

    /// <summary>已預約</summary>
    Reserved,

    /// <summary>已下架</summary>
    Archived
}

/// <summary>
/// 書籍類型
/// </summary>
public enum BookGenre
{
    Fiction,
    NonFiction,
    Science,
    Technology,
    History,
    Biography,
    Children,
    Art,
    Reference
}

/// <summary>
/// 書籍模型
/// </summary>
public class Book
{
    /// <summary>書籍唯一識別碼</summary>
    public Guid Id { get; set; }

    /// <summary>書名</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>作者</summary>
    public string Author { get; set; } = string.Empty;

    /// <summary>ISBN（國際標準書號）</summary>
    public string Isbn { get; set; } = string.Empty;

    /// <summary>書籍類型</summary>
    public BookGenre Genre { get; set; }

    /// <summary>出版日期</summary>
    public DateTime PublishedDate { get; set; }

    /// <summary>定價</summary>
    public decimal Price { get; set; }

    /// <summary>書籍狀態</summary>
    public BookStatus Status { get; set; } = BookStatus.Available;

    /// <summary>頁數</summary>
    public int PageCount { get; set; }
}
