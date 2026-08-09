'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { objectiveStepSchema, type ObjectiveStep } from '@/lib/validation/cv-wizard';
import { Button, Input } from '@/components/ui';

interface ObjectiveStepFormProps {
  defaultValues: Partial<ObjectiveStep>;
  onSubmit: (data: ObjectiveStep) => void;
  submitLabel: string;
}

export function ObjectiveStepForm({
  defaultValues,
  onSubmit,
  submitLabel,
}: ObjectiveStepFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ObjectiveStep>({
    resolver: zodResolver(objectiveStepSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Input
        label="Pays cible"
        placeholder="France, Canada, Maroc…"
        error={errors.targetCountry?.message}
        {...register('targetCountry')}
      />
      <Input
        label="Domaine d’études"
        placeholder="Informatique, Gestion, Médecine…"
        error={errors.targetField?.message}
        {...register('targetField')}
      />
      <Input
        label="Programme visé (optionnel)"
        placeholder="Master 2 Data Science"
        error={errors.targetProgram?.message}
        {...register('targetProgram')}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
