// /cv — CV Builder entry point.
//
// Phase 2 scope: capture the two inputs that drive CV generation (target
// country + target field) and persist them as a draft via /api/cv. The
// actual multi-step wizard (education, experience, skills, format) is a
// later phase — this screen proves the model + route + auth gate end to
// end without a half-built wizard behind it.
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { useUser } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Card, Input, Button, Badge } from '@/components/ui';

interface CvDraft {
  targetCountry: string | null;
  targetField: string | null;
  updatedAt: string | null;
}

export default function CvBuilderPage() {
  const user = useUser();
  const { toast } = useToast();
  const [draft, setDraft] = useState<CvDraft | null>(null);
  const [targetCountry, setTargetCountry] = useState('');
  const [targetField, setTargetField] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api<CvDraft>('/api/cv')
      .then((res) => {
        setDraft(res);
        setTargetCountry(res.targetCountry ?? '');
        setTargetField(res.targetField ?? '');
      })
      .catch(() => {
        // First visit — no draft yet, form stays empty.
      })
      .finally(() => setLoading(false));
  }, [user]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api<CvDraft>('/api/cv', {
        method: 'PATCH',
        body: { targetCountry, targetField },
      });
      setDraft(res);
      toast('Ton espace CV est enregistré.', 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue.');
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper-50">
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-16">
      <div>
        <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">CV Builder</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">
          Construis un CV adapté à ta candidature
        </h1>
        <p className="mt-2 text-sm text-charcoal-900/70">
          Indique ton pays cible et ton domaine — Doxi s’en sert pour structurer ton CV aux bons
          standards.
        </p>
      </div>

      <Card bordered elevated className="flex flex-col gap-5">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Input
            label="Pays cible"
            placeholder="ex : France, Canada, Maroc…"
            value={targetCountry}
            onChange={(e) => setTargetCountry(e.target.value)}
            disabled={loading}
            maxLength={100}
          />
          <Input
            label="Domaine d’études visé"
            placeholder="ex : Informatique, Gestion, Médecine…"
            value={targetField}
            onChange={(e) => setTargetField(e.target.value)}
            disabled={loading}
            maxLength={100}
          />
          {error && (
            <p role="alert" className="text-sm text-error-600">
              {error}
            </p>
          )}
          <Button type="submit" loading={saving} disabled={loading} className="w-full">
            Enregistrer
          </Button>
        </form>
      </Card>

      <Card bordered className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-ink-900">Étape suivante : le questionnaire guidé</p>
          <p className="mt-1 text-sm text-charcoal-900/70">
            Formations, expériences, compétences et génération du CV — disponible dans la prochaine
            mise à jour.
          </p>
        </div>
        <Badge variant="neutral" className="shrink-0">
          Bientôt
        </Badge>
      </Card>

      {draft?.updatedAt && (
        <p className="text-xs text-charcoal-900/40">
          Dernière sauvegarde : {new Date(draft.updatedAt).toLocaleString('fr-FR')}
        </p>
      )}
    </main>
  );
}
