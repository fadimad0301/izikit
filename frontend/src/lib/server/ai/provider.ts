/**
 * Provider-agnostic AI interface. Mirrors payments/provider.ts's shape:
 * routes consume `AiProvider`, never the concrete Claude adapter, so
 * swapping/adding providers is one wiring change in `index.ts`.
 */
import type { CvAnswers, GeneratedCv } from '@/lib/validation/cv-wizard';

export interface CvGenerationInput {
  answers: CvAnswers;
}

export interface AiProvider {
  /** Short identifier (used for logging). */
  name: string;

  generateCv(input: CvGenerationInput): Promise<GeneratedCv>;
}
