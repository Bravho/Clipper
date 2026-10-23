/**
 * Guard for /api/campaign-admin: a signed-in account whose e-mail is on the
 * operator list (`config/merchantCampaigns.ts`). Any role. A non-operator
 * gets 404 — the feature should look absent, not forbidden.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { isCampaignOperator } from "@/config/merchantCampaigns";
import { CampaignError } from "@/services/campaigns";

export type OperatorGuard =
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; response: NextResponse };

export async function requireCampaignOperator(): Promise<OperatorGuard> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorised." }, { status: 401 }) };
  }
  if (!isCampaignOperator(session.user.email)) {
    return { ok: false, response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return { ok: true, user: { id: session.user.id, email: session.user.email ?? "" } };
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function adminFailure(error: unknown, label: string): NextResponse {
  if (error instanceof CampaignError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(`[api/campaign-admin] ${label}`, error);
  const message = /relation .* does not exist/i.test(String((error as Error)?.message))
    ? "Campaign tables are missing — apply migration 043."
    : "Something went wrong.";
  return NextResponse.json({ error: message }, { status: 500 });
}
