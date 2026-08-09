'use client';

import { useForm, useFieldArray, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { experienceStepSchema, type ExperienceStep } from '@/lib/validation/cv-wizard';
import { Button, Input, Card } from '@/components/ui';

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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <p className="text-sm text-charcoal-900/70">
        Stages, emplois, engagement associatif — ajoute ce que tu as, ou passe cette étape si tu
        n’as encore rien à ajouter.
      </p>
      {fields.map((field, index) => (
        <Card key={field.id} bordered className="flex flex-col gap-3">
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
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => append({ title: '', organization: '', description: '' })}
      >
        Ajouter une expérience
      </Button>
      <Button type="submit" loading={isSubmitting} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
