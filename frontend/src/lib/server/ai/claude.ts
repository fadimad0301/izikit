import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { generatedCvSchema, type CvAnswers, type GeneratedCv } from '@/lib/validation/cv-wizard';
import {
  generatedDocumentSchema,
  type DocumentType,
  type GeneratedDocumentContent,
} from '@/lib/validation/document-types';
import { z } from 'zod';
import type {
  AiProvider,
  CvGenerationInput,
  CvAnalysisInput,
  CvAnalysis,
  DocumentGenerationInput,
} from './provider';

export interface CreateClaudeProviderOptions {
  apiKey: string;
  model?: string;
}

const DEFAULT_MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'emit_cv';

const CV_TOOL = {
  name: TOOL_NAME,
  description: 'Emit the finished CV content as structured JSON.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string' as const,
        description: 'A 2-3 sentence professional summary in French.',
      },
      sections: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            title: { type: 'string' as const },
            bullets: { type: 'array' as const, items: { type: 'string' as const } },
          },
          required: ['title', 'bullets'],
        },
      },
    },
    required: ['summary', 'sections'],
  },
};

const ANALYZE_TOOL_NAME = 'emit_cv_analysis';

const CV_ANALYSIS_TOOL = {
  name: ANALYZE_TOOL_NAME,
  description: 'Emit a list of concrete improvement points for the CV.',
  input_schema: {
    type: 'object' as const,
    properties: {
      points: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: '3 to 6 concrete, French-language suggestions to improve this CV.',
      },
    },
    required: ['points'],
  },
};

const cvAnalysisSchema = z.object({ points: z.array(z.string()) });

function buildSystemPrompt(): string {
  return [
    'Tu es un assistant qui aide des étudiants ouest-africains à rédiger un CV professionnel ' +
      "pour une candidature à l'étranger (bourses, admissions, visas études).",
    'Réécris les informations fournies par l’étudiant en un CV clair et professionnel : ' +
      'reformule en une accroche courte et des puces concises, adapte le ton et le vocabulaire ' +
      'au pays et au domaine visés. Écris en français, tutoiement interdit ici (le CV s’adresse ' +
      'à un recruteur/jury, pas à l’étudiant).',
    'RÈGLE ABSOLUE : n’invente aucun fait, date, employeur, diplôme, compétence ou résultat qui ' +
      'n’est pas explicitement fourni par l’étudiant. Si une information manque, ne comble pas le ' +
      'vide — reste sobre et fidèle aux données reçues.',
    'Réponds uniquement en appelant l’outil emit_cv avec le CV complet.',
  ].join('\n');
}

function buildUserPrompt(answers: CvAnswers): string {
  return JSON.stringify(answers, null, 2);
}

function buildAnalysisSystemPrompt(): string {
  return [
    'Tu es un assistant qui aide des étudiants ouest-africains à améliorer leur CV pour une ' +
      'candidature à une procédure précise (bourse, admission, visa études).',
    'On te donne un CV déjà rédigé et le nom/pays/domaine de la procédure ciblée. Relis le CV ' +
      'et propose entre 3 et 6 points d’amélioration concrets, en français, en tutoiement (tu ' +
      't’adresses directement à l’étudiant cette fois).',
    'Chaque point doit être actionnable (ce qu’il faut changer, pas juste un constat) et tenir ' +
      'compte du pays et du domaine de la procédure visée.',
    'RÈGLE ABSOLUE : ne juge que le contenu réellement présent dans le CV fourni — n’invente ' +
      'aucun fait sur l’étudiant.',
    'Réponds uniquement en appelant l’outil emit_cv_analysis.',
  ].join('\n');
}

function buildAnalysisUserPrompt(input: CvAnalysisInput): string {
  return JSON.stringify({ cv: input.generatedCv, procedure: input.procedure }, null, 2);
}

const DOCUMENT_TOOL_NAME = 'emit_document';

const DOCUMENT_TOOL = {
  name: DOCUMENT_TOOL_NAME,
  description: 'Emit the finished document content as structured JSON.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string' as const, description: 'A short title for the document, in French.' },
      paragraphs: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'The document body, one paragraph per array entry, in French.',
      },
    },
    required: ['title', 'paragraphs'],
  },
};

