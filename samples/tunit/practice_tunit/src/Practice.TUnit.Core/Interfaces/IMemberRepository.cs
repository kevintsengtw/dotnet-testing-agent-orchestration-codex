using Practice.TUnit.Core.Models;

namespace Practice.TUnit.Core.Interfaces;

/// <summary>
/// 會員資料存取介面
/// </summary>
public interface IMemberRepository
{
    /// <summary>依 ID 取得會員</summary>
    Task<LibraryMember?> GetByIdAsync(Guid id);

    /// <summary>依 Email 取得會員</summary>
    Task<LibraryMember?> GetByEmailAsync(string email);

    /// <summary>取得所有會員</summary>
    Task<IReadOnlyList<LibraryMember>> GetAllAsync();

    /// <summary>新增會員</summary>
    Task AddAsync(LibraryMember member);

    /// <summary>更新會員</summary>
    Task UpdateAsync(LibraryMember member);
}
