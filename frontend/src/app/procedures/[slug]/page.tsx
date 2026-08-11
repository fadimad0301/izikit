// /procedures/[slug] — détail d'une procédure : checklist si déjà achetée
// (avec upload de documents + analyse IA pour l'offre Complet), sinon
// boutons d'achat (Simple / Complet) via le flux Bictorys existant
// (POST /api/orders, inchangé — voir CLAUDE.md).
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { Card, Badge, Button, Accordion, type AccordionItemData } from '@/components/ui';
import {
  ChecklistItemUpload,
  type ChecklistItemUploadItem,
} from '@/components/procedures/ChecklistItemUpload';
import { formatPrice, isInAppBrowser } from '@/lib/utils';

type Tier = 'SIMPLE' | 'COMPLET' | null;

interface ChecklistItem extends ChecklistItemUploadItem {
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
  completPriceFcfa: number;
  upgradePriceFcfa: number;
  hasAccess: boolean;
  tier: Tier;
  // `| undefined` (not just `?`) — exactOptionalPropertyTypes rejects the
  // setProcedure updater below otherwise, since `prev.checklist?.map(...)`
  // produces `ChecklistItem[] | undefined` even when `prev.checklist` was
  // present (see notifications/prefs/route.ts for the same precedent).
  checklist?: ChecklistItem[] | undefined;
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
  const [buying, setBuying] = useState<'SIMPLE' | 'COMPLET' | null>(null);
  const [inAppWarning, setInAppWarning] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisPoints, setAnalysisPoints] = useState<string[] | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [needsCv, setNeedsCv] = useState(false);

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

  async function handleBuy(tier: 'SIMPLE' | 'COMPLET') {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!procedure) return;

    const amount =
      tier === 'SIMPLE'
        ? procedure.priceFcfa
        : procedure.tier === 'SIMPLE'
          ? procedure.upgradePriceFcfa
          : procedure.completPriceFcfa;

    setBuying(tier);
    try {
      const res = await api<{ id: string; paymentUrl: string; status: string }>('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          amount,
          currency: 'XOF',
          metadata: {
            tier,
            procedureId: procedure.id,
            procedureSlug: procedure.slug,
          },
        },
      });
      window.location.href = res.paymentUrl;
    } catch (err) {
      toast(apiErrorMessage(err, 'Le paiement n’a pas pu être initié.'), 'error');
      setBuying(null);
    }
  }

  function handleDocumentUploaded(itemId: string, filename: string) {
    setProcedure((prev) =>
      prev
        ? {
            ...prev,
            checklist: prev.checklist?.map((item) =>
              item.id === itemId ? { ...item, uploaded: true, filename } : item,
            ),
          }
        : prev,
    );
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalysisError(null);
    setNeedsCv(false);
    try {
      const res = await api<{ points: string[] }>(`/api/procedures/${slug}/analyze`, {
        method: 'POST',
      });
      setAnalysisPoints(res.points);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CV_NOT_GENERATED') {
        setNeedsCv(true);
        setAnalysisError('Génère d’abord ton CV pour recevoir une analyse.');
      } else {
        setAnalysisError(apiErrorMessage(err, 'L’analyse a échoué, réessaie dans un instant.'));
      }
    } finally {
      setAnalyzing(false);
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

  const checklistItems: AccordionItemData[] = (procedure.checklist ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    content:
      procedure.tier === 'COMPLET' ? (
        <ChecklistItemUpload slug={slug} item={item} onUploaded={handleDocumentUploaded} />
      ) : (
        (item.description ?? '')
      ),
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
        <>
          {procedure.tier === 'COMPLET' && (
            <Card bordered className="mt-8">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-medium text-ink-900">Analyse IA de ton CV</h2>
                <Button variant="secondary" size="sm" loading={analyzing} onClick={handleAnalyze}>
                  Analyser mon CV
                </Button>
              </div>
              {analysisError && (
                <div className="mt-3">
                  <p className="text-sm text-error-600">{analysisError}</p>
                  {needsCv && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => router.push('/cv')}
                    >
                      Aller à mon CV
                    </Button>
                  )}
                </div>
              )}
              {analysisPoints && (
                <ul className="mt-3 flex flex-col gap-2 text-sm text-charcoal-900/80">
                  {analysisPoints.map((point, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 text-seal-gold" aria-hidden="true">
                        •
                      </span>
                      {point}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card bordered className="mt-8">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium text-ink-900">Checklist des documents</h2>
              <Badge variant="success">
                {procedure.tier === 'COMPLET' ? 'Complet' : 'Débloquée'}
              </Badge>
            </div>
            <div className="mt-4">
              {checklistItems.length > 0 ? (
                <Accordion items={checklistItems} type="multiple" />
              ) : (
                <p className="text-sm text-charcoal-900/60">Aucun document listé.</p>
              )}
            </div>
          </Card>

          {procedure.tier === 'SIMPLE' && (
            <Card bordered className="mt-6 border-seal-gold">
              <p className="text-sm text-charcoal-900/75">
                Passe à l’offre Complet pour suivre l’upload de tes documents et recevoir une
                analyse IA de ton CV pour cette procédure.
              </p>
              <Button
                variant="primary"
                className="mt-4 w-full"
                loading={buying === 'COMPLET'}
                onClick={() => handleBuy('COMPLET')}
              >
                Passer à Complet (+{formatPrice(procedure.upgradePriceFcfa)} FCFA)
              </Button>
            </Card>
          )}
        </>
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
          <div className="mt-5 flex flex-col gap-2">
            <Button
              variant="secondary"
              loading={buying === 'SIMPLE'}
              onClick={() => handleBuy('SIMPLE')}
            >
              Débloquer Simple pour {formatPrice(procedure.priceFcfa)} FCFA
            </Button>
            <Button
              variant="primary"
              loading={buying === 'COMPLET'}
              onClick={() => handleBuy('COMPLET')}
            >
              Débloquer Complet pour {formatPrice(procedure.completPriceFcfa)} FCFA
            </Button>
          </div>
        </Card>
      )}
    </main>
  );
}
