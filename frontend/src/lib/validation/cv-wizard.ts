import { z } from 'zod';

// Client + server shared schemas for the CV Builder wizard. Client forms use
// these as RHF resolvers; server routes use them to validate the `answers`
// JSON blob on CvProfile and the AI-generated CV shape. No `server-only`
// import here — this module must be importable from client components.

export const WIZARD_STEPS = ['identity', 'education', 'experience', 'skills', 'objective'] as const;
export type WizardStepKey = (typeof WIZARD_STEPS)[number];

export const identityStepSchema = z.object({
  fullName: z.string().min(1, 'Ton nom est requis.').max(100),
  email: z.string().email('Adresse e-mail invalide.'),
  phone: z.string().min(6, 'Numéro de téléphone invalide.').max(20),
  city: z.string().min(1, 'Ta ville est requise.').max(100),
});
export type IdentityStep = z.infer<typeof identityStepSchema>;

export const educationEntrySchema = z.object({
  institution: z.string().min(1, "Le nom de l'établissement est requis.").max(150),
  degree: z.string().min(1, 'Le diplôme/la filière est requis.').max(150),
  startYear: z.number().int().min(1980).max(2100),
  endYear: z.number().int().min(1980).max(2100).nullable(),
});
export type EducationEntry = z.infer<typeof educationEntrySchema>;

export const educationStepSchema = z.object({
  entries: z.array(educationEntrySchema).min(1, 'Ajoute au moins une formation.').max(10),
});
export type EducationStep = z.infer<typeof educationStepSchema>;

export const experienceEntrySchema = z.object({
  title: z.string().min(1, 'Le titre est requis.').max(150),
  organization: z.string().min(1, "Le nom de l'organisation est requis.").max(150),
  description: z.string().min(1, 'Décris brièvement ce que tu as fait.').max(1000),
});
export type ExperienceEntry = z.infer<typeof experienceEntrySchema>;

export const experienceStepSchema = z.object({
  entries: z.array(experienceEntrySchema).max(10).default([]),
});
export type ExperienceStep = z.infer<typeof experienceStepSchema>;

export const languageEntrySchema = z.object({
  name: z.string().min(1, 'Le nom de la langue est requis.').max(60),
  level: z.enum(['DEBUTANT', 'INTERMEDIAIRE', 'COURANT', 'BILINGUE', 'NATIF']),
});
export type LanguageEntry = z.infer<typeof languageEntrySchema>;

export const skillsStepSchema = z.object({
  skills: z.array(z.string().min(1).max(60)).min(1, 'Ajoute au moins une compétence.').max(20),
  languages: z.array(languageEntrySchema).max(10).default([]),
});
export type SkillsStep = z.infer<typeof skillsStepSchema>;

export const objectiveStepSchema = z.object({
  targetCountry: z.string().min(1, 'Le pays cible est requis.').max(100),
  targetField: z.string().min(1, 'Le domaine est requis.').max(100),
  targetProgram: z.string().max(150).optional(),
});
export type ObjectiveStep = z.infer<typeof objectiveStepSchema>;

export const cvAnswersSchema = z.object({
  identity: identityStepSchema.optional(),
  education: educationStepSchema.optional(),
  experience: experienceStepSchema.optional(),
  skills: skillsStepSchema.optional(),
  objective: objectiveStepSchema.optional(),
});
export type CvAnswers = z.infer<typeof cvAnswersSchema>;

export const generatedCvSectionSchema = z.object({
  title: z.string(),
  bullets: z.array(z.string()),
});
export type GeneratedCvSection = z.infer<typeof generatedCvSectionSchema>;

export const generatedCvSchema = z.object({
  summary: z.string(),
  sections: z.array(generatedCvSectionSchema),
});
export type GeneratedCv = z.infer<typeof generatedCvSchema>;
