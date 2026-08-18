// /admin/users/[id] — user detail: identity/role/status, "Procédures
// achetées" (Phase 7), "Documents" with an on-demand "Voir" button that
// mints a fresh 300s signed URL per click (never prefetched, never cached).
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Card, Badge, Button } from '@/components/ui';

interface AdminUserDetail {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN' | 'SUPERADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  emailVerifiedAt: string | null;
  createdAt: string;
  procedureAccess: Array<{
    tier: 'SIMPLE' | 'COMPLET';
    grantedAt: string;
    procedure: { id: string; slug: string; name: string };
  }>;
  procedureDocuments: Array<{
    id: string;
    procedureId: string;
    checklistItemId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
  }>;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ user: AdminUserDetail }>(`/api/admin/users/${params.id}`)
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, "Impossible de charger l'utilisateur."));
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  async function viewDocument(documentId: string) {
    setDocError(null);
    setViewingDocId(documentId);
    // Open the tab synchronously on the click, before the `await` — by the
    // time the fetch resolves the browser may have lost the "this came from
    // a direct user gesture" signal and silently block a popup opened here,
    // with no visible error. We instead point the pre-opened tab's location
    // once the signed URL arrives.
    const win = window.open('', '_blank', 'noopener,noreferrer');
    try {
      const res = await api<{ url: string }>(`/api/admin/documents/${documentId}/url`);
      if (win) {
        win.location.href = res.url;
      } else {
        setDocError(
          "Le navigateur a bloqué l'ouverture du document. Autorise les popups pour ce site.",
        );
      }
    } catch (err) {
      if (win) win.close();
      setDocError(apiErrorMessage(err, "Impossible d'ouvrir le document."));
    } finally {
      setViewingDocId(null);
    }
  }

  if (error) {
    return <p className="text-sm text-error-600">{error}</p>;
  }

  if (!user) {
    return <p className="text-sm text-charcoal-900/60">Chargement…</p>;
  }

  const procedureNames = new Map(
    user.procedureAccess.map((pa) => [pa.procedure.id, pa.procedure.name]),
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-2xl text-ink-900">{user.email}</h1>
        <div className="mt-2 flex items-center gap-2">
          <Badge variant={user.role === 'USER' ? 'neutral' : 'gold'}>{user.role}</Badge>
          {user.status === 'SUSPENDED' && <Badge variant="error">Suspendu</Badge>}
        </div>
        <p className="mt-1 text-sm text-charcoal-900/60">
          {user.name ?? 'Sans nom'} · inscrit le{' '}
          {new Date(user.createdAt).toLocaleDateString('fr-FR')}
        </p>
      </header>

      <Card bordered>
        <h2 className="text-lg font-semibold text-ink-900">Procédures achetées</h2>
        {user.procedureAccess.length === 0 ? (
          <p className="mt-3 text-sm text-charcoal-900/60">Aucun achat.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {user.procedureAccess.map((pa) => (
              <div
                key={pa.procedure.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-ink-900/10 p-4"
              >
                <div>
                  <span className="font-medium text-ink-900">{pa.procedure.name}</span>
                  <p className="mt-1 text-sm text-charcoal-900/60">
                    Acheté le {new Date(pa.grantedAt).toLocaleDateString('fr-FR')}
                  </p>
                </div>
                <Badge variant={pa.tier === 'COMPLET' ? 'gold' : 'neutral'}>
                  {pa.tier === 'COMPLET' ? 'Complet' : 'Simple'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card bordered>
        <h2 className="text-lg font-semibold text-ink-900">Documents</h2>
        {docError && <p className="mt-3 text-sm text-error-600">{docError}</p>}
        {user.procedureDocuments.length === 0 ? (
          <p className="mt-3 text-sm text-charcoal-900/60">Aucun document déposé.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {user.procedureDocuments.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-ink-900/10 p-4"
              >
                <div>
                  <span className="font-medium text-ink-900">{doc.filename}</span>
                  <p className="mt-1 text-sm text-charcoal-900/60">
                    {procedureNames.get(doc.procedureId) ?? doc.procedureId} · {doc.checklistItemId}
                  </p>
                  <p className="mt-1 text-sm text-charcoal-900/60">
                    {new Date(doc.uploadedAt).toLocaleDateString('fr-FR')} ·{' '}
                    {Math.round(doc.sizeBytes / 1024)} Ko
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={viewingDocId === doc.id}
                  onClick={() => void viewDocument(doc.id)}
                >
                  Voir
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
