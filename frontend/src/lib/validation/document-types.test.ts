import { describe, it, expect } from 'vitest';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_SLUGS,
  documentTypeFromSlug,
  documentAnswersSchemaFor,
  coverLetterAnswersSchema,
  recommendationLetterAnswersSchema,
  generatedDocumentSchema,
} from './document-types';

describe('DOCUMENT_TYPES', () => {
  it('lists the registered document types', () => {
    expect(DOCUMENT_TYPES).toEqual(['COVER_LETTER', 'RECOMMENDATION_LETTER']);
  });

  it('every type has a slug and the mapping round-trips', () => {
    for (const type of DOCUMENT_TYPES) {
      const slug = DOCUMENT_TYPE_SLUGS[type];
      expect(documentTypeFromSlug(slug)).toBe(type);
    }
  });
});

describe('documentTypeFromSlug', () => {
  it('returns null for an unknown slug', () => {
    expect(documentTypeFromSlug('not-a-real-type')).toBeNull();
  });
});

describe('coverLetterAnswersSchema', () => {
  it('accepts complete answers', () => {
    const result = coverLetterAnswersSchema.safeParse({
      targetProgram: 'Master 2 Data Science',
      targetCountry: 'France',
      motivation: 'Je souhaite approfondir mes compétences en data science.',
      relevantExperience: 'Stage de 6 mois en analyse de données.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing required field', () => {
    const result = coverLetterAnswersSchema.safeParse({
      targetProgram: 'Master 2 Data Science',
      targetCountry: 'France',
    });
    expect(result.success).toBe(false);
  });

  it('optional fields (whyThisSchool, careerGoals) may be omitted', () => {
    const result = coverLetterAnswersSchema.safeParse({
      targetProgram: 'Master 2 Data Science',
      targetCountry: 'France',
      motivation: 'Je souhaite approfondir mes compétences en data science.',
      relevantExperience: 'Stage de 6 mois en analyse de données.',
    });
    expect(result.success).toBe(true);
  });
});

describe('recommendationLetterAnswersSchema', () => {
  it('accepts complete answers', () => {
    const result = recommendationLetterAnswersSchema.safeParse({
      recommenderName: 'Pr. Fatou Sarr',
      recommenderRole: 'Professeure de mathématiques',
      relationship: 'Enseignante en licence 2.',
      relationshipDuration: '2 ans',
      strengths: 'Rigueur, esprit d’équipe.',
      concreteExamples: 'A obtenu la meilleure note du cours en 2024.',
      targetProgram: 'Master 2 Data Science',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing required field', () => {
    const result = recommendationLetterAnswersSchema.safeParse({
      recommenderName: 'Pr. Fatou Sarr',
    });
    expect(result.success).toBe(false);
  });
});

describe('documentAnswersSchemaFor', () => {
  it('resolves the correct schema per type', () => {
    expect(documentAnswersSchemaFor('COVER_LETTER')).toBe(coverLetterAnswersSchema);
    expect(documentAnswersSchemaFor('RECOMMENDATION_LETTER')).toBe(
      recommendationLetterAnswersSchema,
    );
  });
});

describe('generatedDocumentSchema', () => {
  it('accepts a title + paragraphs shape', () => {
    const result = generatedDocumentSchema.safeParse({
      title: 'Lettre de motivation',
      paragraphs: ['Madame, Monsieur, …'],
    });
    expect(result.success).toBe(true);
  });
});
