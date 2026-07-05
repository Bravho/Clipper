"use client";

import { useState } from "react";
import { NewRequestForm } from "./NewRequestForm";
import { ProductionPipeline } from "./ProductionPipeline";
import { AI_TRACK_BASE_COST, PIPELINE_STEP_COSTS } from "@/config/credits";

interface Props {
  creditBalance: number;
}

export function PackageSelector({ creditBalance }: Props) {
  const [selected, setSelected] = useState<"ai" | "editor" | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number>(
    PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS
  );
  const [platformCount, setPlatformCount] = useState<number>(
    PIPELINE_STEP_COSTS.RESIZE_FREE_CHANNELS
  );

  if (selected === "ai") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="mb-6 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          ← เปลี่ยนประเภทการผลิต
        </button>

        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 flex items-center gap-3">
          <div className="rounded-full bg-blue-600 p-1.5">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-blue-800">AI Track — วิดีโอ AI · รูปภาพและคลิปวิดีโอ</p>
            <p className="text-xs text-blue-600 mt-0.5">AI สร้างวิดีโอให้อัตโนมัติจากรูปและคลิปของคุณ · ราคาขึ้นอยู่กับความยาวและช่องทาง</p>
          </div>
        </div>

        <NewRequestForm
          creditBalance={creditBalance}
          creditCost={PIPELINE_STEP_COSTS.CONTENT_ANALYSIS}
          onCreditParamsChange={(d, p) => {
            setDurationSeconds(d);
            setPlatformCount(p);
          }}
        />

        <ProductionPipeline
          durationSeconds={durationSeconds}
          totalChannels={platformCount}
        />
      </div>
    );
  }

  return (
    <div>
      <p className="mb-6 text-sm text-slate-500">
        เลือก AI หรือ Editor สำหรับธุรกิจของคุณ
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        {/* AI Track */}
        <div
          className="rounded-2xl border-2 border-blue-100 bg-blue-50 p-8 flex flex-col cursor-pointer hover:border-blue-400 hover:shadow-md transition-all"
          onClick={() => setSelected("ai")}
        >
          <div className="mb-4 inline-block self-start rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white uppercase tracking-wider">
            AI Track
          </div>
          <h3 className="mb-3 text-2xl font-bold text-slate-900">
            ไว · ถูก · ไม่ต้องรู้เรื่องวิดีโอ
          </h3>
          <p className="mb-6 text-slate-600 leading-relaxed flex-1">
            ส่งรูปหรือคำบรรยาย AI จัดการตัดต่อ ใส่ subtitle ไทย-อังกฤษ-จีน
            และโพสต์ให้อัตโนมัติ เหมาะสำหรับธุรกิจที่ต้องการคอนเทนต์สม่ำเสมอในราคาประหยัด
          </p>
          <ul className="mb-8 space-y-2.5 text-sm text-slate-700">
            {[
              "Subtitle 3 ภาษา: ไทย · อังกฤษ · จีน",
              "Export 4 ratio: 9:16 · 16:9 · 1:1 · 4:5",
              "โพสต์อัตโนมัติ ไม่ต้องทำเอง",
              "ผลลัพธ์ภายใน 24–48 ชั่วโมง",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <span className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-full bg-blue-600 flex items-center justify-center text-white text-[10px] font-bold">
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500">เริ่มต้นที่</span>
              <span className="ml-1 text-2xl font-bold text-slate-900">{AI_TRACK_BASE_COST}</span>
              <span className="ml-1 text-sm text-slate-400">เครดิต</span>
              <p className="text-xs text-slate-400 mt-0.5">สำหรับวิดีโอ {PIPELINE_STEP_COSTS.DEFAULT_DURATION_SECONDS} วินาที 2 ช่องทาง</p>
            </div>
            <span className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
              เริ่มด้วย AI →
            </span>
          </div>
        </div>

        {/* Editor Track */}
        <div className="rounded-2xl border-2 border-amber-100 bg-amber-50 p-8 flex flex-col opacity-70 cursor-not-allowed relative">
          <div className="absolute top-4 right-4 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white">
            เร็วๆ นี้
          </div>
          <div className="mb-4 inline-block self-start rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white uppercase tracking-wider">
            Editor Track
          </div>
          <h3 className="mb-3 text-2xl font-bold text-slate-900">
            เจาะลึก · เข้าใจตลาด · เพิ่ม Reach
          </h3>
          <p className="mb-6 text-slate-600 leading-relaxed flex-1">
            เลือก Editor ที่เชี่ยวชาญ TikTok / YouTube algorithm และเข้าใจพฤติกรรม
            นักท่องเที่ยวต่างชาติ เหมาะสำหรับธุรกิจที่ต้องการ engagement สูง
          </p>
          <ul className="mb-8 space-y-2.5 text-sm text-slate-700">
            {[
              "Editor รู้จัก algorithm ของแต่ละ platform",
              "สคริปต์และ hook เฉพาะตลาดต่างชาติ",
              "Voice-over และ narration หลายภาษา",
              "ปรึกษา strategy ก่อนผลิต",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <span className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-full bg-amber-400 flex items-center justify-center text-white text-[10px] font-bold">
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-slate-400 italic">ราคา TBA</span>
            </div>
            <span className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-white cursor-not-allowed">
              เร็วๆ นี้
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
