// /admin/procedures — catalog list with an inline archive/unarchive toggle
// (reversible, no confirmation dialog needed) and a link to create a new one.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Card, Badge, Button, Toggle } from '@/components/ui';

interface AdminProcedure {
  id: string;
  slug: string;
  name: string;
  country: string;
  field: string | null;
  tagline: string;
  isArchived: boolean;
  createdAt: string;
}

interface ListResponse {
  items: AdminProcedure[];
  nextCursor: string | null;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function AdminProceduresPage() {
  const [procedures, setProcedures] = useState<AdminProcedure[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function load(reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (!reset && cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      const res = await api<ListResponse>(`/api/admin/procedures?${params.toString()}`);
      setProcedures((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les procédures.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
  }, []);

  async function toggleArchive(procedure: AdminProcedure) {
    setTogglingId(procedure.id);
    setError(null);
    try {
      await api(`/api/admin/procedures/${procedure.id}`, {
        method: 'PATCH',
        body: { isArchived: !procedure.isArchived },
      });
      setProcedures((prev) =>
        prev.map((p) => (p.id === procedure.id ? { ...p, isArchived: !p.isArchived } : p)),
      );
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de modifier le statut.'));
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-2xl text-ink-900">Procédures</h1>
        <Link href="/admin/procedures/new">
          <Button>Nouvelle procédure</Button>
        </Link>
      </header>

      {error && <p className="text-sm text-error-600">{error}</p>}

      {loading && procedures.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      )}

      <div className="flex flex-col gap-2">
        {procedures.map((p) => (
          <Card key={p.id} bordered className="flex items-center justify-between gap-3 p-4">
            <Link href={`/admin/procedures/${p.id}`} className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink-900">{p.name}</span>
                {p.isArchived && <Badge variant="error">Archivée</Badge>}
              </div>
              <p className="mt-1 text-sm text-charcoal-900/60">
                {p.country}
                {p.field ? ` · ${p.field}` : ''}
              </p>
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-xs text-charcoal-900/60">
                {p.isArchived ? 'Archivée' : 'Publiée'}
              </span>
              <Toggle
                checked={!p.isArchived}
                onChange={() => void toggleArchive(p)}
                disabled={togglingId === p.id}
                label={p.isArchived ? 'Désarchiver' : 'Archiver'}
              />
            </div>
          </Card>
        ))}
      </div>

      {!loading && procedures.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Aucune procédure pour le moment.</p>
      )}

      {hasMore && (
        <Button variant="secondary" onClick={() => void load(false)} disabled={loading}>
          {loading ? 'Chargement…' : 'Charger plus'}
        </Button>
      )}
    </div>
  );
}
