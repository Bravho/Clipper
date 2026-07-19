"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

export function ReportAiContent({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("unsafe");
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
        body: JSON.stringify({ reason, details }),
      });
      if (!response.ok) throw new Error("Report failed.");
      setMessage("ส่งรายงานแล้ว ทีมงานจะตรวจสอบเนื้อหานี้");
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
        รายงานผลลัพธ์ AI
      </Button>
      {open && (
        <div className="mt-4 space-y-3">
          <Select
            label="เหตุผล"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            options={[
              { value: "unsafe", label: "เนื้อหาไม่ปลอดภัยหรือไม่เหมาะสม" },
              { value: "sexual", label: "เนื้อหาทางเพศ" },
              { value: "violent", label: "ความรุนแรง" },
              { value: "hate", label: "ความเกลียดชังหรือคุกคาม" },
              { value: "privacy", label: "ละเมิดความเป็นส่วนตัว" },
              { value: "impersonation", label: "ปลอมแปลงบุคคลหรือเสียง" },
              { value: "copyright", label: "ลิขสิทธิ์หรือเครื่องหมายการค้า" },
              { value: "misleading", label: "ข้อมูลหลอกลวง" },
              { value: "other", label: "อื่น ๆ" },
            ]}
          />
          <Textarea
            label="รายละเอียดเพิ่มเติม"
            value={details}
            maxLength={2000}
            onChange={(event) => setDetails(event.target.value)}
          />
          <Button type="button" loading={loading} onClick={() => void submit()}>
            ส่งรายงาน
          </Button>
        </div>
      )}
      {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
    </div>
  );
}

