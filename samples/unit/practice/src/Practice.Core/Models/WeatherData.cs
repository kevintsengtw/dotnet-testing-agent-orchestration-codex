namespace Practice.Core.Models;

/// <summary>
/// 天氣資料模型 - Phase 2 練習：Mock 依賴
/// </summary>
public class WeatherData
{
    /// <summary>
    /// 城市名稱
    /// </summary>
    public string City { get; set; } = string.Empty;

    /// <summary>
    /// 溫度（攝氏）
    /// </summary>
    public double Temperature { get; set; }

    /// <summary>
    /// 濕度（百分比）
    /// </summary>
    public double Humidity { get; set; }

    /// <summary>
    /// 天氣描述
    /// </summary>
    public string Description { get; set; } = string.Empty;

    /// <summary>
    /// 資料時間戳記
    /// </summary>
    public DateTime Timestamp { get; set; }
}
