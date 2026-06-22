using System.Text.Json;
using Practice.Integration.WebApi.Net8.Interfaces;
using StackExchange.Redis;

namespace Practice.Integration.WebApi.Net8.Services;

/// <summary>
/// Redis 快取服務實作
/// </summary>
public class RedisCacheService : ICacheService
{
    private readonly IDatabase _database;

    public RedisCacheService(IConnectionMultiplexer connectionMultiplexer)
    {
        _database = connectionMultiplexer.GetDatabase();
    }

    /// <summary>
    /// 取得快取值
    /// </summary>
    public async Task<T?> GetAsync<T>(string key) where T : class
    {
        var value = await _database.StringGetAsync(key);

        if (value.IsNullOrEmpty)
        {
            return null;
        }

        return JsonSerializer.Deserialize<T>(value!);
    }

    /// <summary>
    /// 設定快取值
    /// </summary>
    public async Task SetAsync<T>(string key, T value, TimeSpan? expiry = null) where T : class
    {
        var serialized = JsonSerializer.Serialize(value);
        await _database.StringSetAsync(key, serialized, expiry);
    }

    /// <summary>
    /// 刪除快取值
    /// </summary>
    public async Task RemoveAsync(string key)
    {
        await _database.KeyDeleteAsync(key);
    }

    /// <summary>
    /// 檢查快取鍵是否存在
    /// </summary>
    public async Task<bool> ExistsAsync(string key)
    {
        return await _database.KeyExistsAsync(key);
    }
}
