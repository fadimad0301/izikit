// /admin/orders — list-only (no detail page this phase). Resolves
// metadata.procedureId into a readable procedure name via a one-shot
// GET /api/admin/procedures?limit=50 fetch on mount (the catalog is a
// handful of rows — a client-side Map lookup beats a server join).
'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Card, Badge, Button } from '@/components/ui';

interface AdminOrder {
  id: string;
  userId: string | null;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' | 'REFUNDED';
  customerEmail: string | null;
  metadata: { tier?: string; procedureId?: string; procedureSlug?: string } | null;
  createdAt: string;
}

interface ListResponse {
  items: AdminOrder[];
  nextCursor: string | null;
}

interface AdminProcedure {
  id: string;
  name: string;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

const STATUS_VARIANT: Record<AdminOrder['status'], 'gold' | 'success' | 'error' | 'neutral'> = {
  PENDING: 'neutral',
  PAID: 'success',
  EXPIRED: 'error',
  FAILED: 'error',
  REFUNDED: 'error',
};

function formatAmount(amount: number, currency: string): string {
  return `${amount.toLocaleString('fr-FR')} ${currency}`;
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [procedureNames, setProcedureNames] = useState<Map<string, string>>(new Map());
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: AdminProcedure[] }>('/api/admin/procedures?limit=50')
      .then((res) => {
        setProcedureNames(new Map(res.items.map((p) => [p.id, p.name])));
      })
      .catch(() => {
        // Non-fatal — orders still render, just without a resolved name.
      });
  }, []);

  async function load(reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (!reset && cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      const res = await api<ListResponse>(`/api/admin/orders?${params.toString()}`);
      setOrders((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les commandes.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
  }, []);

  function procedureLabel(order: AdminOrder): string {
    const procedureId = order.metadata?.procedureId;
    const tier = order.metadata?.tier;
    if (!procedureId) return '—';
    const name = procedureNames.get(procedureId) ?? order.metadata?.procedureSlug ?? procedureId;
    return tier ? `${name} (${tier === 'COMPLET' ? 'Complet' : 'Simple'})` : name;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl text-ink-900">Commandes</h1>

      {error && <p className="text-sm text-error-600">{error}</p>}

      {loading && orders.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      )}

      {!loading && orders.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Aucune commande.</p>
      )}

      <div className="flex flex-col gap-2">
        {orders.map((o) => (
          <Card key={o.id} bordered className="flex items-center justify-between gap-3 p-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink-900">{procedureLabel(o)}</span>
                <Badge variant={STATUS_VARIANT[o.status]}>{o.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-charcoal-900/60">
                {o.customerEmail ?? o.userId ?? 'Client anonyme'} ·{' '}
                {new Date(o.createdAt).toLocaleDateString('fr-FR')}
              </p>
            </div>
            <span className="font-medium text-ink-900">{formatAmount(o.amount, o.currency)}</span>
          </Card>
        ))}
      </div>

      {hasMore && (
        <Button variant="secondary" onClick={() => void load(false)} disabled={loading}>
          {loading ? 'Chargement…' : 'Charger plus'}
        </Button>
      )}
    </div>
  );
}
