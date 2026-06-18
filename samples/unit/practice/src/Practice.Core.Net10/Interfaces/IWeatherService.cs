using Practice.Core.Net10.Models;

namespace Practice.Core.Net10.Interfaces;

/// <summary>
/// 天氣服務介面 - 用於取得天氣資料
/// </summary>
public interface IWeatherService
{
    /// <summary>
    /// 取得目前天氣
    /// </summary>
    /// <param name="city">城市名稱</param>
    /// <returns>天氣資料</returns>
    Task<WeatherData> GetCurrentWeatherAsync(string city);

    /// <summary>
    /// 取得天氣預報
    /// </summary>
    /// <param name="city">城市名稱</param>
    /// <param name="days">預報天數</param>
    /// <returns>天氣預報列表</returns>
    Task<List<WeatherData>> GetForecastAsync(string city, int days);
}
