import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/helpers";
import { isAdLabEnabledFor } from "@/config/adLab";
import { adLabWorkspaceRepository } from "@/repositories/index";
import { isTransientPostgresConnectionError } from "@/lib/postgresErrors";
import { workspaceSchema } from "@/services/ad-lab/workspaceSchema";

async function adLabOwner() {
  const user = await getCurrentUser();
  // 404 (not 401/403) for anyone outside the allowlist, so the endpoint does
  // not reveal that the private Ad Lab exists.
  if (!user || !isAdLabEnabledFor({ id: user.id, email: user.email })) {
    return { error: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return { ownerId: user.id };
}

function stripSensitiveFields(result: import("@/repositories/interfaces/IAdLabWorkspaceRepository").AdLabWorkspaceResult): import("@/repositories/interfaces/IAdLabWorkspaceRepository").AdLabWorkspaceResult {
  if (!result.store) return result;
  // adsReporting contains encrypted tokens and OAuth states — never send to browser.
  const { adsReporting: _stripped, ...safeStore } = result.store;
  return { ...result, store: safeStore as typeof result.store };
}

export async function GET() {
  const auth = await adLabOwner();
  if (auth.error) return auth.error;
  try {
    const result = await adLabWorkspaceRepository.findByOwnerId(auth.ownerId!);
    return NextResponse.json(stripSensitiveFields(result));
  } catch (error) {
    if (isTransientPostgresConnectionError(error)) {
      console.warn("[GET /api/ad-lab/workspace] PostgreSQL is temporarily unreachable.");
    } else {
      console.error("[GET /api/ad-lab/workspace]", error);
    }
    return NextResponse.json(
      { error: "Ad Lab database is unavailable." },
      { status: 503, headers: { "Retry-After": "15" } }
    );
  }
}

export async function PUT(request: Request) {
  const auth = await adLabOwner();
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  const parsed = workspaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Ad Lab workspace." }, { status: 400 });
  }
  try {
    // Load server's existing adsReporting and merge it back — clients must never
    // overwrite tokens or OAuth states stored server-side.
    const existing = await adLabWorkspaceRepository.findByOwnerId(auth.ownerId!);
    const serverAdsReporting = existing.store?.adsReporting;
    const dataToSave = serverAdsReporting
      ? { ...parsed.data, adsReporting: serverAdsReporting }
      : parsed.data;
    const result = await adLabWorkspaceRepository.upsert(auth.ownerId!, dataToSave);
    return NextResponse.json(stripSensitiveFields(result));
  } catch (error) {
    if (isTransientPostgresConnectionError(error)) {
      console.warn("[PUT /api/ad-lab/workspace] PostgreSQL is temporarily unreachable.");
    } else {
      console.error("[PUT /api/ad-lab/workspace]", error);
    }
    return NextResponse.json(
      { error: "Ad Lab database is unavailable." },
      { status: 503, headers: { "Retry-After": "15" } }
    );
  }
}
