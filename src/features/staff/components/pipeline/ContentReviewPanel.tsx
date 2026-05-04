"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoGenerationJob, ScenePlan } from "@/domain/models/VideoGenerationJob";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";

interface Props {
  requestId: string;
  job: VideoGenerationJob;
  scenePlan: ScenePlan[];
}

export function ContentReviewPanel({ requestId, job, scenePlan }: Props) {
  const router = useRouter();
  const [scriptThai, setScriptThai] = useState(job.scriptThai ?? "");
  const [scriptEnglish, setScriptEnglish] = useState(job.scriptEnglish ?? "");
  const [hookThai, setHookThai] = useState(job.hookThai ?? "");
  const [hookEnglish, setHookEnglish] = useState(job.hookEnglish ?? "");
  const [captionThai, setCaptionThai] = useState(job.captionThai ?? "");
  const [captionEnglish, setCaptionEnglish] = useState(job.captionEnglish ?? "");
  const [captionChinese, setCaptionChinese] = useState(job.captionChinese ?? "");
  const [editedScenePlan, setEditedScenePlan] = useState(
    JSON.stringify(scenePlan, null, 2)
  );
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setLoading("approve");
    setError(null);
    try {
      const res = await fetch(
        `/api/staff/requests/${requestId}/pipeline/content/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: job.id,
            scenePlan: editedScenePlan,
            scriptThai,
            scriptEnglish,
            hookThai,
            hookEnglish,
            captionThai,
            captionEnglish,
            captionChinese,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve");
    } finally {
      setLoading(null);
    }
  }

  async function handleReject() {
    setLoading("reject");
    setError(null);
    try {
      const res = await fetch(
        `/api/staff/requests/${requestId}/pipeline/content/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id, instructions }),
        }
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reject");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Step 1 — Review AI Content Plan</h2>

      {/* Hook — emphasized */}
      <div className="rounded-lg border-2 border-orange-300 bg-orange-50 p-4 space-y-3">
        <p className="text-sm font-semibold text-orange-700">
          First 3 Seconds — Attention Hook
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Thai hook</label>
            <Textarea
              value={hookThai}
              onChange={(e) => setHookThai(e.target.value)}
              rows={2}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">English hook</label>
            <Textarea
              value={hookEnglish}
              onChange={(e) => setHookEnglish(e.target.value)}
              rows={2}
            />
          </div>
        </div>
      </div>

      {/* Bilingual script */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-gray-700">Voiceover Script (15s)</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Thai (spoken voice)
            </label>
            <Textarea
              value={scriptThai}
              onChange={(e) => setScriptThai(e.target.value)}
              rows={5}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              English (subtitle overlay)
            </label>
            <Textarea
              value={scriptEnglish}
              onChange={(e) => setScriptEnglish(e.target.value)}
              rows={5}
            />
          </div>
        </div>
      </div>

      {/* Scene plan */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-gray-700">Scene Plan</p>
        {scenePlan.length > 0 ? (
          <div className="grid grid-cols-3 gap-3">
            {scenePlan.map((scene) => (
              <div key={scene.sceneNumber} className="rounded-lg border bg-gray-50 p-3 text-sm space-y-1">
                <p className="font-semibold text-gray-700">
                  Scene {scene.sceneNumber} ({scene.durationSeconds}s)
                </p>
                <p className="text-gray-600">{scene.visualDescription}</p>
                <p className="text-gray-400 text-xs">Motion: {scene.motionNotes}</p>
              </div>
            ))}
          </div>
        ) : (
          <Textarea
            value={editedScenePlan}
            onChange={(e) => setEditedScenePlan(e.target.value)}
            rows={8}
            className="font-mono text-xs"
          />
        )}
      </div>

      {/* Platform captions */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-gray-700">Platform Captions</p>
        <div className="space-y-3">
          {[
            { label: "Thai", value: captionThai, set: setCaptionThai },
            { label: "English", value: captionEnglish, set: setCaptionEnglish },
            { label: "Chinese (Simplified)", value: captionChinese, set: setCaptionChinese },
          ].map(({ label, value, set }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <Textarea value={value} onChange={(e) => set(e.target.value)} rows={3} />
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <Button
          onClick={handleApprove}
          disabled={loading !== null}
          variant="primary"
        >
          {loading === "approve" ? "Approving..." : "Approve & Send to Kling"}
        </Button>

        <div className="flex-1 space-y-2">
          <Textarea
            placeholder="Instructions for AI regeneration (optional)..."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
          />
          <Button
            onClick={handleReject}
            disabled={loading !== null}
            variant="secondary"
          >
            {loading === "reject" ? "Regenerating..." : "Regenerate with AI"}
          </Button>
        </div>
      </div>
    </div>
  );
}
