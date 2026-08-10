'use client';

import { motion } from 'framer-motion';
import { Button, Stamp } from '@/components/ui';
import { useReducedMotion, DOXI_EASE } from '@/lib/motion';
import type { GeneratedCv } from '@/lib/validation/cv-wizard';

interface CvPreviewProps {
  generatedCv: GeneratedCv;
  onEdit: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}

// The reveal is staged in three beats: header, then the document card
// scaling into place, then each section stacking in top-to-bottom — closing
// on the stamp motif as a "this is confirmed" beat. This is the product's
// actual payoff moment (first sight of the generated CV), so it's one of
// the two orchestrated moments called out in the design brief — the other
// being the Hero's ink-stamp, which this one closes with too.
export function CvPreview({ generatedCv, onEdit, onRegenerate, regenerating }: CvPreviewProps) {
  const reduceMotion = useReducedMotion();
  const sectionsDelay = 0.25;
  const stampDelay = sectionsDelay + generatedCv.sections.length * 0.09 + 0.15;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-16">
      <motion.div
        data-print-hide
        initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.4, ease: DOXI_EASE }}
        className="flex flex-wrap items-center justify-between gap-3"
      >
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
      </motion.div>

      <motion.article
        id="cv-print-area"
        initial={{ opacity: 0, y: reduceMotion ? 0 : 16, scale: reduceMotion ? 1 : 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.45, delay: 0.1, ease: DOXI_EASE }}
        className="relative rounded-2xl border border-ink-900/10 bg-white p-10 shadow-doxi-2"
      >
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.4, delay: 0.2, ease: DOXI_EASE }}
          className="text-base leading-relaxed text-charcoal-900"
        >
          {generatedCv.summary}
        </motion.p>
        <div className="mt-8 flex flex-col gap-6">
          {generatedCv.sections.map((section, i) => (
            <motion.section
              key={section.title}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reduceMotion ? 0 : 0.4,
                delay: sectionsDelay + i * 0.09,
                ease: DOXI_EASE,
              }}
            >
              <h2 className="font-serif text-lg text-ink-900">{section.title}</h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {section.bullets.map((bullet, j) => (
                  <li key={j} className="flex gap-2 text-sm text-charcoal-900/85">
                    <span aria-hidden="true" className="text-seal-gold">
                      •
                    </span>
                    {bullet}
                  </li>
                ))}
              </ul>
            </motion.section>
          ))}
        </div>
        <div data-print-hide className="mt-8 flex justify-center">
          <Stamp size={56} delay={stampDelay} />
        </div>
      </motion.article>
    </main>
  );
}
