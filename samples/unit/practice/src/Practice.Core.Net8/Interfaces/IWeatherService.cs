using Practice.Core.Net8.Models;

namespace Practice.Core.Net8.Interfaces;

/// <summary>
/// 天氣服務介面 - Phase 2 練習：Mock 依賴
/// </summary>
public interface IWeatherService
{
    /// <summary>
    /// 取得指定城市的當前天氣
    /// </summary>
    /// <param name="city">城市名稱</param>
    /// <returns>天氣資料</returns>
    Task<WeatherData> GetCurrentWeatherAsync(string city);

    /// <summary>
    /// 取得指定城市的天氣預報
    /// </summary>
    /// <param name="city">城市名稱</param>
    /// <param name="days">預報天數</param>
    /// <returns>天氣資料列表</returns>
    Task<IEnumerable<WeatherData>> GetForecastAsync(string city, int days);
}
