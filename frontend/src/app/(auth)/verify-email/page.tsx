'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, ApiError, storeCsrfToken } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { POST_AUTH_REDIRECT } from '@/lib/constants';
import { verifyEmailSchema, type VerifyEmailInput } from '@/lib/validation/auth';
import { Card, Input, Button } from '@/components/ui';

function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<VerifyEmailInput>({
    resolver: zodResolver(verifyEmailSchema),
    defaultValues: {
      email: params.get('email') ?? '',
      code: (params.get('code') ?? '').toUpperCase(),
    },
  });

  async function onSubmit(values: VerifyEmailInput) {
    setFormError(null);
    try {
      const res = await api<{ csrfToken?: string }>('/api/auth/verify-email', {
        method: 'POST',
        body: values,
      });
      if (res.csrfToken) storeCsrfToken(res.csrfToken);
      await refresh();
      router.push(POST_AUTH_REDIRECT);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Une erreur est survenue.');
    }
  }

  // If the verification link carried both params, submit automatically —
  // the form below is the fallback for manual code entry.
  useEffect(() => {
    const qEmail = params.get('email');
    const qCode = params.get('code');
    if (qEmail && qCode) {
      void onSubmit({ email: qEmail, code: qCode.toUpperCase() });
    }
    // Intentionally run once on mount only — onSubmit is stable enough here
    // and re-running on every render would resubmit the form.
  }, []);

  async function onResend() {
    setFormError(null);
    setResent(false);
    try {
      await api('/api/auth/resend-verification', {
        method: 'POST',
        body: { email: getValues('email') },
      });
      setResent(true);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Une erreur est survenue.');
    }
  }

  return (
    <Card bordered elevated className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-2xl text-ink-900">Vérifie ton adresse e-mail</h1>
        <p className="text-sm text-charcoal-900/70">
          On t’a envoyé un code à 8 caractères. Il expire dans 10 minutes.
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
          label="Code de vérification"
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
        {formError && (
          <p role="alert" className="text-sm text-error-600">
            {formError}
          </p>
        )}
        <Button type="submit" loading={isSubmitting} className="mt-1 w-full">
          Vérifier mon compte
        </Button>
      </form>

      <div className="flex flex-col gap-2 text-sm text-charcoal-900/70">
        <p>
          Pas reçu de code ?{' '}
          <button
            type="button"
            onClick={onResend}
            className="font-medium text-ink-900 underline underline-offset-2"
          >
            Renvoyer le code
          </button>
          {resent && <span className="ml-1 text-success-600">Code renvoyé.</span>}
        </p>
        <Link href="/signup" className="text-ink-900 underline underline-offset-2">
          Mauvaise adresse e-mail ? Recommence l’inscription
        </Link>
      </div>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  );
}
