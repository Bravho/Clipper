import type { MessageKey } from "./messages";

/**
 * The form schemas (zod) are shared with the API routes, so their messages are
 * fixed strings — some English, some Thai. The forms show them through this
 * map, in the language picked in the menu. A message not listed here (a new
 * rule) is shown as written rather than dropped.
 */
const VALIDATION_KEYS: Record<string, MessageKey> = {
  "Email is required.": "validation.emailRequired",
  "กรุณากรอกอีเมล": "validation.emailRequired",
  "Please enter a valid email address.": "validation.emailInvalid",
  "รูปแบบอีเมลไม่ถูกต้อง": "validation.emailInvalid",
  "Email address is too long.": "validation.emailTooLong",
  "อีเมลยาวเกินไป": "validation.emailTooLong",
  "Password is required.": "validation.passwordRequired",
  "Password must be at least 8 characters.": "validation.passwordMin",
  "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร": "validation.passwordMin",
  "Password must be under 128 characters.": "validation.passwordMax",
  "รหัสผ่านต้องไม่เกิน 128 ตัวอักษร": "validation.passwordMax",
  "Password must contain at least one uppercase letter.": "validation.passwordUpper",
  "รหัสผ่านต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว": "validation.passwordUpper",
  "Password must contain at least one lowercase letter.": "validation.passwordLower",
  "รหัสผ่านต้องมีตัวพิมพ์เล็กอย่างน้อย 1 ตัว": "validation.passwordLower",
  "Password must contain at least one number.": "validation.passwordNumber",
  "รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว": "validation.passwordNumber",
  "Please confirm your password.": "validation.confirmRequired",
  "กรุณายืนยันรหัสผ่าน": "validation.confirmRequired",
  "Passwords do not match.": "validation.passwordMismatch",
  "รหัสผ่านทั้งสองช่องไม่ตรงกัน": "validation.passwordMismatch",
  "Full name must be at least 2 characters.": "validation.nameMin",
  "Full name must be under 100 characters.": "validation.nameMax",
  "Full name may contain letters, spaces, apostrophes, periods, and hyphens.": "validation.nameChars",
};

export function localizeValidation(
  t: (key: MessageKey) => string,
  message: string | undefined
): string | undefined {
  if (!message) return message;
  const key = VALIDATION_KEYS[message];
  return key ? t(key) : message;
}
