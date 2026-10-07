"use client";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  TIKTOK_AD_OBJECTIVES,
  TIKTOK_AD_OBJECTIVE_LABELS,
  defaultAdLabAdTargeting,
  formatSearchKeywordLines,
  parseSearchKeywordLines,
  type AdLabAdTargeting,
  type TikTokAdObjective,
} from "@/domain/models/AdLabAdTargeting";

/**
 * Rich TikTok Ads Manager-style targeting for the Publishing advertise panel.
 * Plan-only until "Create paused Ads draft" is clicked — never spends money.
 */

function csv(values: string[]): string {
  return values.join(", ");
}
function splitCsv(text: string): string[] {
  return text.split(/[,|\n]+/).map((s) => s.trim()).filter(Boolean);
}

export function AdTargetingPanel({
  value,
  onChange,
  organicPostId,
}: {
  value: AdLabAdTargeting | null | undefined;
  onChange: (next: AdLabAdTargeting) => void;
  /** Filled automatically after a successful organic post when Spark mode is on. */
  organicPostId?: string | null;
}) {
  const targeting = value ?? defaultAdLabAdTargeting();
  const patch = (partial: Partial<AdLabAdTargeting>) => onChange({ ...targeting, ...partial });

  return (
    <div className="space-y-4 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <div>
        <h5 className="text-sm font-semibold text-slate-900">ตั้งค่า Ads Manager (เป้าหมายโฆษณา)</h5>
        <p className="mt-0.5 text-xs text-slate-600">
          ครอบคลุม objective, สถานที่, อายุ/เพศ, ความสนใจ, อุปกรณ์ และคำค้นหา (Search keywords).
          RClipper สร้างได้แค่ draft ที่ <strong>paused</strong> — เปิดใช้จ่ายเงินได้เฉพาะใน TikTok Ads Manager
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Objective"
          value={targeting.objective}
          onChange={(e) => patch({ objective: e.target.value as TikTokAdObjective })}
          options={TIKTOK_AD_OBJECTIVES.map((o) => ({ value: o, label: TIKTOK_AD_OBJECTIVE_LABELS[o] }))}
        />
        <Input
          label="Advertiser ID (Ads account)"
          value={targeting.advertiserId}
          onChange={(e) => patch({ advertiserId: e.target.value.trim() })}
          placeholder="จาก TikTok Business Center"
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
        <input
          type="checkbox"
          className="h-4 w-4 accent-violet-700"
          checked={targeting.sparkMode}
          onChange={(e) => patch({ sparkMode: e.target.checked })}
        />
        Spark Ads — ใช้วิดีโอ/โพสต์ organic ที่เพิ่งเผยแพร่
      </label>
      {targeting.sparkMode && (
        <Input
          label="Organic post / item ID"
          value={targeting.sparkPostId || organicPostId || ""}
          onChange={(e) => patch({ sparkPostId: e.target.value.trim() })}
          placeholder={organicPostId ? `จะใช้ ${organicPostId} อัตโนมัติหลังโพสต์` : "ใส่หลังโพสต์ขึ้น หรือปล่อยว่างให้ระบบเติม"}
          hint="ปกติระบบเติมจาก platform_post_id หลัง Publish สำเร็จ"
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Locations (คั่นด้วยจุลภาค)"
          value={csv(targeting.locations)}
          onChange={(e) => patch({ locations: splitCsv(e.target.value) })}
          placeholder="TH, Bangkok"
        />
        <Input
          label="Languages"
          value={csv(targeting.languages)}
          onChange={(e) => patch({ languages: splitCsv(e.target.value) })}
          placeholder="th, en"
        />
        <Input
          label="อายุต่ำสุด"
          type="number"
          min={13}
          max={65}
          value={targeting.ageMin}
          onChange={(e) => patch({ ageMin: Math.max(13, Number(e.target.value) || 18) })}
        />
        <Input
          label="อายุสูงสุด"
          type="number"
          min={13}
          max={65}
          value={targeting.ageMax}
          onChange={(e) => patch({ ageMax: Math.min(65, Number(e.target.value) || 55) })}
        />
      </div>

      <Select
        label="เพศ"
        value={targeting.gender}
        onChange={(e) => patch({ gender: e.target.value as AdLabAdTargeting["gender"] })}
        options={[
          { value: "all", label: "ทั้งหมด" },
          { value: "male", label: "ชาย" },
          { value: "female", label: "หญิง" },
        ]}
      />

      <Input
        label="Interests (category ids หรือชื่อ — คั่นด้วยจุลภาค)"
        value={csv(targeting.interests)}
        onChange={(e) => patch({ interests: splitCsv(e.target.value) })}
        placeholder="education, language learning"
      />
      <Input
        label="Behaviors"
        value={csv(targeting.behaviors)}
        onChange={(e) => patch({ behaviors: splitCsv(e.target.value) })}
        placeholder="video engagement"
      />
      <Input
        label="Custom audience IDs"
        value={csv(targeting.customAudienceIds)}
        onChange={(e) => patch({ customAudienceIds: splitCsv(e.target.value) })}
      />
      <Input
        label="Lookalike audience IDs"
        value={csv(targeting.lookalikeAudienceIds)}
        onChange={(e) => patch({ lookalikeAudienceIds: splitCsv(e.target.value) })}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Devices"
          value={targeting.devices[0] || "mobile"}
          onChange={(e) => patch({ devices: [e.target.value as "mobile" | "desktop" | "tablet"] })}
          options={[
            { value: "mobile", label: "Mobile" },
            { value: "desktop", label: "Desktop" },
            { value: "tablet", label: "Tablet" },
          ]}
        />
        <Select
          label="OS"
          value={targeting.operatingSystems[0] || "all"}
          onChange={(e) => patch({ operatingSystems: [e.target.value as "android" | "ios" | "all"] })}
          options={[
            { value: "all", label: "All OS" },
            { value: "android", label: "Android" },
            { value: "ios", label: "iOS" },
          ]}
        />
        <Select
          label="Connection"
          value={targeting.connectionTypes[0] || "all"}
          onChange={(e) => patch({ connectionTypes: [e.target.value as "wifi" | "cellular" | "all"] })}
          options={[
            { value: "all", label: "All connections" },
            { value: "wifi", label: "Wi‑Fi" },
            { value: "cellular", label: "Cellular" },
          ]}
        />
      </div>

      <Textarea
        label="Search keywords (หนึ่งบรรทัดต่อคำ)"
        value={formatSearchKeywordLines(targeting.searchKeywords)}
        onChange={(e) => patch({ searchKeywords: parseSearchKeywordLines(e.target.value) })}
        placeholder={'เรียนภาษาจีน\n"chinese ttt"\n[line oa]\n-ฟรีไม่มีคุณภาพ'}
        hint='ใส่คำปกติ = broad, "phrase", [exact], ขึ้นต้นด้วย - = exclude. ใช้กับ Search Ads / keyword targeting'
        rows={5}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Schedule start (ISO date)"
          type="date"
          value={targeting.scheduleStart.slice(0, 10)}
          onChange={(e) => patch({ scheduleStart: e.target.value })}
        />
        <Input
          label="Schedule end"
          type="date"
          value={targeting.scheduleEnd.slice(0, 10)}
          onChange={(e) => patch({ scheduleEnd: e.target.value })}
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold uppercase text-slate-500">UTM / attribution (Chinese_TTT → LINE / Stripe)</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Input label="utm_source" value={targeting.utmSource} onChange={(e) => patch({ utmSource: e.target.value })} />
          <Input label="utm_medium" value={targeting.utmMedium} onChange={(e) => patch({ utmMedium: e.target.value })} />
          <Input label="utm_campaign" value={targeting.utmCampaign} onChange={(e) => patch({ utmCampaign: e.target.value })} />
          <Input label="utm_content" value={targeting.utmContent} onChange={(e) => patch({ utmContent: e.target.value })} />
        </div>
        <Textarea
          className="mt-3"
          label="หมายเหตุแท็ก LINE / Stripe"
          value={targeting.attributionNote}
          onChange={(e) => patch({ attributionNote: e.target.value })}
          placeholder="เช่น Stripe metadata.product=chinese_ttt; LINE ติดตามเพื่อนใหม่ช่วงแคมเปญ"
          rows={2}
        />
      </div>
    </div>
  );
}
