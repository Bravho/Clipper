import { NextResponse } from "next/server";

/**
 * The former self-reported transfer endpoint has been retired. It trusted a
 * requester-supplied amount/reference and could grant unverified credits.
 * All requester top-ups must now be confirmed by Stripe.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Manual credit purchases are no longer available. Please use Stripe." },
    { status: 410 }
  );
}
