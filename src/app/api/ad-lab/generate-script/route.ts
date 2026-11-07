import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/helpers";
import { isAdLabEnabledFor } from "@/config/adLab";
import { generateProfessionalAdLabScript } from "@/lib/ai/adLabScriptService";
import { scriptRequestSchema } from "@/services/ad-lab/scriptRequestSchema";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  // 404 for anyone outside the allowlist: do not reveal the private Ad Lab.
  if (!user || !isAdLabEnabledFor({ id: user.id, email: user.email })) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const result = scriptRequestSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: "Invalid script brief." }, { status: 400 });
  }

  const generated = await generateProfessionalAdLabScript(result.data.brand, result.data.input);
  return NextResponse.json(generated);
}
