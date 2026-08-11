// Doxi Phase 4 — seed script for the procedure catalog (Accompagnement
// Simple tier). Static reference content, not admin-managed in this phase.
// docs/superpowers/specs/2026-08-09-procedure-checklist-payment-design.md
//
// Usage: pnpm seed:procedures
//
// Idempotent — upsert keyed on `slug`, safe to re-run (e.g. after editing a
// checklist below) without duplicating rows. Mirrors scripts/seed-dev.ts's
// main(args, deps) shape so tests can inject a mocked PrismaClient.

import { pathToFileURL } from 'node:url';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { ChecklistItem } from '../src/lib/server/procedures/checklist';

interface ProcedureSeed {
  slug: string;
  name: string;
  country: string;
  field?: string;
  tagline: string;
  priceFcfa: number;
  checklist: ChecklistItem[];
}

const PROCEDURES: ProcedureSeed[] = [
  {
    slug: 'campus-france',
    name: 'Campus France',
    country: 'France',
    tagline: 'La procédure obligatoire pour candidater aux universités françaises.',
    priceFcfa: 5000,
    checklist: [
      {
        id: 'passeport-valide',
        title: 'Passeport en cours de validité',
        description: 'Valide au moins 6 mois après la date de départ prévue.',
      },
      {
        id: 'releves-notes',
        title: 'Relevés de notes des 2 ou 3 dernières années',
        description: 'Traduits en français si l’original est dans une autre langue.',
      },
      {
        id: 'diplomes-attestation',
        title: 'Diplômes obtenus (ou attestation de scolarité en cours)',
      },
      {
        id: 'lettre-motivation',
        title: 'Lettre de motivation',
        description: 'Adaptée à chaque formation demandée.',
      },
      { id: 'cv-a-jour', title: 'CV à jour' },
      {
        id: 'justificatif-ressources',
        title: 'Justificatif de ressources financières',
        description: 'Preuve de capacité à financer au moins la première année.',
      },
      {
        id: 'certificat-francais',
        title: 'Certificat de français (TCF/TEF) si la formation l’exige',
      },
    ],
  },
  {
    slug: 'chevening',
    name: 'Chevening',
    country: 'Royaume-Uni',
    field: 'Master',
    tagline: 'Bourse britannique entièrement financée pour un Master d’un an.',
    priceFcfa: 5000,
    checklist: [
      { id: 'passeport-valide', title: 'Passeport en cours de validité' },
      {
        id: 'lettres-recommandation',
        title: '3 lettres de recommandation',
        description:
          'D’employeurs ou d’enseignants, soumises directement en ligne par les référents.',
      },
      {
        id: 'essais-candidature',
        title: 'Essais de candidature Chevening',
        description:
          '4 essais courts sur le leadership, le réseau, les études et les objectifs de carrière.',
      },
      { id: 'cv-a-jour', title: 'CV à jour' },
      { id: 'diplomes-releves', title: 'Diplômes et relevés de notes' },
      {
        id: 'preuve-experience',
        title: 'Preuve de 2 ans d’expérience professionnelle minimum',
      },
      {
        id: 'offres-admission',
        title: '3 offres d’admission inconditionnelles à des universités britanniques éligibles',
        description:
          'À obtenir avant la date limite Chevening, séparément de la candidature à la bourse.',
      },
    ],
  },
  {
    slug: 'bourses-canada',
    name: 'Bourses Canada',
    country: 'Canada',
    tagline: 'Programmes de bourses d’études supérieures pour étudiants internationaux.',
    priceFcfa: 5000,
    checklist: [
      { id: 'passeport-valide', title: 'Passeport en cours de validité' },
      {
        id: 'lettre-admission',
        title: 'Lettre d’admission ou de pré-admission d’un établissement canadien reconnu',
      },
      {
        id: 'releves-notes-officiels',
        title: 'Relevés de notes officiels',
        description: 'Traduits en français ou en anglais.',
      },
      { id: 'lettre-motivation', title: 'Lettre de motivation' },
      { id: 'lettres-recommandation', title: '2 à 3 lettres de recommandation académiques' },
      {
        id: 'preuve-linguistique',
        title: 'Preuve de compétence linguistique (IELTS/TEF)',
        description: 'Selon la langue d’enseignement du programme visé.',
      },
      {
        id: 'caq-preuve-fonds',
        title: 'Certificat d’acceptation du Québec (CAQ) ou preuve de fonds',
        description: 'Selon la province et le type de bourse.',
      },
    ],
  },
  {
    slug: 'amci-maroc',
    name: 'AMCI Maroc',
    country: 'Maroc',
    tagline: 'Bourses de l’Agence Marocaine de Coopération Internationale.',
    priceFcfa: 5000,
    checklist: [
      { id: 'passeport-valide', title: 'Passeport en cours de validité' },
      {
        id: 'copie-diplome',
        title: 'Copie légalisée du baccalauréat ou du dernier diplôme obtenu',
      },
      { id: 'releves-notes-legalises', title: 'Relevés de notes légalisés des 2 dernières années' },
      {
        id: 'certificat-medical',
        title: 'Certificat médical d’aptitude',
        description: 'Délivré par un médecin agréé.',
      },
      { id: 'acte-naissance', title: 'Extrait d’acte de naissance' },
      { id: 'photos-identite', title: 'Photos d’identité récentes' },
      {
        id: 'dossier-amci',
        title: 'Dossier de candidature AMCI complété',
        description: 'Déposé auprès de l’ambassade du Maroc ou du service culturel compétent.',
      },
    ],
  },
  {
    slug: 'ytb-turkiye',
    name: 'YTB Türkiye',
    country: 'Turquie',
    tagline: 'Bourses Türkiye pour étudiants internationaux, tous niveaux confondus.',
    priceFcfa: 5000,
    checklist: [
      { id: 'passeport-valide', title: 'Passeport en cours de validité' },
      {
        id: 'diplome-releves',
        title: 'Diplôme le plus récent et relevés de notes',
        description: 'Traduits et si besoin apostillés.',
      },
      { id: 'lettre-motivation', title: 'Lettre de motivation' },
      {
        id: 'lettres-recommandation',
        title: 'Lettres de recommandation',
        description: 'Nombre variable selon le niveau d’études visé.',
      },
      {
        id: 'certificat-medical',
        title: 'Certificat médical attestant l’absence de maladie contagieuse',
      },
      { id: 'photos-identite', title: 'Photos d’identité récentes' },
      {
        id: 'candidature-en-ligne',
        title: 'Candidature en ligne complétée sur le portail Türkiye Scholarships',
      },
    ],
  },
];

interface SeedDeps {
  // Injectable for tests — defaults to a freshly-instantiated PrismaClient
  // when called as a CLI.
  prisma?: PrismaClient;
}

export async function main(_args: string[] = [], deps: SeedDeps = {}): Promise<void> {
  const prisma = deps.prisma ?? new PrismaClient();
  try {
    for (const proc of PROCEDURES) {
      const { slug, field, checklist, ...rest } = proc;
      const data = {
        ...rest,
        field: field ?? null,
        checklist: checklist as unknown as Prisma.InputJsonValue,
      };
      const row = await prisma.procedure.upsert({
        where: { slug },
        update: data,
        create: { slug, ...data },
        select: { slug: true, name: true },
      });
      console.log(`✓ ${row.slug} — ${row.name}`);
    }
  } finally {
    // Only disconnect the real client; tests pass their own mock and close
    // it themselves.
    if (!deps.prisma) {
      await prisma.$disconnect();
    }
  }
}

// CLI entrypoint guard — only run when invoked as a script, not when
// imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
