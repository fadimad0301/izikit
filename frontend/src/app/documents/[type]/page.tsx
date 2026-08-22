// /documents/[type] — one flat questionnaire → AI generation → printable
// preview, for documents beyond the CV (lettre de motivation, lettre de
// recommandation…). Unlike /cv (multi-step wizard), each document type here
// is a single form — the questions themselves already adapt per type (see
// CoverLetterForm / RecommendationLetterForm), there's no multi-step
// progression to manage.
//
// Answers auto-save via PATCH /api/documents/[type] on submit, then the same
// submit triggers POST /api/documents/[type]/generate and swaps into the
// preview view — same pattern as /cv/page.tsx.
'use client';

import { use, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useUser } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { CoverLetterForm, RecommendationLetterForm, DocumentPreview } from '@/components/documents';
import {
  documentTypeFromSlug,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPE_SLUGS,
  type DocumentType,
  type CoverLetterAnswers,
  type RecommendationLetterAnswers,
  type GeneratedDocumentContent,
} from '@/lib/validation/document-types';

interface DocumentDraft {
  answers: Record<string, unknown>;
  content: GeneratedDocumentContent | null;
  generatedAt: string | null;
  updatedAt: string | null;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

export default function DocumentPage({ params }: { params: Promise<{ type: string }> }) {
  const { type: slug } = use(params);
  const type = documentTypeFromSlug(slug);
  if (!type) notFound();

  return <DocumentPageContent type={type} />;
}

function DocumentPageContent({ type }: { type: DocumentType }) {
  const user = useUser();
  const { toast } = useToast();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [content, setContent] = useState<GeneratedDocumentContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [view, setView] = useState<'form' | 'preview'>('form');

  useEffect(() => {
    if (!user) return;
    api<DocumentDraft>(`/api/documents/${DOCUMENT_TYPE_SLUGS[type]}`)
      .then((res) => {
        setAnswers(res.answers);
        setContent(res.content);
        if (res.content) setView('preview');
      })
      .catch(() => {
        // First visit — no draft yet, form starts empty.
      })
      .finally(() => setLoading(false));
    // Only re-run if the document type itself changes (route navigation).
  }, [user, type]);

  async function handleGenerate(formAnswers: Record<string, unknown>) {
    setGenerating(true);
    try {
      await api(`/api/documents/${DOCUMENT_TYPE_SLUGS[type]}`, {
        method: 'PATCH',
        body: { answers: formAnswers },
      });
      setAnswers(formAnswers);
      const res = await api<{ content: GeneratedDocumentContent; generatedAt: string }>(
        `/api/documents/${DOCUMENT_TYPE_SLUGS[type]}/generate`,
        { method: 'POST' },
      );
      setContent(res.content);
      setView('preview');
      toast('Ton document a été généré.', 'success');
    } catch (err) {
      toast(apiErrorMessage(err, 'La génération a échoué.'), 'error');
    } finally {
      setGenerating(false);
    }
  }

  if (!user || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper-50">
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      </main>
    );
  }

  if (view === 'preview' && content) {
    return (
      <DocumentPreview
        content={content}
        onEdit={() => setView('form')}
        onRegenerate={() => handleGenerate(answers)}
        regenerating={generating}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-16">
      <div>
        <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">Documents</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">{DOCUMENT_TYPE_LABELS[type]}</h1>
        <p className="mt-4 text-sm font-medium text-ink-900/70">
          Réponds à ces questions, l’IA rédige le document à partir de tes réponses.
        </p>
      </div>

      {type === 'COVER_LETTER' && (
        <CoverLetterForm
          defaultValues={answers as Partial<CoverLetterAnswers>}
          onSubmit={handleGenerate}
          submitLabel={generating ? 'Génération…' : 'Générer ma lettre'}
        />
      )}
      {type === 'RECOMMENDATION_LETTER' && (
        <RecommendationLetterForm
          defaultValues={answers as Partial<RecommendationLetterAnswers>}
          onSubmit={handleGenerate}
          submitLabel={generating ? 'Génération…' : 'Générer la lettre'}
        />
      )}
    </main>
  );
}
