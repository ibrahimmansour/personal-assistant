// Open-Meteo free API - no key required
// Berlin coordinates: 52.52, 13.405

export const dynamic = "force-dynamic";

const BERLIN_LAT = 52.52;
const BERLIN_LON = 13.405;

const weatherCodeMap: Record<number, string> = {
  0: "Clear Sky",
  1: "Mainly Clear",
  2: "Partly Cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Rime Fog",
  51: "Light Drizzle",
  53: "Moderate Drizzle",
  55: "Dense Drizzle",
  56: "Freezing Drizzle",
  57: "Heavy Freezing Drizzle",
  61: "Slight Rain",
  63: "Moderate Rain",
  65: "Heavy Rain",
  66: "Light Freezing Rain",
  67: "Heavy Freezing Rain",
  71: "Slight Snow",
  73: "Moderate Snow",
  75: "Heavy Snow",
  77: "Snow Grains",
  80: "Slight Showers",
  81: "Moderate Showers",
  82: "Violent Showers",
  85: "Slight Snow Showers",
  86: "Heavy Snow Showers",
  95: "Thunderstorm",
  96: "Thunderstorm + Hail",
  99: "Thunderstorm + Heavy Hail",
};

function conditionCategory(code: number): string {
  if (code === 0 || code === 1) return "Sunny";
  if (code === 2) return "Partly Cloudy";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 57) return "Rainy";
  if (code >= 61 && code <= 67) return "Rainy";
  if (code >= 71 && code <= 77) return "Snowy";
  if (code >= 80 && code <= 82) return "Rainy";
  if (code >= 85 && code <= 86) return "Snowy";
  if (code >= 95) return "Stormy";
  return "Partly Cloudy";
}

function windDirection(degrees: number): string {
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const idx = Math.round(degrees / 22.5) % 16;
  return directions[idx];
}

function uvLabel(uv: number): string {
  if (uv <= 2) return "Low";
  if (uv <= 5) return "Moderate";
  if (uv <= 7) return "High";
  if (uv <= 10) return "Very High";
  return "Extreme";
}

export async function GET() {
  try {
    const currentParams = [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "surface_pressure",
      "cloud_cover",
      "is_day",
    ].join(",");

    const hourlyParams = [
      "temperature_2m",
      "apparent_temperature",
      "weather_code",
      "precipitation_probability",
      "precipitation",
      "wind_speed_10m",
      "wind_direction_10m",
      "is_day",
    ].join(",");

    const dailyParams = [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "apparent_temperature_max",
      "apparent_temperature_min",
      "sunrise",
      "sunset",
      "uv_index_max",
      "precipitation_sum",
      "precipitation_probability_max",
      "wind_speed_10m_max",
      "wind_gusts_10m_max",
      "wind_direction_10m_dominant",
    ].join(",");

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${BERLIN_LAT}&longitude=${BERLIN_LON}&current=${currentParams}&hourly=${hourlyParams}&daily=${dailyParams}&timezone=Europe%2FBerlin&forecast_days=7`;

    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) throw new Error(`Open-Meteo API ${res.status}`);

    const data = await res.json();
    const current = data.current;
    const hourly = data.hourly;
    const daily = data.daily;

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    // Build hourly forecast (next 24 hours from current time)
    const now = new Date();
    const currentHourIndex = hourly.time.findIndex((t: string) => new Date(t) >= now);
    const startIdx = Math.max(0, currentHourIndex);
    const hourlyForecast = [];
    for (let i = startIdx; i < Math.min(startIdx + 24, hourly.time.length); i++) {
      const time = new Date(hourly.time[i]);
      hourlyForecast.push({
        time: hourly.time[i],
        hour: time.getHours(),
        temperature: Math.round(hourly.temperature_2m[i]),
        apparentTemperature: Math.round(hourly.apparent_temperature[i]),
        condition: conditionCategory(hourly.weather_code[i]),
        description: weatherCodeMap[hourly.weather_code[i]] || "Unknown",
        precipitationProbability: hourly.precipitation_probability[i] ?? 0,
        precipitation: hourly.precipitation[i] ?? 0,
        windSpeed: Math.round(hourly.wind_speed_10m[i]),
        windDirection: windDirection(hourly.wind_direction_10m[i]),
        windDegrees: hourly.wind_direction_10m[i],
        isDay: hourly.is_day[i] === 1,
      });
    }

    // Build daily forecast
    const forecast = daily.time.map((date: string, i: number) => {
      const d = new Date(date + "T00:00:00");
      return {
        day: dayNames[d.getDay()],
        date,
        high: Math.round(daily.temperature_2m_max[i]),
        low: Math.round(daily.temperature_2m_min[i]),
        apparentHigh: Math.round(daily.apparent_temperature_max[i]),
        apparentLow: Math.round(daily.apparent_temperature_min[i]),
        condition: conditionCategory(daily.weather_code[i]),
        description: weatherCodeMap[daily.weather_code[i]] || "Unknown",
        sunrise: daily.sunrise[i],
        sunset: daily.sunset[i],
        uvIndexMax: daily.uv_index_max[i],
        uvLabel: uvLabel(daily.uv_index_max[i]),
        precipitationSum: daily.precipitation_sum[i],
        precipitationProbability: daily.precipitation_probability_max[i] ?? 0,
        windSpeedMax: Math.round(daily.wind_speed_10m_max[i]),
        windGustsMax: Math.round(daily.wind_gusts_10m_max[i]),
        windDirection: windDirection(daily.wind_direction_10m_dominant[i]),
      };
    });

    return Response.json({
      location: "Berlin, DE",
      temperature: Math.round(current.temperature_2m),
      apparentTemperature: Math.round(current.apparent_temperature),
      condition: conditionCategory(current.weather_code),
      description: weatherCodeMap[current.weather_code] || "Unknown",
      humidity: current.relative_humidity_2m,
      wind: Math.round(current.wind_speed_10m),
      windDirection: windDirection(current.wind_direction_10m),
      windDegrees: current.wind_direction_10m,
      windGusts: Math.round(current.wind_gusts_10m),
      pressure: Math.round(current.surface_pressure),
      cloudCover: current.cloud_cover,
      isDay: current.is_day === 1,
      sunrise: daily.sunrise[0],
      sunset: daily.sunset[0],
      uvIndex: daily.uv_index_max[0],
      uvLabel: uvLabel(daily.uv_index_max[0]),
      hourly: hourlyForecast,
      forecast,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Weather API error:", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch weather",
      },
      { status: 500 }
    );
  }
}
