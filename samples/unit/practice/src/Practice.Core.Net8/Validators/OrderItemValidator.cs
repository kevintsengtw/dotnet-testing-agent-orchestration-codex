using FluentValidation;
using Practice.Core.Net8.Models;

namespace Practice.Core.Net8.Validators;

/// <summary>
/// 訂單項目驗證器
/// 驗證單一訂單項目的業務規則
/// </summary>
public class OrderItemValidator : AbstractValidator<OrderItem>
{
    public OrderItemValidator()
    {
        #region 產品識別碼驗證

        RuleFor(x => x.ProductId)
            .NotEmpty().WithMessage("產品識別碼不可為空");

        #endregion

        #region 產品名稱驗證

        RuleFor(x => x.ProductName)
            .NotEmpty().WithMessage("產品名稱不可為空")
            .Length(2, 100).WithMessage("產品名稱長度必須在 2 到 100 個字元之間");

        #endregion

        #region 數量驗證

        RuleFor(x => x.Quantity)
            .GreaterThan(0).WithMessage("數量必須大於 0")
            .LessThanOrEqualTo(1000).WithMessage("單一項目數量不能超過 1000");

        #endregion

        #region 單價驗證

        RuleFor(x => x.UnitPrice)
            .GreaterThan(0).WithMessage("單價必須大於 0")
            .LessThanOrEqualTo(1_000_000).WithMessage("單價不能超過 1,000,000");

        #endregion
    }
}
