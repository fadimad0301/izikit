// /procedures — catalogue public des procédures (Accompagnement Simple).
// Consultable sans compte ; l'achat (voir /procedures/[slug]) redirige vers
// /login si nécessaire.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { api, ApiError } from '@/lib/api';
import { Card, Badge } from '@/components/ui';
import { formatPrice } from '@/lib/utils';
import { useReducedMotion, DOXI_EASE } from '@/lib/motion';

interface ProcedureListItem {
  id: string;
  slug: string;
  name: string;
  country: string;
  field: string | null;
  tagline: string;
  priceFcfa: number;
}

// `api.ts` (PROTECTED) sets `ApiError.message` from the response body's
// `error` field — the stable code, not the user-facing copy. Every route
// in this plan also returns a French `message` field, reachable via
// `err.body.message`. Prefer that; fall back if it's absent/malformed.
function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function ProceduresPage() {
  const [procedures, setProcedures] = useState<ProcedureListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    api<ProcedureListItem[]>('/api/procedures')
      .then((data) => {
        if (!cancelled) setProcedures(data);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'Impossible de charger les procédures.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">
        Accompagnement Simple
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Choisis ta procédure</h1>
      <p className="mt-2 max-w-xl text-sm text-charcoal-900/70">
        Débloque la checklist des documents requis pour une procédure, pour {formatPrice(5000)}{' '}
        FCFA.
      </p>

      {error && <p className="mt-8 text-sm text-error-600">{error}</p>}

      {procedures === null && !error && (
        <p className="mt-8 text-sm text-charcoal-900/60">Chargement…</p>
      )}

      {procedures !== null && procedures.length === 0 && (
        <p className="mt-8 text-sm text-charcoal-900/60">
          Aucune procédure disponible pour le moment.
        </p>
      )}

      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {procedures?.map((proc, i) => (
          <motion.div
            key={proc.id}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.35, delay: i * 0.05, ease: DOXI_EASE }}
          >
            <Link href={`/procedures/${proc.slug}`}>
              <Card bordered className="h-full">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium text-ink-900">{proc.name}</h2>
                    <p className="mt-1 text-sm text-charcoal-900/60">
                      {proc.country}
                      {proc.field ? ` · ${proc.field}` : ''}
                    </p>
                  </div>
                  <Badge variant="gold">{formatPrice(proc.priceFcfa)} FCFA</Badge>
                </div>
                <p className="mt-4 text-sm text-charcoal-900/75">{proc.tagline}</p>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>
    </main>
  );
}
