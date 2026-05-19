import { NextRequest } from "next/server";
import { getConfig, saveConfig, AppConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await getConfig();
  return Response.json(config);
}

export async function POST(request: NextRequest) {
  const body = await request.json() as AppConfig;
  await saveConfig(body);
  return Response.json({ success: true });
}
