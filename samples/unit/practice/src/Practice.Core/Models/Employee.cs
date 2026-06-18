namespace Practice.Core.Models;

/// <summary>
/// 員工模型 - Phase 3 練習：AutoFixture 和 Bogus
/// 包含與 Department 的循環參考
/// </summary>
public class Employee
{
    /// <summary>
    /// 員工唯一識別碼
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// 名字
    /// </summary>
    public string FirstName { get; set; } = string.Empty;

    /// <summary>
    /// 姓氏
    /// </summary>
    public string LastName { get; set; } = string.Empty;

    /// <summary>
    /// 電子郵件
    /// </summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// 入職日期
    /// </summary>
    public DateTime HireDate { get; set; }

    /// <summary>
    /// 薪資
    /// </summary>
    public decimal Salary { get; set; }

    /// <summary>
    /// 所屬部門（循環參考）
    /// </summary>
    public Department? Department { get; set; }

    /// <summary>
    /// 員工技能列表
    /// </summary>
    public List<string> Skills { get; set; } = new();

    /// <summary>
    /// 員工全名
    /// </summary>
    public string FullName => $"{FirstName} {LastName}";

    /// <summary>
    /// 計算年資
    /// </summary>
    /// <param name="currentDate">當前日期</param>
    /// <returns>年資（年）</returns>
    public int GetYearsOfService(DateTime currentDate)
    {
        if (currentDate < HireDate)
            throw new ArgumentException("Current date cannot be before hire date", nameof(currentDate));

        return (currentDate - HireDate).Days / 365;
    }
}
