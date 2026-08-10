'use client';

import { useForm, useFieldArray, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { skillsStepSchema, type SkillsStep } from '@/lib/validation/cv-wizard';
import { Button, Input, Card } from '@/components/ui';
import { useReducedMotion, DURATION } from '@/lib/motion';

interface SkillsStepFormProps {
  defaultValues: Partial<SkillsStep>;
  onSubmit: (data: SkillsStep) => void;
  submitLabel: string;
}

const LANGUAGE_LEVELS = ['DEBUTANT', 'INTERMEDIAIRE', 'COURANT', 'BILINGUE', 'NATIF'] as const;
const LANGUAGE_LEVEL_LABELS: Record<(typeof LANGUAGE_LEVELS)[number], string> = {
  DEBUTANT: 'Débutant',
  INTERMEDIAIRE: 'Intermédiaire',
  COURANT: 'Courant',
  BILINGUE: 'Bilingue',
  NATIF: 'Natif',
};

export function SkillsStepForm({ defaultValues, onSubmit, submitLabel }: SkillsStepFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SkillsStep>({
    resolver: zodResolver(skillsStepSchema) as Resolver<SkillsStep>,
    defaultValues: {
      skills: defaultValues.skills ?? [],
      languages: defaultValues.languages ?? [],
    },
  });
  const skillsArray = useFieldArray({ control, name: 'skills' as never });
  const languagesArray = useFieldArray({ control, name: 'languages' });
  const reduceMotion = useReducedMotion();

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink-900">Compétences</span>
        {skillsArray.fields.map((field, index) => (
          <div key={field.id} className="flex gap-2">
            <Input
              placeholder="Excel, prise de parole…"
              {...register(`skills.${index}` as const)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => skillsArray.remove(index)}
            >
              Retirer
            </Button>
          </div>
        ))}
        {errors.skills?.message && (
          <p className="text-xs text-error-600">{errors.skills.message}</p>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => skillsArray.append('')}>
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M12 5v14M5 12h14"
            />
          </svg>
          Ajouter une compétence
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink-900">Langues</span>
        <AnimatePresence initial={false}>
          {languagesArray.fields.map((field, index) => (
            <motion.div
              key={field.id}
              initial={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: reduceMotion ? 0 : DURATION.base }}
            >
              <Card bordered className="flex items-end gap-3">
                <Input
                  label="Langue"
                  placeholder="Anglais"
                  error={errors.languages?.[index]?.name?.message}
                  {...register(`languages.${index}.name`)}
                />
                <Controller
                  control={control}
                  name={`languages.${index}.level`}
                  render={({ field: levelField }) => (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium text-ink-900">Niveau</label>
                      <div className="relative">
                        <select
                          className="h-11 w-full appearance-none rounded-xl border border-ink-900/15 bg-white px-3.5 pr-9 text-sm text-charcoal-900 outline-none transition-colors focus:border-seal-gold focus:ring-2 focus:ring-seal-gold/30"
                          value={levelField.value ?? 'DEBUTANT'}
                          onChange={(e) => levelField.onChange(e.target.value)}
                        >
                          {LANGUAGE_LEVELS.map((level) => (
                            <option key={level} value={level}>
                              {LANGUAGE_LEVEL_LABELS[level]}
                            </option>
                          ))}
                        </select>
                        <svg
                          className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-ink-900/50"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.75}
                            d="M6 9l6 6 6-6"
                          />
                        </svg>
                      </div>
                    </div>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => languagesArray.remove(index)}
                >
                  Retirer
                </Button>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => languagesArray.append({ name: '', level: 'DEBUTANT' })}
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M12 5v14M5 12h14"
            />
          </svg>
          Ajouter une langue
        </Button>
      </div>

      <Button type="submit" loading={isSubmitting} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
