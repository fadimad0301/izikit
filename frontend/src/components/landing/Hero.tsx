'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui';
import { useReducedMotion, DOXI_EASE } from '@/lib/motion';

// No hero video asset yet — per the design brief, the fallback when no
// footage exists is a lightweight animated scene instead of a static image.
// Three "document" cards settle into a stack, then a seal drops onto them —
// a visual echo of what Doxi actually does, without needing real footage.
function HeroIllustration() {
  const reduceMotion = useReducedMotion();
  const cardTransition = (delay: number) =>
    reduceMotion ? { duration: 0 } : { duration: 0.6, delay, ease: DOXI_EASE };

  return (
    <div className="relative mx-auto aspect-square w-full max-w-sm" aria-hidden="true">
      <motion.div
        className="absolute inset-x-8 top-10 h-48 rounded-2xl bg-paper-100 shadow-md"
        initial={{ opacity: 0, y: reduceMotion ? 0 : 40, rotate: reduceMotion ? 0 : -6 }}
        animate={{ opacity: 1, y: 0, rotate: -6 }}
        transition={cardTransition(0)}
      />
      <motion.div
        className="absolute inset-x-6 top-14 h-48 rounded-2xl bg-white shadow-md"
        initial={{ opacity: 0, y: reduceMotion ? 0 : 40, rotate: reduceMotion ? 0 : 4 }}
        animate={{ opacity: 1, y: 0, rotate: 4 }}
        transition={cardTransition(0.15)}
      />
      <motion.div
        className="absolute inset-x-10 top-16 flex h-44 flex-col gap-2.5 rounded-2xl bg-white p-5 shadow-lg"
        initial={{ opacity: 0, y: reduceMotion ? 0 : 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={cardTransition(0.3)}
      >
        <div className="h-2.5 w-2/3 rounded-full bg-ink-900/15" />
        <div className="h-2 w-full rounded-full bg-ink-900/8" />
        <div className="h-2 w-full rounded-full bg-ink-900/8" />
        <div className="h-2 w-3/4 rounded-full bg-ink-900/8" />
      </motion.div>
      <motion.div
        className="absolute right-4 bottom-6 flex h-16 w-16 items-center justify-center rounded-full border-4 border-seal-gold font-serif text-xs font-semibold text-seal-gold"
        initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.6, rotate: reduceMotion ? -18 : -28 }}
        animate={{ opacity: 1, scale: 1, rotate: -18 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 260, damping: 14, delay: 0.6 }
        }
      >
        VALIDÉ
      </motion.div>
    </div>
  );
}

export function Hero() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="grid items-center gap-12 md:grid-cols-2">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.5, ease: DOXI_EASE }}
          className="font-serif text-4xl leading-tight text-ink-900 md:text-5xl"
        >
          Ton dossier d’études à l’étranger, sans stress
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.5, delay: 0.1, ease: DOXI_EASE }}
          className="mt-5 max-w-md text-lg text-charcoal-900/75"
        >
          Doxi t’aide à préparer ton CV, ta checklist de documents et ton dossier de candidature —
          bourses, admissions, visas — étape par étape.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.5, delay: 0.2, ease: DOXI_EASE }}
          className="mt-8 flex flex-wrap gap-3"
        >
          <Link href="/signup">
            <Button size="lg">Créer mon CV gratuitement</Button>
          </Link>
          <a href="#tarifs">
            <Button variant="secondary" size="lg">
              Voir les tarifs
            </Button>
          </a>
        </motion.div>
        <p className="mt-4 text-xs text-charcoal-900/50">
          Conforme aux exigences officielles des programmes de bourses et d’admission.
        </p>
      </div>
      <HeroIllustration />
    </div>
  );
}
