import { NextResponse } from "next/server";
import Stripe from "stripe";
import { paymentService } from "@/services/PaymentService";
import {
  constructStripeEvent,
  getChargeStatus,
  toChargeStatus,
} from "@/lib/payments/stripe";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = constructStripeEvent(await request.text(), signature);
  } catch (err) {
    console.error("[Stripe webhook] signature verification failed", err);
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  if (
    event.type !== "payment_intent.succeeded" &&
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return NextResponse.json({ received: true });
  }

  try {
    if (event.type === "payment_intent.succeeded") {
      const stripeIntent = event.data.object as Stripe.PaymentIntent;
      await paymentService.settleFromWebhook(stripeIntent.id, toChargeStatus(stripeIntent));
    } else {
      const session = event.data.object as Stripe.Checkout.Session;
      await paymentService.settleFromWebhook(
        session.id,
        await getChargeStatus(session.id)
      );
    }
    return NextResponse.json({ received: true, settled: true });
  } catch (err) {
    console.error("[POST /api/payments/stripe/webhook]", err);
    return NextResponse.json({ error: "Settlement failed." }, { status: 500 });
  }
}
