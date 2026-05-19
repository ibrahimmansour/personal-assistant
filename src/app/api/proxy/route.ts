import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Enhanced proxy route that fetches URLs and strips iframe-blocking headers.
 * Rewrites HTML to route navigation through postMessage and resolves relative URLs.
 *
 * Usage: /api/proxy?url=https://www.google.com
 */
export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url");

  if (!targetUrl) {
    return new Response("Missing ?url= parameter", { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new Response("Invalid URL", { status: 400 });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return new Response("Only HTTP(S) URLs are allowed", { status: 400 });
  }

  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
      },
      redirect: "follow",
      cache: "no-store",
    });

    // Track the final URL after redirects
    const finalUrl = res.url || targetUrl;
    let finalParsed: URL;
    try {
      finalParsed = new URL(finalUrl);
    } catch {
      finalParsed = parsed;
    }

    const contentType = res.headers.get("content-type") || "";
    const server = res.headers.get("server") || "";

    // Detect network-level blocks (Cisco Umbrella / OpenDNS, etc.)
    const isBlocked =
      (server.toLowerCase().includes("cisco") ||
        server.toLowerCase().includes("umbrella")) &&
      (res.status === 403 || res.status === 451);

    // Detect other error responses and return a friendly error page
    if (isBlocked || (res.status >= 400 && res.status !== 404)) {
      const reason = isBlocked
        ? "This site is blocked by your network security filter (Cisco Umbrella/OpenDNS)."
        : `The site returned HTTP ${res.status} ${res.statusText || ""}.`;

      const errorHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #fafafa; color: #333; }
  .container { text-align: center; max-width: 420px; padding: 32px; }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h2 { font-size: 16px; margin-bottom: 8px; }
  p { font-size: 13px; color: #666; line-height: 1.5; margin-bottom: 16px; }
  .url { font-size: 11px; color: #999; word-break: break-all; background: #eee; padding: 6px 10px; border-radius: 6px; margin-bottom: 16px; }
  .btn { display: inline-block; padding: 8px 16px; font-size: 12px; border-radius: 6px; cursor: pointer; border: none; margin: 0 4px; text-decoration: none; }
  .btn-primary { background: #3b82f6; color: white; }
  .btn-secondary { background: #e5e7eb; color: #333; }
</style></head>
<body><div class="container">
  <div class="icon">${isBlocked ? "&#128274;" : "&#9888;&#65039;"}</div>
  <h2>${isBlocked ? "Site Blocked" : "Failed to Load"}</h2>
  <p>${reason}</p>
  <div class="url">${targetUrl}</div>
  <button class="btn btn-primary" onclick="window.open('${targetUrl}', '_blank')">Open in New Tab</button>
  <button class="btn btn-secondary" onclick="window.parent.postMessage({type:'browser-navigate',url:'https://www.google.com'},'*')">Go Home</button>
</div></body></html>`;

      return new Response(errorHtml, {
        status: 200, // Return 200 so the iframe renders it
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Final-URL": finalUrl,
          "X-Proxy-Error": isBlocked ? "blocked" : `http-${res.status}`,
        },
      });
    }

    if (contentType.includes("text/html")) {
      let html = await res.text();
      const origin = finalParsed.origin;
      const baseHref = `${origin}${finalParsed.pathname.replace(/\/[^/]*$/, "/") || "/"}`;

      // Inject <base> so relative URLs resolve against the original site
      if (!html.includes("<base")) {
        const baseTag = `<base href="${baseHref}" target="_self">`;
        if (/<head[^>]*>/i.test(html)) {
          html = html.replace(/(<head[^>]*>)/i, `$1${baseTag}`);
        } else {
          html = baseTag + html;
        }
      }

      // Inject a comprehensive navigation interceptor + URL reporter
      const interceptScript = `
<script data-proxy-injected="true">
(function() {
  var PROXY = '/api/proxy?url=';
  var origin = ${JSON.stringify(origin)};
  var currentUrl = ${JSON.stringify(finalUrl)};

  // Report the actual loaded URL back to the parent (for URL bar sync)
  try {
    window.parent.postMessage({
      type: 'browser-url-update',
      url: currentUrl,
      title: document.title || ''
    }, '*');
  } catch(e) {}

  // Update title when it changes
  new MutationObserver(function() {
    try {
      window.parent.postMessage({
        type: 'browser-title-update',
        title: document.title || ''
      }, '*');
    } catch(e) {}
  }).observe(document.querySelector('title') || document.head, {
    subtree: true,
    characterData: true,
    childList: true
  });

  // Resolve a potentially relative URL to absolute
  function resolveUrl(href) {
    try {
      return new URL(href, currentUrl).href;
    } catch(e) {
      return null;
    }
  }

  // Intercept all link clicks
  document.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('data:')) return;

    var resolved = resolveUrl(href);
    if (!resolved) return;

    var u;
    try { u = new URL(resolved); } catch(e) { return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;

    e.preventDefault();
    e.stopPropagation();
    window.parent.postMessage({ type: 'browser-navigate', url: resolved }, '*');
  }, true);

  // Intercept form submissions (e.g. Google search)
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form || !form.tagName || form.tagName !== 'FORM') return;

    var action = form.getAttribute('action') || currentUrl;
    var resolved = resolveUrl(action);
    if (!resolved) return;

    var method = (form.method || 'GET').toUpperCase();

    if (method === 'GET') {
      e.preventDefault();
      var fd = new FormData(form);
      var params = new URLSearchParams(fd).toString();
      var sep = resolved.includes('?') ? '&' : '?';
      window.parent.postMessage({
        type: 'browser-navigate',
        url: resolved + sep + params
      }, '*');
    }
    // POST forms — let them submit naturally through the proxy
  }, true);

  // Intercept window.open
  var origOpen = window.open;
  window.open = function(url) {
    if (url) {
      var resolved = resolveUrl(url);
      if (resolved) {
        window.parent.postMessage({ type: 'browser-navigate', url: resolved }, '*');
        return null;
      }
    }
    return origOpen.apply(this, arguments);
  };

  // Intercept location changes via pushState/replaceState
  var origPush = history.pushState;
  var origReplace = history.replaceState;
  history.pushState = function() {
    origPush.apply(this, arguments);
    var newUrl = arguments[2];
    if (newUrl) {
      var resolved = resolveUrl(newUrl);
      if (resolved) {
        window.parent.postMessage({ type: 'browser-url-update', url: resolved }, '*');
      }
    }
  };
  history.replaceState = function() {
    origReplace.apply(this, arguments);
    var newUrl = arguments[2];
    if (newUrl) {
      var resolved = resolveUrl(newUrl);
      if (resolved) {
        window.parent.postMessage({ type: 'browser-url-update', url: resolved }, '*');
      }
    }
  };
})();
</script>`;

      // Inject before </head> if possible (so it runs early), otherwise before </body>
      if (html.includes("</head>")) {
        html = html.replace("</head>", interceptScript + "</head>");
      } else if (html.includes("</body>")) {
        html = html.replace("</body>", interceptScript + "</body>");
      } else {
        html += interceptScript;
      }

      return new Response(html, {
        status: res.status,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
          // Send the final URL so the widget can sync its URL bar
          "X-Final-URL": finalUrl,
          // Deliberately omit X-Frame-Options and CSP to allow iframe embedding
        },
      });
    }

    // For CSS, rewrite url() references to absolute
    if (contentType.includes("text/css")) {
      let css = await res.text();
      const origin = finalParsed.origin;
      const basePath = finalParsed.pathname.replace(/\/[^/]*$/, "/") || "/";

      // Rewrite relative url() references
      css = css.replace(
        /url\(\s*(['"]?)(?!data:|https?:|\/\/)(.*?)\1\s*\)/gi,
        (match, quote, path) => {
          const absolute = path.startsWith("/")
            ? `${origin}${path}`
            : `${origin}${basePath}${path}`;
          return `url(${quote}${absolute}${quote})`;
        }
      );

      return new Response(css, {
        status: res.status,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // For all other resources (images, JS, fonts, etc.), pass through
    const body = await res.arrayBuffer();

    // Build response headers — pass through useful headers
    const responseHeaders: Record<string, string> = {
      "Cache-Control": "public, max-age=3600",
    };
    if (contentType) responseHeaders["Content-Type"] = contentType;

    const contentDisp = res.headers.get("content-disposition");
    if (contentDisp) responseHeaders["Content-Disposition"] = contentDisp;

    return new Response(body, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch URL";

    // Detect common connection errors
    let friendlyMessage = message;
    if (message.includes("ECONNREFUSED")) {
      friendlyMessage = "Connection refused — the site may be down or blocking requests.";
    } else if (message.includes("ENOTFOUND")) {
      friendlyMessage = "DNS lookup failed — the domain could not be resolved.";
    } else if (message.includes("ETIMEDOUT") || message.includes("timeout")) {
      friendlyMessage = "Connection timed out — the site took too long to respond.";
    } else if (message.includes("CERT") || message.includes("SSL") || message.includes("TLS")) {
      friendlyMessage = "SSL/TLS error — the site has an invalid or expired certificate.";
    }

    const errorHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #fafafa; color: #333; }
  .container { text-align: center; max-width: 420px; padding: 32px; }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h2 { font-size: 16px; margin-bottom: 8px; }
  p { font-size: 13px; color: #666; line-height: 1.5; margin-bottom: 16px; }
  .url { font-size: 11px; color: #999; word-break: break-all; background: #eee; padding: 6px 10px; border-radius: 6px; margin-bottom: 16px; }
  .detail { font-size: 10px; color: #aaa; margin-bottom: 16px; font-family: monospace; }
  .btn { display: inline-block; padding: 8px 16px; font-size: 12px; border-radius: 6px; cursor: pointer; border: none; margin: 0 4px; text-decoration: none; }
  .btn-primary { background: #3b82f6; color: white; }
  .btn-secondary { background: #e5e7eb; color: #333; }
</style></head>
<body><div class="container">
  <div class="icon">&#128268;</div>
  <h2>Can't Connect</h2>
  <p>${friendlyMessage}</p>
  <div class="url">${targetUrl}</div>
  <div class="detail">${message}</div>
  <button class="btn btn-primary" onclick="window.open('${targetUrl}', '_blank')">Open in New Tab</button>
  <button class="btn btn-secondary" onclick="window.parent.postMessage({type:'browser-navigate',url:'https://www.google.com'},'*')">Go Home</button>
</div></body></html>`;

    return new Response(errorHtml, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Proxy-Error": "connection-failed",
      },
    });
  }
}
