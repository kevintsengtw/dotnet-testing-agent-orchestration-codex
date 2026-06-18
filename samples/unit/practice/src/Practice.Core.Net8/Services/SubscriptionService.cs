using Practice.Core.Net8.Models;

namespace Practice.Core.Net8.Services;

/// <summary>
/// 訂閱服務 - Phase 4 練習：TimeProvider
/// 使用 TimeProvider 抽象化時間依賴
/// </summary>
public class SubscriptionService
{
    private readonly TimeProvider _timeProvider;

    public SubscriptionService(TimeProvider timeProvider)
    {
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
    }

    /// <summary>
    /// 檢查訂閱是否在有效期內
    /// </summary>
    /// <param name="subscription">訂閱</param>
    /// <returns>是否有效</returns>
    public bool IsSubscriptionActive(Subscription subscription)
    {
        if (subscription == null)
            throw new ArgumentNullException(nameof(subscription));

        var now = _timeProvider.GetUtcNow();
        return subscription.StartDate <= now && now <= subscription.EndDate;
    }

    /// <summary>
    /// 計算訂閱剩餘天數
    /// </summary>
    /// <param name="subscription">訂閱</param>
    /// <returns>剩餘天數（已過期回傳 0）</returns>
    public int GetRemainingDays(Subscription subscription)
    {
        if (subscription == null)
            throw new ArgumentNullException(nameof(subscription));

        var now = _timeProvider.GetUtcNow();
        if (now > subscription.EndDate)
            return 0;

        return (subscription.EndDate - now).Days;
    }

    /// <summary>
    /// 檢查訂閱是否即將過期（7 天內）
    /// </summary>
    /// <param name="subscription">訂閱</param>
    /// <returns>是否即將過期</returns>
    public bool IsExpiringSoon(Subscription subscription)
    {
        if (subscription == null)
            throw new ArgumentNullException(nameof(subscription));

        var now = _timeProvider.GetUtcNow();
        if (now > subscription.EndDate)
            return false;

        var daysRemaining = (subscription.EndDate - now).Days;
        return daysRemaining <= 7 && daysRemaining >= 0;
    }

    /// <summary>
    /// 計算訂閱已使用的天數
    /// </summary>
    /// <param name="subscription">訂閱</param>
    /// <returns>已使用天數</returns>
    public int GetUsedDays(Subscription subscription)
    {
        if (subscription == null)
            throw new ArgumentNullException(nameof(subscription));

        var now = _timeProvider.GetUtcNow();
        if (now < subscription.StartDate)
            return 0;

        var endPoint = now > subscription.EndDate ? subscription.EndDate : now;
        return (endPoint - subscription.StartDate).Days;
    }

    /// <summary>
    /// 計算訂閱使用比例
    /// </summary>
    /// <param name="subscription">訂閱</param>
    /// <returns>使用比例（0-1）</returns>
    public double GetUsagePercentage(Subscription subscription)
    {
        if (subscription == null)
            throw new ArgumentNullException(nameof(subscription));

        var totalDays = (subscription.EndDate - subscription.StartDate).TotalDays;
        if (totalDays <= 0)
            return 1.0;

        var usedDays = GetUsedDays(subscription);
        return Math.Min(usedDays / totalDays, 1.0);
    }

    /// <summary>
    /// 續訂訂閱
    /// </summary>
    /// <param name="subscription">原訂閱</param>
    /// <param name="durationDays">續訂天數</param>
    /// <returns>新訂閱</returns>
    public Subscription RenewSubscription(Subscription subscription, int durationDays)
    {
        if (subscription == null)
            throw new ArgumentNullException(nameof(subscription));

        if (durationDays <= 0)
            throw new ArgumentException("Duration must be greater than zero", nameof(durationDays));

        var now = _timeProvider.GetUtcNow();

        // 如果原訂閱還未過期，從原結束日期開始；否則從現在開始
        var newStartDate = subscription.EndDate > now ? subscription.EndDate : now;

        return new Subscription
        {
            Id = Guid.NewGuid(),
            UserId = subscription.UserId,
            PlanName = subscription.PlanName,
            StartDate = newStartDate,
            EndDate = newStartDate.AddDays(durationDays),
            AutoRenew = subscription.AutoRenew,
            Price = subscription.Price
        };
    }

    /// <summary>
    /// 取得訂閱狀態描述
    /// </summary>
    /// <param name="subscription">訂閱</param>
    /// <returns>狀態描述</returns>
    public string GetSubscriptionStatus(Subscription subscription)
    {
        if (subscription == null)
            throw new ArgumentNullException(nameof(subscription));

        var now = _timeProvider.GetUtcNow();

        if (now < subscription.StartDate)
            return "尚未開始";

        if (now > subscription.EndDate)
            return "已過期";

        var remainingDays = GetRemainingDays(subscription);
        if (remainingDays <= 7)
            return $"即將到期（剩餘 {remainingDays} 天）";

        return "有效";
    }
}
