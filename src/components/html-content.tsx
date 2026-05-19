"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTheme } from "next-themes";

interface HtmlContentProps {
  html: string;
  fallbackText?: string;
  className?: string;
}

/**
 * Renders HTML content inside a sandboxed iframe that:
 * - Isolates email/event CSS from the dashboard
 * - Auto-sizes height to fit content
 * - Inherits the current theme colors (light/dark)
 * - Prevents script execution via sandbox
 */
export function HtmlContent({ html, fallbackText, className }: HtmlContentProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(150);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Read computed CSS variable values from the document root
  const getThemeColors = useCallback(() => {
    if (typeof window === "undefined") return { bg: "#fff", fg: "#000", link: "#0066cc", muted: "#666" };
    const styles = getComputedStyle(document.documentElement);
    return {
      bg: styles.getPropertyValue("--background").trim() || (isDark ? "#09090b" : "#ffffff"),
      fg: styles.getPropertyValue("--foreground").trim() || (isDark ? "#fafafa" : "#09090b"),
      link: styles.getPropertyValue("--primary").trim() || (isDark ? "#d4d4d8" : "#18181b"),
      muted: styles.getPropertyValue("--muted-foreground").trim() || (isDark ? "#a1a1aa" : "#71717a"),
    };
  }, [isDark]);

  const buildSrcdoc = useCallback(() => {
    const colors = getThemeColors();
    // oklch values from CSS vars need to be used with oklch() wrapper
    const wrapColor = (val: string) => {
      if (val.startsWith("oklch(") || val.startsWith("rgb") || val.startsWith("#")) return val;
      if (val.match(/^[\d.]+\s/)) return `oklch(${val})`;
      return val;
    };

    const bgColor = wrapColor(colors.bg);
    const fgColor = wrapColor(colors.fg);
    const linkColor = wrapColor(colors.link);
    const mutedColor = wrapColor(colors.muted);

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: ${bgColor};
    color: ${fgColor};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    line-height: 1.6;
    word-wrap: break-word;
    overflow-wrap: break-word;
    overflow-x: hidden;
  }
  body { padding: 2px 0; }
  a { color: ${linkColor}; text-decoration: underline; }
  a:hover { opacity: 0.8; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; border-collapse: collapse; font-size: inherit; }
  td, th { padding: 2px 4px; }
  pre, code {
    font-family: ui-monospace, "SF Mono", Monaco, "Cascadia Mono", monospace;
    font-size: 11px;
    background: ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"};
    border-radius: 3px;
    padding: 1px 3px;
  }
  pre { padding: 8px; overflow-x: auto; }
  blockquote {
    margin: 8px 0;
    padding: 4px 12px;
    border-left: 3px solid ${mutedColor};
    color: ${mutedColor};
  }
  hr {
    border: none;
    border-top: 1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"};
    margin: 8px 0;
  }
  h1, h2, h3, h4, h5, h6 {
    margin: 8px 0 4px;
    line-height: 1.3;
    color: ${fgColor};
  }
  h1 { font-size: 16px; }
  h2 { font-size: 14px; }
  h3 { font-size: 13px; }
  p { margin: 4px 0; }
  ul, ol { padding-left: 20px; margin: 4px 0; }
  /* Hide Outlook specific junk */
  .x_MsoNormal, .MsoNormal { margin: 0; }
  div[style*="border-top"] { margin: 4px 0; }
</style>
</head>
<body>${html}</body>
<script>
  function postHeight() {
    var h = document.documentElement.scrollHeight;
    window.parent.postMessage({ type: 'iframe-height', height: h }, '*');
  }
  // Post height after load and after images load
  postHeight();
  window.addEventListener('load', postHeight);
  new MutationObserver(postHeight).observe(document.body, { childList: true, subtree: true });
  // Recheck after images
  document.querySelectorAll('img').forEach(function(img) {
    img.addEventListener('load', postHeight);
    img.addEventListener('error', postHeight);
  });
  // Also on resize
  window.addEventListener('resize', postHeight);
  // Open links in parent window
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a');
    if (a && a.href) {
      e.preventDefault();
      window.parent.postMessage({ type: 'open-link', href: a.href }, '*');
    }
  });
</script>
</html>`;
  }, [html, isDark, getThemeColors]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "iframe-height" && typeof event.data.height === "number") {
        // Only update if the message is from our iframe
        if (iframeRef.current && event.source === iframeRef.current.contentWindow) {
          setHeight(Math.max(40, Math.min(event.data.height, 2000)));
        }
      }
      if (event.data?.type === "open-link" && typeof event.data.href === "string") {
        window.open(event.data.href, "_blank", "noopener,noreferrer");
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // If no HTML content, just show plain text
  if (!html && fallbackText) {
    return (
      <p className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
        {fallbackText}
      </p>
    );
  }

  if (!html) return null;

  return (
    <iframe
      ref={iframeRef}
      srcDoc={buildSrcdoc()}
      sandbox="allow-same-origin allow-scripts"
      className={className}
      style={{
        width: "100%",
        height: `${height}px`,
        border: "none",
        display: "block",
        background: "transparent",
        overflow: "hidden",
      }}
      title="Content"
    />
  );
}
