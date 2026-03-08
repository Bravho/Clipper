import { z } from "zod";

/**
 * Zod schema for the email/password signup form.
 *
 * Consent is implicit: by clicking "Create my account" the user agrees to
 * the Terms of Service and Privacy Policy (which covers ownership rights
 * and storage retention). No explicit checkbox fields required.
 */
export const signupSchema = z
  .object({
    name: z
      .string()
      .min(2, "Full name must be at least 2 characters.")
      .max(100, "Full name must be under 100 characters.")
      .regex(/^[a-zA-Z\s\-'.]+$/, "Full name contains invalid characters."),
    email: z
      .string()
      .min(1, "Email is required.")
      .email("Please enter a valid email address.")
      .max(254, "Email address is too long."),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(128, "Password must be under 128 characters.")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter.")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter.")
      .regex(/[0-9]/, "Password must contain at least one number."),
    confirmPassword: z.string().min(1, "Please confirm your password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignupInput = z.infer<typeof signupSchema>;
