// /admin/audit-log — paginated AdminAction list with an action/targetType
// filter bar. The route already existed (D-AUDIT-01) but had zero UI
// consumer before this phase.
'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Card, Badge, Input, Button } from '@/components/ui';

interface AdminActionRow {
  id: string;
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

interface ListResponse {
  items: AdminActionRow[];
  nextCursor: string | null;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function AdminAuditLogPage() {
  const [rows, setRows] = useState<AdminActionRow[]>([]);
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (action) params.set('action', action);
      if (targetType) params.set('targetType', targetType);
      if (!reset && cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      const res = await api<ListResponse>(`/api/admin/audit-log?${params.toString()}`);
      setRows((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (err) {
      setError(apiErrorMessage(err, "Impossible de charger le journal d'audit."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl text-ink-900">Journal d'audit</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(true);
          }}
          className="flex flex-wrap gap-2"
        >
          <Input
            placeholder="Action (ex. procedure.update)"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-56"
          />
          <Input
            placeholder="Type de cible (ex. Procedure)"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            className="w-48"
          />
          <Button type="submit" variant="secondary">
            Filtrer
          </Button>
        </form>
      </header>

      {error && <p className="text-sm text-error-600">{error}</p>}

      {loading && rows.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      )}

      {!loading && rows.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Aucune entrée.</p>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <Card key={row.id} bordered className="flex flex-col gap-1 p-4">
            <div className="flex items-center gap-2">
              <Badge variant="neutral">{row.action}</Badge>
              {row.targetType && (
                <span className="text-xs text-charcoal-900/60">
                  {row.targetType}
                  {row.targetId ? ` · ${row.targetId}` : ''}
                </span>
              )}
            </div>
            <p className="text-xs text-charcoal-900/50">
              {new Date(row.createdAt).toLocaleString('fr-FR')} · acteur {row.actorId}
            </p>
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
