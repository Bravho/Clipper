import { NextResponse } from "next/server";
import {
  managementConnectionService,
  ManagementConnectionError,
} from "@/services/management/ManagementConnectionService";
import { requireManagementUser } from "../../_guard";
import { ROUTES } from "@/config/routes";
import { appUrl } from "@/lib/appOrigin";

export const dynamic = "force-dynamic";

/**
 * GET /api/management/social-accounts/callback
 *
 * Where the provider sends the user after the OAuth screen. It always redirects
 * here, success or failure, with these query parameters:
 *
 *   provider, projectId, isSuccess, accountIds, failedAccountIds, error
 *
 * FAILURES ARE ONLY VISIBLE HERE. No webhook fires for a cancelled or failed
 * authorization, so this redirect is the sole signal — which is why the failure
 * branch is handled explicitly rather than assumed away.
 *
 * NOTHING IN THIS QUERY STRING IS TRUSTED. `accountIds` is a hint; the service
 * re-fetches every account from the provider and requires its `external_id` to
 * match the session user before writing anything.
 *
 * This is a browser navigation, so every outcome ends in a redirect back to the
 * connections page carrying a status the UI can render — never a raw JSON error.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  // Built from NEXTAUTH_URL, not `url.origin`. The OAuth hand-off arrives with
  // a request URL we cannot trust the scheme of, and echoing it back sent the
  // browser to https://localhost:3000 — a port serving plain HTTP — so a
  // SUCCESSFUL connection still ended on ERR_SSL_PROTOCOL_ERROR.
  const connectionsUrl = (status: string, detail?: string) => {
    const target = appUrl(request, ROUTES.MANAGEMENT_CONNECTIONS);
    target.searchParams.set("connection", status);
    if (detail) target.searchParams.set("detail", detail.slice(0, 200));
    return NextResponse.redirect(target);
  };

  const guard = await requireManagementUser();
  if (!guard.ok) {
    // Session expired during the OAuth round trip. Send them to sign in rather
    // than showing an API error page.
    return NextResponse.redirect(appUrl(request, ROUTES.LOGIN));
  }

  // The provider reports failure and cancellation the same way.
  const isSuccess = params.get("isSuccess");
  if (isSuccess !== null && isSuccess !== "true") {
    const providerError = params.get("error") ?? "";
    console.error("[management connection] provider reported failure", {
      userId: guard.user.id,
      provider: params.get("provider"),
      // Logged for support; never shown raw to the user.
      error: providerError.slice(0, 300),
    });
    return connectionsUrl("failed");
  }

  const accountIds = (params.get("accountIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (accountIds.length === 0) {
    return connectionsUrl("none");
  }

  try {
    const connected = await managementConnectionService.completeCallback({
      user: guard.user,
      state: params.get("state"),
      accountIds,
    });

    if (connected.length === 0) {
      // Every claimed account failed its ownership re-check. Deliberately vague
      // to the user; the detail is in the server log.
      return connectionsUrl("rejected");
    }

    return connectionsUrl("success", String(connected.length));
  } catch (err) {
    if (err instanceof ManagementConnectionError) {
      return connectionsUrl(err.code);
    }
    console.error("[GET /api/management/social-accounts/callback]", err);
    return connectionsUrl("error");
  }
}
