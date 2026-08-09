'use client';

import { motion } from 'framer-motion';
import { Card } from '@/components/ui';
import { Section } from './Section';
import { useReducedMotion, DOXI_EASE } from '@/lib/motion';

const POINTS = [
  {
    title: 'Des lettres de motivation maladroites',
    body: 'Des formulations qui ne collent pas aux standards attendus par les comités d’admission — et une candidature écartée avant même d’être lue en détail.',
  },
  {
    title: 'Des bourses ratées faute de valorisation',
    body: 'Un excellent parcours, mais un dossier qui ne met pas en avant ce qui compte vraiment pour les jurys de bourses.',
  },
  {
    title: 'Des dossiers de visa incomplets',
    body: 'Un seul document manquant ou mal traduit peut annuler des mois d’efforts et de préparation.',
  },
];

export function PainPoints() {
  const reduceMotion = useReducedMotion();

  return (
    <Section bg="paper-100">
      <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">
        Les obstacles réels
      </p>
      <h2 className="mt-2 max-w-xl font-serif text-3xl text-ink-900">
        Pourquoi tant de dossiers d’étudiants sont rejetés
      </h2>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {POINTS.map((point, i) => (
          <motion.div
            key={point.title}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: reduceMotion ? 0 : 0.4, delay: i * 0.08, ease: DOXI_EASE }}
          >
            <Card bordered className="h-full">
              <h3 className="font-medium text-ink-900">{point.title}</h3>
              <p className="mt-2 text-sm text-charcoal-900/70">{point.body}</p>
            </Card>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}
