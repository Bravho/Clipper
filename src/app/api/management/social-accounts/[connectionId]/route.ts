import { NextResponse } from "next/server";
import {
  managementConnectionService,
  ManagementConnectionError,
} from "@/services/management/ManagementConnectionService";
import { requireManagementUser, managementErrorResponse } from "../../_guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/management/social-accounts/[connectionId]
 *
 * Refresh one connection's metadata and status from the provider. Used by the
 * "reconnect / refresh" affordance when an account has gone stale.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  const { connectionId } = await params;

  try {
    const updated = await managementConnectionService.refresh(guard.user.id, connectionId);
    return NextResponse.json({
      connection: {
        id: updated.id,
        platform: updated.platform,
        accountName: updated.accountName,
        accountUsername: updated.accountUsername,
        avatarUrl: updated.avatarUrl,
        status: updated.connectionStatus,
        lastSyncedAt: updated.lastSyncedAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    if (err instanceof ManagementConnectionError) {
      return NextResponse.json(
        { error: err.message, reason: err.code },
        { status: err.code === "not_owner" ? 404 : 400 }
      );
    }
    return managementErrorResponse(
      "POST /api/management/social-accounts/[connectionId]",
      err
    );
  }
}

/**
 * DELETE /api/management/social-accounts/[connectionId]
 *
 * Disconnect an account.
 *
 * Removed from the dashboard even if the provider call fails — the user asked
 * for it gone, and leaving it visible because a third party was unreachable
 * would be the wrong answer. Already-published posts are untouched; this only
 * stops future publishing.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  const { connectionId } = await params;

  try {
    await managementConnectionService.disconnect(guard.user.id, connectionId);
    return NextResponse.json({ disconnected: true });
  } catch (err) {
    if (err instanceof ManagementConnectionError) {
      return NextResponse.json(
        { error: err.message, reason: err.code },
        { status: err.code === "not_owner" ? 404 : 400 }
      );
    }
    return managementErrorResponse(
      "DELETE /api/management/social-accounts/[connectionId]",
      err
    );
  }
}
