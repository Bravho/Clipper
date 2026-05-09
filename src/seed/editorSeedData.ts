/**
 * Seed data for the editor marketplace.
 *
 * Loaded on first access via MockEditorProfileRepository's globalThis singleton.
 * Call initEditorSeedData() once at app startup (e.g. in providers.tsx or a seed route).
 *
 * Profiles:
 *   AI Editor   — system account, isAI: true, linked to user-staff-001 (existing seed user)
 *   Nat Kamon   — human editor, tourism specialist
 *   Pim Sirichai — human editor, restaurant / food specialist
 */

import { EditorProfile } from "@/domain/models/EditorProfile";

const now = new Date("2024-01-01T00:00:00Z");

export const SEED_EDITOR_PROFILES: EditorProfile[] = [
  {
    id: "editor-ai-001",
    userId: "user-staff-001",
    displayName: "AI Editor",
    bio: "ระบบ AI อัตโนมัติที่สร้างคลิปสั้น 15 วินาทีจากรูปภาพของคุณ — วิเคราะห์ภาพ วางแผนฉาก เขียน script ภาษาไทย/อังกฤษ/จีน บันทึกเสียง และ publish พร้อมกัน ทุกแพลตฟอร์ม รวดเร็วและราคาถูก",
    avatarUrl: null,
    portfolioUrl: null,
    specialties: ["tourism", "restaurant", "hotel", "fast-delivery"],
    isAI: true,
    pricePerRequestBaht: 500,
    avgRating: 4.5,
    totalReviews: 120,
    totalCompleted: 120,
    isApproved: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "editor-human-001",
    userId: "user-admin-001",
    displayName: "Nat Kamon",
    bio: "ผู้เชี่ยวชาญด้านวิดีโอท่องเที่ยวและโรงแรม มีประสบการณ์ทำ content สำหรับตลาดจีน ญี่ปุ่น และตะวันตก เข้าใจ algorithm TikTok และ YouTube Shorts เป็นพิเศษ",
    avatarUrl: null,
    portfolioUrl: "https://natportfolio.example.com",
    specialties: ["tourism", "hotel", "chinese-market", "tiktok-algorithm"],
    isAI: false,
    pricePerRequestBaht: 800,
    avgRating: 4.8,
    totalReviews: 47,
    totalCompleted: 47,
    isApproved: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "editor-human-002",
    userId: "user-requester-001",
    displayName: "Pim Sirichai",
    bio: "เชี่ยวชาญ content ร้านอาหารและ F&B ทำงานกับแบรนด์อาหารไทยมากกว่า 50 แบรนด์ สไตล์ภาพสวย น่ากินใน 3 วินาทีแรก เข้าถึงตลาด Instagram และ Facebook ได้ดี",
    avatarUrl: null,
    portfolioUrl: "https://pimportfolio.example.com",
    specialties: ["restaurant", "food", "instagram", "facebook"],
    isAI: false,
    pricePerRequestBaht: 750,
    avgRating: 4.7,
    totalReviews: 63,
    totalCompleted: 63,
    isApproved: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
];

/** Load seed editor profiles into the mock repository. Call once at startup. */
export function initEditorSeedData(): void {
  // Lazily access the globalThis store that MockEditorProfileRepository uses
  if (!global.__mockEditorProfileStore) {
    global.__mockEditorProfileStore = new Map();
  }
  if (global.__mockEditorProfileStore.size === 0) {
    for (const profile of SEED_EDITOR_PROFILES) {
      global.__mockEditorProfileStore.set(profile.id, profile);
    }
  }
}
