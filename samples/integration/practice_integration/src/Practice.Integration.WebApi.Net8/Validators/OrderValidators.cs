using FluentValidation;
using Practice.Integration.WebApi.Net8.Models;

namespace Practice.Integration.WebApi.Net8.Validators;

/// <summary>
/// 建立訂單請求驗證器
/// </summary>
public class CreateOrderRequestValidator : AbstractValidator<CreateOrderRequest>
{
    public CreateOrderRequestValidator()
    {
        RuleFor(x => x.CustomerName)
            .NotEmpty().WithMessage("客戶名稱不可為空")
            .MaximumLength(200).WithMessage("客戶名稱不能超過 200 個字元");

        RuleFor(x => x.CustomerEmail)
            .NotEmpty().WithMessage("客戶電子郵件不可為空")
            .EmailAddress().WithMessage("客戶電子郵件格式不正確")
            .MaximumLength(320).WithMessage("客戶電子郵件不能超過 320 個字元");

        RuleFor(x => x.TotalAmount)
            .GreaterThan(0).WithMessage("訂單金額必須大於 0");

        RuleFor(x => x.Notes)
            .MaximumLength(1000).WithMessage("備註不能超過 1000 個字元")
            .When(x => !string.IsNullOrEmpty(x.Notes));
    }
}

/// <summary>
/// 更新訂單請求驗證器
/// </summary>
public class UpdateOrderRequestValidator : AbstractValidator<UpdateOrderRequest>
{
    public UpdateOrderRequestValidator()
    {
        RuleFor(x => x.CustomerName)
            .NotEmpty().WithMessage("客戶名稱不可為空")
            .MaximumLength(200).WithMessage("客戶名稱不能超過 200 個字元");

        RuleFor(x => x.CustomerEmail)
            .NotEmpty().WithMessage("客戶電子郵件不可為空")
            .EmailAddress().WithMessage("客戶電子郵件格式不正確")
            .MaximumLength(320).WithMessage("客戶電子郵件不能超過 320 個字元");

        RuleFor(x => x.TotalAmount)
            .GreaterThan(0).WithMessage("訂單金額必須大於 0");

        RuleFor(x => x.Notes)
            .MaximumLength(1000).WithMessage("備註不能超過 1000 個字元")
            .When(x => !string.IsNullOrEmpty(x.Notes));
    }
}
