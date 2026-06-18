using FluentValidation;
using Practice.Core.Net8.Models;

namespace Practice.Core.Net8.Validators;

/// <summary>
/// 員工資料驗證器
/// 展示 FluentValidation 的各種驗證模式
/// </summary>
public class EmployeeValidator : AbstractValidator<Employee>
{
    private readonly TimeProvider _timeProvider;

    /// <summary>
    /// 建立員工驗證器（使用系統時間）
    /// </summary>
    public EmployeeValidator() : this(TimeProvider.System)
    {
    }

    /// <summary>
    /// 建立員工驗證器（可注入 TimeProvider 用於測試）
    /// </summary>
    /// <param name="timeProvider">時間提供者</param>
    public EmployeeValidator(TimeProvider timeProvider)
    {
        _timeProvider = timeProvider;

        #region 基本欄位驗證

        RuleFor(x => x.FirstName)
            .NotEmpty().WithMessage("名字不可為空")
            .Length(2, 50).WithMessage("名字長度必須在 2 到 50 個字元之間");

        RuleFor(x => x.LastName)
            .NotEmpty().WithMessage("姓氏不可為空")
            .Length(2, 50).WithMessage("姓氏長度必須在 2 到 50 個字元之間");

        #endregion

        #region Email 驗證

        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("電子郵件不可為空")
            .EmailAddress().WithMessage("電子郵件格式不正確")
            .MaximumLength(100).WithMessage("電子郵件長度不能超過 100 個字元");

        #endregion

        #region 數值範圍驗證

        RuleFor(x => x.Salary)
            .GreaterThan(0).WithMessage("薪資必須大於 0")
            .LessThanOrEqualTo(10_000_000).WithMessage("薪資不能超過 10,000,000");

        #endregion

        #region 日期驗證

        RuleFor(x => x.HireDate)
            .Must(BeNotInFuture).WithMessage("入職日期不能是未來日期");

        #endregion

        #region 集合驗證

        RuleFor(x => x.Skills)
            .Must(skills => skills == null || skills.All(s => !string.IsNullOrWhiteSpace(s)))
            .WithMessage("技能項目不可為空白")
            .When(x => x.Skills != null && x.Skills.Count > 0);

        #endregion
    }

    /// <summary>
    /// 檢查日期是否不在未來
    /// </summary>
    private bool BeNotInFuture(DateTime date)
    {
        var today = _timeProvider.GetLocalNow().Date;
        return date.Date <= today;
    }
}
