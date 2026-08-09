'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, ApiError } from '@/lib/api';
import { signupSchema, type SignupInput } from '@/lib/validation/auth';
import { Card, Input, Button } from '@/components/ui';

export default function SignupPage() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({ resolver: zodResolver(signupSchema) });

  async function onSubmit(values: SignupInput) {
    setFormError(null);
    try {
      // Enumeration-resistant endpoint: always 201, never issues cookies —
      // the account isn't usable until the email is verified.
      await api('/api/auth/signup', { method: 'POST', body: values });
      router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOO_MANY_SIGNUP_ATTEMPTS') {
        setFormError('Trop de tentatives pour cette adresse. Réessaie dans une heure.');
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Une erreur est survenue.');
      }
    }
  }

  return (
    <Card bordered elevated className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-2xl text-ink-900">Crée ton compte Doxi</h1>
        <p className="text-sm text-charcoal-900/70">
          Prépare ton CV et ton dossier d’études à l’étranger, étape par étape.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <Input
          label="Adresse e-mail"
          type="email"
          autoComplete="email"
          placeholder="ex : moussa@gmail.com"
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Mot de passe"
          type="password"
          autoComplete="new-password"
          helperText={!errors.password ? '8 caractères minimum.' : undefined}
          error={errors.password?.message}
          {...register('password')}
        />
        {formError && (
          <p role="alert" className="text-sm text-error-600">
            {formError}
          </p>
        )}
        <Button type="submit" loading={isSubmitting} className="mt-1 w-full">
          Créer mon compte
        </Button>
      </form>

      <p className="text-sm text-charcoal-900/70">
        Déjà un compte ?{' '}
        <Link href="/login" className="font-medium text-ink-900 underline underline-offset-2">
          Connecte-toi
        </Link>
      </p>
    </Card>
  );
}
