using Practice.Core.Models;

namespace Practice.Core.Services;

/// <summary>
/// 員工服務 - Phase 3 練習：AutoFixture 和 Bogus
/// </summary>
public class EmployeeService
{
    /// <summary>
    /// 驗證員工資料
    /// </summary>
    /// <param name="employee">員工</param>
    /// <returns>驗證結果</returns>
    public ValidationResult ValidateEmployee(Employee employee)
    {
        if (employee == null)
            throw new ArgumentNullException(nameof(employee));

        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(employee.FirstName))
            errors.Add("FirstName is required");

        if (string.IsNullOrWhiteSpace(employee.LastName))
            errors.Add("LastName is required");

        if (string.IsNullOrWhiteSpace(employee.Email))
            errors.Add("Email is required");
        else if (!IsValidEmail(employee.Email))
            errors.Add("Email format is invalid");

        if (employee.Salary < 0)
            errors.Add("Salary cannot be negative");

        if (employee.HireDate > DateTime.Today)
            errors.Add("HireDate cannot be in the future");

        return new ValidationResult
        {
            IsValid = errors.Count == 0,
            Errors = errors
        };
    }

    /// <summary>
    /// 計算員工年度獎金
    /// </summary>
    /// <param name="employee">員工</param>
    /// <param name="performanceRating">績效評分（1-5）</param>
    /// <returns>年度獎金</returns>
    public decimal CalculateAnnualBonus(Employee employee, int performanceRating)
    {
        if (employee == null)
            throw new ArgumentNullException(nameof(employee));

        if (performanceRating < 1 || performanceRating > 5)
            throw new ArgumentOutOfRangeException(nameof(performanceRating), "Performance rating must be between 1 and 5");

        // 基本獎金比例：績效 1=0%, 2=5%, 3=10%, 4=15%, 5=20%
        var bonusPercentage = (performanceRating - 1) * 0.05m;

        // 年資加成：每年多 0.5%，最多 5%
        var yearsOfService = employee.GetYearsOfService(DateTime.Today);
        var seniorityBonus = Math.Min(yearsOfService * 0.005m, 0.05m);

        // 部門主管額外加成 3%
        var managerBonus = employee.Department?.Manager?.Id == employee.Id ? 0.03m : 0m;

        var totalBonusPercentage = bonusPercentage + seniorityBonus + managerBonus;

        return employee.Salary * totalBonusPercentage;
    }

    /// <summary>
    /// 取得員工摘要資訊
    /// </summary>
    /// <param name="employee">員工</param>
    /// <returns>摘要字串</returns>
    public string GetEmployeeSummary(Employee employee)
    {
        if (employee == null)
            throw new ArgumentNullException(nameof(employee));

        var departmentInfo = employee.Department != null
            ? $", Department: {employee.Department.Name}"
            : "";

        var skillsInfo = employee.Skills.Count > 0
            ? $", Skills: {string.Join(", ", employee.Skills)}"
            : "";

        return $"{employee.FullName} ({employee.Email}){departmentInfo}{skillsInfo}";
    }

    /// <summary>
    /// 分析部門薪資分布
    /// </summary>
    /// <param name="department">部門</param>
    /// <returns>薪資分析結果</returns>
    public SalaryAnalysis AnalyzeDepartmentSalary(Department department)
    {
        if (department == null)
            throw new ArgumentNullException(nameof(department));

        if (department.Employees.Count == 0)
        {
            return new SalaryAnalysis
            {
                DepartmentName = department.Name,
                EmployeeCount = 0,
                TotalSalary = 0,
                AverageSalary = 0,
                MinSalary = 0,
                MaxSalary = 0
            };
        }

        var salaries = department.Employees.Select(e => e.Salary).ToList();

        return new SalaryAnalysis
        {
            DepartmentName = department.Name,
            EmployeeCount = department.Employees.Count,
            TotalSalary = salaries.Sum(),
            AverageSalary = salaries.Average(),
            MinSalary = salaries.Min(),
            MaxSalary = salaries.Max()
        };
    }

    /// <summary>
    /// 建立員工報告
    /// </summary>
    /// <param name="employees">員工列表</param>
    /// <returns>報告</returns>
    public EmployeeReport GenerateEmployeeReport(IEnumerable<Employee> employees)
    {
        if (employees == null)
            throw new ArgumentNullException(nameof(employees));

        var employeeList = employees.ToList();

        return new EmployeeReport
        {
            GeneratedAt = DateTime.UtcNow,
            TotalEmployees = employeeList.Count,
            TotalSalary = employeeList.Sum(e => e.Salary),
            DepartmentBreakdown = employeeList
                .Where(e => e.Department != null)
                .GroupBy(e => e.Department!.Name)
                .ToDictionary(g => g.Key, g => g.Count()),
            SkillsDistribution = employeeList
                .SelectMany(e => e.Skills)
                .GroupBy(s => s)
                .ToDictionary(g => g.Key, g => g.Count())
        };
    }

    private static bool IsValidEmail(string email)
    {
        try
        {
            var addr = new System.Net.Mail.MailAddress(email);
            return addr.Address == email;
        }
        catch
        {
            return false;
        }
    }
}

/// <summary>
/// 驗證結果
/// </summary>
public class ValidationResult
{
    public bool IsValid { get; set; }
    public List<string> Errors { get; set; } = new();
}

/// <summary>
/// 薪資分析結果
/// </summary>
public class SalaryAnalysis
{
    public string DepartmentName { get; set; } = string.Empty;
    public int EmployeeCount { get; set; }
    public decimal TotalSalary { get; set; }
    public decimal AverageSalary { get; set; }
    public decimal MinSalary { get; set; }
    public decimal MaxSalary { get; set; }
}

/// <summary>
/// 員工報告
/// </summary>
public class EmployeeReport
{
    public DateTime GeneratedAt { get; set; }
    public int TotalEmployees { get; set; }
    public decimal TotalSalary { get; set; }
    public Dictionary<string, int> DepartmentBreakdown { get; set; } = new();
    public Dictionary<string, int> SkillsDistribution { get; set; } = new();
}
