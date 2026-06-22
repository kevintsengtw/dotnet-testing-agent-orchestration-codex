using Practice.TUnit.Core.Models;

namespace Practice.TUnit.Core.Interfaces;

/// <summary>
/// 書籍資料存取介面
/// </summary>
public interface IBookRepository
{
    /// <summary>依 ID 取得書籍</summary>
    Task<Book?> GetByIdAsync(Guid id);

    /// <summary>依 ISBN 取得書籍</summary>
    Task<Book?> GetByIsbnAsync(string isbn);

    /// <summary>取得所有書籍</summary>
    Task<IReadOnlyList<Book>> GetAllAsync();

    /// <summary>依類型取得書籍</summary>
    Task<IReadOnlyList<Book>> GetByGenreAsync(BookGenre genre);

    /// <summary>新增書籍</summary>
    Task AddAsync(Book book);

    /// <summary>更新書籍</summary>
    Task UpdateAsync(Book book);

    /// <summary>刪除書籍</summary>
    Task DeleteAsync(Guid id);
}
