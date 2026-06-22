using Practice.Integration.WebApi.Net10.Models;

namespace Practice.Integration.WebApi.Net10.Interfaces;

/// <summary>
/// 客戶活動 Repository 介面 - MongoDB 資料存取
/// </summary>
public interface ICustomerActivityRepository
{
    /// <summary>
    /// 新增客戶活動記錄
    /// </summary>
    Task<CustomerActivity> CreateAsync(CustomerActivity activity);

    /// <summary>
    /// 根據 ID 取得客戶活動
    /// </summary>
    Task<CustomerActivity?> GetByIdAsync(string id);

    /// <summary>
    /// 根據客戶 ID 取得所有活動記錄
    /// </summary>
    Task<IEnumerable<CustomerActivity>> GetByCustomerIdAsync(string customerId);

    /// <summary>
    /// 根據活動類型取得活動記錄
    /// </summary>
    Task<IEnumerable<CustomerActivity>> GetByActivityTypeAsync(string activityType);

    /// <summary>
    /// 刪除客戶活動記錄
    /// </summary>
    Task<bool> DeleteAsync(string id);
}
