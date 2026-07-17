/**
 * Jira issues list API route.
 *
 * GET /api/jira — Fetch open issues assigned to the current user.
 *
 * Directly calls the Jira REST API using cookie-based auth.
 * No prompt-kit dependency.
 */

import { searchIssues, JiraAuthError } from "@/lib/jira-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jql =
      "assignee=currentUser() AND statusCategory != Done ORDER BY updated DESC";
    const { issues, total } = await searchIssues(jql, 15);

    return Response.json({
      issues,
      total,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof JiraAuthError) {
      return Response.json(
        {
          error: error.message,
          authRequired: true,
          issues: [],
        },
        { status: 401 }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message, issues: [] }, { status: 500 });
  }
}
