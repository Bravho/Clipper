import { z } from "zod";
import { passwordFieldTh } from "./passwordRules";

/** /forgot-password — just the address to look up. */
export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, "กรุณากรอกอีเมล")
    .email("รูปแบบอีเมลไม่ถูกต้อง")
    .max(254, "อีเมลยาวเกินไป"),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** /reset-password — the new password, twice. */
export const resetPasswordSchema = z
  .object({
    password: passwordFieldTh,
    confirmPassword: z.string().min(1, "กรุณายืนยันรหัสผ่าน"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "รหัสผ่านทั้งสองช่องไม่ตรงกัน",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
