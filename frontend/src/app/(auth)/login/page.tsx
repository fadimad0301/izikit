'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, ApiError, storeCsrfToken } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { POST_AUTH_REDIRECT } from '@/lib/constants';
import { loginSchema, type LoginInput } from '@/lib/validation/auth';
import { Card, Input, Button } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    try {
      const res = await api<{ csrfToken?: string }>('/api/auth/login', {
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

  return (
    <Card bordered elevated className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-2xl text-ink-900">Connecte-toi à ton compte</h1>
        <p className="text-sm text-charcoal-900/70">
          Retrouve ton CV et le suivi de tes candidatures.
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
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        {formError && (
          <p role="alert" className="text-sm text-error-600">
            {formError}
          </p>
        )}
        <Button type="submit" loading={isSubmitting} className="mt-1 w-full">
          Se connecter
        </Button>
      </form>

      <div className="flex flex-col gap-2 text-sm text-charcoal-900/70">
        <Link href="/forgot-password" className="text-ink-900 underline underline-offset-2">
          Mot de passe oublié ?
        </Link>
        <p>
          Pas encore de compte ?{' '}
          <Link href="/signup" className="font-medium text-ink-900 underline underline-offset-2">
            Crée-en un
          </Link>
        </p>
      </div>
    </Card>
  );
}
