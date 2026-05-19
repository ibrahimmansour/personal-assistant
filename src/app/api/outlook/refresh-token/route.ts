import { getTokenStatus, writeTokenCache } from "@/lib/outlook-token";
import { execFile } from "child_process";
import { promisify } from "util";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

// Match both old and new Outlook domains
const OUTLOOK_DOMAINS = [
  "outlook.office.com",
  "outlook.cloud.microsoft",
  "outlook.office365.com",
];
const OUTLOOK_URL = "https://outlook.office.com/mail/";

function domainMatch(varName: string = "tabURL"): string {
  return OUTLOOK_DOMAINS.map((d) => `${varName} contains "${d}"`).join(" or ");
}

// JS to extract token from localStorage — searches any Outlook domain
const EXTRACT_JS = `(function() {
  var keys = Object.keys(localStorage);
  var key = keys.find(function(k) {
    var kl = k.toLowerCase();
    return kl.indexOf('accesstoken') > -1
      && (kl.indexOf('outlook.office.com') > -1
          || kl.indexOf('outlook.cloud.microsoft') > -1
          || kl.indexOf('outlook.office365.com') > -1);
  });
  if (!key) {
    key = keys.find(function(k) {
      var kl = k.toLowerCase();
      return kl.indexOf('accesstoken') > -1
        && (kl.indexOf('mail.readwrite') > -1 || kl.indexOf('mail.read') > -1);
    });
  }
  if (!key) return 'TOKEN_NOT_FOUND';
  var data = JSON.parse(localStorage.getItem(key));
  if (!data || !data.secret) return 'TOKEN_NOT_FOUND';
  var now = Math.floor(Date.now() / 1000);
  var expiresOn = parseInt(data.expiresOn || data.expires_on || '0');
  if (expiresOn && expiresOn < now) return 'TOKEN_EXPIRED';
  return data.secret + '|EXPIRY|' + expiresOn;
})()`.replace(/\n/g, " ");

/** Find an existing Outlook tab in Chrome. */
const FIND_SCRIPT = `
tell application "Google Chrome"
    if (count of windows) = 0 then return "not_found"
    repeat with w from 1 to (count of windows)
        repeat with t from 1 to (count of tabs of window w)
            set tabURL to URL of tab t of window w
            if ${domainMatch()} then
                return (w as text) & "," & (t as text)
            end if
        end repeat
    end repeat
    return "not_found"
end tell
`;

/** Close a Chrome tab. */
async function closeTab(win: number, tab: number) {
  try {
    await execFileAsync(
      "osascript",
      ["-e", `tell application "Google Chrome" to close tab ${tab} of window ${win}`],
      { timeout: 5000 },
    );
  } catch {
    // best effort
  }
}

/** Run an AppleScript and return stdout. */
async function runAS(script: string, timeout = 10000): Promise<string> {
  const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout });
  return stdout.trim();
}

/**
 * GET — Check current token status.
 */
export async function GET() {
  const status = await getTokenStatus();
  return Response.json(status);
}

/**
 * POST — Extract a fresh Outlook token from Chrome.
 *
 * Strategy:
 * 1. If an Outlook tab already exists, extract from it (don't close it)
 * 2. Otherwise, open a background tab, extract, close it
 * 3. Poll up to ~90 seconds for the token to appear
 *
 * Requires: Chrome > View > Developer > Allow JavaScript from Apple Events
 */
export async function POST() {
  try {
    // Step 1: Check for existing Outlook tab
    let tabLocation = "not_found";
    try {
      tabLocation = await runAS(FIND_SCRIPT);
    } catch {
      // no Chrome or no windows
    }

    let win: number;
    let tab: number;
    let weOpenedTab = false;

    if (tabLocation !== "not_found") {
      // Existing tab — use it, don't close it later
      const parts = tabLocation.split(",");
      win = parseInt(parts[0], 10);
      tab = parseInt(parts[1], 10);
    } else {
      // Open a background tab (no activate — don't steal focus)
      weOpenedTab = true;
      const openScript = `
tell application "Google Chrome"
    if (count of windows) = 0 then
        set newWindow to make new window
        set URL of active tab of newWindow to "${OUTLOOK_URL}"
        return "1,1"
    else
        tell front window
            set newTab to make new tab with properties {URL:"${OUTLOOK_URL}"}
        end tell
        set tabCount to count of tabs of front window
        return "1," & tabCount
    end if
end tell
`;
      const result = await runAS(openScript);
      const parts = result.split(",");
      win = parseInt(parts[0], 10);
      tab = parseInt(parts[1], 10);
    }

    // Step 2: Poll for the token (up to ~90 seconds)
    const maxAttempts = 30;
    const pollInterval = 3000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, pollInterval));

      // Re-find tab (URL/index may change after SSO redirect)
      let currentWin = win;
      let currentTab = tab;
      try {
        const loc = await runAS(FIND_SCRIPT);
        if (loc !== "not_found") {
          const parts = loc.split(",");
          currentWin = parseInt(parts[0], 10);
          currentTab = parseInt(parts[1], 10);
        }
      } catch {
        // keep original
      }

      try {
        const extractScript = `
tell application "Google Chrome"
    set currentTab to tab ${currentTab} of window ${currentWin}
    set jsResult to execute currentTab javascript "${EXTRACT_JS}"
    return jsResult
end tell
`;
        const result = await runAS(extractScript);

        if (result.includes("|EXPIRY|")) {
          const [token, expiryStr] = result.split("|EXPIRY|", 2);
          const expiresOn = parseInt(expiryStr, 10);

          // Close the tab if we opened it
          if (weOpenedTab) {
            await closeTab(currentWin, currentTab);
          }

          await writeTokenCache(token, expiresOn);

          return Response.json({
            success: true,
            expiresOn,
            expiresIn: expiresOn - Math.floor(Date.now() / 1000),
          });
        }

        continue;
      } catch {
        continue;
      }
    }

    // Timed out — close the tab if we opened it
    if (weOpenedTab) {
      // Re-find to get current index
      try {
        const loc = await runAS(FIND_SCRIPT);
        if (loc !== "not_found") {
          const parts = loc.split(",");
          await closeTab(parseInt(parts[0], 10), parseInt(parts[1], 10));
        }
      } catch {
        // best effort
      }
    }

    return Response.json({
      success: false,
      needsLogin: true,
      message:
        "Could not extract token. Please sign in to Outlook in Chrome, then click Refresh Token again.",
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
