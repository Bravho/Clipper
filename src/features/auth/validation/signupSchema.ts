import { z } from "zod";
import { passwordField } from "./passwordRules";

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
      // Accept names in every language used by the product, including Thai
      // combining marks. Numbers and symbols remain disallowed.
      .regex(
        /^[\p{L}\p{M}\s\-'.]+$/u,
        "Full name may contain letters, spaces, apostrophes, periods, and hyphens."
      ),
    email: z
      .string()
      .min(1, "Email is required.")
      .email("Please enter a valid email address.")
      .max(254, "Email address is too long."),
    // Shared with the password-reset form so the two cannot drift.
    password: passwordField,
    confirmPassword: z.string().min(1, "Please confirm your password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignupInput = z.infer<typeof signupSchema>;
