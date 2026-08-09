'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button, Badge } from '@/components/ui';
import { useReducedMotion, DOXI_EASE } from '@/lib/motion';

// Real, derivable facts (not marketing metrics) — kept in sync with the
// sections they summarize: HowItWorks' 3 steps, TrustBar's 5 programs,
// and Pricing's free entry tier. See STEPS.length / PROGRAMS.length in
// those files if these numbers ever drift.
const STATS = [
  {
    label: 'Étapes guidées',
    value: '3',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"
      />
    ),
  },
  {
    label: 'Programmes couverts',
    value: '5',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M3 21V5a2 2 0 012-2h6l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H9l-4 4z"
      />
    ),
  },
  {
    label: 'CV bilingue inclus',
    value: '1',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M12 12a4 4 0 100-8 4 4 0 000 8z M4.5 20c0-4.14 3.36-6.5 7.5-6.5s7.5 2.36 7.5 6.5"
      />
    ),
  },
  {
    label: 'Pour démarrer',
    value: 'Gratuit',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M20 12v7a1 1 0 01-1 1H5a1 1 0 01-1-1v-7M2 7h20v5H2V7zM12 7v13M12 7c-1.5-3-6-3-6 0s4.5 3 6 0zM12 7c1.5-3 6-3 6 0s-4.5 3-6 0z"
      />
    ),
  },
] as const;

function HeroStats() {
  const reduceMotion = useReducedMotion();
  return (
    <motion.dl
      initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.5, delay: 0.3, ease: DOXI_EASE }}
      className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {STATS.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-ink-900/8 bg-white px-4 py-3 shadow-sm"
        >
          <svg
            className="h-5 w-5 text-seal-gold"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            {stat.icon}
          </svg>
          <dd className="mt-2 font-serif text-xl text-ink-900">{stat.value}</dd>
          <dt className="text-xs text-charcoal-900/60">{stat.label}</dt>
        </div>
      ))}
    </motion.dl>
  );
}

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
      <div className="absolute inset-0 -z-10 rounded-full bg-seal-gold/10 blur-3xl" />
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
        <motion.div
          initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.5, ease: DOXI_EASE }}
        >
          <Badge variant="gold">CV · Checklist · Candidature</Badge>
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.5, delay: 0.05, ease: DOXI_EASE }}
          className="mt-4 font-serif text-4xl leading-tight text-ink-900 md:text-5xl"
        >
          Ton dossier d’études à l’étranger,{' '}
          <span className="bg-gradient-to-r from-ink-900 to-seal-gold bg-clip-text text-transparent">
            sans stress
          </span>
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
        <HeroStats />
      </div>
      <HeroIllustration />
    </div>
  );
}
