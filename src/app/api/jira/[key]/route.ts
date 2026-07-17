/**
 * Jira issue detail API route.
 *
 * GET /api/jira/{key} — Fetch full detail for a single issue.
 *
 * Directly calls the Jira REST API using cookie-based auth.
 * No prompt-kit dependency.
 */

import { getIssueDetail, JiraAuthError } from "@/lib/jira-client";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const detail = await getIssueDetail(key);
    return Response.json({ issue: detail });
  } catch (error: unknown) {
    if (error instanceof JiraAuthError) {
      return Response.json(
        {
          error: error.message,
          authRequired: true,
        },
        { status: 401 }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
