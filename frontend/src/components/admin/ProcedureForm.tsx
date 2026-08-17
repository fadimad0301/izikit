// Shared create/edit form for admin/procedures/new and admin/procedures/[id].
// Does NOT import @/lib/server/slug (server-only) — reimplements a small
// client-side slugify purely as a UX suggestion for each checklist item's
// `id`; the id stays freely editable and is never sent as the procedure's
// own slug (that's derived server-side in POST /api/admin/procedures).
'use client';

import { useState, type FormEvent } from 'react';
import { Card, Input, Button } from '@/components/ui';

export interface ChecklistItemDraft {
  key: string; // client-only React key, stable across edits
  id: string;
  title: string;
  description: string;
  autoId: boolean; // true until the user manually edits `id`
}

export interface ProcedureFormValues {
  name: string;
  country: string;
  field: string;
  tagline: string;
  checklist: Array<{ id: string; title: string; description?: string }>;
}

interface ProcedureFormProps {
  initialValues?: ProcedureFormValues;
  submitLabel: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (values: ProcedureFormValues) => Promise<void>;
}

function clientSlugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `item_${keySeq}`;
}

function draftsFromInitial(initial?: ProcedureFormValues): ChecklistItemDraft[] {
  if (!initial || initial.checklist.length === 0) {
    return [{ key: nextKey(), id: '', title: '', description: '', autoId: true }];
  }
  return initial.checklist.map((item) => ({
    key: nextKey(),
    id: item.id,
    title: item.title,
    description: item.description ?? '',
    autoId: false,
  }));
}

export function ProcedureForm({
  initialValues,
  submitLabel,
  submitting,
  error,
  onSubmit,
}: ProcedureFormProps) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [country, setCountry] = useState(initialValues?.country ?? '');
  const [field, setField] = useState(initialValues?.field ?? '');
  const [tagline, setTagline] = useState(initialValues?.tagline ?? '');
  const [items, setItems] = useState<ChecklistItemDraft[]>(() => draftsFromInitial(initialValues));
  const [formError, setFormError] = useState<string | null>(null);

  function updateItem(key: string, patch: Partial<ChecklistItemDraft>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function onTitleChange(key: string, title: string) {
    setItems((prev) =>
      prev.map((it) =>
        it.key === key ? { ...it, title, id: it.autoId ? clientSlugify(title) : it.id } : it,
      ),
    );
  }

  function onIdChange(key: string, id: string) {
    updateItem(key, { id, autoId: false });
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      { key: nextKey(), id: '', title: '', description: '', autoId: true },
    ]);
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (name.trim().length === 0 || country.trim().length === 0 || tagline.trim().length === 0) {
      setFormError('Nom, pays et accroche sont obligatoires.');
      return;
    }
    if (items.length === 0) {
      setFormError('Ajoute au moins un élément de checklist.');
      return;
    }
    for (const item of items) {
      if (item.id.trim().length === 0 || item.title.trim().length === 0) {
        setFormError('Chaque élément de checklist doit avoir un identifiant et un titre.');
        return;
      }
    }
    const ids = items.map((it) => it.id.trim());
    if (new Set(ids).size !== ids.length) {
      setFormError('Les identifiants de checklist doivent être uniques.');
      return;
    }

    await onSubmit({
      name: name.trim(),
      country: country.trim(),
      field: field.trim(),
      tagline: tagline.trim(),
      checklist: items.map((it) => ({
        id: it.id.trim(),
        title: it.title.trim(),
        ...(it.description.trim() ? { description: it.description.trim() } : {}),
      })),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Card bordered className="flex flex-col gap-4">
        <Input
          label="Nom"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Campus France"
        />
        <Input
          label="Pays"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder="France"
        />
        <Input
          label="Domaine (optionnel)"
          value={field}
          onChange={(e) => setField(e.target.value)}
          placeholder="Master"
        />
        <Input
          label="Accroche"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="Étudie en France via Campus France."
        />
      </Card>

      <Card bordered className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-900">Checklist</h2>
          <Button type="button" variant="secondary" size="sm" onClick={addItem}>
            Ajouter un élément
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.key} className="rounded-xl border border-ink-900/10 p-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  label="Titre"
                  value={item.title}
                  onChange={(e) => onTitleChange(item.key, e.target.value)}
                  placeholder="Copie du passeport"
                  className="flex-1"
                />
                <Input
                  label="Identifiant"
                  value={item.id}
                  onChange={(e) => onIdChange(item.key, e.target.value)}
                  placeholder="passport"
                  helperText="Ne change pas cet identifiant après publication."
                  className="sm:w-48"
                />
              </div>
              <Input
                label="Description (optionnelle)"
                value={item.description}
                onChange={(e) => updateItem(item.key, { description: e.target.value })}
                className="mt-3"
              />
              <div className="mt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeItem(item.key)}
                >
                  Supprimer
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {(formError ?? error) && (
        <p role="alert" className="text-sm text-error-600">
          {formError ?? error}
        </p>
      )}

      <div>
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
