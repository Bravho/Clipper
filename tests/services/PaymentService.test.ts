import { PaymentService } from "@/services/PaymentService";
import { MockPaymentIntentRepository } from "@/repositories/mock/MockPaymentIntentRepository";
import { PaymentStatus } from "@/domain/enums/PaymentStatus";

/**
 * PaymentService tests — isolated fresh repo + fake gateway + fake credit service.
 * No network, no DB.
 */
function makeService(opts?: {
  paid?: boolean;
  failed?: boolean;
  gatewayAmount?: number | null;
}) {
  const intents = new MockPaymentIntentRepository(new Map());

  const creditCalls: Array<{ userId: string; credits: number; baht: number }> = [];
  const credits = {
    async creditTopup(userId: string, credits: number, baht: number) {
      creditCalls.push({ userId, credits, baht });
      return {} as never;
    },
  };

  // Track the amount charged per reference so the fake gateway echoes the real
  // intent amount (as Stripe would), unless a test overrides it.
  const chargedAmounts = new Map<string, number>();

  const gatewayStats = { statusChecks: 0 };
  const gateway = {
    async createPromptPayQr(params: { amountBaht: number; referenceNo: string }) {
      chargedAmounts.set(params.referenceNo, params.amountBaht);
      return {
        qrImageDataUrl: "data:image/png;base64,ZmFrZQ==",
        referenceNo: params.referenceNo,
        gatewayRef: `pi_${params.referenceNo}`,
      };
    },
    async createCardCheckout(params: { amountBaht: number; referenceNo: string }) {
      chargedAmounts.set(params.referenceNo, params.amountBaht);
      return {
        checkoutUrl: "https://checkout.stripe.test/session",
        gatewayRef: `cs_${params.referenceNo}`,
      };
    },
    async getChargeStatus(gatewayRef: string) {
      gatewayStats.statusChecks++;
      const referenceNo = gatewayRef.replace(/^(pi_|cs_)/, "");
      const amountBaht =
        opts?.gatewayAmount === undefined
          ? chargedAmounts.get(referenceNo) ?? null
          : opts.gatewayAmount;
      return {
        paid: opts?.paid ?? true,
        gatewayRef,
        resultCode: opts?.paid === false ? "requires_action" : "succeeded",
        amountBaht,
        currency: "thb",
        referenceNo,
        failed: opts?.failed ?? false,
      };
    },
  };

  const svc = new PaymentService(intents, credits as never, gateway as never);
  return { svc, intents, creditCalls, gatewayStats };
}

