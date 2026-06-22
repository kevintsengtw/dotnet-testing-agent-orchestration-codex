namespace Practice.TUnit.Core.Services;

/// <summary>
/// 書籍目錄工具 — P3-1 驗證：純函式，無外部依賴
/// 提供 ISBN 驗證、價格計算、書籍分類等功能
/// </summary>
public class BookCatalog
{
    /// <summary>
    /// 驗證 ISBN-13 格式
    /// </summary>
    /// <param name="isbn">ISBN 字串</param>
    /// <returns>是否為有效的 ISBN-13</returns>
    public bool IsValidIsbn13(string isbn)
    {
        if (string.IsNullOrWhiteSpace(isbn))
            return false;

        // 移除連字號
        var digits = isbn.Replace("-", "");

        if (digits.Length != 13 || !digits.All(char.IsDigit))
            return false;

        // ISBN-13 校驗碼驗證
        var sum = 0;
        for (var i = 0; i < 12; i++)
        {
            var digit = digits[i] - '0';
            sum += i % 2 == 0 ? digit : digit * 3;
        }

        var checkDigit = (10 - sum % 10) % 10;
        return checkDigit == digits[12] - '0';
    }

    /// <summary>
    /// 計算會員折扣價
    /// </summary>
    /// <param name="originalPrice">原價</param>
    /// <param name="membershipYears">會員年資</param>
    /// <returns>折扣後價格</returns>
    /// <exception cref="ArgumentException">當原價為負數時拋出</exception>
    public decimal CalculateDiscountPrice(decimal originalPrice, int membershipYears)
    {
        if (originalPrice < 0)
            throw new ArgumentException("Price cannot be negative", nameof(originalPrice));

        if (membershipYears < 0)
            throw new ArgumentException("Membership years cannot be negative", nameof(membershipYears));

        // 折扣率：0-1 年 0%、2-4 年 5%、5-9 年 10%、10+ 年 15%
        var discountRate = membershipYears switch
        {
            < 2 => 0m,
            < 5 => 0.05m,
            < 10 => 0.10m,
            _ => 0.15m
        };

        return Math.Round(originalPrice * (1 - discountRate), 2);
    }

    /// <summary>
    /// 計算逾期罰款
    /// </summary>
    /// <param name="overdueDays">逾期天數</param>
    /// <param name="bookPrice">書籍定價</param>
    /// <returns>罰款金額</returns>
    public decimal CalculateOverdueFine(int overdueDays, decimal bookPrice)
    {
        if (overdueDays <= 0)
            return 0m;

        if (bookPrice < 0)
            throw new ArgumentException("Book price cannot be negative", nameof(bookPrice));

        // 每日罰款：$1，最高不超過書籍定價的 50%
        var dailyFine = 1m;
        var totalFine = dailyFine * overdueDays;
        var maxFine = bookPrice * 0.5m;

        return Math.Min(totalFine, maxFine);
    }

    /// <summary>
    /// 根據頁數分類書籍厚度等級
    /// </summary>
    /// <param name="pageCount">頁數</param>
    /// <returns>厚度等級描述</returns>
    public string ClassifyByPageCount(int pageCount)
    {
        if (pageCount <= 0)
            throw new ArgumentException("Page count must be positive", nameof(pageCount));

        return pageCount switch
        {
            <= 50 => "小冊子",
            <= 150 => "薄書",
            <= 300 => "一般",
            <= 500 => "厚書",
            _ => "巨著"
        };
    }

    /// <summary>
    /// 產生書籍索引碼
    /// </summary>
    /// <param name="genre">書籍類型</param>
    /// <param name="author">作者姓名</param>
    /// <param name="publishYear">出版年份</param>
    /// <returns>索引碼（格式：GENRE-AUTHOR_INITIAL-YEAR）</returns>
    public string GenerateIndexCode(string genre, string author, int publishYear)
    {
        if (string.IsNullOrWhiteSpace(genre))
            throw new ArgumentException("Genre is required", nameof(genre));

        if (string.IsNullOrWhiteSpace(author))
            throw new ArgumentException("Author is required", nameof(author));

        if (publishYear < 1450 || publishYear > 2100)
            throw new ArgumentOutOfRangeException(nameof(publishYear), "Publish year must be between 1450 and 2100");

        var genreCode = genre.Length >= 3 ? genre[..3].ToUpperInvariant() : genre.ToUpperInvariant();
        var authorInitial = author.Trim()[0].ToString().ToUpperInvariant();

        return $"{genreCode}-{authorInitial}-{publishYear}";
    }

    /// <summary>
    /// 判斷書籍是否為經典（出版超過 50 年）
    /// </summary>
    /// <param name="publishedDate">出版日期</param>
    /// <returns>是否為經典</returns>
    public bool IsClassic(DateTime publishedDate)
    {
        var yearsOld = DateTime.Today.Year - publishedDate.Year;
        if (publishedDate.Date > DateTime.Today.AddYears(-yearsOld))
            yearsOld--;

        return yearsOld >= 50;
    }
}
