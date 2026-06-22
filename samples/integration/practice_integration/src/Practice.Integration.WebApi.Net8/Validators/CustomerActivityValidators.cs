using FluentValidation;
using Practice.Integration.WebApi.Net8.Models;

namespace Practice.Integration.WebApi.Net8.Validators;

/// <summary>
/// 建立客戶活動請求驗證器
/// </summary>
public class CreateCustomerActivityRequestValidator : AbstractValidator<CreateCustomerActivityRequest>
{
    private static readonly string[] ValidActivityTypes = ["View", "Search", "Purchase", "Login"];

    public CreateCustomerActivityRequestValidator()
    {
        RuleFor(x => x.CustomerId)
            .NotEmpty().WithMessage("客戶識別碼不可為空")
            .MaximumLength(100).WithMessage("客戶識別碼不能超過 100 個字元");

        RuleFor(x => x.ActivityType)
            .NotEmpty().WithMessage("活動類型不可為空")
            .Must(type => ValidActivityTypes.Contains(type))
            .WithMessage($"活動類型必須為: {string.Join(", ", ValidActivityTypes)}");

        RuleFor(x => x.Description)
            .NotEmpty().WithMessage("活動描述不可為空")
            .MaximumLength(500).WithMessage("活動描述不能超過 500 個字元");
    }
}
