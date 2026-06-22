namespace Practice.Integration.WebApi.Net8.Interfaces;

/// <summary>
/// 快取服務介面 - Redis 資料存取
/// </summary>
public interface ICacheService
{
    /// <summary>
    /// 取得快取值
    /// </summary>
    Task<T?> GetAsync<T>(string key) where T : class;

    /// <summary>
    /// 設定快取值
    /// </summary>
    Task SetAsync<T>(string key, T value, TimeSpan? expiry = null) where T : class;

    /// <summary>
    /// 刪除快取值
    /// </summary>
    Task RemoveAsync(string key);

    /// <summary>
    /// 檢查快取鍵是否存在
    /// </summary>
    Task<bool> ExistsAsync(string key);
}