// One system prompt per document type — each explains who's "speaking" (the
// student for a cover letter, the recommender for a recommendation letter),
// the register, and the structure. Adding a document type: add its prompt
// here and register the type in lib/validation/document-types.ts.
const DOCUMENT_SYSTEM_PROMPTS: Record<DocumentType, string> = {
  COVER_LETTER: [
    'Tu es un assistant qui aide des étudiants ouest-africains à rédiger une lettre de ' +
      "motivation pour une candidature à l'étranger (bourse, admission, procédure de visa études).",
    "Rédige la lettre à la première personne, comme si c'était l'étudiant qui écrivait lui-même, " +
      "en français soutenu et professionnel (vouvoiement — la lettre s'adresse à un comité " +
      "d'admission ou un jury).",
    'Structure la lettre en paragraphes clairs : accroche, motivation et lien avec le programme ' +
      'visé, expérience pertinente, projet professionnel, formule de politesse finale.',
    "RÈGLE ABSOLUE : n'invente aucun fait, diplôme, expérience ou résultat qui n'est pas " +
      'explicitement fourni par l’étudiant. Si une information manque, ne comble pas le vide — ' +
      'reste sobre et fidèle aux données reçues.',
    'Réponds uniquement en appelant l’outil emit_document avec le titre et les paragraphes.',
  ].join('\n'),
  RECOMMENDATION_LETTER: [
    'Tu es un assistant qui aide à rédiger une lettre de recommandation pour un étudiant ' +
      "ouest-africain candidatant à l'étranger (bourse, admission, procédure de visa études).",
    'Rédige la lettre à la première personne, du point de vue du recommandataire (la personne ' +
      "qui recommande l'étudiant — professeur, employeur, encadrant…), en français soutenu et " +
      "professionnel (vouvoiement — la lettre s'adresse à un comité d'admission ou un jury).",
    'Structure la lettre en paragraphes clairs : présentation du recommandataire et de sa ' +
      'relation avec l’étudiant, qualités et compétences observées avec des exemples concrets, ' +
      'recommandation explicite pour le programme visé, formule de politesse finale.',
    "RÈGLE ABSOLUE : n'invente aucun fait, qualité ou exemple qui n'est pas explicitement " +
      'fourni. Si une information manque, ne comble pas le vide — reste sobre et fidèle aux ' +
      'données reçues.',
    'Réponds uniquement en appelant l’outil emit_document avec le titre et les paragraphes.',
  ].join('\n'),
};

function buildDocumentUserPrompt(answers: Record<string, unknown>): string {
  return JSON.stringify(answers, null, 2);
}

export function createClaudeProvider(options: CreateClaudeProviderOptions): AiProvider {
  const client = new Anthropic({ apiKey: options.apiKey });
  const model = options.model ?? DEFAULT_MODEL;

  return {
    name: 'claude',
    async generateCv({ answers }: CvGenerationInput): Promise<GeneratedCv> {
      const response = await client.messages.create({
        model,
        // 8000 (not 2048): a 5-section CV with multiple bullets per section
        // is non-trivial structured output on its own, and this model's
        // `messages.create` budgets thinking tokens (if any) out of the same
        // max_tokens pool as the tool_use output. `thinking` is intentionally
        // left unset — forcing tool_choice to a specific tool (below) already
        // precludes extended thinking for this call, so there's no separate
        // budget to reclaim by disabling it explicitly.
        max_tokens: 8000,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildUserPrompt(answers) }],
        tools: [CV_TOOL],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      });

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (!toolUse) {
        throw new Error('Claude response did not include the expected tool_use block');
      }

      return generatedCvSchema.parse(toolUse.input);
    },

    async analyzeCv(input: CvAnalysisInput): Promise<CvAnalysis> {
      const response = await client.messages.create({
        model,
        max_tokens: 2000,
        system: buildAnalysisSystemPrompt(),
        messages: [{ role: 'user', content: buildAnalysisUserPrompt(input) }],
        tools: [CV_ANALYSIS_TOOL],
        tool_choice: { type: 'tool', name: ANALYZE_TOOL_NAME },
      });

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (!toolUse) {
        throw new Error('Claude response did not include the expected tool_use block');
      }

      return cvAnalysisSchema.parse(toolUse.input);
    },

    async generateDocument({
      type,
      answers,
    }: DocumentGenerationInput): Promise<GeneratedDocumentContent> {
      const response = await client.messages.create({
        model,
        max_tokens: 4000,
        system: DOCUMENT_SYSTEM_PROMPTS[type],
        messages: [{ role: 'user', content: buildDocumentUserPrompt(answers) }],
        tools: [DOCUMENT_TOOL],
        tool_choice: { type: 'tool', name: DOCUMENT_TOOL_NAME },
      });

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (!toolUse) {
        throw new Error('Claude response did not include the expected tool_use block');
      }

      return generatedDocumentSchema.parse(toolUse.input);
    },
  };
}
