'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, ApiError } from '@/lib/api';
import { resetPasswordSchema, type ResetPasswordInput } from '@/lib/validation/auth';
import { Card, Input, Button } from '@/components/ui';

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      email: params.get('email') ?? '',
      code: (params.get('code') ?? '').toUpperCase(),
      newPassword: '',
    },
  });

  async function onSubmit(values: ResetPasswordInput) {
    setFormError(null);
    try {
      // No auto-login here — reset bumps tokenVersion, invalidating any
      // stolen sessions. The user logs in fresh with the new password.
      await api('/api/auth/reset-password', { method: 'POST', body: values });
      router.push('/login?reset=ok');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOO_MANY_RESET_ATTEMPTS') {
        setFormError('Trop de tentatives. Réessaie dans 10 minutes.');
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Une erreur est survenue.');
      }
    }
  }

  return (
    <Card bordered elevated className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-2xl text-ink-900">Réinitialise ton mot de passe</h1>
        <p className="text-sm text-charcoal-900/70">
          Saisis le code reçu par e-mail et choisis un nouveau mot de passe.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <Input
          label="Adresse e-mail"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Code de réinitialisation"
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          maxLength={8}
          className="font-mono uppercase tracking-widest"
          error={errors.code?.message}
          {...register('code', {
            onChange: (e) => {
              e.target.value = e.target.value.toUpperCase();
            },
          })}
        />
        <Input
          label="Nouveau mot de passe"
          type="password"
          autoComplete="new-password"
          helperText={!errors.newPassword ? '8 caractères minimum.' : undefined}
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        {formError && (
          <p role="alert" className="text-sm text-error-600">
            {formError}
          </p>
        )}
        <Button type="submit" loading={isSubmitting} className="mt-1 w-full">
          Réinitialiser le mot de passe
        </Button>
      </form>

      <Link href="/login" className="text-sm text-ink-900 underline underline-offset-2">
        Retour à la connexion
      </Link>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
