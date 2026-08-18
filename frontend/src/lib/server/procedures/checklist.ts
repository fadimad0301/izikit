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

// Lenient — used to re-parse already-persisted checklist JSON at read time
// (GET /api/procedures/[slug], /mine, [slug]/documents). Must accept
// whatever was legal to store historically, or a row seeded/saved before
// checklistWriteSchema below existed would start 500ing on every view.
export const checklistSchema = z.array(checklistItemSchema);

// Strict — used only at the admin create/edit write boundary (POST/PATCH
// /api/admin/procedures). Empty checklists and duplicate item ids were
// never desirable, but tightening the shared `checklistSchema` symbol
// directly once made it also reject pre-existing rows on read; keep the
// stricter rule on its own name instead.
export const checklistWriteSchema = checklistSchema
  .min(1)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
    message: 'checklist item ids must be unique',
  });
