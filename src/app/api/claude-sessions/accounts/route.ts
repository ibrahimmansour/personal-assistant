import { listClaudeAccounts } from "@/lib/claude-accounts";

export const dynamic = "force-dynamic";

/** Logged-in Claude Code accounts (`~/.claude` plus `~/.claude-<name>`). */
export async function GET() {
  const accounts = await listClaudeAccounts();
  return Response.json({
    accounts: accounts.map((a) => ({ id: a.id, label: a.label, email: a.email, isDefault: a.isDefault })),
  });
}
