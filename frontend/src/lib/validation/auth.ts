import { z } from 'zod';

// Client-side schemas for form feedback (react-hook-form). These mirror, but
// never replace, the server's own validation in frontend/src/app/api/auth/*.

export const loginSchema = z.object({
  email: z.string().email('Adresse e-mail invalide.'),
  password: z.string().min(1, 'Mot de passe requis.'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const signupSchema = z.object({
  email: z.string().email('Adresse e-mail invalide.'),
  password: z.string().min(8, '8 caractères minimum.'),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email('Adresse e-mail invalide.'),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

const verificationCode = z
  .string()
  .length(8, 'Le code fait 8 caractères.')
  .regex(/^[A-Z2-9]{8}$/, 'Code invalide.');

export const verifyEmailSchema = z.object({
  email: z.string().email('Adresse e-mail invalide.'),
  code: verificationCode,
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resetPasswordSchema = z.object({
  email: z.string().email('Adresse e-mail invalide.'),
  code: verificationCode,
  newPassword: z.string().min(8, '8 caractères minimum.'),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
