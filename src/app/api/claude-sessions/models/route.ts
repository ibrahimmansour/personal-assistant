import { NextRequest } from "next/server";
import { listOpenCodeModels } from "@/lib/opencode-store";

export const dynamic = "force-dynamic";

/**
 * Models the local OpenCode install can run (`opencode models --verbose`),
 * with the variants each accepts. Claude Code's model list is static and
 * lives in the widget; only OpenCode's depends on which providers the user
 * has configured.
 */
export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const models = await listOpenCodeModels(refresh);
  return Response.json({ models });
}
