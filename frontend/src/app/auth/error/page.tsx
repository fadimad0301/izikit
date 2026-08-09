// /auth/error — landing page for OAuth callback failures.
//
// The callback (frontend/src/app/api/auth/oauth/google/callback/route.ts)
// builds redirects via `redirectToAuthError(code)` in
// frontend/src/lib/server/oauth/error-redirect.ts. That helper hard-codes
// `/auth/error?code=<CODE>` with five UPPERCASE codes (D-06 contract):
//   GOOGLE_EMAIL_NOT_VERIFIED
//   OAUTH_STATE_MISMATCH
//   OAUTH_CODE_EXCHANGE_FAILED
//   OAUTH_PROVIDER_DISABLED
//   OAUTH_GENERIC
//
// Unknown / missing codes fall back to a generic message.
'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui';
import { Logo } from '@/components/brand/Logo';

const ERROR_MESSAGES: Record<string, string> = {
  GOOGLE_EMAIL_NOT_VERIFIED:
    "Votre adresse Google n'est pas vérifiée. Vérifiez-la sur votre compte Google, puis réessayez.",
  OAUTH_STATE_MISMATCH:
    'La connexion a été interrompue (vérification de sécurité). Cela peut arriver si la page Google est restée ouverte trop longtemps — réessayez.',
  OAUTH_CODE_EXCHANGE_FAILED: 'Google a refusé la connexion. Réessayez dans un instant.',
  OAUTH_PROVIDER_DISABLED:
    'La connexion via Google n’est pas activée sur ce serveur. Contactez le support.',
  OAUTH_GENERIC: 'Une erreur inattendue est survenue pendant la connexion. Réessayez.',
};

function AuthErrorBody() {
  const params = useSearchParams();
  const code = params.get('code') ?? params.get('error') ?? '';
  const normalized = code.toUpperCase();
  const message =
    ERROR_MESSAGES[normalized] ??
    'Une erreur inconnue est survenue pendant la connexion. Réessayez.';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-paper-50 px-4 py-12">
      <Logo />
      <div className="w-full max-w-md">
        <Card bordered elevated className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-serif text-2xl text-ink-900">Échec de connexion</h1>
            <p className="text-sm text-charcoal-900/70">{message}</p>
          </div>
          {code && (
            <p className="font-mono text-xs text-charcoal-900/40" aria-hidden="true">
              code : {code}
            </p>
          )}
          <div className="flex flex-col gap-3">
            <Link
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-ink-900 px-5 text-sm font-medium text-paper-50 transition-colors hover:bg-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seal-gold focus-visible:ring-offset-2"
            >
              Retour à la connexion
            </Link>
            <Link
              href="/"
              className="text-center text-sm text-ink-900 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seal-gold focus-visible:ring-offset-2"
            >
              Accueil
            </Link>
          </div>
        </Card>
      </div>
    </main>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={null}>
      <AuthErrorBody />
    </Suspense>
  );
}
