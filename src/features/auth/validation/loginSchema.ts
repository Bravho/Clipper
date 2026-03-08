import { z } from "zod";

/**
 * Zod schema for the login form.
 * Used both client-side (form validation) and server-side (API route).
 */
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required.")
    .email("Please enter a valid email address."),
  password: z
    .string()
    .min(1, "Password is required."),
});

export type LoginInput = z.infer<typeof loginSchema>;