describe("PaymentService", () => {
  it("creates a top-up intent with 1:1 credits and a QR", async () => {
    const { svc } = makeService();
    const res = await svc.createTopupIntent("user-1", 49, "user@example.com");

    expect(res.amountBaht).toBe(49);
    expect(res.creditsToAdd).toBe(49);
    expect(res.qrImageDataUrl).toContain("data:image/png");
    expect(res.referenceNo).toMatch(/^RC-/);
  });

  it("creates an immediate Stripe card Checkout top-up", async () => {
    const { svc, intents } = makeService();
    const res = await svc.createCardTopupIntent(
      "user-1",
      98,
      "https://rclipper.test/dashboard/credits"
    );

    expect(res.amountBaht).toBe(98);
    expect(res.creditsToAdd).toBe(98);
    expect(res.checkoutUrl).toContain("checkout.stripe.test");
    const stored = await intents.findById(res.intentId);
    expect(stored?.gatewayRef).toBe(`cs_${res.referenceNo}`);
  });

  it("settles a verified payment and credits the wallet once", async () => {
    const { svc, creditCalls } = makeService({ paid: true });
    const intent = await svc.createTopupIntent("user-1", 99, "user@example.com");

    const settled = await svc.settleFromWebhook(`pi_${intent.referenceNo}`);

    expect(settled.status).toBe(PaymentStatus.Paid);
    expect(settled.gatewayRef).toBe(`pi_${intent.referenceNo}`);
    expect(creditCalls).toHaveLength(1);
    expect(creditCalls[0]).toEqual({ userId: "user-1", credits: 99, baht: 99 });
  });

  it("is idempotent — a re-delivered webhook does not double-credit", async () => {
    const { svc, creditCalls } = makeService({ paid: true });
    const intent = await svc.createTopupIntent("user-1", 49, "user@example.com");

    await svc.settleFromWebhook(`pi_${intent.referenceNo}`);
    await svc.settleFromWebhook(`pi_${intent.referenceNo}`); // duplicate delivery
    await svc.settleFromWebhook(`pi_${intent.referenceNo}`); // and again

    expect(creditCalls).toHaveLength(1);
  });

  it("marks Failed and does not credit when the gateway reports unpaid", async () => {
    const { svc, creditCalls } = makeService({ paid: false, failed: true });
    const intent = await svc.createTopupIntent("user-1", 49, "user@example.com");

    const settled = await svc.settleFromWebhook(`pi_${intent.referenceNo}`);

    expect(settled.status).toBe(PaymentStatus.Failed);
    expect(creditCalls).toHaveLength(0);
  });

  it("rejects when the gateway amount does not match the intent", async () => {
    const { svc, creditCalls } = makeService({ paid: true, gatewayAmount: 10 });
    const intent = await svc.createTopupIntent("user-1", 49, "user@example.com");

    const settled = await svc.settleFromWebhook(`pi_${intent.referenceNo}`);

    expect(settled.status).toBe(PaymentStatus.Failed);
    expect(creditCalls).toHaveLength(0);
  });

  it("throws on an unknown reference", async () => {
    const { svc } = makeService();
    await expect(svc.settleFromWebhook("pi_nope")).rejects.toThrow(
      "Unknown payment reference."
    );
  });

  // ── Poll-side settlement backstop ──────────────────────────────────────────

  it("poll backstop settles a paid intent even with no webhook", async () => {
    const { svc, creditCalls } = makeService({ paid: true });
    const intent = await svc.createTopupIntent("user-1", 99, "user@example.com");

    const res = await svc.pollIntentStatus(intent.intentId, "user-1");

    expect(res?.status).toBe(PaymentStatus.Paid);
    expect(creditCalls).toEqual([{ userId: "user-1", credits: 99, baht: 99 }]);
  });

  it("poll backstop leaves an unpaid intent Pending — never marks it Failed", async () => {
    const { svc, creditCalls } = makeService({ paid: false });
    const intent = await svc.createTopupIntent("user-1", 49, "user@example.com");

    const res = await svc.pollIntentStatus(intent.intentId, "user-1");

    expect(res?.status).toBe(PaymentStatus.Pending);
    expect(creditCalls).toHaveLength(0);
  });

  it("poll backstop throttles gateway checks per intent", async () => {
    const { svc, gatewayStats } = makeService({ paid: false });
    const intent = await svc.createTopupIntent("user-1", 49, "user@example.com");

    // Three rapid polls within the throttle window → only ONE gateway check.
    await svc.pollIntentStatus(intent.intentId, "user-1");
    await svc.pollIntentStatus(intent.intentId, "user-1");
    await svc.pollIntentStatus(intent.intentId, "user-1");

    expect(gatewayStats.statusChecks).toBe(1);
  });

  it("returns null for a missing intent or the wrong owner", async () => {
    const { svc } = makeService({ paid: true });
    const intent = await svc.createTopupIntent("user-1", 49, "user@example.com");

    expect(await svc.pollIntentStatus("does-not-exist", "user-1")).toBeNull();
    expect(await svc.pollIntentStatus(intent.intentId, "someone-else")).toBeNull();
  });

  it("concurrent webhook + poll credit the wallet only once", async () => {
    const { svc, creditCalls } = makeService({ paid: true });
    const intent = await svc.createTopupIntent("user-1", 49, "user@example.com");

    await Promise.all([
      svc.settleFromWebhook(`pi_${intent.referenceNo}`),
      svc.pollIntentStatus(intent.intentId, "user-1"),
    ]);

    // The atomic Pending→Paid claim means exactly one path credits.
    expect(creditCalls).toHaveLength(1);
  });
});
