'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { identityStepSchema, type IdentityStep } from '@/lib/validation/cv-wizard';
import { Button, Input } from '@/components/ui';

interface IdentityStepFormProps {
  defaultValues: Partial<IdentityStep>;
  onSubmit: (data: IdentityStep) => void;
  submitLabel: string;
}

export function IdentityStepForm({ defaultValues, onSubmit, submitLabel }: IdentityStepFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<IdentityStep>({
    resolver: zodResolver(identityStepSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Input
        label="Nom complet"
        placeholder="Awa Ndiaye"
        error={errors.fullName?.message}
        {...register('fullName')}
      />
      <Input
        label="E-mail"
        type="email"
        placeholder="awa@example.com"
        error={errors.email?.message}
        {...register('email')}
      />
      <Input
        label="Téléphone"
        placeholder="+221 77 123 45 67"
        error={errors.phone?.message}
        {...register('phone')}
      />
      <Input label="Ville" placeholder="Dakar" error={errors.city?.message} {...register('city')} />
      <Button type="submit" loading={isSubmitting} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
