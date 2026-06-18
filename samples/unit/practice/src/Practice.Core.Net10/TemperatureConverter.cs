namespace Practice.Core.Net10;

/// <summary>
/// 溫度轉換器 - Phase 1 練習：Pure Function 測試
/// 適合用來練習基本的單元測試技巧：
/// - 正常值測試
/// - 邊界值測試
/// - 例外處理測試
/// - 等價類別劃分
/// </summary>
public class TemperatureConverter
{
    /// <summary>
    /// 絕對零度（攝氏）
    /// </summary>
    public const double AbsoluteZeroCelsius = -273.15;

    /// <summary>
    /// 絕對零度（華氏）
    /// </summary>
    public const double AbsoluteZeroFahrenheit = -459.67;

    /// <summary>
    /// 攝氏轉華氏
    /// </summary>
    /// <param name="celsius">攝氏溫度</param>
    /// <returns>華氏溫度</returns>
    /// <exception cref="ArgumentOutOfRangeException">低於絕對零度時擲出</exception>
    public double CelsiusToFahrenheit(double celsius)
    {
        if (celsius < AbsoluteZeroCelsius)
            throw new ArgumentOutOfRangeException(nameof(celsius),
                $"Temperature cannot be below absolute zero ({AbsoluteZeroCelsius}°C)");

        return celsius * 9.0 / 5.0 + 32;
    }

    /// <summary>
    /// 華氏轉攝氏
    /// </summary>
    /// <param name="fahrenheit">華氏溫度</param>
    /// <returns>攝氏溫度</returns>
    /// <exception cref="ArgumentOutOfRangeException">低於絕對零度時擲出</exception>
    public double FahrenheitToCelsius(double fahrenheit)
    {
        if (fahrenheit < AbsoluteZeroFahrenheit)
            throw new ArgumentOutOfRangeException(nameof(fahrenheit),
                $"Temperature cannot be below absolute zero ({AbsoluteZeroFahrenheit}°F)");

        return (fahrenheit - 32) * 5.0 / 9.0;
    }

    /// <summary>
    /// 攝氏轉開爾文
    /// </summary>
    /// <param name="celsius">攝氏溫度</param>
    /// <returns>開爾文溫度</returns>
    /// <exception cref="ArgumentOutOfRangeException">低於絕對零度時擲出</exception>
    public double CelsiusToKelvin(double celsius)
    {
        if (celsius < AbsoluteZeroCelsius)
            throw new ArgumentOutOfRangeException(nameof(celsius),
                $"Temperature cannot be below absolute zero ({AbsoluteZeroCelsius}°C)");

        return celsius - AbsoluteZeroCelsius;
    }

    /// <summary>
    /// 開爾文轉攝氏
    /// </summary>
    /// <param name="kelvin">開爾文溫度</param>
    /// <returns>攝氏溫度</returns>
    /// <exception cref="ArgumentOutOfRangeException">低於零時擲出</exception>
    public double KelvinToCelsius(double kelvin)
    {
        if (kelvin < 0)
            throw new ArgumentOutOfRangeException(nameof(kelvin),
                "Kelvin temperature cannot be negative");

        return kelvin + AbsoluteZeroCelsius;
    }

    /// <summary>
    /// 判斷溫度等級
    /// </summary>
    /// <param name="celsius">攝氏溫度</param>
    /// <returns>溫度等級描述</returns>
    public string GetTemperatureLevel(double celsius)
    {
        if (celsius < AbsoluteZeroCelsius)
            throw new ArgumentOutOfRangeException(nameof(celsius),
                $"Temperature cannot be below absolute zero ({AbsoluteZeroCelsius}°C)");

        return celsius switch
        {
            < -20 => "Extreme Cold",
            < 0 => "Freezing",
            < 10 => "Cold",
            < 20 => "Cool",
            < 30 => "Warm",
            < 40 => "Hot",
            _ => "Extreme Heat"
        };
    }
}
