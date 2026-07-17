/**
 * Standalone Jira REST API client for SAP Jira (jira.tools.sap).
 *
 * Makes authenticated requests using cookies from jira-auth module.
 * Replaces the prompt-kit CLI dependency with direct REST API calls.
 */

import { ensureCookies } from "@/lib/jira-auth";

// ============================================================================
// CONFIG
// ============================================================================

const JIRA_BASE = "https://jira.tools.sap";
const JIRA_API = `${JIRA_BASE}/rest/api/2`;

// ============================================================================
// TYPES
// ============================================================================

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  priority: string;
  type: string;
  project: string;
  updated: string;
  url: string;
}

export interface JiraComment {
  author: string;
  body: string;
  bodyHtml: string;
  created: string;
  updated: string;
}

export interface JiraIssueDetail {
  key: string;
  summary: string;
  description: string | null;
  descriptionHtml: string | null;
  status: string;
  statusCategory: string;
  priority: string;
  type: string;
  project: string;
  projectName: string;
  assignee: string | null;
  reporter: string | null;
  created: string;
  updated: string;
  labels: string[];
  components: string[];
  fixVersions: string[];
  comments: JiraComment[];
  url: string;
}

export class JiraAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JiraAuthError";
  }
}

// ============================================================================
// REQUEST HELPER
// ============================================================================

/**
 * Make an authenticated Jira API request.
 * Throws JiraAuthError if not authenticated.
 */
async function jiraRequest(
  method: string,
  endpoint: string,
  body?: object
): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const cookies = await ensureCookies();
  if (!cookies) {
    throw new JiraAuthError(
      "Jira authentication required. Please re-authenticate."
    );
  }

  const url = `${JIRA_API}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      Cookie: cookies,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Atlassian-Token": "no-check",
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();

  // Check for auth failures
  if (response.status === 401 || response.status === 403) {
    throw new JiraAuthError(
      "Jira authentication expired. Please re-authenticate."
    );
  }

  // Check for login page redirect (non-JSON response)
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    if (!response.ok) {
      // Check if it's a login page redirect
      if (
        text.includes("login") ||
        text.includes("Login") ||
        text.includes("SSO")
      ) {
        throw new JiraAuthError(
          "Jira session expired (redirected to login page). Please re-authenticate."
        );
      }
      throw new Error(`Jira API error: HTTP ${response.status}`);
    }
  }

  return { status: response.status, data };
}

// ============================================================================
// SEARCH / LIST
// ============================================================================

/**
 * Search Jira issues using JQL. Returns structured issue list.
 */
export async function searchIssues(
  jql: string,
  maxResults: number = 15
): Promise<{ issues: JiraIssue[]; total: number }> {
  const fields = [
    "summary",
    "status",
    "priority",
    "issuetype",
    "project",
    "updated",
  ].join(",");

  const encodedJql = encodeURIComponent(jql);
  const { data } = await jiraRequest(
    "GET",
    `/search?jql=${encodedJql}&fields=${fields}&maxResults=${maxResults}`
  );

  const total = (data?.total as number) ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issues: JiraIssue[] = ((data?.issues as any[]) ?? []).map((issue: any) => {
    const f = issue.fields || {};
    return {
      key: issue.key,
      summary: f.summary || "",
      status: f.status?.name || "",
      priority: f.priority?.name || "",
      type: f.issuetype?.name || "",
      project: f.project?.key || "",
      updated: f.updated?.split("T")[0] || "",
      url: `${JIRA_BASE}/browse/${issue.key}`,
    };
  });

  return { issues, total };
}

// ============================================================================
// ISSUE DETAIL
// ============================================================================

/**
 * Fetch detailed info for a single issue.
 */
export async function getIssueDetail(
  key: string
): Promise<JiraIssueDetail> {
  const cookies = await ensureCookies();
  if (!cookies) {
    throw new JiraAuthError(
      "Jira authentication required. Please re-authenticate."
    );
  }

  const fields = [
    "summary",
    "status",
    "priority",
    "issuetype",
    "project",
    "updated",
    "created",
    "description",
    "assignee",
    "reporter",
    "labels",
    "components",
    "fixVersions",
    "comment",
  ].join(",");

  const res = await fetch(
    `${JIRA_BASE}/rest/api/2/issue/${encodeURIComponent(key)}?fields=${fields}&expand=renderedFields`,
    {
      headers: {
        Cookie: cookies,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Atlassian-Token": "no-check",
      },
    }
  );

  if (res.status === 401 || res.status === 403) {
    throw new JiraAuthError(
      "Jira authentication expired. Please re-authenticate."
    );
  }

  if (!res.ok) {
    const text = await res.text();
    if (text.includes("login") || text.includes("Login")) {
      throw new JiraAuthError(
        "Jira session expired. Please re-authenticate."
      );
    }
    throw new Error(`Jira API error: ${res.status} ${text.substring(0, 200)}`);
  }

  const data = await res.json();
  const f = data.fields || {};
  const rf = data.renderedFields || {};

  const comments: JiraComment[] = (f.comment?.comments || []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) => ({
      author: c.author?.displayName || c.author?.name || "Unknown",
      body: c.body || "",
      bodyHtml: c.renderedBody || "",
      created: c.created || "",
      updated: c.updated || "",
    })
  );

  // Merge rendered comments from renderedFields
  const renderedComments = rf.comment?.comments || [];
  for (let i = 0; i < comments.length && i < renderedComments.length; i++) {
    if (renderedComments[i]?.body) {
      comments[i].bodyHtml = renderedComments[i].body;
    }
  }

  return {
    key: data.key,
    summary: f.summary || "",
    description: f.description || null,
    descriptionHtml: rf.description || null,
    status: f.status?.name || "",
    statusCategory: f.status?.statusCategory?.name || "",
    priority: f.priority?.name || "",
    type: f.issuetype?.name || "",
    project: f.project?.key || "",
    projectName: f.project?.name || "",
    assignee: f.assignee?.displayName || null,
    reporter: f.reporter?.displayName || null,
    created: f.created || "",
    updated: f.updated || "",
    labels: f.labels || [],
    components: (f.components || []).map((c: { name: string }) => c.name),
    fixVersions: (f.fixVersions || []).map((v: { name: string }) => v.name),
    comments,
    url: `${JIRA_BASE}/browse/${data.key}`,
  };
}
