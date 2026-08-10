// /orders/[id]/success — landing after a Bictorys checkout redirect for a
// successful charge. The webhook may not have processed the payment yet by
// the time the browser lands here, so this page polls GET /api/orders/[id]
// briefly until status leaves PENDING.
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Card, Button } from '@/components/ui';

interface OrderStatus {
  status: string;
  amount: number;
  currency: string;
  metadata: { procedureSlug?: string } | null;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 10;

export default function OrderSuccessPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const orderId = params.id;

  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    api<OrderStatus>(`/api/orders/${orderId}`)
      .then((data) => {
        if (cancelled) return;
        setOrder(data);
        if (data.status === 'PENDING' && pollCount < MAX_POLLS) {
          setTimeout(() => {
            if (!cancelled) setPollCount((c) => c + 1);
          }, POLL_INTERVAL_MS);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'Impossible de vérifier ce paiement.'));
      });

    return () => {
      cancelled = true;
    };
  }, [orderId, pollCount]);

  const procedureSlug = order?.metadata?.procedureSlug;

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <Card bordered className="w-full">
        {error && <p className="text-sm text-error-600">{error}</p>}

        {!error && !order && (
          <p className="text-sm text-charcoal-900/60">Vérification du paiement…</p>
        )}

        {!error && order?.status === 'PENDING' && pollCount < MAX_POLLS && (
          <>
            <h1 className="font-serif text-2xl text-ink-900">Confirmation en cours</h1>
            <p className="mt-2 text-sm text-charcoal-900/70">
              Ton paiement est en cours de traitement. Cette page se mettra à jour automatiquement.
            </p>
          </>
        )}

        {!error && order?.status === 'PENDING' && pollCount >= MAX_POLLS && (
          <>
            <h1 className="font-serif text-2xl text-ink-900">Confirmation en attente</h1>
            <p className="mt-2 text-sm text-charcoal-900/70">
              La confirmation prend plus de temps que prévu. Rafraîchis cette page dans quelques
              instants pour réessayer.
            </p>
          </>
        )}

        {!error && order?.status === 'PAID' && (
          <>
            <h1 className="font-serif text-2xl text-ink-900">Paiement confirmé</h1>
            <p className="mt-2 text-sm text-charcoal-900/70">Merci — ta checklist est prête.</p>
            {procedureSlug && (
              <Button
                variant="primary"
                className="mt-6 w-full"
                onClick={() => router.push(`/procedures/${procedureSlug}`)}
              >
                Voir la checklist
              </Button>
            )}
          </>
        )}

        {!error && order && order.status !== 'PENDING' && order.status !== 'PAID' && (
          <>
            <h1 className="font-serif text-2xl text-ink-900">Paiement non confirmé</h1>
            <p className="mt-2 text-sm text-charcoal-900/70">
              Ce paiement n’a pas abouti. Réessaie depuis la page de la procédure.
            </p>
            {procedureSlug && (
              <Button
                variant="secondary"
                className="mt-6 w-full"
                onClick={() => router.push(`/procedures/${procedureSlug}`)}
              >
                Retour à la procédure
              </Button>
            )}
          </>
        )}
      </Card>
    </main>
  );
}
