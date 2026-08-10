// /cv — CV Builder: 5-step questionnaire → AI generation → printable preview.
//
// Each step auto-saves via PATCH /api/cv on "Suivant" (resumable — closing
// the tab and coming back keeps prior steps). The last step's submit calls
// POST /api/cv/generate and swaps into the preview view. Regenerating from
// the preview goes back through the same generate call.
'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, ApiError } from '@/lib/api';
import { useUser } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useReducedMotion, DOXI_EASE } from '@/lib/motion';
import {
  IdentityStepForm,
  EducationStepForm,
  ExperienceStepForm,
  SkillsStepForm,
  ObjectiveStepForm,
} from '@/components/cv';
import { CvPreview } from '@/components/cv/CvPreview';
import {
  WIZARD_STEPS,
  type CvAnswers,
  type GeneratedCv,
  type WizardStepKey,
} from '@/lib/validation/cv-wizard';

interface CvDraft {
  targetCountry: string | null;
  targetField: string | null;
  answers: CvAnswers;
  generatedCv: GeneratedCv | null;
  generatedAt: string | null;
  updatedAt: string | null;
}

const STEP_LABELS: Record<WizardStepKey, string> = {
  identity: 'Identité',
  education: 'Formation',
  experience: 'Expériences',
  skills: 'Compétences & langues',
  objective: 'Objectif',
};

// `api.ts` (PROTECTED) sets `ApiError.message` from the response body's
// `error` field — the stable English code, not the user-facing copy. Every
// Phase 3 route also returns a French `message` field in its body, reachable
// via `err.body.message`. Prefer that; fall back if it's absent/malformed.
function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const serverMessage = err.body.message;
    if (typeof serverMessage === 'string' && serverMessage.length > 0) return serverMessage;
  }
  return fallback;
}

// Dots read better than a continuous fill for a short, linear wizard — each
// step is a discrete commitment, not a fractional quantity. The visible
// label text stays a plain paragraph right above (same copy the old
// ProgressBar rendered); this element carries the equivalent progressbar
// semantics for assistive tech.
function StepIndicator({ total, current }: { total: number; current: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={current + 1}
      aria-valuemin={1}
      aria-valuemax={total}
      className="mt-3 flex items-center gap-1.5"
    >
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={
            i < current
              ? 'h-1.5 flex-1 rounded-full bg-ink-900'
              : i === current
                ? 'h-1.5 flex-1 rounded-full bg-seal-gold'
                : 'h-1.5 flex-1 rounded-full bg-ink-900/12'
          }
        />
      ))}
    </div>
  );
}

export default function CvBuilderPage() {
  const user = useUser();
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();
  const [answers, setAnswers] = useState<CvAnswers>({});
  const [generatedCv, setGeneratedCv] = useState<GeneratedCv | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [view, setView] = useState<'wizard' | 'preview'>('wizard');

  useEffect(() => {
    if (!user) return;
    api<CvDraft>('/api/cv')
      .then((res) => {
        setAnswers(res.answers);
        setGeneratedCv(res.generatedCv);
        if (res.generatedCv) setView('preview');
        const firstIncomplete = WIZARD_STEPS.findIndex((step) => !res.answers[step]);
        setStepIndex(firstIncomplete === -1 ? WIZARD_STEPS.length - 1 : firstIncomplete);
      })
      .catch(() => {
        // First visit — no draft yet, wizard starts empty at step 0.
      })
      .finally(() => setLoading(false));
  }, [user]);

  async function saveStep(step: WizardStepKey, data: CvAnswers[WizardStepKey]) {
    try {
      const res = await api<CvDraft>('/api/cv', {
        method: 'PATCH',
        body: { answers: { [step]: data } },
      });
      setAnswers(res.answers);
      return true;
    } catch (err) {
      toast(apiErrorMessage(err, 'Une erreur est survenue.'), 'error');
      return false;
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await api<{ generatedCv: GeneratedCv; generatedAt: string }>('/api/cv/generate', {
        method: 'POST',
      });
      setGeneratedCv(res.generatedCv);
      setView('preview');
      toast('Ton CV a été généré.', 'success');
    } catch (err) {
      toast(apiErrorMessage(err, 'La génération a échoué.'), 'error');
    } finally {
      setGenerating(false);
    }
  }

  if (!user || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper-50">
        <p className="text-sm text-charcoal-900/60">Chargement…</p>
      </main>
    );
  }

  if (view === 'preview' && generatedCv) {
    return (
      <CvPreview
        generatedCv={generatedCv}
        onEdit={() => setView('wizard')}
        onRegenerate={handleGenerate}
        regenerating={generating}
      />
    );
  }

  const currentStep = WIZARD_STEPS[stepIndex]!;
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;

  async function handleStepSubmit(data: CvAnswers[typeof currentStep]) {
    const saved = await saveStep(currentStep, data);
    if (!saved) return;
    if (isLastStep) {
      await handleGenerate();
    } else {
      setDirection(1);
      setStepIndex((i) => i + 1);
    }
  }

  function goBack() {
    setDirection(-1);
    setStepIndex((i) => Math.max(0, i - 1));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-16">
      <div>
        <p className="text-xs font-semibold tracking-wide text-seal-gold uppercase">CV Builder</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">Construis ton CV</h1>
        <p className="mt-4 text-sm font-medium text-ink-900/70">
          Étape {stepIndex + 1}/{WIZARD_STEPS.length} — {STEP_LABELS[currentStep]}
        </p>
        <StepIndicator total={WIZARD_STEPS.length} current={stepIndex} />
      </div>

      {stepIndex > 0 && (
        <button
          type="button"
          onClick={goBack}
          className="self-start text-sm text-ink-900/70 underline underline-offset-2"
        >
          ← Étape précédente
        </button>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, x: reduceMotion ? 0 : direction * 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduceMotion ? 0 : -direction * 20 }}
          transition={{ duration: reduceMotion ? 0 : 0.3, ease: DOXI_EASE }}
        >
          {currentStep === 'identity' && (
            <IdentityStepForm
              defaultValues={answers.identity ?? {}}
              onSubmit={handleStepSubmit}
              submitLabel="Suivant"
            />
          )}
          {currentStep === 'education' && (
            <EducationStepForm
              defaultValues={answers.education ?? {}}
              onSubmit={handleStepSubmit}
              submitLabel="Suivant"
            />
          )}
          {currentStep === 'experience' && (
            <ExperienceStepForm
              defaultValues={answers.experience ?? {}}
              onSubmit={handleStepSubmit}
              submitLabel="Suivant"
            />
          )}
          {currentStep === 'skills' && (
            <SkillsStepForm
              defaultValues={answers.skills ?? {}}
              onSubmit={handleStepSubmit}
              submitLabel="Suivant"
            />
          )}
          {currentStep === 'objective' && (
            <ObjectiveStepForm
              defaultValues={answers.objective ?? {}}
              onSubmit={handleStepSubmit}
              submitLabel={generating ? 'Génération…' : 'Générer mon CV'}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}
