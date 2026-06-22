using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;
using Practice.Integration.WebApi.Net8.Configuration;
using Practice.Integration.WebApi.Net8.Interfaces;
using Practice.Integration.WebApi.Net8.Models;

namespace Practice.Integration.WebApi.Net8.Services;

/// <summary>
/// MongoDB 客戶活動 Repository 實作
/// </summary>
public class MongoCustomerActivityRepository : ICustomerActivityRepository
{
    private readonly IMongoCollection<CustomerActivity> _collection;

    public MongoCustomerActivityRepository(
        IMongoDatabase database,
        IOptions<MongoDbSettings> settings)
    {
        _collection = database.GetCollection<CustomerActivity>(
            settings.Value.CustomerActivitiesCollectionName);
    }

    /// <summary>
    /// 新增客戶活動記錄
    /// </summary>
    public async Task<CustomerActivity> CreateAsync(CustomerActivity activity)
    {
        await _collection.InsertOneAsync(activity);
        return activity;
    }

    /// <summary>
    /// 根據 ID 取得客戶活動
    /// </summary>
    public async Task<CustomerActivity?> GetByIdAsync(string id)
    {
        if (!ObjectId.TryParse(id, out _))
        {
            return null;
        }

        var filter = Builders<CustomerActivity>.Filter.Eq(x => x.Id, id);
        return await _collection.Find(filter).FirstOrDefaultAsync();
    }

    /// <summary>
    /// 根據客戶 ID 取得所有活動記錄
    /// </summary>
    public async Task<IEnumerable<CustomerActivity>> GetByCustomerIdAsync(string customerId)
    {
        var filter = Builders<CustomerActivity>.Filter.Eq(x => x.CustomerId, customerId);
        var sort = Builders<CustomerActivity>.Sort.Descending(x => x.Timestamp);
        return await _collection.Find(filter).Sort(sort).ToListAsync();
    }

    /// <summary>
    /// 根據活動類型取得活動記錄
    /// </summary>
    public async Task<IEnumerable<CustomerActivity>> GetByActivityTypeAsync(string activityType)
    {
        var filter = Builders<CustomerActivity>.Filter.Eq(x => x.ActivityType, activityType);
        var sort = Builders<CustomerActivity>.Sort.Descending(x => x.Timestamp);
        return await _collection.Find(filter).Sort(sort).ToListAsync();
    }

    /// <summary>
    /// 刪除客戶活動記錄
    /// </summary>
    public async Task<bool> DeleteAsync(string id)
    {
        if (!ObjectId.TryParse(id, out _))
        {
            return false;
        }

        var filter = Builders<CustomerActivity>.Filter.Eq(x => x.Id, id);
        var result = await _collection.DeleteOneAsync(filter);
        return result.DeletedCount > 0;
    }
}
