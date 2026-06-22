namespace Practice.TUnit.Core.Models;

/// <summary>
/// 會員類型
/// </summary>
public enum MembershipType
{
    /// <summary>基本會員</summary>
    Basic,

    /// <summary>進階會員</summary>
    Premium,

    /// <summary>VIP 會員</summary>
    Vip
}

/// <summary>
/// 圖書館會員模型
/// </summary>
public class LibraryMember
{
    /// <summary>會員唯一識別碼</summary>
    public Guid Id { get; set; }

    /// <summary>會員姓名</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>電子郵件</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>會員類型</summary>
    public MembershipType MembershipType { get; set; } = MembershipType.Basic;

    /// <summary>加入日期</summary>
    public DateTime JoinDate { get; set; }

    /// <summary>最大可借閱數量</summary>
    public int MaxBooksAllowed => MembershipType switch
    {
        MembershipType.Basic => 3,
        MembershipType.Premium => 7,
        MembershipType.Vip => 15,
        _ => 3
    };

    /// <summary>借閱期限（天數）</summary>
    public int LoanPeriodDays => MembershipType switch
    {
        MembershipType.Basic => 14,
        MembershipType.Premium => 21,
        MembershipType.Vip => 30,
        _ => 14
    };

    /// <summary>是否啟用</summary>
    public bool IsActive { get; set; } = true;

    /// <summary>聯絡電話</summary>
    public string? PhoneNumber { get; set; }
}
