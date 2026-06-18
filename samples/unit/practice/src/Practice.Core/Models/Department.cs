namespace Practice.Core.Models;

/// <summary>
/// 部門模型 - Phase 3 練習：AutoFixture 和 Bogus
/// 包含與 Employee 的循環參考
/// </summary>
public class Department
{
    /// <summary>
    /// 部門識別碼
    /// </summary>
    public int Id { get; set; }

    /// <summary>
    /// 部門名稱
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// 部門代碼
    /// </summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>
    /// 部門主管（循環參考：Employee）
    /// </summary>
    public Employee? Manager { get; set; }

    /// <summary>
    /// 部門預算
    /// </summary>
    public decimal Budget { get; set; }

    /// <summary>
    /// 部門員工列表（循環參考：多個 Employee）
    /// </summary>
    public List<Employee> Employees { get; set; } = new();

    /// <summary>
    /// 部門成立日期
    /// </summary>
    public DateTime EstablishedDate { get; set; }

    /// <summary>
    /// 取得部門員工數量
    /// </summary>
    public int EmployeeCount => Employees.Count;

    /// <summary>
    /// 計算部門總薪資
    /// </summary>
    /// <returns>部門所有員工的薪資總和</returns>
    public decimal GetTotalSalary()
    {
        return Employees.Sum(e => e.Salary);
    }

    /// <summary>
    /// 檢查預算是否足夠支付薪資
    /// </summary>
    /// <returns>預算是否充足</returns>
    public bool IsBudgetSufficient()
    {
        return Budget >= GetTotalSalary();
    }
}
