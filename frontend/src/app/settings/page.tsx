// /settings — compte : profil, mot de passe, comptes liés, statut des procédures.
//
// Trois flux existants (inchangés en logique, restylés en Phase 6) :
//   1. Set / change password — voir onSubmitPassword.
//   2. Lier Google — voir la section "Comptes liés".
// Deux flux ajoutés en Phase 6 :
//   3. Éditer nom + téléphone (PATCH /api/auth/me).
//   4. Statut des procédures achetées (GET /api/procedures/mine), avec un Stamp
//      "Dossier complet" quand tous les documents d'une procédure Complet sont déposés.
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { api, ApiError } from '@/lib/api';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Card, Badge, Input, Button, Stamp } from '@/components/ui';
import { useReducedMotion, DOXI_EASE } from '@/lib/motion';

interface MyProcedure {
  slug: string;
  name: string;
  country: string;
  field: string | null;
  tier: 'SIMPLE' | 'COMPLET';
  checklistTotal: number;
  documentsUploaded: number | null;
  grantedAt: string;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function SettingsPage() {
  const user = useUser();
  const { refresh } = useAuth();
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();

  // Profile form state.
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Password form state.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Mes procédures" state.
  const [procedures, setProcedures] = useState<MyProcedure[] | null>(null);
  const [proceduresError, setProceduresError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setProfileName(user.name ?? '');
      setProfilePhone(user.phone ?? '');
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api<MyProcedure[]>('/api/procedures/mine')
      .then((data) => {
        if (!cancelled) setProcedures(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setProceduresError(apiErrorMessage(err, 'Impossible de charger tes procédures.'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 px-4">
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      </main>
    );
  }

  const hasPassword = user.hasPassword;
  const googleLinked = user.linkedProviders.includes('google');

  async function onSubmitProfile(e: FormEvent) {
    e.preventDefault();
    setProfileError(null);

    if (profileName.trim().length === 0) {
      setProfileError('Le nom ne peut pas être vide.');
      return;
    }

    setProfileSubmitting(true);
    try {
      await api('/api/auth/me', {
        method: 'PATCH',
        body: { name: profileName.trim(), phone: profilePhone.trim() },
      });
      toast('Profil mis à jour.', 'success');
      await refresh();
    } catch (err) {
      setProfileError(apiErrorMessage(err, 'Impossible de mettre à jour le profil.'));
    } finally {
      setProfileSubmitting(false);
    }
  }

  async function onSubmitPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length === 0) {
      setError('Saisis un nouveau mot de passe.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }

    setSubmitting(true);
    try {
      if (hasPassword) {
        await api('/api/auth/change-password', {
          method: 'PUT',
          body: { currentPassword, newPassword },
        });
        toast('Mot de passe mis à jour.', 'success');
      } else {
        await api('/api/auth/set-password', {
          method: 'POST',
          body: { newPassword },
        });
        toast('Mot de passe défini. Tu peux maintenant te connecter par email.', 'success');
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const map: Record<string, string> = {
          INVALID_CREDENTIALS: 'Mot de passe actuel incorrect.',
          PASSWORD_BANNED: 'Ce mot de passe est trop courant.',
          PASSWORD_TOO_SHORT: err.message || 'Mot de passe trop court.',
          PASSWORD_PWNED: 'Ce mot de passe a fuité — choisis-en un autre.',
          PASSWORD_ALREADY_SET:
            'Un mot de passe est déjà défini. Utilise « changer le mot de passe ».',
          VALIDATION_FAILED: 'Champs invalides.',
        };
        setError(map[err.code] ?? err.message);
      } else {
        setError('Erreur réseau. Réessaie.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function statusLine(proc: MyProcedure): { text: string; complete: boolean } {
    if (proc.tier === 'SIMPLE') {
      return { text: 'Débloqué', complete: false };
    }
    const uploaded = proc.documentsUploaded ?? 0;
    if (proc.checklistTotal > 0 && uploaded === proc.checklistTotal) {
      return { text: 'Dossier complet', complete: true };
    }
    return { text: `${uploaded} / ${proc.checklistTotal} documents déposés`, complete: false };
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl text-ink-900">Paramètres</h1>
        <p className="text-sm text-charcoal-900/60">Connecté en tant que {user.email}</p>
      </header>

      {/* ── Profile section ──────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.35, ease: DOXI_EASE }}
      >
        <Card bordered>
          <h2 className="text-lg font-semibold text-ink-900">Mon profil</h2>
          <p className="mt-1 text-sm text-charcoal-900/70">
            Ces informations nous permettent de te contacter si besoin. Le téléphone est optionnel.
          </p>
          <form onSubmit={onSubmitProfile} className="mt-4 flex flex-col gap-4">
            <Input
              label="Nom complet"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Awa Diop"
            />
            <Input
              label="Téléphone"
              type="tel"
              value={profilePhone}
              onChange={(e) => setProfilePhone(e.target.value)}
              placeholder="+221771234567"
              helperText="Format international, ex. +221771234567. Laisse vide pour effacer."
            />
            {profileError && (
              <p role="alert" className="text-sm text-error-600">
                {profileError}
              </p>
            )}
            <div>
              <Button type="submit" loading={profileSubmitting}>
                Enregistrer
              </Button>
            </div>
          </form>
        </Card>
      </motion.div>

      {/* ── Password section ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reduceMotion ? 0 : 0.35,
          delay: reduceMotion ? 0 : 0.05,
          ease: DOXI_EASE,
        }}
      >
        <Card bordered>
          <h2 className="text-lg font-semibold text-ink-900">
            {hasPassword ? 'Changer le mot de passe' : 'Définir un mot de passe'}
          </h2>
          <p className="mt-1 text-sm text-charcoal-900/70">
            {hasPassword
              ? 'Tu peux modifier ton mot de passe ici. Les autres sessions seront déconnectées.'
              : 'Tu t’es connecté via Google. Définis un mot de passe pour pouvoir aussi te connecter par email.'}
          </p>
          <form onSubmit={onSubmitPassword} className="mt-4 flex flex-col gap-4">
            {hasPassword && (
              <Input
                label="Mot de passe actuel"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            )}
            <Input
              label="Nouveau mot de passe"
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <Input
              label="Confirmer le nouveau mot de passe"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {error && (
              <p role="alert" className="text-sm text-error-600">
                {error}
              </p>
            )}
            <div>
              <Button type="submit" loading={submitting}>
                {hasPassword ? 'Changer le mot de passe' : 'Définir le mot de passe'}
              </Button>
            </div>
          </form>
        </Card>
      </motion.div>

      {/* ── Linked providers section ────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reduceMotion ? 0 : 0.35,
          delay: reduceMotion ? 0 : 0.1,
          ease: DOXI_EASE,
        }}
      >
        <Card bordered>
          <h2 className="text-lg font-semibold text-ink-900">Comptes liés</h2>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-ink-900">Google</span>
              <span className="text-xs text-charcoal-900/60">
                {googleLinked
                  ? 'Tu peux te connecter via Google.'
                  : 'Lie ton compte Google pour te connecter en un clic.'}
              </span>
            </div>
            {googleLinked ? (
              <Badge variant="success">Lié</Badge>
            ) : (
              <a
                href="/api/auth/oauth/google/start?next=/settings"
                className="rounded-xl border border-ink-900/15 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-paper-100"
              >
                Lier Google
              </a>
            )}
          </div>
        </Card>
      </motion.div>

      {/* ── Mes procédures section ──────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reduceMotion ? 0 : 0.35,
          delay: reduceMotion ? 0 : 0.15,
          ease: DOXI_EASE,
        }}
      >
        <Card bordered>
          <h2 className="text-lg font-semibold text-ink-900">Mes procédures</h2>

          {proceduresError && <p className="mt-3 text-sm text-error-600">{proceduresError}</p>}

          {procedures === null && !proceduresError && (
            <p className="mt-3 text-sm text-charcoal-900/60">Chargement…</p>
          )}

          {procedures !== null && procedures.length === 0 && (
            <p className="mt-3 text-sm text-charcoal-900/60">
              Tu n'as encore acheté aucune procédure.{' '}
              <Link href="/procedures" className="underline">
                Voir les procédures
              </Link>
            </p>
          )}

          <div className="mt-4 flex flex-col gap-3">
            {procedures?.map((proc) => {
              const status = statusLine(proc);
              return (
                <Link
                  key={proc.slug}
                  href={`/procedures/${proc.slug}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-ink-900/10 p-4 hover:bg-paper-100"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink-900">{proc.name}</span>
                      <Badge variant={proc.tier === 'COMPLET' ? 'gold' : 'neutral'}>
                        {proc.tier === 'COMPLET' ? 'Complet' : 'Simple'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-charcoal-900/60">
                      {proc.country}
                      {proc.field ? ` · ${proc.field}` : ''}
                    </p>
                    <p className="mt-1 text-sm text-charcoal-900/75">{status.text}</p>
                  </div>
                  {status.complete && <Stamp size={36} delay={0} />}
                </Link>
              );
            })}
          </div>
        </Card>
      </motion.div>

      <Link href="/procedures" className="text-center text-sm text-charcoal-900/60 underline">
        Retour aux procédures
      </Link>
    </main>
  );
}
