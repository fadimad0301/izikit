'use client';

import { Button } from '@/components/ui';
import type { GeneratedCv } from '@/lib/validation/cv-wizard';

interface CvPreviewProps {
  generatedCv: GeneratedCv;
  onEdit: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}

export function CvPreview({ generatedCv, onEdit, onRegenerate, regenerating }: CvPreviewProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-16">
      <div data-print-hide className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">CV Builder</p>
          <h1 className="mt-2 font-serif text-3xl text-ink-900">Ton CV est prêt</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onEdit}>
            Modifier mes réponses
          </Button>
          <Button variant="secondary" loading={regenerating} onClick={onRegenerate}>
            Régénérer
          </Button>
          <Button onClick={() => window.print()}>Télécharger en PDF</Button>
        </div>
      </div>

      <article
        id="cv-print-area"
        className="rounded-2xl border border-ink-900/10 bg-white p-10 shadow-sm"
      >
        <p className="text-base leading-relaxed text-charcoal-900">{generatedCv.summary}</p>
        <div className="mt-8 flex flex-col gap-6">
          {generatedCv.sections.map((section) => (
            <section key={section.title}>
              <h2 className="font-serif text-lg text-ink-900">{section.title}</h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {section.bullets.map((bullet, i) => (
                  <li key={i} className="flex gap-2 text-sm text-charcoal-900/85">
                    <span aria-hidden="true" className="text-seal-gold">
                      •
                    </span>
                    {bullet}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
