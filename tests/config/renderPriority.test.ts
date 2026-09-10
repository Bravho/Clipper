import {
  RENDER_PRIORITY,
  RENDER_QUEUE,
  renderPriorityForRequest,
  effectiveRenderPriority,
  compareRenderOrder,
} from "@/config/renderQueue";
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";

/**
 * The render line is the scarcest thing in the product — one job is 2–3 hours on
 * a single worker. These pin the two properties that matter: money already
 * received is served first, and nothing waits forever.
 */

const HOUR = 3_600_000;
const NOW = new Date("2026-09-08T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR);

describe("renderPriorityForRequest", () => {
  it("ranks by which allowance the request was drawn against", () => {
    expect(
      renderPriorityForRequest({ pricingTier: RequestPricingTier.Paid })
    ).toBe(RENDER_PRIORITY.paid);
    expect(
      renderPriorityForRequest({ pricingTier: RequestPricingTier.Free })
    ).toBe(RENDER_PRIORITY.free);
  });

  it("treats an unknown or legacy tier as paid", () => {
    // A paid request wrongly demoted keeps a customer waiting; a free one wrongly
    // promoted costs only ordering. Fail toward the customer.
    expect(renderPriorityForRequest({})).toBe(RENDER_PRIORITY.paid);
    expect(renderPriorityForRequest({ pricingTier: "something_new" })).toBe(
      RENDER_PRIORITY.paid
    );
  });
});

describe("effectiveRenderPriority — ageing", () => {
  it("adds nothing to a task just enqueued", () => {
    expect(effectiveRenderPriority(RENDER_PRIORITY.free, NOW, NOW)).toBe(0);
  });

  it("grows by whole hours only, so the order does not churn between polls", () => {
    const perHour = RENDER_QUEUE.agingPointsPerHour;
    expect(effectiveRenderPriority(0, hoursAgo(0.9), NOW)).toBe(0);
    expect(effectiveRenderPriority(0, hoursAgo(1.1), NOW)).toBe(perHour);
    expect(effectiveRenderPriority(0, hoursAgo(3), NOW)).toBe(perHour * 3);
  });

  it("stops at the cap", () => {
    expect(effectiveRenderPriority(0, hoursAgo(1000), NOW)).toBe(
      RENDER_QUEUE.agingCapPoints
    );
  });
});

describe("compareRenderOrder", () => {
  const task = (priority: number, enqueuedHoursAgo: number) => ({
    priority,
    enqueuedAt: hoursAgo(enqueuedHoursAgo),
  });
  /** Sorts a line the way the worker would claim from it. */
  const order = (tasks: { priority: number; enqueuedAt: Date }[]) =>
    [...tasks].sort((a, b) => compareRenderOrder(a, b, NOW));

  it("claims paid work before free work enqueued at the same time", () => {
    const paid = task(RENDER_PRIORITY.paid, 0);
    const free = task(RENDER_PRIORITY.free, 0);
    expect(order([free, paid])[0]).toBe(paid);
  });

  it("orders free work among itself by age alone", () => {
    // There is only one free rank, so nothing but arrival time separates two
    // free requests. A subscriber's work is what jumps the line, not seniority.
    const older = task(RENDER_PRIORITY.free, 3);
    const newer = task(RENDER_PRIORITY.free, 1);
    expect(order([newer, older])[0]).toBe(older);
  });

  it("keeps plain FIFO within one priority", () => {
    const older = task(RENDER_PRIORITY.paid, 2);
    const newer = task(RENDER_PRIORITY.paid, 1);
    expect(order([newer, older])[0]).toBe(older);
  });

  it("lets a long-waiting free task overtake freshly-paid work", () => {
    // The anti-starvation guarantee: without it, sustained paid load means a free
    // requester waits forever and churns before they ever consider upgrading.
    const hoursToOvertake =
      Math.ceil(RENDER_PRIORITY.paid / RENDER_QUEUE.agingPointsPerHour) + 1;
    const stale = task(RENDER_PRIORITY.free, hoursToOvertake);
    const fresh = task(RENDER_PRIORITY.paid, 0);
    expect(order([fresh, stale])[0]).toBe(stale);
  });

  it("does not let ageing invert the policy permanently", () => {
    // Both aged past the cap → the base priority decides again, so paid work
    // never ends up permanently behind an ancient free backlog.
    const ancientFree = task(RENDER_PRIORITY.free, 500);
    const oldPaid = task(RENDER_PRIORITY.paid, 400);
    expect(order([ancientFree, oldPaid])[0]).toBe(oldPaid);
  });
});
