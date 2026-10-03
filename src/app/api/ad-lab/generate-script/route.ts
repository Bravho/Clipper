import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/helpers";
import { isAdLabEnabledFor } from "@/config/adLab";
import { generateProfessionalAdLabScript } from "@/lib/ai/adLabScriptService";

const requestSchema = z.object({
  brand: z.object({
    id: z.string(),
    name: z.string().trim().min(1).max(160),
    product: z.string().max(2_000),
    audience: z.string().max(2_000),
    promise: z.string().max(2_000),
    tone: z.string().max(500),
    createdAt: z.string(),
  }),
  input: z.object({
    mainMessage: z.string().max(4_000),
    detailedContent: z.string().max(20_000),
    presentationDirection: z.string().max(500),
    objective: z.enum(["awareness", "consideration", "conversion"]),
    duration: z.enum(["15", "30", "45", "60", "90", "120", "180", "300", "600"]),
    revisionComment: z.string().trim().max(4_000).optional(),
    currentDraft: z.object({
      title: z.string().max(1_000),
      mainHook: z.string().max(4_000),
      scriptPlan: z.string().max(30_000),
    }).optional(),
  }),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  // 404 for anyone outside the allowlist: do not reveal the private Ad Lab.
  if (!user || !isAdLabEnabledFor({ id: user.id, email: user.email })) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const result = requestSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: "Invalid script brief." }, { status: 400 });
  }

  const generated = await generateProfessionalAdLabScript(result.data.brand, result.data.input);
  return NextResponse.json(generated);
}
