import {
  RequestPresentationService,
} from "@/services/RequestPresentationService";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Platform } from "@/domain/enums/Platform";
import type { ClipRequest } from "@/domain/models/ClipRequest";

function makeRequest(overrides: Partial<ClipRequest> = {}): ClipRequest {
  return {
    id: "req-test",
    userId: "user-test",
    title: "Test Clip",
    description: "Test description",
    targetAudience: "Testers",
    targetPlatforms: [Platform.TikTok],
    preferredStyle: "Dynamic / Energetic",
    preferredLanguage: "English",
    status: RequestStatus.Draft,
    estimatedDueDate: null,
    confirmedDueDate: null,
    dueDateConfirmed: false,
    holdReason: null,
    rejectionReason: null,
    queuePosition: null,
    creditConfirmed: false,
    rightsConfirmed: false,
    durationSeconds: 15,
    assignedEditorId: null,
    editorType: null,
    priceBaht: 500,
    creditsUsed: 1,
    discountBaht: 10,
    amountPaidBaht: 490,
    revisionCount: 0,
    creditsCost: 10,
    submittedAt: null,
    createdAt: new Date("2026-03-01"),
    updatedAt: new Date("2026-03-01"),
    ...overrides,
  };
}

const svc = new RequestPresentationService();

// ── Status presentation ───────────────────────────────────────────────────────

describe("RequestPresentationService.getStatusPresentation", () => {
  it("returns correct label for each status", () => {
    const cases: [RequestStatus, string][] = [
      [RequestStatus.Draft, "แบบร่าง"],
      [RequestStatus.Submitted, "ส่งแล้ว"],
      [RequestStatus.UnderReview, "กำลังตรวจสอบ"],
      [RequestStatus.AcceptedForProduction, "รับงานแล้ว"],
      [RequestStatus.Editing, "กำลังผลิต"],
      [RequestStatus.ScheduledForPublishing, "กำหนดเผยแพร่แล้ว"],
      [RequestStatus.Published, "เผยแพร่แล้ว"],
      [RequestStatus.Delivered, "ส่งมอบแล้ว"],
      [RequestStatus.OnHold, "พักไว้ชั่วคราว"],
      [RequestStatus.Rejected, "ปฏิเสธ"],
    ];

    for (const [status, expected] of cases) {
      const p = svc.getStatusPresentation(status);
      expect(p.label).toBe(expected);
    }
  });

  it("assigns red badge to Rejected", () => {
    const p = svc.getStatusPresentation(RequestStatus.Rejected);
    expect(p.badgeVariant).toBe("red");
  });

  it("assigns yellow badge to OnHold", () => {
    const p = svc.getStatusPresentation(RequestStatus.OnHold);
    expect(p.badgeVariant).toBe("yellow");
  });

  it("assigns green badge to Delivered", () => {
    const p = svc.getStatusPresentation(RequestStatus.Delivered);
    expect(p.badgeVariant).toBe("green");
  });

  it("assigns slate badge to Draft", () => {
    const p = svc.getStatusPresentation(RequestStatus.Draft);
    expect(p.badgeVariant).toBe("slate");
  });
});

// ── Due date display ──────────────────────────────────────────────────────────

