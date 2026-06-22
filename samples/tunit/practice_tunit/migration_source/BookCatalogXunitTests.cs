// ==========================================================================
// 此檔案為 P3-5 驗證場景的 xUnit 遷移來源
// 包含多種 xUnit 模式（Fact、Theory、InlineData、MemberData、IDisposable）
// 供 TUnit Orchestrator 偵測並轉換為 TUnit 框架測試
// ==========================================================================

using Xunit;
using Xunit.Abstractions;
using AwesomeAssertions;
using Practice.TUnit.Core.Services;

namespace Practice.TUnit.Core.Tests;

/// <summary>
/// BookCatalog 的 xUnit 單元測試（遷移來源）
/// 包含 [Fact]、[Theory]、[InlineData]、[MemberData]、IDisposable 等模式
/// </summary>
public class BookCatalogXunitTests : IDisposable
{
    private readonly BookCatalog _sut;
    private readonly ITestOutputHelper _output;

    public BookCatalogXunitTests(ITestOutputHelper output)
    {
        _output = output;
        _sut = new BookCatalog();
        _output.WriteLine("BookCatalogXunitTests initialized");
    }

    public void Dispose()
    {
        _output.WriteLine("BookCatalogXunitTests disposed");
    }

    // ── IsValidIsbn13 ────────────────────────────────────

    [Fact]
    public void IsValidIsbn13_ValidIsbn_ReturnsTrue()
    {
        // Arrange
        var isbn = "978-0-306-40615-7";

        // Act
        var result = _sut.IsValidIsbn13(isbn);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void IsValidIsbn13_NullOrEmpty_ReturnsFalse()
    {
        _sut.IsValidIsbn13(null!).Should().BeFalse();
        _sut.IsValidIsbn13("").Should().BeFalse();
        _sut.IsValidIsbn13("   ").Should().BeFalse();
    }

    [Theory]
    [InlineData("978-0-306-40615-7", true)]   // 有效 ISBN
    [InlineData("9780306406157", true)]         // 無連字號
    [InlineData("978-0-306-40615-0", false)]   // 校驗碼錯誤
    [InlineData("123", false)]                  // 長度不足
    [InlineData("978-0-306-4061A-7", false)]   // 含非數字
    public void IsValidIsbn13_WithVariousInputs_ReturnsExpected(string isbn, bool expected)
    {
        // Act
        var result = _sut.IsValidIsbn13(isbn);

        // Assert
        result.Should().Be(expected);
    }

    // ── CalculateDiscountPrice ───────────────────────────

    [Fact]
    public void CalculateDiscountPrice_NewMember_NoDiscount()
    {
        // Arrange & Act
        var result = _sut.CalculateDiscountPrice(100m, 0);

        // Assert
        result.Should().Be(100m);
    }

    [Theory]
    [InlineData(100, 0, 100)]      // 0 年：無折扣
    [InlineData(100, 1, 100)]      // 1 年：無折扣
    [InlineData(100, 2, 95)]       // 2 年：5% 折扣
    [InlineData(100, 4, 95)]       // 4 年：5% 折扣
    [InlineData(100, 5, 90)]       // 5 年：10% 折扣
    [InlineData(100, 9, 90)]       // 9 年：10% 折扣
    [InlineData(100, 10, 85)]      // 10 年：15% 折扣
    [InlineData(100, 20, 85)]      // 20 年：15% 折扣
    public void CalculateDiscountPrice_ByMembershipYears_ReturnsCorrectDiscount(
        decimal price, int years, decimal expected)
    {
        var result = _sut.CalculateDiscountPrice(price, years);

        result.Should().Be(expected);
    }

    [Fact]
    public void CalculateDiscountPrice_NegativePrice_ThrowsArgumentException()
    {
        // Act
        var act = () => _sut.CalculateDiscountPrice(-10m, 5);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*negative*");
    }

    // ── CalculateOverdueFine ─────────────────────────────

    [Theory]
    [InlineData(0, 100, 0)]         // 未逾期
    [InlineData(-1, 100, 0)]        // 負數天數
    [InlineData(5, 100, 5)]         // 5 天 × $1 = $5
    [InlineData(10, 100, 10)]       // 10 天 × $1 = $10
    [InlineData(100, 20, 10)]       // 100 天 × $1 = $100，但上限 $20 × 50% = $10
    public void CalculateOverdueFine_WithVariousDays_ReturnsCorrectFine(
        int overdueDays, decimal bookPrice, decimal expectedFine)
    {
        var result = _sut.CalculateOverdueFine(overdueDays, bookPrice);

        result.Should().Be(expectedFine);
    }

    // ── ClassifyByPageCount ──────────────────────────────

    [Theory]
    [InlineData(30, "小冊子")]
    [InlineData(50, "小冊子")]
    [InlineData(100, "薄書")]
    [InlineData(200, "一般")]
    [InlineData(400, "厚書")]
    [InlineData(600, "巨著")]
    public void ClassifyByPageCount_WithVariousPages_ReturnsCorrectCategory(
        int pageCount, string expected)
    {
        var result = _sut.ClassifyByPageCount(pageCount);

        result.Should().Be(expected);
    }

    [Fact]
    public void ClassifyByPageCount_ZeroOrNegative_ThrowsArgumentException()
    {
        var act = () => _sut.ClassifyByPageCount(0);

        act.Should().Throw<ArgumentException>();
    }

    // ── GenerateIndexCode ────────────────────────────────

    public static IEnumerable<object[]> IndexCodeTestData()
    {
        yield return new object[] { "Fiction", "Tolkien", 1954, "FIC-T-1954" };
        yield return new object[] { "Science", "Hawking", 1988, "SCI-H-1988" };
        yield return new object[] { "AI", "Russell", 2020, "AI-R-2020" };
    }

    [Theory]
    [MemberData(nameof(IndexCodeTestData))]
    public void GenerateIndexCode_WithValidInputs_ReturnsCorrectFormat(
        string genre, string author, int year, string expected)
    {
        var result = _sut.GenerateIndexCode(genre, author, year);

        result.Should().Be(expected);
    }

    [Fact]
    public void GenerateIndexCode_EmptyGenre_ThrowsArgumentException()
    {
        var act = () => _sut.GenerateIndexCode("", "Author", 2020);

        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void GenerateIndexCode_InvalidYear_ThrowsArgumentOutOfRangeException()
    {
        var act = () => _sut.GenerateIndexCode("Fiction", "Author", 1200);

        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    // ── IsClassic ────────────────────────────────────────

    [Fact]
    public void IsClassic_PublishedOver50YearsAgo_ReturnsTrue()
    {
        // Arrange
        var publishedDate = new DateTime(1960, 1, 1);

        // Act
        var result = _sut.IsClassic(publishedDate);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void IsClassic_PublishedRecently_ReturnsFalse()
    {
        var publishedDate = DateTime.Today.AddYears(-10);

        var result = _sut.IsClassic(publishedDate);

        result.Should().BeFalse();
    }
}
