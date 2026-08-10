'use client';

import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { educationStepSchema, type EducationStep } from '@/lib/validation/cv-wizard';
import { Button, Input, Card } from '@/components/ui';
import { useReducedMotion, DURATION } from '@/lib/motion';

interface EducationStepFormProps {
  defaultValues: Partial<EducationStep>;
  onSubmit: (data: EducationStep) => void;
  submitLabel: string;
}

const EMPTY_ENTRY = {
  institution: '',
  degree: '',
  startYear: new Date().getFullYear(),
  endYear: null,
};

export function EducationStepForm({
  defaultValues,
  onSubmit,
  submitLabel,
}: EducationStepFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EducationStep>({
    resolver: zodResolver(educationStepSchema),
    defaultValues: {
      entries: defaultValues.entries?.length ? defaultValues.entries : [EMPTY_ENTRY],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'entries' });
  const reduceMotion = useReducedMotion();

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
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
                label="Établissement"
                placeholder="UCAD"
                error={errors.entries?.[index]?.institution?.message}
                {...register(`entries.${index}.institution`)}
              />
              <Input
                label="Diplôme / filière"
                placeholder="Licence Informatique"
                error={errors.entries?.[index]?.degree?.message}
                {...register(`entries.${index}.degree`)}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Année de début"
                  type="number"
                  error={errors.entries?.[index]?.startYear?.message}
                  {...register(`entries.${index}.startYear`, { valueAsNumber: true })}
                />
                <Input
                  label="Année de fin (vide si en cours)"
                  type="number"
                  error={errors.entries?.[index]?.endYear?.message}
                  {...register(`entries.${index}.endYear`, {
                    setValueAs: (v) => (v === '' ? null : Number(v)),
                  })}
                />
              </div>
              {fields.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                  Retirer cette formation
                </Button>
              )}
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>
      <Button type="button" variant="secondary" onClick={() => append(EMPTY_ENTRY)}>
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
        Ajouter une formation
      </Button>
      <Button type="submit" loading={isSubmitting} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
