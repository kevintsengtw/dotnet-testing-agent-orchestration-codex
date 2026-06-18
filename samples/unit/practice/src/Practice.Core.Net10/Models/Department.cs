namespace Practice.Core.Net10.Models;

/// <summary>
/// 部門模型 - Phase 3 練習用
/// </summary>
public class Department
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public decimal Budget { get; set; }
    public Employee? Manager { get; set; }
    public List<Employee> Employees { get; set; } = new();
}
