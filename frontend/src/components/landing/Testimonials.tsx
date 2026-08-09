import { Card } from '@/components/ui';
import { Section } from './Section';

// PLACEHOLDER CONTENT — replace with real student testimonials once Doxi has
// its first cohort of users. Do not present these as real quotes in
// production; they exist to validate the section's layout only.
const TESTIMONIALS = [
  {
    quote:
      'La checklist m’a évité d’oublier un document — sans ça, mon dossier de bourse serait passé à côté du bon format.',
    name: 'Exemple — à remplacer',
    context: 'Étudiante, candidature bourse d’excellence',
  },
  {
    quote:
      'J’ai pu structurer mon CV et ma lettre de motivation en une soirée au lieu d’y passer des semaines.',
    name: 'Exemple — à remplacer',
    context: 'Étudiant, candidature Master',
  },
];

export function Testimonials() {
  return (
    <Section>
      <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">
        Récits de réussite
      </p>
      <h2 className="mt-2 max-w-xl font-serif text-3xl text-ink-900">
        Ils préparent leur dossier avec Doxi
      </h2>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {TESTIMONIALS.map((t) => (
          <Card key={t.name} bordered>
            <p className="font-serif text-lg text-ink-900 italic">“{t.quote}”</p>
            <p className="mt-4 text-sm font-medium text-ink-900">{t.name}</p>
            <p className="text-xs text-charcoal-900/50">{t.context}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}
