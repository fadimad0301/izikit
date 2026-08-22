'use client';

import { motion } from 'framer-motion';
import { Button, Stamp } from '@/components/ui';
import { useReducedMotion, DOXI_EASE } from '@/lib/motion';
import type { GeneratedDocumentContent } from '@/lib/validation/document-types';

interface DocumentPreviewProps {
  content: GeneratedDocumentContent;
  onEdit: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}

// Mirrors CvPreview.tsx's structure and reveal choreography (header, then
// the document card, then each paragraph stacking in) so the two "here's
// your generated document" moments feel like the same product.
export function DocumentPreview({
  content,
  onEdit,
  onRegenerate,
  regenerating,
}: DocumentPreviewProps) {
  const reduceMotion = useReducedMotion();
  const paragraphsDelay = 0.25;
  const stampDelay = paragraphsDelay + content.paragraphs.length * 0.09 + 0.15;

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
          <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">Documents</p>
          <h1 className="mt-2 font-serif text-3xl text-ink-900">Ton document est prêt</h1>
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
        initial={{ opacity: 0, y: reduceMotion ? 0 : 16, scale: reduceMotion ? 1 : 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.45, delay: 0.1, ease: DOXI_EASE }}
        className="print-area relative rounded-2xl border border-ink-900/10 bg-white p-10 shadow-doxi-2"
      >
        <motion.h2
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.4, delay: 0.2, ease: DOXI_EASE }}
          className="font-serif text-xl text-ink-900"
        >
          {content.title}
        </motion.h2>
        <div className="mt-6 flex flex-col gap-4">
          {content.paragraphs.map((paragraph, i) => (
            <motion.p
              key={i}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reduceMotion ? 0 : 0.4,
                delay: paragraphsDelay + i * 0.09,
                ease: DOXI_EASE,
              }}
              className="text-sm leading-relaxed text-charcoal-900/85"
            >
              {paragraph}
            </motion.p>
          ))}
        </div>
        <div data-print-hide className="mt-8 flex justify-center">
          <Stamp size={56} delay={stampDelay} />
        </div>
      </motion.article>
    </main>
  );
}
