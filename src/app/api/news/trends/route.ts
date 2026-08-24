import { NextRequest } from "next/server";
import {
  TREND_COUNTRIES,
  getCountry,
  fetchCountryTrends,
  fetchTrendContext,
  type TrendContext,
} from "@/lib/x-trends";

export const dynamic = "force-dynamic";

const COUNTRY_LIST = TREND_COUNTRIES.map(({ id, name, flag, dir }) => ({
  id,
  name,
  flag,
  dir,
}));

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const action = params.get("action");

  if (action === "countries") {
    return Response.json({ countries: COUNTRY_LIST });
  }

  const country = getCountry(params.get("country")) ?? TREND_COUNTRIES[0];

  // News coverage for a single trend
  if (action === "context") {
    const trend = params.get("trend");
    if (!trend) {
      return Response.json({ error: "Missing trend parameter" }, { status: 400 });
    }
    const context = await fetchTrendContext(country, trend);
    return Response.json(context);
  }

  // Default: the country's trend list
  const result = await fetchCountryTrends(country, {
    force: params.get("refresh") === "1",
  });
  if ("error" in result) {
    return Response.json(
      { error: result.error, countryId: country.id, countries: COUNTRY_LIST },
      { status: 502 }
    );
  }

  return Response.json({ ...result, countries: COUNTRY_LIST });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  // Batch context lookup for the visible list, mirroring the news widget's
  // thumbnail backfill: one request per chunk instead of one per trend.
  if (body.action === "contexts") {
    const country = getCountry(body.country);
    if (!country) {
      return Response.json({ error: "Unknown country" }, { status: 400 });
    }

    const trends: string[] = [];
    const seen = new Set<string>();
    for (const t of (body.trends as string[] | undefined) ?? []) {
      if (typeof t !== "string" || !t.trim() || seen.has(t)) continue;
      seen.add(t);
      trends.push(t);
      if (trends.length >= 8) break;
    }

    const entries = await Promise.all(
      trends.map(async (t) => [t, await fetchTrendContext(country, t)] as const)
    );
    const results: Record<string, TrendContext> = {};
    for (const [t, ctx] of entries) results[t] = ctx;
    return Response.json({ results });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
