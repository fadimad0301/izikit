// /admin/procedures/new — create form, POSTs and redirects to the new
// procedure's detail page on success.
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { ProcedureForm, type ProcedureFormValues } from '@/components/admin/ProcedureForm';

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function NewProcedurePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(values: ProcedureFormValues) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ procedure: { id: string } }>('/api/admin/procedures', {
        method: 'POST',
        body: values,
      });
      router.push(`/admin/procedures/${res.procedure.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de créer la procédure.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-2xl text-ink-900">Nouvelle procédure</h1>
      <ProcedureForm
        submitLabel="Créer"
        submitting={submitting}
        error={error}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
