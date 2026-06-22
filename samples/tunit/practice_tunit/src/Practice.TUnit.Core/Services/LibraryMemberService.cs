using Practice.TUnit.Core.Interfaces;
using Practice.TUnit.Core.Models;

namespace Practice.TUnit.Core.Services;

/// <summary>
/// 圖書館會員服務 — P3-2 驗證：Mock 依賴 + 複雜驗證邏輯
/// 需要使用 MethodDataSource / Matrix 進行多場景測試
/// </summary>
public class LibraryMemberService
{
    private readonly IMemberRepository _memberRepository;
    private readonly ILoanRepository _loanRepository;
    private readonly INotificationService _notificationService;

    public LibraryMemberService(
        IMemberRepository memberRepository,
        ILoanRepository loanRepository,
        INotificationService notificationService)
    {
        _memberRepository = memberRepository ?? throw new ArgumentNullException(nameof(memberRepository));
        _loanRepository = loanRepository ?? throw new ArgumentNullException(nameof(loanRepository));
        _notificationService = notificationService ?? throw new ArgumentNullException(nameof(notificationService));
    }

    /// <summary>
    /// 註冊新會員
    /// </summary>
    /// <param name="name">姓名</param>
    /// <param name="email">電子郵件</param>
    /// <param name="membershipType">會員類型</param>
    /// <returns>新建會員</returns>
    public async Task<LibraryMember> RegisterMemberAsync(string name, string email, MembershipType membershipType)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Name is required", nameof(name));

        if (string.IsNullOrWhiteSpace(email))
            throw new ArgumentException("Email is required", nameof(email));

        if (!IsValidEmail(email))
            throw new ArgumentException("Invalid email format", nameof(email));

        var existingMember = await _memberRepository.GetByEmailAsync(email);
        if (existingMember != null)
            throw new InvalidOperationException($"Member with email '{email}' already exists");

        var member = new LibraryMember
        {
            Id = Guid.NewGuid(),
            Name = name,
            Email = email,
            MembershipType = membershipType,
            JoinDate = DateTime.UtcNow,
            IsActive = true
        };

        await _memberRepository.AddAsync(member);
        return member;
    }

    /// <summary>
    /// 驗證會員資料
    /// </summary>
    /// <param name="member">會員</param>
    /// <returns>驗證結果</returns>
    public MemberValidationResult ValidateMember(LibraryMember member)
    {
        if (member == null)
            throw new ArgumentNullException(nameof(member));

        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(member.Name))
            errors.Add("Name is required");
        else if (member.Name.Length < 2)
            errors.Add("Name must be at least 2 characters");
        else if (member.Name.Length > 100)
            errors.Add("Name must not exceed 100 characters");

        if (string.IsNullOrWhiteSpace(member.Email))
            errors.Add("Email is required");
        else if (!IsValidEmail(member.Email))
            errors.Add("Email format is invalid");

        if (member.JoinDate > DateTime.UtcNow)
            errors.Add("Join date cannot be in the future");

        if (member.PhoneNumber != null && member.PhoneNumber.Length < 8)
            errors.Add("Phone number must be at least 8 digits");

        return new MemberValidationResult
        {
            IsValid = errors.Count == 0,
            Errors = errors
        };
    }

    /// <summary>
    /// 升級會員等級
    /// </summary>
    /// <param name="memberId">會員 ID</param>
    /// <param name="newType">新會員類型</param>
    /// <returns>升級後的會員</returns>
    public async Task<LibraryMember> UpgradeMembershipAsync(Guid memberId, MembershipType newType)
    {
        var member = await _memberRepository.GetByIdAsync(memberId)
                     ?? throw new KeyNotFoundException($"Member '{memberId}' not found");

        if (!member.IsActive)
            throw new InvalidOperationException("Cannot upgrade inactive member");

        if (newType <= member.MembershipType)
            throw new InvalidOperationException(
                $"New type '{newType}' must be higher than current type '{member.MembershipType}'");

        member.MembershipType = newType;
        await _memberRepository.UpdateAsync(member);

        return member;
    }

    /// <summary>
    /// 檢查會員是否可借閱
    /// </summary>
    /// <param name="memberId">會員 ID</param>
    /// <returns>是否可借閱及原因</returns>
    public async Task<(bool CanBorrow, string? Reason)> CanBorrowAsync(Guid memberId)
    {
        var member = await _memberRepository.GetByIdAsync(memberId);
        if (member == null)
            return (false, "Member not found");

        if (!member.IsActive)
            return (false, "Member account is inactive");

        var activeLoans = await _loanRepository.GetActiveLoansByMemberAsync(memberId);
        if (activeLoans.Count >= member.MaxBooksAllowed)
            return (false, $"Maximum loan limit reached ({member.MaxBooksAllowed} books)");

        var hasOverdue = activeLoans.Any(l => l.Status == LoanStatus.Overdue);
        if (hasOverdue)
            return (false, "Member has overdue books");

        return (true, null);
    }

    /// <summary>
    /// 計算會員年費
    /// </summary>
    /// <param name="membershipType">會員類型</param>
    /// <param name="isRenewal">是否為續約</param>
    /// <returns>年費金額</returns>
    public decimal CalculateAnnualFee(MembershipType membershipType, bool isRenewal)
    {
        var baseFee = membershipType switch
        {
            MembershipType.Basic => 0m,
            MembershipType.Premium => 500m,
            MembershipType.Vip => 1200m,
            _ => throw new ArgumentOutOfRangeException(nameof(membershipType))
        };

        // 續約享 9 折優惠
        return isRenewal ? baseFee * 0.9m : baseFee;
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
/// 會員驗證結果
/// </summary>
public class MemberValidationResult
{
    public bool IsValid { get; set; }
    public List<string> Errors { get; set; } = new();
}
