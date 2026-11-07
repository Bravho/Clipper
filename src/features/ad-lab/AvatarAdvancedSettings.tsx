"use client";

import { useState } from "react";
import {
  applicableSettings,
  settingsSummary,
  type AvatarVideoSettings,
} from "@/config/heygenVideoOptions";

/**
 * Collapsible "ตั้งค่าขั้นสูง" panel for HeyGen POST /v3/videos options.
 * Fields are shown/hidden by engine, avatar type and voice mode; the server
 * re-validates and drops anything that doesn't apply (never trust the client).
 * Source: https://developers.heygen.com/reference/create-video (checked 2026-10-13).
 */
export function AvatarAdvancedSettings({
  value,
  onChange,
  engine,
  avatarType,
  ttsMode,
}: {
  value: AvatarVideoSettings;
  onChange: (next: AvatarVideoSettings) => void;
  engine: "avatar_v" | "avatar_iv";
  avatarType: string;
  ttsMode: boolean;
}) {
  const [open, setOpen] = useState(false);
  const applied = applicableSettings(value, { engine, avatarType, mode: ttsMode ? "tts" : "audio" });
  const summary = settingsSummary(applied);

  const isVideoAvatar = avatarType === "digital_twin" || avatarType === "studio_avatar";
  const showMotion = avatarType === "photo_avatar" || (isVideoAvatar && engine === "avatar_v");
  const showExpr = avatarType === "photo_avatar" && engine === "avatar_iv";

  function set<K extends keyof AvatarVideoSettings>(key: K, v: AvatarVideoSettings[K] | undefined) {
    const next = { ...value };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(next);
  }
  function setVoice(key: "speed" | "pitch" | "volume", v: number, def: number) {
    const vs = { ...(value.voice_settings ?? {}) };
    if (v === def) delete vs[key];
    else vs[key] = v;
    set("voice_settings", Object.keys(vs).length ? vs : undefined);
  }

  const label = "block text-xs font-medium text-slate-700";
  const help = "text-[11px] text-slate-500";
  const input = "w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs";

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-slate-700"
      >
        <span>ตั้งค่าขั้นสูง {summary ? <span className="ml-1 text-xs font-normal text-slate-500">({summary})</span> : null}</span>
        <span className="text-xs text-slate-500">{open ? "ซ่อน ▲" : "แสดง ▼"}</span>
      </button>
      {open && (
        <div className="grid gap-3 border-t border-slate-200 px-3 py-3 sm:grid-cols-2">
          <div>
            <label className={label} title="ความละเอียดของวิดีโอ ราคาเท่ากันทั้ง 720p และ 1080p">ความละเอียด</label>
            <select className={input} value={value.resolution ?? "1080p"} onChange={(e) => set("resolution", e.target.value === "720p" ? "720p" : undefined)}>
              <option value="1080p">1080p (ค่าเริ่มต้น)</option>
              <option value="720p">720p</option>
            </select>
          </div>

          <div>
            <label className={label} title="cover = ขยายเต็มกรอบ (อาจครอปขอบ), contain = แสดงทั้งตัว (อาจมีพื้นหลังเพิ่ม)">การจัดวาง Avatar (fit)</label>
            <select className={input} value={value.fit ?? ""} onChange={(e) => set("fit", e.target.value === "cover" || e.target.value === "contain" ? e.target.value : undefined)}>
              <option value="">อัตโนมัติ (HeyGen เลือก)</option>
              <option value="cover">cover - เต็มกรอบ</option>
              <option value="contain">contain - เห็นทั้งตัว</option>
            </select>
          </div>

          <div>
            <label className={label} title="สีพื้นหลังทึบ (#RRGGBB)">สีพื้นหลัง</label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!value.background}
                onChange={(e) => set("background", e.target.checked ? { type: "color", value: value.background?.value ?? "#ffffff" } : undefined)}
                aria-label="ใช้สีพื้นหลัง"
              />
              <input
                type="color"
                disabled={!value.background}
                value={value.background?.value ?? "#ffffff"}
                onChange={(e) => set("background", { type: "color", value: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded border border-slate-300 disabled:opacity-40"
              />
              <span className="font-mono text-xs text-slate-500">{value.background?.value ?? "ไม่ตั้ง"}</span>
            </div>
          </div>

          <div>
            <label className={label} title="ต้องเป็น Avatar ที่เทรนแบบ matting ไม่เช่นนั้น HeyGen อาจปฏิเสธ">ลบพื้นหลังเดิม</label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={!!value.remove_background} onChange={(e) => set("remove_background", e.target.checked || undefined)} />
              remove_background
            </label>
            <p className={help}>ใช้ได้เฉพาะ Avatar ที่รองรับ matting</p>
          </div>

          <div>
            <label className={label} title="สร้างไฟล์ซับ SRT และฝังคำบรรยายลงในวิดีโอ">ฝังคำบรรยาย (captions)</label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={!!value.caption}
                onChange={(e) => set("caption", e.target.checked ? { file_format: "srt", style: "default" } : undefined)}
              />
              ฝังซับในวิดีโอ
            </label>
            <p className={help}>คุณภาพซับภาษาไทยของ HeyGen ยังไม่ได้ทดสอบ</p>
          </div>

          <div>
            <label className={label} title="ชื่อวิดีโอที่แสดงในหน้า HeyGen">ชื่อวิดีโอใน HeyGen</label>
            <input className={input} maxLength={100} value={value.title ?? ""} onChange={(e) => set("title", e.target.value.trim() ? e.target.value : undefined)} placeholder="ไม่ตั้ง" />
          </div>

          {showMotion && (
            <div className="sm:col-span-2">
              <label className={label} title="คำสั่งท่าทางและการเคลื่อนไหวของมือ/ตัว (ภาษาอังกฤษแนะนำ)">ท่าทาง (motion prompt)</label>
              <textarea className={input} rows={2} maxLength={500} value={value.motion_prompt ?? ""} onChange={(e) => set("motion_prompt", e.target.value.trim() ? e.target.value : undefined)} placeholder="เช่น natural hand gestures, friendly nodding" />
              <p className={help}>{(value.motion_prompt ?? "").length}/500 · Digital Twin ใช้ได้เฉพาะ Avatar V</p>
            </div>
          )}

          {showExpr && (
            <div>
              <label className={label} title="ระดับการแสดงออกทางสีหน้า (Photo Avatar + Avatar IV เท่านั้น)">การแสดงออก (expressiveness)</label>
              <select className={input} value={value.expressiveness ?? ""} onChange={(e) => set("expressiveness", e.target.value === "low" || e.target.value === "medium" || e.target.value === "high" ? e.target.value : undefined)}>
                <option value="">ค่าเริ่มต้น (low)</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
          )}

          {ttsMode && (
            <div className="space-y-2 sm:col-span-2">
              <p className={label} title="การตั้งค่าเสียงของ HeyGen ใช้เฉพาะโหมดเสียงของ Digital Twin (script + voice_id)">เสียงของ Digital Twin (HeyGen)</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className={help}>ความเร็ว {value.voice_settings?.speed ?? 1}×</label>
                  <input type="range" min={0.5} max={1.5} step={0.05} className="w-full" value={value.voice_settings?.speed ?? 1} onChange={(e) => setVoice("speed", Number(e.target.value), 1)} />
                </div>
                <div>
                  <label className={help}>ระดับเสียง (pitch) {value.voice_settings?.pitch ?? 0}</label>
                  <input type="range" min={-50} max={50} step={1} className="w-full" value={value.voice_settings?.pitch ?? 0} onChange={(e) => setVoice("pitch", Number(e.target.value), 0)} />
                </div>
                <div>
                  <label className={help}>ความดัง {Math.round((value.voice_settings?.volume ?? 1) * 100)}%</label>
                  <input type="range" min={0} max={1} step={0.05} className="w-full" value={value.voice_settings?.volume ?? 1} onChange={(e) => setVoice("volume", Number(e.target.value), 1)} />
                </div>
              </div>
            </div>
          )}
          {!ttsMode && (
            <p className={`${help} sm:col-span-2`}>การตั้งค่าเสียงของ HeyGen ใช้ไม่ได้กับเสียง ElevenLabs (ใช้ไฟล์เสียงที่สร้างแล้ว)</p>
          )}

          <div className="sm:col-span-2">
            <button type="button" className="text-xs text-blue-700 underline" onClick={() => onChange({})}>
              รีเซ็ตเป็นค่าเริ่มต้น
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
