// /documents — chooser: pick which document to generate. Each card links to
// /documents/[type], where the questions adapt to the document picked.
'use client';

import Link from 'next/link';
import { useUser } from '@/contexts/AuthContext';
import { Card } from '@/components/ui';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPE_SLUGS,
} from '@/lib/validation/document-types';

const DOCUMENT_TYPE_DESCRIPTIONS: Record<(typeof DOCUMENT_TYPES)[number], string> = {
  COVER_LETTER:
    'Explique ta motivation pour un programme précis, rédigée à ta place à partir de tes réponses.',
  RECOMMENDATION_LETTER:
    'Une lettre au nom d’un professeur, employeur ou encadrant, à partir de ce qu’il/elle sait de toi.',
};

export default function DocumentsPage() {
  const user = useUser();
  if (!user) return null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-16">
      <div>
        <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">Documents</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">Génère un document</h1>
        <p className="mt-4 text-sm font-medium text-ink-900/70">
          Choisis le document dont tu as besoin pour ton dossier — les questions s’adaptent à chaque
          type.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {DOCUMENT_TYPES.map((type) => (
          <Link key={type} href={`/documents/${DOCUMENT_TYPE_SLUGS[type]}`}>
            <Card
              bordered
              className="flex flex-col gap-1.5 transition-colors hover:border-seal-gold/60"
            >
              <h2 className="font-serif text-lg text-ink-900">{DOCUMENT_TYPE_LABELS[type]}</h2>
              <p className="text-sm text-charcoal-900/70">{DOCUMENT_TYPE_DESCRIPTIONS[type]}</p>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
