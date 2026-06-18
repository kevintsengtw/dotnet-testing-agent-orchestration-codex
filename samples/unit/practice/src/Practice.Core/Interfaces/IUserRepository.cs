using Practice.Core.Legacy;

namespace Practice.Core.Interfaces;

/// <summary>
/// 使用者資料存取介面 - Phase 6 練習：重構遺留程式碼
/// 用於替代靜態 Database.GetUser() 方法
/// </summary>
public interface IUserRepository
{
    /// <summary>
    /// 取得使用者資料
    /// </summary>
    /// <param name="userId">使用者 ID</param>
    /// <returns>使用者記錄</returns>
    UserRecord GetUser(int userId);

    /// <summary>
    /// 檢查使用者是否存在
    /// </summary>
    /// <param name="userId">使用者 ID</param>
    /// <returns>是否存在</returns>
    bool UserExists(int userId);
}
