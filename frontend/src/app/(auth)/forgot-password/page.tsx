'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, ApiError } from '@/lib/api';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@/lib/validation/auth';
import { Card, Input, Button } from '@/components/ui';

export default function ForgotPasswordPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  async function onSubmit(values: ForgotPasswordInput) {
    setFormError(null);
    try {
      // Enumeration-resistant: server always returns the same response.
      await api('/api/auth/forgot-password', { method: 'POST', body: values });
      setSubmittedEmail(values.email);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOO_MANY_RESET_REQUESTS') {
        setFormError('Trop de demandes pour cette adresse. Réessaie dans une heure.');
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Une erreur est survenue.');
      }
    }
  }

  if (submittedEmail) {
    return (
      <Card bordered elevated className="flex flex-col gap-4">
        <h1 className="font-serif text-2xl text-ink-900">Vérifie tes e-mails</h1>
        <p className="text-sm text-charcoal-900/70">
          Si un compte existe pour <strong>{submittedEmail}</strong>, tu recevras un code de
          réinitialisation dans la minute.
        </p>
        <Link href="/reset-password" className="text-sm text-ink-900 underline underline-offset-2">
          J’ai déjà mon code
        </Link>
      </Card>
    );
  }

  return (
    <Card bordered elevated className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-2xl text-ink-900">Mot de passe oublié ?</h1>
        <p className="text-sm text-charcoal-900/70">
          Indique ton adresse e-mail, on t’envoie un code pour le réinitialiser.
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
        {formError && (
          <p role="alert" className="text-sm text-error-600">
            {formError}
          </p>
        )}
        <Button type="submit" loading={isSubmitting} className="mt-1 w-full">
          Envoyer le code
        </Button>
      </form>

      <p className="text-sm text-charcoal-900/70">
        Tu t’en souviens finalement ?{' '}
        <Link href="/login" className="font-medium text-ink-900 underline underline-offset-2">
          Connecte-toi
        </Link>
      </p>
    </Card>
  );
}
