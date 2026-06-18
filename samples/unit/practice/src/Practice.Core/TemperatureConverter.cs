namespace Practice.Core;

/// <summary>
/// 溫度轉換器 - Phase 1 練習：基礎單元測試
/// </summary>
public class TemperatureConverter
{
    /// <summary>
    /// 攝氏轉華氏
    /// </summary>
    /// <param name="celsius">攝氏溫度</param>
    /// <returns>華氏溫度</returns>
    public double CelsiusToFahrenheit(double celsius)
    {
        return celsius * 9 / 5 + 32;
    }

    /// <summary>
    /// 華氏轉攝氏
    /// </summary>
    /// <param name="fahrenheit">華氏溫度</param>
    /// <returns>攝氏溫度</returns>
    public double FahrenheitToCelsius(double fahrenheit)
    {
        return (fahrenheit - 32) * 5 / 9;
    }

    /// <summary>
    /// 攝氏轉克氏（絕對溫度）
    /// </summary>
    /// <param name="celsius">攝氏溫度</param>
    /// <returns>克氏溫度</returns>
    /// <exception cref="ArgumentException">當溫度低於絕對零度時拋出</exception>
    public double CelsiusToKelvin(double celsius)
    {
        if (celsius < -273.15)
        {
            throw new ArgumentException("Temperature cannot be below absolute zero (-273.15°C)");
        }

        return celsius + 273.15;
    }

    /// <summary>
    /// 克氏轉攝氏
    /// </summary>
    /// <param name="kelvin">克氏溫度</param>
    /// <returns>攝氏溫度</returns>
    /// <exception cref="ArgumentException">當克氏溫度為負數時拋出</exception>
    public double KelvinToCelsius(double kelvin)
    {
        if (kelvin < 0)
        {
            throw new ArgumentException("Kelvin temperature cannot be negative");
        }

        return kelvin - 273.15;
    }

    /// <summary>
    /// 判斷溫度是否為冰點以下
    /// </summary>
    /// <param name="celsius">攝氏溫度</param>
    /// <returns>是否低於冰點</returns>
    public bool IsBelowFreezing(double celsius)
    {
        return celsius < 0;
    }

    /// <summary>
    /// 判斷溫度是否為沸點以上
    /// </summary>
    /// <param name="celsius">攝氏溫度</param>
    /// <returns>是否高於沸點</returns>
    public bool IsAboveBoiling(double celsius)
    {
        return celsius > 100;
    }

    /// <summary>
    /// 取得溫度等級描述
    /// </summary>
    /// <param name="celsius">攝氏溫度</param>
    /// <returns>溫度等級描述</returns>
    public string GetTemperatureLevel(double celsius)
    {
        return celsius switch
        {
            < -20 => "極寒",
            < 0 => "寒冷",
            < 15 => "涼爽",
            < 25 => "舒適",
            < 35 => "炎熱",
            _ => "酷熱"
        };
    }
}
