import type { StudioAdResult, StudioBrand } from "@/domain/models/Studio";
import {
  STORYTELLING_BACKSTAGE_KNOWLEDGE,
  STORYTELLING_DELIVERY_SEQUENCE,
} from "./storytellingKnowledge";

export interface StudioMetrics {
  spend: number;
  revenue: number;
  impressions: number;
  views3s: number;
  completedViews: number;
  clicks: number;
  conversions: number;
  hookRate: number;
  completionRate: number;
  ctr: number;
  cvr: number;
  roas: number;
}

export interface StudioScriptPlan {
  title: string;
  mainHook: string;
  sections: Array<{
    topic: string;
    script: string;
  }>;
  hooks: string;
  painPointsOrIntroduction: string;
  content: string;
  conversion: string;
  solution: string;
  closing: string;
  backstage: {
    durationSeconds: number;
    hookPrinciple: string;
    deliverySequence: string;
  };
}

const rate = (top: number, bottom: number) => (bottom > 0 ? (top / bottom) * 100 : 0);

export function calculateStudioMetrics(results: StudioAdResult[]): StudioMetrics {
  const totals = results.reduce(
    (sum, item) => ({
      spend: sum.spend + item.spend,
      revenue: sum.revenue + item.revenue,
      impressions: sum.impressions + item.impressions,
      views3s: sum.views3s + item.views3s,
      completedViews: sum.completedViews + item.completedViews,
      clicks: sum.clicks + item.clicks,
      conversions: sum.conversions + item.conversions,
    }),
    { spend: 0, revenue: 0, impressions: 0, views3s: 0, completedViews: 0, clicks: 0, conversions: 0 }
  );

  return {
    ...totals,
    hookRate: rate(totals.views3s, totals.impressions),
    completionRate: rate(totals.completedViews, totals.views3s),
    ctr: rate(totals.clicks, totals.impressions),
    cvr: rate(totals.conversions, totals.clicks),
    roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
  };
}

/** Initial heuristic layer; thresholds will later be calibrated from real campaigns. */
export function diagnoseStudioMetrics(metrics: StudioMetrics): string[] {
  const findings = [
    metrics.hookRate < 25
      ? "Hook ยังอ่อน: ทดลองเปิดด้วย pain point หรือผลลัพธ์ที่เฉพาะเจาะจงกว่าเดิม"
      : "Hook ดึงความสนใจได้ดี: รักษาแนวเปิดคลิปนี้แล้วทดสอบภาพแรกหลายแบบ",
    metrics.completionRate < 20
      ? "ผู้ชมหลุดกลางคลิป: ลดคำอธิบายและนำ demo/proof มาให้เร็วขึ้น"
      : "การดูต่ออยู่ในทิศทางดี: ทดสอบ CTA ที่ชัดขึ้นเพื่อเปลี่ยน attention เป็น action",
    metrics.ctr < 1
      ? "CTR ต่ำ: ทำ offer และ CTA ให้เข้าใจได้ในหนึ่งประโยค"
      : "CTR ผ่านเกณฑ์ตั้งต้น: ตรวจหน้า landing และ conversion ต่อ",
  ];

  if (metrics.spend > 0 && metrics.roas < 1) {
    findings.push("รายได้ยังต่ำกว่าค่าโฆษณา: หยุดเพิ่มงบจนกว่าจะหาครีเอทีฟหรือกลุ่มเป้าหมายที่ชนะ");
  }
  return findings;
}

