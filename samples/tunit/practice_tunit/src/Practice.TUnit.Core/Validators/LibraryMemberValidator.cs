using FluentValidation;
using Practice.TUnit.Core.Models;

namespace Practice.TUnit.Core.Validators;

/// <summary>
/// 圖書館會員驗證器 — 展示 FluentValidation 欄位驗證 + 跨欄位驗證
/// </summary>
public class LibraryMemberValidator : AbstractValidator<LibraryMember>
{
    private readonly TimeProvider _timeProvider;

    public LibraryMemberValidator() : this(TimeProvider.System) { }

    public LibraryMemberValidator(TimeProvider timeProvider)
    {
        _timeProvider = timeProvider;

        // ── 基本欄位 ──
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("會員姓名不可為空")
            .Length(2, 50).WithMessage("會員姓名長度必須在 2 到 50 個字元之間");

        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("電子郵件不可為空")
            .EmailAddress().WithMessage("電子郵件格式不正確")
            .MaximumLength(100).WithMessage("電子郵件長度不能超過 100 個字元");

        RuleFor(x => x.MembershipType)
            .IsInEnum().WithMessage("會員類型不正確");

        // 電話(選填,有填才驗格式)
        RuleFor(x => x.PhoneNumber)
            .Matches(@"^09\d{8}$").WithMessage("電話格式必須為 09 開頭共 10 碼")
            .When(x => !string.IsNullOrEmpty(x.PhoneNumber));

        // 日期(需 TimeProvider)
        RuleFor(x => x.JoinDate)
            .NotEmpty().WithMessage("加入日期不可為空")
            .Must(BeNotInFuture).WithMessage("加入日期不可為未來時間");

        // ── 跨欄位 1:Vip 會員必須是資深會員(JoinDate 早於現在 1 年以上)──
        RuleFor(x => x.JoinDate)
            .Must((member, joinDate) => BeSeniorEnoughForVip(joinDate))
            .WithMessage("Vip 會員的加入日期必須早於一年前(需為資深會員)")
            .When(x => x.MembershipType == MembershipType.Vip);

        // ── 跨欄位 2:Premium / Vip 會員必須提供電話 ──
        RuleFor(x => x.PhoneNumber)
            .NotEmpty().WithMessage("Premium 與 Vip 會員必須提供電話")
            .When(x => x.MembershipType is MembershipType.Premium or MembershipType.Vip);
    }

    private bool BeNotInFuture(DateTime date)
        => date <= _timeProvider.GetUtcNow().UtcDateTime;

    private bool BeSeniorEnoughForVip(DateTime joinDate)
        => joinDate <= _timeProvider.GetUtcNow().UtcDateTime.AddYears(-1);
}
