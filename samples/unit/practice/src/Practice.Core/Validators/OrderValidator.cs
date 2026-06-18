using FluentValidation;
using Practice.Core.Models;

namespace Practice.Core.Validators;

/// <summary>
/// 訂單驗證器
/// 展示巢狀集合驗證、跨欄位驗證等進階模式
/// </summary>
public class OrderValidator : AbstractValidator<Order>
{
    private readonly TimeProvider _timeProvider;

    /// <summary>
    /// 建立訂單驗證器（使用系統時間）
    /// </summary>
    public OrderValidator() : this(TimeProvider.System)
    {
    }

    /// <summary>
    /// 建立訂單驗證器（可注入 TimeProvider 用於測試）
    /// </summary>
    /// <param name="timeProvider">時間提供者</param>
    public OrderValidator(TimeProvider timeProvider)
    {
        _timeProvider = timeProvider;

        #region 客戶識別碼驗證

        RuleFor(x => x.CustomerId)
            .NotEmpty().WithMessage("客戶識別碼不可為空")
            .MaximumLength(50).WithMessage("客戶識別碼長度不能超過 50 個字元");

        #endregion

        #region 客戶電子郵件驗證

        RuleFor(x => x.CustomerEmail)
            .NotEmpty().WithMessage("客戶電子郵件不可為空")
            .EmailAddress().WithMessage("客戶電子郵件格式不正確");

        #endregion

        #region 訂單項目集合驗證

        RuleFor(x => x.Items)
            .NotEmpty().WithMessage("訂單至少需要一個項目");

        RuleForEach(x => x.Items)
            .SetValidator(new OrderItemValidator());

        #endregion

        #region 建立時間驗證

        RuleFor(x => x.CreatedAt)
            .Must(BeNotInFuture).WithMessage("訂單建立時間不能是未來時間");

        #endregion

        #region 跨欄位驗證：處理時間必須晚於建立時間

        RuleFor(x => x.ProcessedAt)
            .Must((order, processedAt) => BeAfterCreatedAt(order.CreatedAt, processedAt))
            .WithMessage("訂單處理時間必須晚於建立時間")
            .When(x => x.ProcessedAt.HasValue);

        #endregion

        #region 狀態相關驗證

        // 已完成的訂單必須有處理時間
        RuleFor(x => x.ProcessedAt)
            .NotNull().WithMessage("已完成的訂單必須有處理時間")
            .When(x => x.Status == OrderStatus.Completed);

        #endregion
    }

    /// <summary>
    /// 檢查時間是否不在未來
    /// </summary>
    private bool BeNotInFuture(DateTimeOffset dateTime)
    {
        var now = _timeProvider.GetUtcNow();
        return dateTime <= now;
    }

    /// <summary>
    /// 檢查處理時間是否晚於建立時間
    /// </summary>
    private static bool BeAfterCreatedAt(DateTimeOffset createdAt, DateTimeOffset? processedAt)
    {
        if (!processedAt.HasValue)
            return true;

        return processedAt.Value > createdAt;
    }
}
