'use client';

import { useForm, useFieldArray, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { experienceStepSchema, type ExperienceStep } from '@/lib/validation/cv-wizard';
import { Button, Input, Card } from '@/components/ui';
import { useReducedMotion, DURATION } from '@/lib/motion';

interface ExperienceStepFormProps {
  defaultValues: Partial<ExperienceStep>;
  onSubmit: (data: ExperienceStep) => void;
  submitLabel: string;
}

export function ExperienceStepForm({
  defaultValues,
  onSubmit,
  submitLabel,
}: ExperienceStepFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ExperienceStep>({
    resolver: zodResolver(experienceStepSchema) as Resolver<ExperienceStep>,
    defaultValues: { entries: defaultValues.entries ?? [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'entries' });
  const reduceMotion = useReducedMotion();

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <p className="text-sm text-charcoal-900/70">
        Stages, emplois, engagement associatif — ajoute ce que tu as, ou passe cette étape si tu
        n’as encore rien à ajouter.
      </p>
      <AnimatePresence initial={false}>
        {fields.map((field, index) => (
          <motion.div
            key={field.id}
            initial={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: reduceMotion ? 0 : DURATION.base }}
          >
            <Card bordered className="flex flex-col gap-3">
              <Input
                label="Intitulé"
                placeholder="Stagiaire vente"
                error={errors.entries?.[index]?.title?.message}
                {...register(`entries.${index}.title`)}
              />
              <Input
                label="Organisation"
                placeholder="Auchan Dakar"
                error={errors.entries?.[index]?.organization?.message}
                {...register(`entries.${index}.organization`)}
              />
              <Input
                label="Description"
                placeholder="Conseil client, gestion de la caisse…"
                error={errors.entries?.[index]?.description?.message}
                {...register(`entries.${index}.description`)}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                Retirer
              </Button>
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>
      <Button
        type="button"
        variant="secondary"
        onClick={() => append({ title: '', organization: '', description: '' })}
      >
        <svg
          className="h-4 w-4"
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
        Ajouter une expérience
      </Button>
      <Button type="submit" loading={isSubmitting} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
