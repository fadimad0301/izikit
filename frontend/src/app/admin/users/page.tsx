// /admin/users — list with search-by-email/name and cursor "load more".
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { api, ApiError } from '@/lib/api';
import { Card, Badge, Input, Button } from '@/components/ui';
import { useReducedMotion, DOXI_EASE } from '@/lib/motion';

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN' | 'SUPERADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  emailVerifiedAt: string | null;
  createdAt: string;
}

interface ListResponse {
  items: AdminUser[];
  nextCursor: string | null;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

function roleBadgeVariant(role: AdminUser['role']): 'gold' | 'neutral' {
  return role === 'USER' ? 'neutral' : 'gold';
}

export default function AdminUsersPage() {
  const reduceMotion = useReducedMotion();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (!reset && cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      const res = await api<ListResponse>(`/api/admin/users?${params.toString()}`);
      setUsers((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les utilisateurs.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl text-ink-900">Utilisateurs</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(true);
          }}
          className="flex gap-2"
        >
          <Input
            type="search"
            placeholder="Email ou nom…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-64"
          />
          <Button type="submit" variant="secondary">
            Rechercher
          </Button>
        </form>
      </header>

      {error && <p className="text-sm text-error-600">{error}</p>}

      {loading && users.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      )}

      {!loading && users.length === 0 && !error && (
        <p className="text-sm text-charcoal-900/60">Aucun utilisateur ne correspond.</p>
      )}

      <div className="flex flex-col gap-2">
        {users.map((u, i) => (
          <motion.div
            key={u.id}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduceMotion ? 0 : 0.25,
              delay: reduceMotion ? 0 : Math.min(i, 10) * 0.02,
              ease: DOXI_EASE,
            }}
          >
            <Link href={`/admin/users/${u.id}`}>
              <Card bordered className="flex items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink-900">{u.email}</span>
                    <Badge variant={roleBadgeVariant(u.role)}>{u.role}</Badge>
                    {u.status === 'SUSPENDED' && <Badge variant="error">Suspendu</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-charcoal-900/60">
                    {u.name ?? 'Sans nom'} · inscrit le{' '}
                    {new Date(u.createdAt).toLocaleDateString('fr-FR')}
                  </p>
                </div>
              </Card>
            </Link>
          </motion.div>
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
