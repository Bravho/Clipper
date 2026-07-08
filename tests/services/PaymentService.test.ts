import { PaymentService } from "@/services/PaymentService";
import { MockPaymentIntentRepository } from "@/repositories/mock/MockPaymentIntentRepository";
import { PaymentStatus } from "@/domain/enums/PaymentStatus";

/**
 * PaymentService tests — isolated fresh repo + fake gateway + fake credit service.
 * No network, no DB.
 */
function makeService(opts?: {
  paid?: boolean;
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
  // intent amount (as GB Prime Pay would), unless a test overrides it.
  const chargedAmounts = new Map<string, number>();

  const gateway = {
    async createPromptPayQr(params: { amountBaht: number; referenceNo: string }) {
      chargedAmounts.set(params.referenceNo, params.amountBaht);
      return {
        qrImageDataUrl: "data:image/png;base64,ZmFrZQ==",
        referenceNo: params.referenceNo,
      };
    },
    async getChargeStatus(referenceNo: string) {
      const amountBaht =
        opts?.gatewayAmount === undefined
          ? chargedAmounts.get(referenceNo) ?? null
          : opts.gatewayAmount;
      return {
        paid: opts?.paid ?? true,
        gatewayRef: "GBP-123",
        resultCode: opts?.paid === false ? "01" : "00",
        amountBaht,
      };
    },
  };

  const svc = new PaymentService(intents, credits as never, gateway as never);
  return { svc, intents, creditCalls };
}

describe("PaymentService", () => {
  it("creates a top-up intent with 1:1 credits and a QR", async () => {
    const { svc } = makeService();
    const res = await svc.createTopupIntent("user-1", 49);

    expect(res.amountBaht).toBe(49);
    expect(res.creditsToAdd).toBe(49);
    expect(res.qrImageDataUrl).toContain("data:image/png");
    expect(res.referenceNo).toMatch(/^RC-/);
  });

  it("settles a verified payment and credits the wallet once", async () => {
    const { svc, creditCalls } = makeService({ paid: true });
    const intent = await svc.createTopupIntent("user-1", 99);

    const settled = await svc.settleFromWebhook(intent.referenceNo);

    expect(settled.status).toBe(PaymentStatus.Paid);
    expect(settled.gatewayRef).toBe("GBP-123");
    expect(creditCalls).toHaveLength(1);
    expect(creditCalls[0]).toEqual({ userId: "user-1", credits: 99, baht: 99 });
  });

  it("is idempotent — a re-delivered webhook does not double-credit", async () => {
    const { svc, creditCalls } = makeService({ paid: true });
    const intent = await svc.createTopupIntent("user-1", 49);

    await svc.settleFromWebhook(intent.referenceNo);
    await svc.settleFromWebhook(intent.referenceNo); // duplicate delivery
    await svc.settleFromWebhook(intent.referenceNo); // and again

    expect(creditCalls).toHaveLength(1);
  });

  it("marks Failed and does not credit when the gateway reports unpaid", async () => {
    const { svc, creditCalls } = makeService({ paid: false });
    const intent = await svc.createTopupIntent("user-1", 49);

    const settled = await svc.settleFromWebhook(intent.referenceNo);

    expect(settled.status).toBe(PaymentStatus.Failed);
    expect(creditCalls).toHaveLength(0);
  });

  it("rejects when the gateway amount does not match the intent", async () => {
    const { svc, creditCalls } = makeService({ paid: true, gatewayAmount: 10 });
    const intent = await svc.createTopupIntent("user-1", 49);

    const settled = await svc.settleFromWebhook(intent.referenceNo);

    expect(settled.status).toBe(PaymentStatus.Failed);
    expect(creditCalls).toHaveLength(0);
  });

  it("throws on an unknown reference", async () => {
    const { svc } = makeService();
    await expect(svc.settleFromWebhook("RC-nope")).rejects.toThrow(
      "Unknown payment reference."
    );
  });
});
