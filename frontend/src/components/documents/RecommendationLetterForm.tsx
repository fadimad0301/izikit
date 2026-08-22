'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  recommendationLetterAnswersSchema,
  type RecommendationLetterAnswers,
} from '@/lib/validation/document-types';
import { Button, Input, Textarea } from '@/components/ui';

interface RecommendationLetterFormProps {
  defaultValues: Partial<RecommendationLetterAnswers>;
  onSubmit: (data: RecommendationLetterAnswers) => void;
  submitLabel: string;
}

export function RecommendationLetterForm({
  defaultValues,
  onSubmit,
  submitLabel,
}: RecommendationLetterFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecommendationLetterAnswers>({
    resolver: zodResolver(recommendationLetterAnswersSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Input
        label="Nom du recommandataire"
        placeholder="Pr. Fatou Sarr"
        error={errors.recommenderName?.message}
        {...register('recommenderName')}
      />
      <Input
        label="Rôle ou titre du recommandataire"
        placeholder="Professeure de mathématiques, Responsable RH…"
        error={errors.recommenderRole?.message}
        {...register('recommenderRole')}
      />
      <Textarea
        label="Relation avec l’étudiant·e"
        placeholder="Enseignante en 2e année de licence, superviseure de stage…"
        rows={3}
        error={errors.relationship?.message}
        {...register('relationship')}
      />
      <Input
        label="Depuis combien de temps se connaissent-ils"
        placeholder="2 ans, depuis septembre 2023…"
        error={errors.relationshipDuration?.message}
        {...register('relationshipDuration')}
      />
      <Textarea
        label="Qualités à mettre en avant"
        placeholder="Rigueur, esprit d’équipe, capacité d’analyse…"
        rows={3}
        error={errors.strengths?.message}
        {...register('strengths')}
      />
      <Textarea
        label="Un exemple concret du travail ou du parcours de l’étudiant·e"
        placeholder="Un projet réussi, une situation où il/elle s’est distingué·e…"
        rows={4}
        error={errors.concreteExamples?.message}
        {...register('concreteExamples')}
      />
      <Input
        label="Programme ou école visé"
        placeholder="Master 2 Data Science — Université Paris-Saclay"
        error={errors.targetProgram?.message}
        {...register('targetProgram')}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
