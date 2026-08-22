'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { coverLetterAnswersSchema, type CoverLetterAnswers } from '@/lib/validation/document-types';
import { Button, Input, Textarea } from '@/components/ui';

interface CoverLetterFormProps {
  defaultValues: Partial<CoverLetterAnswers>;
  onSubmit: (data: CoverLetterAnswers) => void;
  submitLabel: string;
}

export function CoverLetterForm({ defaultValues, onSubmit, submitLabel }: CoverLetterFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CoverLetterAnswers>({
    resolver: zodResolver(coverLetterAnswersSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Input
        label="Programme ou école visé"
        placeholder="Master 2 Data Science — Université Paris-Saclay"
        error={errors.targetProgram?.message}
        {...register('targetProgram')}
      />
      <Input
        label="Pays visé"
        placeholder="France, Canada, Maroc…"
        error={errors.targetCountry?.message}
        {...register('targetCountry')}
      />
      <Textarea
        label="Ta motivation pour ce programme"
        placeholder="Pourquoi ce domaine, ce niveau d’études, ce projet…"
        rows={4}
        error={errors.motivation?.message}
        {...register('motivation')}
      />
      <Textarea
        label="Une expérience ou formation en lien avec ce programme"
        placeholder="Stage, projet académique, engagement associatif…"
        rows={4}
        error={errors.relevantExperience?.message}
        {...register('relevantExperience')}
      />
      <Textarea
        label="Pourquoi cette école ou ce programme en particulier (optionnel)"
        placeholder="Ce qui te distingue dans ce choix précis…"
        rows={3}
        error={errors.whyThisSchool?.message}
        {...register('whyThisSchool')}
      />
      <Textarea
        label="Ton projet professionnel après ces études (optionnel)"
        placeholder="Ce que tu comptes faire une fois diplômé·e…"
        rows={3}
        error={errors.careerGoals?.message}
        {...register('careerGoals')}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
