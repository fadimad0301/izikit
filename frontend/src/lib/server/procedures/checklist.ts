// Doxi Phase 5 — shared shape for one Procedure.checklist entry. The `id`
// is a stable slug assigned once in scripts/seed-procedures.ts and never
// derived from `title` at read time, so a later copy edit can't silently
// orphan a ProcedureDocument that references it via checklistItemId.
import { z } from 'zod';

export const checklistItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistSchema = z
  .array(checklistItemSchema)
  .min(1)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
    message: 'checklist item ids must be unique',
  });