describe("RequestPresentationService.getDueDateDisplay", () => {
  it("returns show=false for Draft status", () => {
    const req = makeRequest({ status: RequestStatus.Draft });
    const d = svc.getDueDateDisplay(req);
    expect(d.show).toBe(false);
  });

  it("returns show=false for Submitted status", () => {
    const req = makeRequest({
      status: RequestStatus.Submitted,
      submittedAt: new Date(),
    });
    const d = svc.getDueDateDisplay(req);
    expect(d.show).toBe(false);
  });

  it("shows pending message for UnderReview when no confirmed date", () => {
    const req = makeRequest({
      status: RequestStatus.UnderReview,
      dueDateConfirmed: false,
      confirmedDueDate: null,
    });
    const d = svc.getDueDateDisplay(req);
    expect(d.show).toBe(true);
    expect(d.formattedDate).toBeNull();
    expect(d.message).toContain("อยู่ระหว่างการตรวจสอบ");
  });

  it("shows confirmed date for AcceptedForProduction when staff confirmed", () => {
    const futureDate = new Date("2026-12-31");
    const req = makeRequest({
      status: RequestStatus.AcceptedForProduction,
      dueDateConfirmed: true,
      confirmedDueDate: futureDate,
    });
    const d = svc.getDueDateDisplay(req);
    expect(d.show).toBe(true);
    expect(d.formattedDate).not.toBeNull();
    expect(d.message).toContain("คาดว่าเสร็จ");
  });

  it("shows pending message for AcceptedForProduction when not confirmed", () => {
    const req = makeRequest({
      status: RequestStatus.AcceptedForProduction,
      dueDateConfirmed: false,
      confirmedDueDate: null,
    });
    const d = svc.getDueDateDisplay(req);
    expect(d.show).toBe(true);
    expect(d.formattedDate).toBeNull();
    expect(d.message).toContain("อยู่ระหว่างการตรวจสอบ");
  });

  it("does not show due date for OnHold", () => {
    const req = makeRequest({
      status: RequestStatus.OnHold,
      holdReason: "Something is wrong.",
    });
    const d = svc.getDueDateDisplay(req);
    expect(d.show).toBe(false);
  });

  it("does not show due date for Rejected", () => {
    const req = makeRequest({
      status: RequestStatus.Rejected,
      rejectionReason: "Cannot proceed.",
    });
    const d = svc.getDueDateDisplay(req);
    expect(d.show).toBe(false);
  });

  it("shows completed date message for Delivered", () => {
    const pastDate = new Date("2026-01-15");
    const req = makeRequest({
      status: RequestStatus.Delivered,
      dueDateConfirmed: true,
      confirmedDueDate: pastDate,
    });
    const d = svc.getDueDateDisplay(req);
    expect(d.show).toBe(true);
    expect(d.formattedDate).not.toBeNull();
    expect(d.message).toContain("เสร็จสิ้นเมื่อ");
  });

  it("NEVER exposes estimatedDueDate to requester — only confirmedDueDate", () => {
    // Requester should only see the confirmed date, not the internal estimate.
    const internalEstimate = new Date("2026-03-10");
    const req = makeRequest({
      status: RequestStatus.UnderReview,
      estimatedDueDate: internalEstimate,
      dueDateConfirmed: false,
      confirmedDueDate: null,
    });
    const d = svc.getDueDateDisplay(req);
    // Even though estimatedDueDate is set, show=true but formattedDate is null
    expect(d.formattedDate).toBeNull();
  });
});

// ── Queue display ─────────────────────────────────────────────────────────────

describe("RequestPresentationService.getQueueDisplay", () => {
  it("does not show queue info for Draft", () => {
    const d = svc.getQueueDisplay(makeRequest({ status: RequestStatus.Draft }));
    expect(d.show).toBe(false);
  });

  it("shows queue message for Submitted with position", () => {
    const d = svc.getQueueDisplay(
      makeRequest({ status: RequestStatus.Submitted, queuePosition: 4 })
    );
    expect(d.show).toBe(true);
    expect(d.message).toContain("4");
  });

  it("shows fallback message for Submitted without position", () => {
    const d = svc.getQueueDisplay(
      makeRequest({ status: RequestStatus.Submitted, queuePosition: null })
    );
    expect(d.show).toBe(true);
    expect(d.message.length).toBeGreaterThan(0);
  });

  it("shows 'next in queue' message when position is 1", () => {
    const d = svc.getQueueDisplay(
      makeRequest({ status: RequestStatus.AcceptedForProduction, queuePosition: 1 })
    );
    expect(d.show).toBe(true);
    expect(d.message).toContain("ลำดับถัดไป");
  });

  it("does not show queue info for Delivered", () => {
    const d = svc.getQueueDisplay(
      makeRequest({ status: RequestStatus.Delivered })
    );
    expect(d.show).toBe(false);
  });

  it("does not show queue info for Rejected", () => {
    const d = svc.getQueueDisplay(
      makeRequest({ status: RequestStatus.Rejected })
    );
    expect(d.show).toBe(false);
  });

  it("shows active production message for Editing", () => {
    const d = svc.getQueueDisplay(makeRequest({ status: RequestStatus.Editing }));
    expect(d.show).toBe(true);
    expect(d.message).toContain("ผลิต");
  });

  it("shows hold message for OnHold", () => {
    const d = svc.getQueueDisplay(makeRequest({ status: RequestStatus.OnHold }));
    expect(d.show).toBe(true);
    expect(d.message).toContain("พัก");
  });
});

// ── buildRequestView ──────────────────────────────────────────────────────────

describe("RequestPresentationService.buildRequestView", () => {
  it("builds a complete view with correct platform labels", () => {
    const req = makeRequest({
      status: RequestStatus.Delivered,
      targetPlatforms: [Platform.TikTok, Platform.Facebook],
    });

    const view = svc.buildRequestView(req, [], [], []);
    expect(view.targetPlatforms).toContain("TikTok");
    expect(view.targetPlatforms).toContain("Facebook");
  });

  it("sets statusPresentation correctly in the view", () => {
    const req = makeRequest({ status: RequestStatus.Editing });
    const view = svc.buildRequestView(req, [], [], []);
    expect(view.statusPresentation.label).toBe("กำลังผลิต");
  });
});
