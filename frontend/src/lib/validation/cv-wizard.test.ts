import { describe, it, expect } from 'vitest';
import {
  WIZARD_STEPS,
  identityStepSchema,
  educationStepSchema,
  experienceStepSchema,
  skillsStepSchema,
  objectiveStepSchema,
  cvAnswersSchema,
  generatedCvSchema,
} from './cv-wizard';

describe('WIZARD_STEPS', () => {
  it('lists the 5 steps in order', () => {
    expect(WIZARD_STEPS).toEqual(['identity', 'education', 'experience', 'skills', 'objective']);
  });
});

describe('identityStepSchema', () => {
  it('accepts a valid identity', () => {
    const result = identityStepSchema.safeParse({
      fullName: 'Awa Ndiaye',
      email: 'awa@example.com',
      phone: '+221771234567',
      city: 'Dakar',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing fullName', () => {
    const result = identityStepSchema.safeParse({
      fullName: '',
      email: 'awa@example.com',
      phone: '+221771234567',
      city: 'Dakar',
    });
    expect(result.success).toBe(false);
  });
});

describe('educationStepSchema', () => {
  it('accepts at least one entry', () => {
    const result = educationStepSchema.safeParse({
      entries: [
        { institution: 'UCAD', degree: 'Licence Informatique', startYear: 2021, endYear: 2024 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects zero entries', () => {
    const result = educationStepSchema.safeParse({ entries: [] });
    expect(result.success).toBe(false);
  });

  it('accepts a null endYear for ongoing studies', () => {
    const result = educationStepSchema.safeParse({
      entries: [{ institution: 'UCAD', degree: 'Master', startYear: 2024, endYear: null }],
    });
    expect(result.success).toBe(true);
  });
});

describe('experienceStepSchema', () => {
  it('defaults to an empty entries array', () => {
    const result = experienceStepSchema.parse({});
    expect(result.entries).toEqual([]);
  });

  it('accepts a filled entry', () => {
    const result = experienceStepSchema.safeParse({
      entries: [
        {
          title: 'Stagiaire vente',
          organization: 'Auchan Dakar',
          description: 'Conseil client, gestion caisse.',
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('skillsStepSchema', () => {
  it('requires at least one skill', () => {
    const result = skillsStepSchema.safeParse({ skills: [], languages: [] });
    expect(result.success).toBe(false);
  });

  it('accepts skills and languages', () => {
    const result = skillsStepSchema.safeParse({
      skills: ['Excel', 'Prise de parole'],
      languages: [
        { name: 'Français', level: 'NATIF' },
        { name: 'Anglais', level: 'COURANT' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid language level', () => {
    const result = skillsStepSchema.safeParse({
      skills: ['Excel'],
      languages: [{ name: 'Anglais', level: 'PARFAIT' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('objectiveStepSchema', () => {
  it('requires targetCountry and targetField', () => {
    const result = objectiveStepSchema.safeParse({
      targetCountry: '',
      targetField: 'Informatique',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an optional targetProgram', () => {
    const result = objectiveStepSchema.safeParse({
      targetCountry: 'France',
      targetField: 'Informatique',
      targetProgram: 'Master 2 Data Science',
    });
    expect(result.success).toBe(true);
  });
});

describe('cvAnswersSchema', () => {
  it('accepts a partial answers object with only one step', () => {
    const result = cvAnswersSchema.safeParse({
      identity: {
        fullName: 'Awa Ndiaye',
        email: 'awa@example.com',
        phone: '+221771234567',
        city: 'Dakar',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty object', () => {
    const result = cvAnswersSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects a step present but malformed', () => {
    const result = cvAnswersSchema.safeParse({ identity: { fullName: '' } });
    expect(result.success).toBe(false);
  });
});

describe('generatedCvSchema', () => {
  it('accepts a summary + sections shape', () => {
    const result = generatedCvSchema.safeParse({
      summary: 'Étudiante motivée en informatique.',
      sections: [{ title: 'Formation', bullets: ['Licence Informatique — UCAD (2021-2024)'] }],
    });
    expect(result.success).toBe(true);
  });
});