export function generateStudioScriptOutline(
  brand: StudioBrand,
  input: {
    mainMessage: string;
    detailedContent: string;
    presentationDirection: string;
    objective: string;
    duration: string;
  }
): StudioScriptPlan {
  const message = input.mainMessage.trim() || brand.promise || `${brand.name} ช่วยให้สิ่งที่ยากง่ายขึ้น`;
  const details = input.detailedContent.trim() || `${brand.product || "สินค้า/บริการนี้"} ออกแบบมาเพื่อ ${brand.audience || "ผู้ชมกลุ่มนี้"}`;
  const audience = brand.audience || "คนที่กำลังมองหาทางเลือกที่ดีกว่า";
  const objectiveClosing: Record<string, string> = {
    awareness: `จำชื่อ ${brand.name} ไว้ เมื่อคุณอยาก ${message}`,
    consideration: `ลองเปรียบเทียบวิธีเดิมกับ ${brand.name} แล้วดูว่าวิธีไหนพาคุณไปถึง “${message}” ได้ชัดกว่า`,
    conversion: `เริ่มต้นกับ ${brand.name} วันนี้ เพื่อเปลี่ยน “${message}” ให้เป็นผลลัพธ์จริง`,
  };

  // These references keep the supplied lessons and requested sequence as an
  // explicit generation contract, while the UI presents only the six sections.
  const hookPrinciple = STORYTELLING_BACKSTAGE_KNOWLEDGE.opening[1];
  const deliverySequence = STORYTELLING_DELIVERY_SEQUENCE.join(" → ");

  const legacySections = {
    hooks: `ถ้าวิธีเดิมยังพาไปไม่ถึง “${message}” ปัญหาอาจไม่ใช่เพราะคุณพยายามน้อยเกินไป แต่อาจเป็นเพราะมีวิธีที่ง่ายและตรงจุดกว่านั้น`,
    painPointsOrIntroduction: `${details} ฟังดูเหมือนเป็นเรื่องที่ต้องยอมรับ แต่จริง ๆ แล้วปัญหาอาจไม่ได้อยู่ที่คุณทำไม่ดีพอ แต่อยู่ที่วิธีเดิมกำลังกินเวลาและพลังไปมากเกินจำเป็น`,
    content: `เมื่อเราตัดสิ่งที่ไม่จำเป็นออก แล้วเลือกใช้ข้อมูลและเครื่องมือให้ตรงกับเป้าหมาย งานที่เคยซับซ้อนก็เริ่มชัดขึ้น และทุกขั้นตอนพาเราเข้าใกล้ “${message}” ได้จริง`,
    conversion: `จุดเปลี่ยนสำคัญจึงไม่ใช่การพยายามให้หนักกว่าเดิม แต่คือการเลือกวิธีที่ทำให้งานเดินหน้าได้อย่างเป็นระบบ โดยยังรักษาคุณภาพและตัวตนของแบรนด์ไว้ครบถ้วน`,
    solution: `นี่คือสิ่งที่ ${brand.name} เข้ามาช่วยครับ ด้วย${brand.product || "วิธีทำงานที่ออกแบบมาให้เหมาะกับปัญหานี้"}${brand.promise ? ` เพื่อให้คุณ${brand.promise}` : ` เพื่อพาคุณไปสู่${message}`} คุณจึงใช้เวลากับสิ่งที่สำคัญต่อธุรกิจได้มากขึ้น`,
    closing: `${objectiveClosing[input.objective] || objectiveClosing.conversion} เพราะเป้าหมายไม่ใช่แค่ทำงานให้เสร็จ แต่คือการทำให้ทุกงานพาธุรกิจไปข้างหน้าได้จริง`,
  };

  const topicsByDirection: Record<string, string[]> = {
    storytelling: ["วันที่วิธีเดิมเริ่มไม่ตอบโจทย์", "จุดเปลี่ยนที่ทำให้เห็นทางใหม่", `${brand.name} เข้ามาเปลี่ยนเรื่องนี้อย่างไร`, "ก้าวต่อไปของคุณ"],
    educational: ["สิ่งที่หลายคนมองข้าม", `หลักคิดเพื่อไปถึง “${message}”`, `นำหลักคิดไปใช้กับ ${brand.name}`, "เริ่มปรับจากจุดนี้"],
    demonstration: ["ก่อนเริ่มใช้งาน", `ขั้นตอนที่ ${brand.name} ช่วยให้ง่ายขึ้น`, "ผลลัพธ์ที่สัมผัสได้", "เริ่มทดลองด้วยตัวคุณเอง"],
    review: ["ประสบการณ์ก่อนพบทางเลือกนี้", `ความแตกต่างเมื่อใช้ ${brand.name}`, "สิ่งที่ได้กลับคืนมา", "เหมาะกับใครและเริ่มอย่างไร"],
    "problem-solution": [`ปัญหาที่${audience}กำลังเจอ`, `ทำไม “${message}” ยังไปไม่ถึง`, `${brand.name} เปลี่ยนวิธีนี้อย่างไร`, "ขั้นต่อไปที่ทำได้ทันที"],
  };
  const topics = topicsByDirection[input.presentationDirection] || ["สถานการณ์ที่กำลังเกิดขึ้น", "มุมมองใหม่ต่อปัญหา", `${brand.name} กับทางออกที่เหมาะสม`, "สิ่งที่ทำต่อได้ทันที"];

  return {
    title: `${brand.name}: ${message}`,
    mainHook: `${audience}—ทำไม “${message}” ถึงยังเป็นเรื่องยาก ทั้งที่คำตอบอาจต่างจากที่คิด?`,
    sections: [
      { topic: topics[0], script: `${legacySections.hooks} ${legacySections.painPointsOrIntroduction}` },
      { topic: topics[1], script: legacySections.content },
      { topic: topics[2], script: `${legacySections.conversion} ${legacySections.solution}` },
      { topic: topics[3], script: legacySections.closing },
    ],
    ...legacySections,
    backstage: {
      durationSeconds: Number(input.duration) || 30,
      hookPrinciple,
      deliverySequence,
    },
  };
}
