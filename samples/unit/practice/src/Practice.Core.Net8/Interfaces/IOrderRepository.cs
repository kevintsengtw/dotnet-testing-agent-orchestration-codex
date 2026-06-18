using Practice.Core.Net8.Models;

namespace Practice.Core.Net8.Interfaces;

/// <summary>
/// 訂單儲存庫介面 - Phase 5 練習：跨技能整合
/// </summary>
public interface IOrderRepository
{
    /// <summary>
    /// 儲存訂單
    /// </summary>
    /// <param name="order">訂單</param>
    Task SaveAsync(Order order);

    /// <summary>
    /// 取得訂單
    /// </summary>
    /// <param name="orderId">訂單識別碼</param>
    /// <returns>訂單</returns>
    Task<Order?> GetByIdAsync(Guid orderId);

    /// <summary>
    /// 更新訂單狀態
    /// </summary>
    /// <param name="orderId">訂單識別碼</param>
    /// <param name="status">新狀態</param>
    Task UpdateStatusAsync(Guid orderId, OrderStatus status);
}
