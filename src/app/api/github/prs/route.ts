import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getConfigEnv } from "@/lib/config";

const execFileAsync = promisify(execFile);

async function getGithubComToken(): Promise<string> {
  const token = await getConfigEnv("GITHUB_COM_TOKEN");
  if (token) return token;
  // Fall back to gh CLI
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], {
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    throw new Error("No GitHub.com token. Set GITHUB_COM_TOKEN or run `gh auth login`.");
  }
}

function getConfig(profile: string) {
  if (profile === "private") {
    return {
      api: "https://api.github.com",
      getUsername: () => getConfigEnv("GITHUB_COM_USERNAME"),
      getToken: getGithubComToken,
    };
  }
  return {
    api: "", // resolved async below
    getUsername: () => getConfigEnv("GITHUB_USERNAME"),
    getToken: async () => {
      const token = await getConfigEnv("GITHUB_TOKEN");
      if (!token) throw new Error("GITHUB_TOKEN not configured. Go to Settings to add it.");
      return token;
    },
  };
}

async function githubFetch(api: string, token: string, endpoint: string) {
  const url = `${api}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "personal-assistant-dashboard",
    },
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${res.statusText} - ${text.slice(0, 200)}`);
  }
  return res.json();
}

function extractRepoName(repositoryUrl: string): string {
  const match = repositoryUrl.match(/\/repos\/(.+)/);
  return match ? match[1] : repositoryUrl;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

export async function GET(request: NextRequest) {
  const profile = request.nextUrl.searchParams.get("profile") || "work";

  try {
    const config = getConfig(profile);
    const token = await config.getToken();
    const username = await config.getUsername();
    const api = profile === "private" ? config.api : (await getConfigEnv("GITHUB_API_URL") || "https://github.wdf.sap.corp/api/v3");

    // Fetch only PRs authored by me
    const authoredRes = await githubFetch(
      api,
      token,
      `/search/issues?q=author:${username}+type:pr+sort:updated&per_page=25`
    );

    const allPRs = authoredRes.items || [];

    // Fetch PR details in parallel
    const prDetails = await Promise.allSettled(
      allPRs.map((pr: any) => {
        const repo = extractRepoName(pr.repository_url);
        return githubFetch(api, token, `/repos/${repo}/pulls/${pr.number}`);
      })
    );

    const enrichedPRs = allPRs.map((pr: any, index: number) => {
      const detail =
        prDetails[index].status === "fulfilled"
          ? (prDetails[index] as PromiseFulfilledResult<any>).value
          : null;

      const isMerged = pr.pull_request?.merged_at != null;
      let status: "open" | "merged" | "closed" | "draft" = "open";
      if (pr.draft) status = "draft";
      else if (isMerged) status = "merged";
      else if (pr.state === "closed") status = "closed";

      const repo = extractRepoName(pr.repository_url);

      return {
        id: String(pr.id),
        number: pr.number,
        title: pr.title,
        repo,
        repoShort: repo.split("/").pop() || repo,
        author: pr.user.login,
        authorAvatar: pr.user.avatar_url,
        status,
        url: pr.html_url,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        comments: pr.comments + (detail?.review_comments || 0),
        additions: detail?.additions || 0,
        deletions: detail?.deletions || 0,
        labels: (pr.labels || []).map((l: any) => ({
          name: l.name,
          color: `#${l.color}`,
        })),
        baseBranch: detail?.base?.ref || "unknown",
        headBranch: detail?.head?.ref || "unknown",
        isAuthor: true,
      };
    });

    // Sort by repo name
    enrichedPRs.sort((a: any, b: any) => {
      const repoCompare = a.repoShort.localeCompare(b.repoShort);
      if (repoCompare !== 0) return repoCompare;
      return 0;
    });

    return Response.json({
      prs: enrichedPRs,
      username,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("GitHub API error:", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch GitHub data",
        prs: [],
      },
      { status: 500 }
    );
  }
}
