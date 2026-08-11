import { describe, it, expect } from 'vitest';
import { checklistItemSchema, checklistSchema } from './checklist';

describe('checklistItemSchema', () => {
  it('accepts an item with id, title, and description', () => {
    const result = checklistItemSchema.safeParse({
      id: 'passeport-valide',
      title: 'Passeport en cours de validité',
      description: 'Valide au moins 6 mois après le départ.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an item without description', () => {
    const result = checklistItemSchema.safeParse({ id: 'cv-a-jour', title: 'CV à jour' });
    expect(result.success).toBe(true);
  });

  it('rejects an item missing id', () => {
    const result = checklistItemSchema.safeParse({ title: 'CV à jour' });
    expect(result.success).toBe(false);
  });
});

describe('checklistSchema', () => {
  it('accepts an array of valid items', () => {
    const result = checklistSchema.safeParse([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B', description: 'desc' },
    ]);
    expect(result.success).toBe(true);
  });
});
