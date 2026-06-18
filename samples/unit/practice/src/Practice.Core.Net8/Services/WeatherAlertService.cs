using Practice.Core.Net8.Interfaces;
using Practice.Core.Net8.Models;

namespace Practice.Core.Net8.Services;

/// <summary>
/// 天氣警報服務 - Phase 2 練習：Mock 依賴
/// 此服務依賴 IWeatherService 和 INotificationService
/// </summary>
public class WeatherAlertService
{
    private readonly IWeatherService _weatherService;
    private readonly INotificationService _notificationService;

    public WeatherAlertService(
        IWeatherService weatherService,
        INotificationService notificationService)
    {
        _weatherService = weatherService ?? throw new ArgumentNullException(nameof(weatherService));
        _notificationService = notificationService ?? throw new ArgumentNullException(nameof(notificationService));
    }

    /// <summary>
    /// 檢查並發送高溫警報
    /// </summary>
    /// <param name="city">城市名稱</param>
    /// <param name="threshold">溫度閾值</param>
    /// <returns>是否發送了警報</returns>
    public async Task<bool> CheckAndAlertAsync(string city, double threshold)
    {
        if (string.IsNullOrWhiteSpace(city))
        {
            throw new ArgumentException("City cannot be null or empty", nameof(city));
        }

        var weather = await _weatherService.GetCurrentWeatherAsync(city);

        if (weather.Temperature > threshold)
        {
            await _notificationService.SendAlertAsync(
                $"High temperature alert in {city}: {weather.Temperature}°C");
            return true;
        }

        return false;
    }

    /// <summary>
    /// 檢查並發送警報給指定收件者
    /// </summary>
    /// <param name="city">城市名稱</param>
    /// <param name="threshold">溫度閾值</param>
    /// <param name="recipient">收件者</param>
    /// <returns>是否發送了警報</returns>
    public async Task<bool> CheckAndAlertToRecipientAsync(string city, double threshold, string recipient)
    {
        if (string.IsNullOrWhiteSpace(city))
        {
            throw new ArgumentException("City cannot be null or empty", nameof(city));
        }

        if (string.IsNullOrWhiteSpace(recipient))
        {
            throw new ArgumentException("Recipient cannot be null or empty", nameof(recipient));
        }

        // 先檢查通知服務是否可用
        var isAvailable = await _notificationService.IsAvailableAsync();
        if (!isAvailable)
        {
            throw new InvalidOperationException("Notification service is not available");
        }

        var weather = await _weatherService.GetCurrentWeatherAsync(city);

        if (weather.Temperature > threshold)
        {
            var message = $"High temperature alert in {city}: {weather.Temperature}°C";
            await _notificationService.SendAlertToAsync(recipient, message);
            return true;
        }

        return false;
    }

    /// <summary>
    /// 取得多個城市的天氣摘要
    /// </summary>
    /// <param name="cities">城市列表</param>
    /// <returns>天氣摘要字典</returns>
    public async Task<Dictionary<string, WeatherData>> GetWeatherSummaryAsync(IEnumerable<string> cities)
    {
        if (cities == null)
        {
            throw new ArgumentNullException(nameof(cities));
        }

        var result = new Dictionary<string, WeatherData>();

        foreach (var city in cities.Where(c => !string.IsNullOrWhiteSpace(c)))
        {
            var weather = await _weatherService.GetCurrentWeatherAsync(city);
            result[city] = weather;
        }

        return result;
    }

    /// <summary>
    /// 檢查未來幾天是否有極端天氣並發送警報
    /// </summary>
    /// <param name="city">城市名稱</param>
    /// <param name="days">預報天數</param>
    /// <param name="highThreshold">高溫閾值</param>
    /// <param name="lowThreshold">低溫閾值</param>
    /// <returns>發送的警報數量</returns>
    public async Task<int> CheckForecastAndAlertAsync(
        string city,
        int days,
        double highThreshold,
        double lowThreshold)
    {
        if (string.IsNullOrWhiteSpace(city))
        {
            throw new ArgumentException("City cannot be null or empty", nameof(city));
        }

        if (days <= 0)
        {
            throw new ArgumentException("Days must be greater than zero", nameof(days));
        }

        var forecasts = await _weatherService.GetForecastAsync(city, days);
        var alertCount = 0;

        foreach (var forecast in forecasts)
        {
            if (forecast.Temperature > highThreshold)
            {
                await _notificationService.SendAlertAsync(
                    $"High temperature forecast for {city} on {forecast.Timestamp:yyyy-MM-dd}: {forecast.Temperature}°C");
                alertCount++;
            }
            else if (forecast.Temperature < lowThreshold)
            {
                await _notificationService.SendAlertAsync(
                    $"Low temperature forecast for {city} on {forecast.Timestamp:yyyy-MM-dd}: {forecast.Temperature}°C");
                alertCount++;
            }
        }

        return alertCount;
    }
}
