'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Card, Badge, Button } from '@/components/ui';
import { Section } from './Section';
import { formatPrice } from '@/lib/utils';
import { useReducedMotion, DOXI_EASE } from '@/lib/motion';

const TIERS = [
  {
    name: 'CV Builder',
    price: 'Gratuit',
    tagline: 'Pour construire un CV solide, adapté à ta cible.',
    features: ['CV bilingue normalisé', '1 modèle de document classique'],
    cta: 'Commencer gratuitement',
    href: '/signup',
    featured: false,
  },
  {
    name: 'Accompagnement Simple',
    price: `${formatPrice(5000)} FCFA`,
    priceNote: '/ candidature',
    tagline: 'Pour cibler une procédure prioritaire.',
    features: [
      'Checklist des documents requis',
      'Marche à suivre détaillée',
      'Accès immédiat après paiement',
    ],
    cta: 'Choisir l’offre Simple',
    href: '/signup',
    featured: false,
  },
  {
    name: 'Accompagnement Complet',
    price: `${formatPrice(20000)} FCFA`,
    priceNote: '/ candidature',
    tagline: 'Pour un dossier suivi de bout en bout.',
    features: [
      'Tout le Simple, en illimité',
      'Suivi et upload de documents',
      'Analyse IA des points à améliorer',
    ],
    cta: 'Choisir l’offre Complet',
    href: '/signup',
    featured: true,
  },
];

export function Pricing() {
  const reduceMotion = useReducedMotion();

  return (
    <Section id="tarifs" bg="paper-100">
      <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">
        Tarifs transparents
      </p>
      <h2 className="mt-2 max-w-xl font-serif text-3xl text-ink-900">
        Un accompagnement adapté à tes besoins
      </h2>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {TIERS.map((tier, i) => (
          <motion.div
            key={tier.name}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: reduceMotion ? 0 : 0.4, delay: i * 0.08, ease: DOXI_EASE }}
          >
            <Card
              bordered
              elevated={tier.featured}
              className={tier.featured ? 'relative h-full border-seal-gold' : 'relative h-full'}
            >
              {tier.featured && (
                <Badge variant="gold" className="absolute top-6 right-6">
                  Recommandé
                </Badge>
              )}
              <h3 className="font-medium text-ink-900">{tier.name}</h3>
              <p className="mt-1 text-sm text-charcoal-900/60">{tier.tagline}</p>
              <p className="mt-5">
                <span className="font-serif text-3xl text-ink-900">{tier.price}</span>
                {'priceNote' in tier && (
                  <span className="ml-1 text-sm text-charcoal-900/50">{tier.priceNote}</span>
                )}
              </p>
              <ul className="mt-5 flex flex-col gap-2 text-sm text-charcoal-900/75">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-success-600" aria-hidden="true">
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href={tier.href} className="mt-6 block">
                <Button variant={tier.featured ? 'primary' : 'secondary'} className="w-full">
                  {tier.cta}
                </Button>
              </Link>
            </Card>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}
