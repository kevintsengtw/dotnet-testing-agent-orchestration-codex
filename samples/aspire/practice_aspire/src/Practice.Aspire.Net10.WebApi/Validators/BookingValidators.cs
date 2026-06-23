using FluentValidation;
using Practice.Aspire.Net10.WebApi.Models;

namespace Practice.Aspire.Net10.WebApi.Validators;

/// <summary>
/// 建立預約請求驗證器
/// </summary>
public class CreateBookingRequestValidator : AbstractValidator<CreateBookingRequest>
{
    public CreateBookingRequestValidator()
    {
        RuleFor(x => x.GuestName)
            .NotEmpty().WithMessage("旅客姓名不可為空")
            .MaximumLength(200).WithMessage("旅客姓名不能超過 200 個字元");

        RuleFor(x => x.GuestEmail)
            .NotEmpty().WithMessage("旅客電子郵件不可為空")
            .EmailAddress().WithMessage("旅客電子郵件格式不正確")
            .MaximumLength(320).WithMessage("旅客電子郵件不能超過 320 個字元");

        RuleFor(x => x.RoomNumber)
            .NotEmpty().WithMessage("房間號碼不可為空")
            .MaximumLength(20).WithMessage("房間號碼不能超過 20 個字元");

        RuleFor(x => x.CheckInDate)
            .NotEmpty().WithMessage("入住日期不可為空")
            .GreaterThanOrEqualTo(DateTime.Today).WithMessage("入住日期不可早於今日");

        RuleFor(x => x.CheckOutDate)
            .NotEmpty().WithMessage("退房日期不可為空")
            .GreaterThan(x => x.CheckInDate).WithMessage("退房日期必須晚於入住日期");

        RuleFor(x => x.TotalPrice)
            .GreaterThan(0).WithMessage("總金額必須大於 0");

        RuleFor(x => x.Notes)
            .MaximumLength(1000).WithMessage("備註不能超過 1000 個字元")
            .When(x => !string.IsNullOrEmpty(x.Notes));
    }
}

/// <summary>
/// 更新預約請求驗證器
/// </summary>
public class UpdateBookingRequestValidator : AbstractValidator<UpdateBookingRequest>
{
    public UpdateBookingRequestValidator()
    {
        RuleFor(x => x.GuestName)
            .NotEmpty().WithMessage("旅客姓名不可為空")
            .MaximumLength(200).WithMessage("旅客姓名不能超過 200 個字元");

        RuleFor(x => x.GuestEmail)
            .NotEmpty().WithMessage("旅客電子郵件不可為空")
            .EmailAddress().WithMessage("旅客電子郵件格式不正確")
            .MaximumLength(320).WithMessage("旅客電子郵件不能超過 320 個字元");

        RuleFor(x => x.RoomNumber)
            .NotEmpty().WithMessage("房間號碼不可為空")
            .MaximumLength(20).WithMessage("房間號碼不能超過 20 個字元");

        RuleFor(x => x.CheckInDate)
            .NotEmpty().WithMessage("入住日期不可為空");

        RuleFor(x => x.CheckOutDate)
            .NotEmpty().WithMessage("退房日期不可為空")
            .GreaterThan(x => x.CheckInDate).WithMessage("退房日期必須晚於入住日期");

        RuleFor(x => x.TotalPrice)
            .GreaterThan(0).WithMessage("總金額必須大於 0");

        RuleFor(x => x.Notes)
            .MaximumLength(1000).WithMessage("備註不能超過 1000 個字元")
            .When(x => !string.IsNullOrEmpty(x.Notes));
    }
}
