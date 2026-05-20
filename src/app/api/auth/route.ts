import { NextRequest } from "next/server";
import {
  createSessionCookie,
  clearSessionCookie,
  verifyPassword,
  setPassword,
  isPasswordConfigured,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, password, newPassword } = body;

  if (action === "setup") {
    // Only allow setup if no password exists yet
    if (isPasswordConfigured()) {
      return Response.json({ error: "Password already configured" }, { status: 400 });
    }
    if (!password || password.length < 4) {
      return Response.json({ error: "Password must be at least 4 characters" }, { status: 400 });
    }
    setPassword(password);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": createSessionCookie(),
      },
    });
  }

  if (action === "login") {
    if (!isPasswordConfigured()) {
      return Response.json({ error: "No password configured" }, { status: 400 });
    }
    if (verifyPassword(password)) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": createSessionCookie(),
        },
      });
    }
    return Response.json({ error: "Invalid password" }, { status: 401 });
  }

  if (action === "logout") {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": clearSessionCookie(),
      },
    });
  }

  if (action === "change-password") {
    if (!isPasswordConfigured()) {
      return Response.json({ error: "No password configured" }, { status: 400 });
    }
    if (!verifyPassword(password)) {
      return Response.json({ error: "Current password is incorrect" }, { status: 401 });
    }
    if (!newPassword || newPassword.length < 4) {
      return Response.json({ error: "New password must be at least 4 characters" }, { status: 400 });
    }
    setPassword(newPassword);
    // Issue new session since signing secret changed
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": createSessionCookie(),
      },
    });
  }

  if (action === "status") {
    return Response.json({ configured: isPasswordConfigured() });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
