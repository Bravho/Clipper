import { studioClipRequestFormSchema } from "@/features/requests/validation/clipRequestSchema";
import { labDraftForm } from "@/lib/lab/labStudioIo";

const FORM = { title: "Lab test clip", placeName: "Fixture place", latitude: 13.75, longitude: 100.5, description: "" };

describe("the lab's draft form against the studio's own draft schema", () => {
  it("the lab form is accepted by the studio's draft validation", () => {
    const parsed = studioClipRequestFormSchema.safeParse(labDraftForm(FORM));
    expect(parsed.success).toBe(true);
  });
  it("the earlier form (without platforms) was refused: that gap is closed", () => {
    expect(studioClipRequestFormSchema.safeParse(FORM).success).toBe(false);
  });
  it("the lab sends the editor's default platform and the fixed length", () => {
    expect(labDraftForm(FORM)).toMatchObject({ targetPlatforms: ["tiktok"], durationSeconds: 15 });
  });
});
