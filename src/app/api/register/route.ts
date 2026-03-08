import { NextRequest, NextResponse } from "next/server";
import { signupSchema } from "@/features/auth/validation/signupSchema";
import { accountService, AccountService } from "@/services/AccountService";
import { AuthProvider } from "@/domain/enums/AuthProvider";
import { ConsentInput } from "@/services/ConsentService";
import { PolicyType } from "@/domain/enums/PolicyType";
import type { ApiResponse } from "@/types";

/**
 * POST /api/register
 *
 * Registers a new requester account via email/password.
 * Called by the SignupForm client component.
 *
 * Consent model: by submitting this form the user has agreed to the
 * Terms of Service and Privacy Policy (implicit consent, shown in UI).
 * We record TermsOfService and PrivacyPolicy acceptances automatically.
 * The PrivacyPolicy covers ownership rights and storage retention.
 *
 * NOTE: Google sign-up is handled entirely by NextAuth (signIn callback).
 *       This route is only for email/password registration.
 */
export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse>> {
  try {
    const body = await req.json();
    const parseResult = signupSchema.safeParse(body);

    if (!parseResult.success) {
      const fieldErrors: Record<string, string[]> = {};
      parseResult.error.errors.forEach((err) => {
        const field = err.path[0]?.toString() ?? "unknown";
        if (!fieldErrors[field]) fieldErrors[field] = [];
        fieldErrors[field].push(err.message);
      });

      return NextResponse.json(
        { success: false, error: "Validation failed.", fieldErrors },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    // Implicit consent: submitting the form = agreement to Terms + Privacy Policy.
    // Privacy Policy covers ownership rights and storage retention.
    const consents: ConsentInput[] = [
      { policyType: PolicyType.TermsOfService, accepted: true },
      { policyType: PolicyType.PrivacyPolicy, accepted: true },
    ];

    const passwordHash = await AccountService.hashPassword(data.password);

    await accountService.createRequesterAccount({
      name: data.name,
      email: data.email,
      provider: AuthProvider.Credentials,
      passwordHash,
      providerAccountId: null,
      consents,
      meta: {
        ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      },
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";

    if (message.includes("already exists")) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 409 }
      );
    }

    console.error("[Clipper] /api/register error:", error);
    return NextResponse.json(
      { success: false, error: "Registration failed. Please try again." },
      { status: 500 }
    );
  }
}
