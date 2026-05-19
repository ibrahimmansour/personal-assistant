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
  61: "Slight Rain",
  63: "Moderate Rain",
  65: "Heavy Rain",
  71: "Slight Snow",
  73: "Moderate Snow",
  75: "Heavy Snow",
  80: "Slight Showers",
  81: "Moderate Showers",
  82: "Violent Showers",
  95: "Thunderstorm",
  96: "Thunderstorm + Hail",
  99: "Thunderstorm + Heavy Hail",
};

function conditionCategory(code: number): string {
  if (code === 0 || code === 1) return "Sunny";
  if (code === 2) return "Partly Cloudy";
  if (code === 3 || code === 45 || code === 48) return "Cloudy";
  if (code >= 51 && code <= 67) return "Rainy";
  if (code >= 71 && code <= 77) return "Snowy";
  if (code >= 80 && code <= 82) return "Rainy";
  if (code >= 95) return "Stormy";
  return "Partly Cloudy";
}

export async function GET() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${BERLIN_LAT}&longitude=${BERLIN_LON}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FBerlin&forecast_days=5`;

    const res = await fetch(url, { next: { revalidate: 600 } }); // cache 10 min
    if (!res.ok) throw new Error(`Open-Meteo API ${res.status}`);

    const data = await res.json();
    const current = data.current;
    const daily = data.daily;

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const forecast = daily.time.map((date: string, i: number) => {
      const d = new Date(date + "T00:00:00");
      return {
        day: dayNames[d.getDay()],
        date,
        high: Math.round(daily.temperature_2m_max[i]),
        low: Math.round(daily.temperature_2m_min[i]),
        condition: conditionCategory(daily.weather_code[i]),
        description: weatherCodeMap[daily.weather_code[i]] || "Unknown",
      };
    });

    return Response.json({
      location: "Berlin, DE",
      temperature: Math.round(current.temperature_2m),
      condition: conditionCategory(current.weather_code),
      description: weatherCodeMap[current.weather_code] || "Unknown",
      humidity: current.relative_humidity_2m,
      wind: Math.round(current.wind_speed_10m),
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
