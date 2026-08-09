import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { generatedCvSchema, type CvAnswers, type GeneratedCv } from '@/lib/validation/cv-wizard';
import type { AiProvider, CvGenerationInput } from './provider';

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
  };
}
