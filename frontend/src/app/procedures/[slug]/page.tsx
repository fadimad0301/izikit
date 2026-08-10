// /procedures/[slug] — détail d'une procédure : checklist si déjà achetée,
// sinon bouton d'achat (Accompagnement Simple, 5 000 FCFA) via le flux
// Bictorys existant (POST /api/orders, inchangé — voir CLAUDE.md).
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Card, Badge, Button, Accordion, type AccordionItemData } from '@/components/ui';
import { formatPrice, isInAppBrowser } from '@/lib/utils';

interface ChecklistItem {
  title: string;
  description?: string;
}

interface ProcedureDetail {
  id: string;
  slug: string;
  name: string;
  country: string;
  field: string | null;
  tagline: string;
  priceFcfa: number;
  hasAccess: boolean;
  checklist?: ChecklistItem[];
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function ProcedureDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [procedure, setProcedure] = useState<ProcedureDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [inAppWarning, setInAppWarning] = useState(false);

  useEffect(() => {
    setInAppWarning(isInAppBrowser());
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<ProcedureDetail>(`/api/procedures/${slug}`)
      .then((data) => {
        if (!cancelled) setProcedure(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiError && err.status === 404
              ? 'Cette procédure n’existe pas.'
              : apiErrorMessage(err, 'Impossible de charger cette procédure.'),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function handleBuy() {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!procedure) return;

    setBuying(true);
    try {
      const res = await api<{ id: string; paymentUrl: string; status: string }>('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          amount: procedure.priceFcfa,
          currency: 'XOF',
          metadata: {
            tier: 'SIMPLE',
            procedureId: procedure.id,
            procedureSlug: procedure.slug,
          },
        },
      });
      window.location.href = res.paymentUrl;
    } catch (err) {
      toast(apiErrorMessage(err, 'Le paiement n’a pas pu être initié.'), 'error');
      setBuying(false);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-error-600">{loadError}</p>
      </main>
    );
  }

  if (!procedure) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      </main>
    );
  }

  const checklistItems: AccordionItemData[] = (procedure.checklist ?? []).map((item, i) => ({
    id: `item-${i}`,
    title: item.title,
    content: item.description ?? '',
  }));

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">
        {procedure.country}
        {procedure.field ? ` · ${procedure.field}` : ''}
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">{procedure.name}</h1>
      <p className="mt-2 text-sm text-charcoal-900/70">{procedure.tagline}</p>

      {procedure.hasAccess ? (
        <Card bordered className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium text-ink-900">Checklist des documents</h2>
            <Badge variant="success">Débloquée</Badge>
          </div>
          <div className="mt-4">
            {checklistItems.length > 0 ? (
              <Accordion items={checklistItems} type="multiple" />
            ) : (
              <p className="text-sm text-charcoal-900/60">Aucun document listé.</p>
            )}
          </div>
        </Card>
      ) : (
        <Card bordered className="mt-8">
          <p className="text-sm text-charcoal-900/75">
            Débloque la checklist complète des documents requis pour cette procédure, avec la marche
            à suivre détaillée.
          </p>
          {inAppWarning && (
            <p className="mt-4 rounded-lg bg-seal-gold/10 px-3 py-2 text-xs text-ink-900">
              Pour un paiement mobile money sans problème, ouvre ce lien dans Chrome ou Safari
              plutôt que dans cette application.
            </p>
          )}
          <Button variant="primary" className="mt-5 w-full" loading={buying} onClick={handleBuy}>
            Débloquer pour {formatPrice(procedure.priceFcfa)} FCFA
          </Button>
        </Card>
      )}
    </main>
  );
}
