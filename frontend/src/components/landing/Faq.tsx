import { Accordion, type AccordionItemData } from '@/components/ui';
import { Section } from './Section';

const ITEMS: AccordionItemData[] = [
  {
    id: 'garantie',
    title: 'Doxi garantit-il l’obtention de mon visa ou de ma bourse ?',
    content:
      'Non — Doxi t’aide à préparer un dossier complet et conforme aux exigences officielles de chaque procédure. La décision finale reste entre les mains de l’institution ou du jury.',
  },
  {
    id: 'delais',
    title: 'Combien de temps faut-il pour préparer mon dossier ?',
    content:
      'Ton CV et tes premiers documents sont générés en quelques minutes. Le temps total dépend surtout des pièces que toi seul peux fournir (relevés de notes, diplômes, justificatifs).',
  },
  {
    id: 'paiement',
    title: 'Comment se passe le paiement sur la plateforme ?',
    content:
      'Par mobile money (Wave, Orange Money, Free Money) — le paiement est traité de façon sécurisée et tu reçois un accès immédiat à ton offre.',
  },
  {
    id: 'donnees',
    title: 'Mes documents et mes données personnelles sont-ils protégés ?',
    content:
      'Oui. Tes documents ne sont utilisés que pour la préparation de ton dossier et ne sont jamais partagés avec des tiers sans ton accord.',
  },
];

export function Faq() {
  return (
    <Section id="faq" bg="paper-100">
      <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">
        Des réponses claires
      </p>
      <h2 className="mt-2 max-w-xl font-serif text-3xl text-ink-900">Questions fréquentes</h2>
      <div className="mt-10 max-w-2xl">
        <Accordion items={ITEMS} />
      </div>
    </Section>
  );
}
