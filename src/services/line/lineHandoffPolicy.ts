import type { LineAccount } from '@/domain/models/LineAccount';
export const inScope = (a: LineAccount) => (a.isTest === true) === (process.env.LINE_TEST_MODE === 'true');
export const takeoverActive = (a: LineAccount) => a.takeoverActive && (!a.takeoverExpiresAt || a.takeoverExpiresAt.getTime() > Date.now());
export function positiveLimit(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
