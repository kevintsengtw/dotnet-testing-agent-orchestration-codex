using Practice.Core.Net8.Models;

namespace Practice.Core.Net8.Interfaces;

/// <summary>
/// 付款閘道介面 - Phase 5 練習：跨技能整合
/// </summary>
public interface IPaymentGateway
{
    /// <summary>
    /// 處理付款
    /// </summary>
    /// <param name="customerId">客戶識別碼</param>
    /// <param name="amount">金額</param>
    /// <returns>付款結果</returns>
    Task<PaymentResult> ChargeAsync(string customerId, decimal amount);

    /// <summary>
    /// 退款
    /// </summary>
    /// <param name="transactionId">交易識別碼</param>
    /// <param name="amount">金額</param>
    /// <returns>退款結果</returns>
    Task<PaymentResult> RefundAsync(string transactionId, decimal amount);
}
