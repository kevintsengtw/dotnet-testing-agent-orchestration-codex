using Practice.Core.Net10.Legacy;

namespace Practice.Core.Net10.Interfaces;

/// <summary>
/// 使用者資料儲存庫介面 - Phase 6 用於取代 Database.GetUser()
/// </summary>
public interface IUserRepository
{
    /// <summary>
    /// 依 ID 取得使用者
    /// </summary>
    /// <param name="userId">使用者 ID</param>
    /// <returns>使用者紀錄</returns>
    UserRecord GetUser(int userId);
}
