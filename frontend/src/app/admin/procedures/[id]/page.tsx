// /admin/procedures/[id] — edit form, pre-filled from GET, PATCHes on submit.
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { ProcedureForm, type ProcedureFormValues } from '@/components/admin/ProcedureForm';

interface AdminProcedureDetail {
  id: string;
  name: string;
  country: string;
  field: string | null;
  tagline: string;
  checklist: Array<{ id: string; title: string; description?: string }>;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function EditProcedurePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [procedure, setProcedure] = useState<AdminProcedureDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ procedure: AdminProcedureDetail }>(`/api/admin/procedures/${params.id}`)
      .then((res) => {
        if (!cancelled) setProcedure(res.procedure);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(apiErrorMessage(err, 'Impossible de charger la procédure.'));
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (loadError) {
    return <p className="text-sm text-error-600">{loadError}</p>;
  }
  if (!procedure) {
    return <p className="text-sm text-charcoal-900/60">Chargement…</p>;
  }

  const initialValues: ProcedureFormValues = {
    name: procedure.name,
    country: procedure.country,
    field: procedure.field ?? '',
    tagline: procedure.tagline,
    checklist: procedure.checklist,
  };

  async function handleSubmit(values: ProcedureFormValues) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Only PATCH the fields that actually changed — sending the full form
      // every time makes logAdminAction's `{ fields: Object.keys(data) }`
      // metadata meaningless (every edit would "touch" all 5 fields).
      const body: Partial<ProcedureFormValues> = {};
      if (values.name !== initialValues.name) body.name = values.name;
      if (values.country !== initialValues.country) body.country = values.country;
      if (values.field !== initialValues.field) body.field = values.field;
      if (values.tagline !== initialValues.tagline) body.tagline = values.tagline;
      if (JSON.stringify(values.checklist) !== JSON.stringify(initialValues.checklist)) {
        body.checklist = values.checklist;
      }
      // Nothing changed — skip the round trip entirely rather than send an
      // empty PATCH body, which the API correctly rejects with 400 "Aucun
      // champ à mettre à jour." A no-op save should still feel like success.
      if (Object.keys(body).length > 0) {
        await api(`/api/admin/procedures/${params.id}`, { method: 'PATCH', body });
      }
      router.push('/admin/procedures');
    } catch (err) {
      setSubmitError(apiErrorMessage(err, 'Impossible de mettre à jour la procédure.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl text-ink-900">Modifier : {procedure.name}</h1>
      <ProcedureForm
        initialValues={initialValues}
        submitLabel="Enregistrer"
        submitting={submitting}
        error={submitError}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
