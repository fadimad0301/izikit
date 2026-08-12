// Doxi Phase 5 — per-checklist-item file upload widget for the Complet
// tier. Uses a raw `fetch` for the upload call (not the shared `api()`
// wrapper, which always sends `Content-Type: application/json` and
// `JSON.stringify`s its body — incompatible with `multipart/form-data`).
// `api()` itself is a protected file (lib/api.ts) so this duplicates its
// minimal CSRF-token-read logic locally rather than modifying it.
'use client';

import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { Button, Badge } from '@/components/ui';
import { API_URL, COOKIE_PREFIX } from '@/lib/constants';

export interface ChecklistItemUploadItem {
  id: string;
  title: string;
  uploaded?: boolean;
  filename?: string;
}

interface ChecklistItemUploadProps {
  slug: string;
  item: ChecklistItemUploadItem;
  onUploaded: (itemId: string, filename: string) => void;
}

function getCsrfTokenForUpload(): string | null {
  if (typeof window === 'undefined') return null;
  const key = `${COOKIE_PREFIX}-csrf`;
  const fromStorage = localStorage.getItem(key);
  if (fromStorage) return fromStorage;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match && match[1] ? decodeURIComponent(match[1]) : null;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export function ChecklistItemUpload({ slug, item, onUploaded }: ChecklistItemUploadProps) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file to re-upload
    if (!file) return;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('checklistItemId', item.id);
      fd.append('file', file);

      const doUpload = (csrfToken: string | null) =>
        fetch(`${API_URL}/api/procedures/${slug}/documents`, {
          method: 'POST',
          credentials: 'include',
          headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
          body: fd,
        });

      let res = await doUpload(getCsrfTokenForUpload());

      // Access JWTs live 15 minutes (see CLAUDE.md's auth model). A student
      // assembling several uploads on this page can plausibly outlast that.
      // Unlike every other mutating call in this app, this raw fetch bypasses
      // api()'s built-in 401-refresh-and-retry, so replicate it here for this
      // one explicit, user-initiated, idempotent-upsert action — retried
      // exactly once, with a fresh CSRF token (a refresh may rotate it).
      if (res.status === 401) {
        const refreshRes = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (refreshRes.ok) {
          res = await doUpload(getCsrfTokenForUpload());
        }
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || 'Échec de l’envoi.');
      }
      const data = (await res.json()) as { filename: string };
      onUploaded(item.id, data.filename);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Échec de l’envoi.', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function handleView() {
    setViewing(true);
    try {
      const data = await api<{ url: string }>(`/api/procedures/${slug}/documents/${item.id}/url`);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast(apiErrorMessage(err, 'Impossible d’ouvrir ce document.'), 'error');
    } finally {
      setViewing(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        {item.uploaded ? (
          <Badge variant="success">{item.filename ?? 'Envoyé'}</Badge>
        ) : (
          <Badge variant="neutral">Manquant</Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.uploaded && (
          <Button variant="ghost" size="sm" loading={viewing} onClick={handleView}>
            Voir
          </Button>
        )}
        <label>
          <Button
            variant="secondary"
            size="sm"
            loading={uploading}
            onClick={(e) => {
              e.preventDefault();
              fileInputRef.current?.click();
            }}
          >
            {item.uploaded ? 'Remplacer' : 'Envoyer'}
          </Button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
        </label>
      </div>
    </div>
  );
}
