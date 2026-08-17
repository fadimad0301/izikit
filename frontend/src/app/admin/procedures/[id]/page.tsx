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

  async function handleSubmit(values: ProcedureFormValues) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api(`/api/admin/procedures/${params.id}`, { method: 'PATCH', body: values });
      router.push('/admin/procedures');
    } catch (err) {
      setSubmitError(apiErrorMessage(err, 'Impossible de mettre à jour la procédure.'));
    } finally {
      setSubmitting(false);
    }
  }

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
