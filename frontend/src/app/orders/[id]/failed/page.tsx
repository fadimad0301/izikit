// /orders/[id]/failed — landing after a Bictorys checkout redirect for a
// failed or cancelled charge.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Card, Button } from '@/components/ui';

interface OrderStatus {
  metadata: { procedureSlug?: string } | null;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function OrderFailedPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const [procedureSlug, setProcedureSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<OrderStatus>(`/api/orders/${orderId}`)
      .then((data) => {
        if (!cancelled) setProcedureSlug(data.metadata?.procedureSlug ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, ''));
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <Card bordered className="w-full">
        <h1 className="font-serif text-2xl text-ink-900">Paiement échoué</h1>
        <p className="mt-2 text-sm text-charcoal-900/70">
          Le paiement n’a pas pu être finalisé. Aucune somme n’a été débitée si tu as annulé avant
          la fin.
        </p>
        {error && <p className="mt-2 text-xs text-error-600">{error}</p>}
        <Link
          href={procedureSlug ? `/procedures/${procedureSlug}` : '/procedures'}
          className="mt-6 block"
        >
          <Button variant="secondary" className="w-full">
            Réessayer
          </Button>
        </Link>
      </Card>
    </main>
  );
}
