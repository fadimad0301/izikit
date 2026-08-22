/**
 * Provider-agnostic AI interface. Mirrors payments/provider.ts's shape:
 * routes consume `AiProvider`, never the concrete Claude adapter, so
 * swapping/adding providers is one wiring change in `index.ts`.
 */
import type { CvAnswers, GeneratedCv } from '@/lib/validation/cv-wizard';
import type { DocumentType, GeneratedDocumentContent } from '@/lib/validation/document-types';

export interface CvGenerationInput {
  answers: CvAnswers;
}

// Phase 5 — CV weak-point analysis, contextualized to the procedure the
// student purchased Complet access for.
export interface CvAnalysisInput {
  generatedCv: GeneratedCv;
  procedure: { name: string; country: string; field?: string };
}

export interface CvAnalysis {
  points: string[];
}

// Documents beyond the CV (lettre de motivation, lettre de recommandation,
// …). `answers` is whatever shape that type's zod schema in
// lib/validation/document-types.ts validated — the provider trusts the
// caller already ran that check.
export interface DocumentGenerationInput {
  type: DocumentType;
  answers: Record<string, unknown>;
}

export interface AiProvider {
  /** Short identifier (used for logging). */
  name: string;

  generateCv(input: CvGenerationInput): Promise<GeneratedCv>;

  analyzeCv(input: CvAnalysisInput): Promise<CvAnalysis>;

  generateDocument(input: DocumentGenerationInput): Promise<GeneratedDocumentContent>;
}
