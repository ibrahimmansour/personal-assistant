import { NextRequest } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = join(homedir(), ".personal-assistant", "claude-uploads");

const ALLOWED_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
};

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB safety cap

export async function POST(request: NextRequest) {
  // The widget POSTs raw binary in the body with the MIME type in
  // Content-Type. multipart/form-data would also work but raw is simpler
  // for a single-file paste.
  const contentType = request.headers.get("content-type") || "";

  // Strip charset / boundary suffixes — we just need the type.
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const ext = ALLOWED_MIME[mime];
  if (!ext) {
    return Response.json(
      { error: `Unsupported content type: ${mime || "(none)"}` },
      { status: 415 },
    );
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return Response.json({ error: "Failed to read body" }, { status: 400 });
  }

  if (bytes.byteLength === 0) {
    return Response.json({ error: "Empty body" }, { status: 400 });
  }
  if (bytes.byteLength > MAX_BYTES) {
    return Response.json({ error: "File too large (max 25 MB)" }, { status: 413 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  const fullPath = join(UPLOAD_DIR, filename);
  await writeFile(fullPath, Buffer.from(bytes));

  return Response.json({
    path: fullPath,
    filename,
    size: bytes.byteLength,
    mime,
  });
}
