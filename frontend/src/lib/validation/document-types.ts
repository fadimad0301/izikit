import { z } from 'zod';

// Client + server shared schemas for AI-generated documents beyond the CV
// (lettre de motivation, lettre de recommandation, …). Same pattern as
// cv-wizard.ts: client forms use these as RHF resolvers, server routes use
// them to validate the `answers` JSON blob on GeneratedDocument. No
// `server-only` import here — this module must be importable from client
// components.
//
// Adding a new document type: add its answers schema below, register it in
// `documentAnswersSchemaByType` + `DOCUMENT_TYPES` + `DOCUMENT_TYPE_LABELS`,
// and add a matching system prompt in lib/server/ai/claude.ts. No migration
// needed — `GeneratedDocument.type` is a free-form string column.

export const coverLetterAnswersSchema = z.object({
  targetProgram: z.string().min(1, 'Le programme ou l’école visé est requis.').max(150),
  targetCountry: z.string().min(1, 'Le pays visé est requis.').max(100),
  motivation: z.string().min(1, 'Explique ta motivation pour ce programme.').max(2000),
  relevantExperience: z
    .string()
    .min(1, 'Décris une expérience ou formation en lien avec ce programme.')
    .max(2000),
  whyThisSchool: z.string().max(1500).optional(),
  careerGoals: z.string().max(1000).optional(),
});
export type CoverLetterAnswers = z.infer<typeof coverLetterAnswersSchema>;

export const recommendationLetterAnswersSchema = z.object({
  recommenderName: z.string().min(1, 'Le nom du recommandataire est requis.').max(150),
  recommenderRole: z.string().min(1, 'Le rôle ou titre du recommandataire est requis.').max(150),
  relationship: z.string().min(1, 'Décris la relation avec l’étudiant.').max(500),
  relationshipDuration: z
    .string()
    .min(1, 'Depuis combien de temps le recommandataire connaît-il l’étudiant ?')
    .max(100),
  strengths: z.string().min(1, 'Quelles qualités doit mettre en avant la lettre ?').max(1500),
  concreteExamples: z
    .string()
    .min(1, 'Donne un exemple concret du travail ou du parcours de l’étudiant.')
    .max(2000),
  targetProgram: z.string().min(1, 'Le programme ou l’école visé est requis.').max(150),
});
export type RecommendationLetterAnswers = z.infer<typeof recommendationLetterAnswersSchema>;

export const documentAnswersSchemaByType = {
  COVER_LETTER: coverLetterAnswersSchema,
  RECOMMENDATION_LETTER: recommendationLetterAnswersSchema,
} as const;

export const DOCUMENT_TYPES = Object.keys(documentAnswersSchemaByType) as DocumentType[];
export type DocumentType = keyof typeof documentAnswersSchemaByType;

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  COVER_LETTER: 'Lettre de motivation',
  RECOMMENDATION_LETTER: 'Lettre de recommandation',
};

// URL-facing slug (kebab-case, English — matches this app's existing route
// naming) <-> internal type key. Centralized here so the API route, the
// frontend router, and any future caller share one source of truth.
export const DOCUMENT_TYPE_SLUGS: Record<DocumentType, string> = {
  COVER_LETTER: 'cover-letter',
  RECOMMENDATION_LETTER: 'recommendation-letter',
};

export function documentTypeFromSlug(slug: string): DocumentType | null {
  const entry = (Object.entries(DOCUMENT_TYPE_SLUGS) as [DocumentType, string][]).find(
    ([, s]) => s === slug,
  );
  return entry ? entry[0] : null;
}

export function documentAnswersSchemaFor(type: DocumentType) {
  return documentAnswersSchemaByType[type];
}

export const generatedDocumentSchema = z.object({
  title: z.string(),
  paragraphs: z.array(z.string()),
});
export type GeneratedDocumentContent = z.infer<typeof generatedDocumentSchema>;
