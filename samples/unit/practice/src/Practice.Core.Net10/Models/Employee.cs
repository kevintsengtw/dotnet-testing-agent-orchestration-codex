namespace Practice.Core.Net10.Models;

/// <summary>
/// 員工模型 - Phase 3 練習用
/// 包含多種屬性型別，適合用 AutoFixture / Bogus 生成測試資料
/// </summary>
public class Employee
{
    public int Id { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public decimal Salary { get; set; }
    public DateTime HireDate { get; set; }
    public Department? Department { get; set; }
    public List<string> Skills { get; set; } = new();

    /// <summary>
    /// 全名
    /// </summary>
    public string FullName => $"{FirstName} {LastName}";

    /// <summary>
    /// 計算年資
    /// </summary>
    /// <param name="today">今天日期</param>
    /// <returns>年資（年數）</returns>
    public int GetYearsOfService(DateTime today)
    {
        var years = today.Year - HireDate.Year;
        if (HireDate.Date > today.AddYears(-years)) years--;
        return Math.Max(0, years);
    }
}
