import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address").max(254));

// Same rules the clients show live: 8+ characters, a number and a symbol.
const newPassword = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Use at most 128 characters")
  .regex(/\d/, "Include a number")
  .regex(/[^A-Za-z0-9\s]/, "Include a symbol");

export const signupBody = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(80),
    email,
    password: newPassword,
  })
  .strict();

export const loginBody = z
  .object({
    email,
    password: z.string().min(1, "Enter your password").max(128),
    keepSignedIn: z.boolean().default(true),
  })
  .strict();

export const googleBody = z
  .object({
    idToken: z.string().min(100).max(4096),
  })
  .strict();

// Native clients send the refresh token in the body; the web client sends nothing (the cookie carries it).
export const refreshBody = z
  .object({
    refreshToken: z.string().min(20).max(256).optional(),
  })
  .strict();

// Email link tokens are 43 base64url characters; anything else simply fails the lookup and returns INVALID_LINK.
const linkToken = z.string().trim().min(20).max(128);

export const forgotPasswordBody = z.object({ email }).strict();

export const linkTokenBody = z.object({ token: linkToken }).strict();

export const resetPasswordBody = z.object({ token: linkToken, password: newPassword }).strict();

export const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(128),
    newPassword,
  })
  .strict();
