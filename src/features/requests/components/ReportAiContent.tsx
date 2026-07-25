"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

export function ReportAiContent({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  const [reportType, setReportType] = useState<"feedback" | "safety">("feedback");
  const [reason, setReason] = useState("video_quality");
  const [rating, setRating] = useState(5);
  const [details, setDetails] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/requests/${requestId}/report-ai-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportType, reason, rating: reportType === "feedback" ? rating : null, details }),
      });
      if (!response.ok) throw new Error("Report failed.");
      setMessage(
        reportType === "feedback"
          ? "ขอบคุณสำหรับความคิดเห็น ทีมงานจะนำไปปรับปรุงการสร้างวิดีโอ"
          : "ส่งรายงานแล้ว ทีมงานจะตรวจสอบเนื้อหานี้"
      );
      setOpen(false);
      setDetails("");
    } catch {
      setMessage("ไม่สามารถส่งรายงานได้ กรุณาลองอีกครั้ง");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Button type="button" variant="outline" onClick={() => setOpen((value) => !value)}>
        ให้ความคิดเห็นหรือรายงานวิดีโอ
      </Button>
      {open && (
        <div className="mt-4 space-y-3">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">ประเภท</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setReportType("feedback");
                  setReason("video_quality");
                }}
                className={`rounded-lg border p-3 text-sm font-medium ${
                  reportType === "feedback"
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600"
                }`}
              >
                ข้อเสนอแนะเพื่อปรับปรุง
              </button>
              <button
                type="button"
                onClick={() => {
                  setReportType("safety");
                  setReason("unsafe");
                }}
                className={`rounded-lg border p-3 text-sm font-medium ${
                  reportType === "safety"
                    ? "border-red-400 bg-red-50 text-red-700"
                    : "border-slate-200 text-slate-600"
                }`}
              >
                รายงานปัญหาเนื้อหา
              </button>
            </div>
          </div>
          {reportType === "feedback" && (
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">คะแนนวิดีโอ</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRating(value)}
                    className={`text-2xl ${value <= rating ? "text-amber-400" : "text-slate-200"}`}
                    aria-label={`${value} ดาว`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          )}
          <Select
            label={reportType === "feedback" ? "หัวข้อที่ควรปรับปรุง" : "เหตุผลที่รายงาน"}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            options={
              reportType === "feedback"
                ? [
                    { value: "video_quality", label: "คุณภาพวิดีโอโดยรวม" },
                    { value: "scene_selection", label: "การเลือกภาพหรือฉาก" },
                    { value: "motion_direction", label: "การเคลื่อนไหวหรือทิศทางกล้อง" },
                    { value: "audio_music", label: "เสียงพากย์หรือเพลง" },
                    { value: "subtitles", label: "ซับไตเติ้ล" },
                    { value: "aspect_ratio", label: "ขนาดวิดีโอสำหรับช่องทาง" },
                    { value: "other_feedback", label: "ข้อเสนอแนะอื่น ๆ" },
                  ]
                : [
                    { value: "unsafe", label: "เนื้อหาไม่ปลอดภัยหรือไม่เหมาะสม" },
                    { value: "sexual", label: "เนื้อหาทางเพศ" },
                    { value: "violent", label: "ความรุนแรง" },
                    { value: "hate", label: "ความเกลียดชังหรือคุกคาม" },
                    { value: "privacy", label: "ละเมิดความเป็นส่วนตัว" },
                    { value: "impersonation", label: "ปลอมแปลงบุคคลหรือเสียง" },
                    { value: "copyright", label: "ลิขสิทธิ์หรือเครื่องหมายการค้า" },
                    { value: "misleading", label: "ข้อมูลหลอกลวง" },
                    { value: "other", label: "อื่น ๆ" },
                  ]
            }
          />
          <Textarea
            label={reportType === "feedback" ? "รายละเอียดหรือสิ่งที่อยากให้ปรับปรุง" : "รายละเอียดเพิ่มเติม"}
            value={details}
            maxLength={2000}
            onChange={(event) => setDetails(event.target.value)}
          />
          <Button type="button" loading={loading} onClick={() => void submit()}>
            {reportType === "feedback" ? "ส่งความคิดเห็น" : "ส่งรายงาน"}
          </Button>
        </div>
      )}
      {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
    </div>
  );
}
