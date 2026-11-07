import type { AdLabAdResult, AdLabBrand } from "@/domain/models/AdLab";
import type { AdLabContentPurpose } from "./contentPurpose";
import {
  STORYTELLING_BACKSTAGE_KNOWLEDGE,
  STORYTELLING_DELIVERY_SEQUENCE,
} from "./storytellingKnowledge";

export interface AdLabMetrics {
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

export interface AdLabScriptPlan {
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

export function calculateAdLabMetrics(results: AdLabAdResult[]): AdLabMetrics {
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
export function diagnoseAdLabMetrics(metrics: AdLabMetrics): string[] {
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

function generatePersonalBrandingOutline(
  brand: AdLabBrand,
  input: {
    mainMessage: string;
    detailedContent: string;
    presentationDirection: string;
    objective: string;
    duration: string;
  }
): AdLabScriptPlan {
  const message = input.mainMessage.trim() || `${brand.name} ช่วยให้สิ่งที่ยากง่ายขึ้น`;
  const details = input.detailedContent.trim() || (brand.promise || "").trim() || `${brand.product || "สินค้า/บริการนี้"} ออกแบบมาเพื่อ ${brand.audience || "ผู้ชมกลุ่มนี้"}`;
  const audience = brand.audience || "คนที่กำลังมองหาทางเลือกที่ดีกว่า";

  const pbObjectiveClosing: Record<string, string> = {
    authority: `ถ้าอยากรู้เรื่องนี้ลึกขึ้น กดติดตาม ${brand.name} ไว้ได้เลย\nแล้วเจอกันในโพสต์หน้า`,
    followers: `ถ้าเนื้อหาแบบนี้มีประโยชน์ กดติดตามไว้นะ\nฉันแชร์เรื่องแบบนี้บ่อย ๆ`,
    engagement: `คุณมีประสบการณ์กับเรื่องนี้ไหม\nคอมเมนต์มาเล่าให้ฟังด้วยนะ`,
    leads: `ถ้าอยากปรึกษาเรื่องนี้เพิ่มเติม ทักมาหาฉันได้เลย\nยินดีคุยให้ทุกคนเสมอ`,
    community: `ถ้าอยากพูดคุยกับคนที่สนใจเรื่องเดียวกัน\nเข้ามาร่วมกลุ่มของเราได้เลย ลิงก์อยู่ใน Bio`,
  };

  const hookPrinciple = STORYTELLING_BACKSTAGE_KNOWLEDGE.opening[1];
  const deliverySequence = STORYTELLING_DELIVERY_SEQUENCE.join(" → ");

  const pbTopicsByDirection: Record<string, string[]> = {
    "story-experience": ["เรื่องที่เกิดขึ้นจริงกับฉัน", "บทเรียนที่ได้จากมัน", "วิธีที่ฉันนำไปใช้", "ลองเอาไปปรับดูได้เลย"],
    "tips-knowledge": ["ปัญหาที่หลายคนเจอบ่อย", "เคล็ดลับที่ใช้ได้จริง", "วิธีเริ่มต้นง่าย ๆ", "แชร์ให้คนที่ต้องการด้วย"],
    "opinion": ["สิ่งที่เกิดขึ้นในวงการ", "มุมมองของฉันต่อเรื่องนี้", "เหตุผลที่คิดอย่างนี้", "อยากรู้ความเห็นคุณด้วย"],
    "behind-the-scenes": ["วันนี้ทำอะไรอยู่", "ความท้าทายที่เจอ", "วิธีที่ฉันรับมือ", "ถามมาได้เลยถ้าสงสัย"],
    "qa": ["คำถามที่คนถามมาบ่อย", "คำตอบของฉัน", "รายละเอียดที่ควรรู้เพิ่ม", "มีคำถามอื่นก็ถามได้เลย"],
    "myth-busting": ["ความเชื่อที่คนส่วนใหญ่มี", "ความจริงที่แตกต่าง", "หลักฐานจากประสบการณ์", "ลองทบทวนสิ่งที่เชื่ออยู่ดู"],
    "lesson-learned": ["สิ่งที่ฉันเคยทำผิด", "ผลที่ตามมา", "สิ่งที่เรียนรู้และเปลี่ยนไป", "อยากให้ลองหลีกเลี่ยงเช่นกัน"],
  };
  const pbTopics = pbTopicsByDirection[input.presentationDirection] || [
    "ประสบการณ์จริงของฉัน", "สิ่งที่ค้นพบ", "วิธีที่นำไปใช้ได้", "ลองเอาไปปรับดู",
  ];

  const pbHooks = `ฉันเคยเจอสถานการณ์ที่ "${message}" ดูเป็นเรื่องยากมาก\nแต่มีมุมหนึ่งที่เปลี่ยนทุกอย่างไป`;
  const pbPainIntro = `${details}\nฉันก็เคยรู้สึกแบบนั้นเหมือนกัน และมันกินเวลาไปมากกว่าที่ควร`;
  const pbContent = `หลังจากลองผิดลองถูกมาสักพัก ฉันพบว่าวิธีที่ได้ผลจริงคือเริ่มจากจุดที่ง่ายที่สุด\nไม่ต้องสมบูรณ์แบบตั้งแต่ต้น แค่เริ่มให้ถูกทิศทาง`;
  const pbConversion = brand.product
    ? `${brand.product} ของ ${brand.name} เป็นหนึ่งในสิ่งที่ฉันใช้ในช่วงนั้น\n${brand.promise ? brand.promise + "\n" : ""}และมันช่วยให้ "${message}" เป็นเรื่องที่จัดการได้จริง`.trim()
    : `${brand.name} เป็นส่วนหนึ่งที่ช่วยฉันในเรื่องนี้\nและมันทำให้ "${message}" ชัดเจนขึ้นมาก`;
  const pbSolution = `สิ่งที่ฉันได้คืนมาคือเวลาและความมั่นใจในการก้าวหน้า\nและนั่นคือสิ่งที่อยากแชร์วันนี้`;
  const pbClosing = pbObjectiveClosing[input.objective] || pbObjectiveClosing.authority;

  return {
    title: `${brand.name}: ${message}`,
    mainHook: `${audience}—คุณกำลังพยายามไปถึง "${message}" อยู่ไหม\nมีมุมหนึ่งที่อาจยังไม่เคยลอง`,
    sections: [
      { topic: pbTopics[0], script: `${pbHooks}\n${pbPainIntro}` },
      { topic: pbTopics[1], script: pbContent },
      { topic: pbTopics[2], script: `${pbConversion}\n${pbSolution}` },
      { topic: pbTopics[3], script: pbClosing },
    ],
    hooks: pbHooks,
    painPointsOrIntroduction: pbPainIntro,
    content: pbContent,
    conversion: pbConversion,
    solution: pbSolution,
    closing: pbClosing,
    backstage: {
      durationSeconds: Number(input.duration) || 60,
      hookPrinciple,
      deliverySequence,
    },
  };
}

export function generateAdLabScriptOutline(
  brand: AdLabBrand,
  input: {
    mainMessage: string;
    detailedContent: string;
    presentationDirection: string;
    objective: string;
    duration: string;
    contentPurpose?: AdLabContentPurpose;
  }
): AdLabScriptPlan {
  if (input.contentPurpose === "personal_branding") {
    return generatePersonalBrandingOutline(brand, input);
  }

  // brand.promise holds product/service details (features, benefits, price) — not a tagline.
  const message = input.mainMessage.trim() || `${brand.name} ช่วยให้สิ่งที่ยากง่ายขึ้น`;
  const details = input.detailedContent.trim() || (brand.promise || "").trim() || `${brand.product || "สินค้า/บริการนี้"} ออกแบบมาเพื่อ ${brand.audience || "ผู้ชมกลุ่มนี้"}`;
  const audience = brand.audience || "คนที่กำลังมองหาทางเลือกที่ดีกว่า";
  const objectiveClosing: Record<string, string> = {
    awareness: `จำชื่อ ${brand.name} ไว้ เมื่อคุณอยาก ${message}`,
    consideration: `ลองเปรียบเทียบวิธีเดิมกับ ${brand.name} แล้วดูว่าวิธีไหนพาคุณไปถึง "${message}" ได้ชัดกว่า`,
    conversion: `เริ่มต้นกับ ${brand.name} วันนี้ เพื่อเปลี่ยน "${message}" ให้เป็นผลลัพธ์จริง`,
  };

  const hookPrinciple = STORYTELLING_BACKSTAGE_KNOWLEDGE.opening[1];
  const deliverySequence = STORYTELLING_DELIVERY_SEQUENCE.join(" → ");

  const legacySections = {
    hooks: `ถ้าวิธีเดิมยังพาไปไม่ถึง "${message}" ปัญหาอาจไม่ใช่เพราะคุณพยายามน้อยเกินไป แต่อาจเป็นเพราะมีวิธีที่ง่ายและตรงจุดกว่านั้น`,
    painPointsOrIntroduction: `${details} ฟังดูเหมือนเป็นเรื่องที่ต้องยอมรับ แต่จริง ๆ แล้วปัญหาอาจไม่ได้อยู่ที่คุณทำไม่ดีพอ แต่อยู่ที่วิธีเดิมกำลังกินเวลาและพลังไปมากเกินจำเป็น`,
    content: `เมื่อเราตัดสิ่งที่ไม่จำเป็นออก แล้วเลือกใช้ข้อมูลและเครื่องมือให้ตรงกับเป้าหมาย งานที่เคยซับซ้อนก็เริ่มชัดขึ้น และทุกขั้นตอนพาเราเข้าใกล้ "${message}" ได้จริง`,
    conversion: `จุดเปลี่ยนสำคัญจึงไม่ใช่การพยายามให้หนักกว่าเดิม แต่คือการเลือกวิธีที่ทำให้งานเดินหน้าได้อย่างเป็นระบบ โดยยังรักษาคุณภาพและตัวตนของแบรนด์ไว้ครบถ้วน`,
    solution: `นี่คือสิ่งที่ ${brand.name} เข้ามาช่วยครับ ด้วย${brand.product || "วิธีทำงานที่ออกแบบมาให้เหมาะกับปัญหานี้"} เพื่อพาคุณไปสู่${message} คุณจึงใช้เวลากับสิ่งที่สำคัญต่อธุรกิจได้มากขึ้น`,
    closing: `${objectiveClosing[input.objective] || objectiveClosing.conversion}\nเพราะเป้าหมายไม่ใช่แค่ทำงานให้เสร็จ\nแต่คือการทำให้ทุกงานพาธุรกิจไปข้างหน้าได้จริง`,
  };

  const topicsByDirection: Record<string, string[]> = {
    storytelling: ["วันที่วิธีเดิมเริ่มไม่ตอบโจทย์", "จุดเปลี่ยนที่ทำให้เห็นทางใหม่", `${brand.name} เข้ามาเปลี่ยนเรื่องนี้อย่างไร`, "ก้าวต่อไปของคุณ"],
    educational: ["สิ่งที่หลายคนมองข้าม", `หลักคิดเพื่อไปถึง "${message}"`, `นำหลักคิดไปใช้กับ ${brand.name}`, "เริ่มปรับจากจุดนี้"],
    demonstration: ["ก่อนเริ่มใช้งาน", `ขั้นตอนที่ ${brand.name} ช่วยให้ง่ายขึ้น`, "ผลลัพธ์ที่สัมผัสได้", "เริ่มทดลองด้วยตัวคุณเอง"],
    review: ["ประสบการณ์ก่อนพบทางเลือกนี้", `ความแตกต่างเมื่อใช้ ${brand.name}`, "สิ่งที่ได้กลับคืนมา", "เหมาะกับใครและเริ่มอย่างไร"],
    "problem-solution": [`ปัญหาที่${audience}กำลังเจอ`, `ทำไม "${message}" ยังไปไม่ถึง`, `${brand.name} เปลี่ยนวิธีนี้อย่างไร`, "ขั้นต่อไปที่ทำได้ทันที"],
  };
  const topics = topicsByDirection[input.presentationDirection] || ["สถานการณ์ที่กำลังเกิดขึ้น", "มุมมองใหม่ต่อปัญหา", `${brand.name} กับทางออกที่เหมาะสม`, "สิ่งที่ทำต่อได้ทันที"];

  return {
    title: `${brand.name}: ${message}`,
    mainHook: `${audience}—ทำไม "${message}" ถึงยังเป็นเรื่องยาก ทั้งที่คำตอบอาจต่างจากที่คิด?`,
    sections: [
      { topic: topics[0], script: `${legacySections.hooks}\n${legacySections.painPointsOrIntroduction}` },
      { topic: topics[1], script: legacySections.content },
      { topic: topics[2], script: `${legacySections.conversion}\n${legacySections.solution}` },
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
