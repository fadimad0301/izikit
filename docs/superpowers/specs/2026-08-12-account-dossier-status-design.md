# Doxi — Phase 6: Compte + statut dossiers — Design

## Contexte

Phases 1-5 ont livré l'auth, le CV builder IA, l'achat de procédures (tier Simple à
5000 FCFA), et le tier Complet (20 000 FCFA, upload de documents par item de checklist,
analyse IA du CV). `/settings` existe déjà (créé en Phase 1) mais n'a jamais été mis aux
couleurs Doxi — il reste 100% générique (gris brut, pas de tokens `ink-900`/`seal-gold`/
`paper-50`, pas de `Card`/`Badge`/`Stamp`). Il n'y a par ailleurs aucun endroit où un
utilisateur peut voir la liste de ce qu'il a acheté et où il en est. Le roadmap initial
(`docs/superpowers/plans/2026-08-09-procedure-checklist-payment.md`, esquisse Phase 6)
prévoyait : enrichir `/settings` avec des champs Doxi, et une première utilisation réelle
du composant `Stamp` (introduit en Phase 1, déjà utilisé pour le Hero et le CV wizard)
pour signaler un statut de dossier.

**Décisions confirmées (ne pas rediscuter) :**
1. Périmètre : restyle complet de `/settings` + nouvelle section « Mes procédures »
   listant les achats avec statut (pas une page `/dashboard` séparée — le roadmap dit
   explicitement d'étendre `/settings`, pas de le remplacer).
2. Champs profil ajoutés : nom complet + téléphone. Le nom est déjà en base
   (`User.name`, rempli par Google OAuth) mais jamais éditable pour les comptes
   email/mot de passe — il sert sur le CV généré, donc utile de le rendre éditable.
3. Téléphone : stockage simple, format E.164 validé via l'utilitaire déjà existant
   `zPhone` (`frontend/src/lib/server/zod-helpers.ts`, PROTÉGÉ — import seulement, pas
   de modification). Pas de vérification SMS/OTP (aucun provider câblé dans le starter,
   hors scope).
4. Correction incluse : le lien « Retour au dashboard » sur `/settings` pointe vers une
   page `/dashboard` qui n'a jamais existé (dead link depuis la Phase 1) — corrigé vers
   `/procedures` puisqu'on retouche cette page de toute façon.

**Fichiers protégés concernés (ne pas modifier, seulement consommer) :**
`frontend/src/lib/server/zod-helpers.ts` (import `zPhone`), `frontend/src/lib/api.ts`
(le nouveau code d'erreur `VALIDATION_FAILED` est déjà dans l'union élargie
`ApiErrorCode | (string & {}) | ''`, aucune modif nécessaire), `frontend/src/lib/server/
middleware/index.ts` (import `requireAuth`).

---

## 1. Modèle de données

**Modifier `frontend/prisma/schema.prisma`** — un seul champ ajouté sur `User` :

```prisma
model User {
  // ... champs existants inchangés ...
  phone             String?   // E.164, ex. "+221771234567" — non vérifié, saisie libre
  // ... relations existantes inchangées ...
}
```

Aucune autre table n'est nécessaire : le statut « Mes procédures » se dérive entièrement
des tables déjà existantes (`ProcedureAccess`, `ProcedureDocument`, `Procedure`).

Migration : `pnpm db:migrate:dev --name doxi_user_phone`.

---

## 2. API

### 2.1 `GET /api/auth/me` (existant, étendu)

Fichier : `frontend/src/app/api/auth/me/route.ts` (pas protégé, fair game).

Le `select` Prisma actuel n'inclut ni `name`, ni `avatarUrl`, ni (nouveau) `phone` — un
manque pré-existant qu'on corrige puisqu'on en a besoin côté client. Ajouter ces trois
champs au `select` et au shape `user` renvoyé :

```ts
const dbUser = await prisma.user.findUnique({
  where: { id: auth.user.sub },
  select: {
    id: true,
    email: true,
    name: true,
    avatarUrl: true,
    phone: true,
    emailVerifiedAt: true,
    createdAt: true,
    updatedAt: true,
    passwordHash: true,
    oauthAccounts: { select: { provider: true } },
  },
});

const user = {
  // ... champs existants inchangés ...
  name: dbUser?.name ?? null,
  avatarUrl: dbUser?.avatarUrl ?? null,
  phone: dbUser?.phone ?? null,
};
```

### 2.2 `PATCH /api/auth/me` (nouveau)

Même fichier — ajoute un handler `PATCH` à côté du `GET` existant. Suit exactement l'ordre
CSRF → auth établi par `change-password/route.ts` :

```ts
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) {
      csrfFail.headers.set('x-request-id', ctx.requestId);
      return csrfFail;
    }

    const auth = await requireAuth(req.headers.get('authorization'));
    if (auth instanceof NextResponse) {
      auth.headers.set('x-request-id', ctx.requestId);
      return auth;
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError('VALIDATION_FAILED', 400, ctx.requestId, 'Corps de requête invalide.');
    }

    const parsed = PatchMeBody.safeParse(raw);
    if (!parsed.success) {
      return jsonError('VALIDATION_FAILED', 400, ctx.requestId, 'Champs invalides.');
    }

    const data: Prisma.UserUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.phone !== undefined) {
      data.phone = parsed.data.phone === '' ? null : parsed.data.phone;
    }
    if (Object.keys(data).length === 0) {
      return jsonError('VALIDATION_FAILED', 400, ctx.requestId, 'Aucun champ à mettre à jour.');
    }

    const updated = await prisma.user.update({
      where: { id: auth.user.sub },
      data,
      select: { id: true, name: true, phone: true },
    });

    return NextResponse.json(
      { name: updated.name, phone: updated.phone },
      { status: 200, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
```

Schéma (au sommet du fichier, à côté des imports) :

```ts
import { zPhone } from '@/lib/server/zod-helpers';

const PatchMeBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: z.union([zPhone, z.literal('')]).optional(),
});
```

`jsonError` n'existe pas encore dans ce fichier — copier l'implémentation exacte de
`change-password/route.ts` (helper local, 6 lignes, pas de dépendance partagée à créer).

**Contrat :**
- Requête : `{ name?: string, phone?: string }` — au moins un champ, `phone: ""` efface le
  numéro.
- 200 : `{ name: string | null, phone: string | null }`.
- 400 `VALIDATION_FAILED` : corps invalide, `name` vide/trop long, `phone` mal formé, ou
  aucun champ fourni.
- 401 : non authentifié (via `requireAuth`).
- 403 CSRF : token manquant/invalide (via `verifyCsrf`).

### 2.3 `GET /api/procedures/mine` (nouveau)

Nouveau fichier : `frontend/src/app/api/procedures/mine/route.ts`.

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';
import { checklistSchema } from '@/lib/server/procedures/checklist';

interface MyProcedure {
  slug: string;
  name: string;
  country: string;
  field: string | null;
  tier: 'SIMPLE' | 'COMPLET';
  checklistTotal: number;
  documentsUploaded: number | null;
  grantedAt: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth(req.headers.get('authorization'));
    if (auth instanceof NextResponse) {
      auth.headers.set('x-request-id', ctx.requestId);
      return auth;
    }

    const accesses = await prisma.procedureAccess.findMany({
      where: { userId: auth.user.sub },
      orderBy: { grantedAt: 'desc' },
      select: {
        tier: true,
        grantedAt: true,
        procedureId: true,
        procedure: {
          select: { slug: true, name: true, country: true, field: true, checklist: true },
        },
      },
    });

    const completIds = accesses.filter((a) => a.tier === 'COMPLET').map((a) => a.procedureId);
    const counts =
      completIds.length > 0
        ? await prisma.procedureDocument.groupBy({
            by: ['procedureId'],
            where: { userId: auth.user.sub, procedureId: { in: completIds } },
            _count: { _all: true },
          })
        : [];
    const uploadedByProcedureId = new Map(counts.map((c) => [c.procedureId, c._count._all]));

    const result: MyProcedure[] = [];
    for (const access of accesses) {
      const parsedChecklist = checklistSchema.safeParse(access.procedure.checklist);
      if (!parsedChecklist.success) {
        // Une procédure au catalogue invalide ne doit pas cacher les autres achats
        // de l'utilisateur — on la saute (avec un log) plutôt que de faire échouer
        // toute la liste. Diverge volontairement du comportement fail-closed de
        // GET /api/procedures/[slug] (où la page entière EST cette procédure).
        log.warn('procedure checklist failed to validate — skipped from /mine list', {
          procedureId: access.procedureId,
          slug: access.procedure.slug,
        });
        continue;
      }
      const tier = access.tier as 'SIMPLE' | 'COMPLET';
      result.push({
        slug: access.procedure.slug,
        name: access.procedure.name,
        country: access.procedure.country,
        field: access.procedure.field,
        tier,
        checklistTotal: parsedChecklist.data.length,
        documentsUploaded:
          tier === 'COMPLET' ? (uploadedByProcedureId.get(access.procedureId) ?? 0) : null,
        grantedAt: access.grantedAt.toISOString(),
      });
    }

    return NextResponse.json(result, { status: 200, headers: { 'x-request-id': ctx.requestId } });
  });
}
```

**Contrat :**
- 200 : `MyProcedure[]`, triée par date d'achat décroissante. `[]` si aucun achat.
- 401 : non authentifié.
- Pas de CSRF (GET, lecture seule).

---

## 3. Frontend

### 3.1 `frontend/src/contexts/AuthContext.tsx` (pas protégé)

Le type `User` exposé par `useUser()` doit gagner `name: string | null`,
`avatarUrl: string | null`, `phone: string | null` pour refléter le `GET /api/auth/me`
étendu — sans quoi la page settings devrait refaire un fetch séparé pour obtenir le nom
courant à préremplir.

### 3.2 `frontend/src/app/settings/page.tsx` — restyle complet

Remplace les classes Tailwind grises brutes par les tokens Doxi et les composants
`Card`/`Badge`/`Stamp` de `@/components/ui`, avec le même fondu à l'entrée
(`framer-motion`, `useReducedMotion` de `frontend/src/lib/motion.ts`) que le reste des
pages authentifiées (ex. `/procedures`). Structure finale, dans l'ordre :

1. **En-tête** : « Paramètres », email de connexion (inchangé dans l'esprit, restylé).
2. **Section « Mon profil »** (nouvelle) : deux champs contrôlés (`name`, `phone`),
   préremplis depuis `useUser()`, un bouton Enregistrer. Appelle
   `api('/api/auth/me', {method:'PATCH', body:{name, phone}})`, toast succès/erreur
   (mappe `VALIDATION_FAILED` → message générique de champ invalide), puis
   `await refresh()` pour resynchroniser `useUser()`.
3. **Section mot de passe** (existante, inchangée en logique, restylée).
4. **Section comptes liés** (existante, inchangée en logique, restylée).
5. **Section « Mes procédures »** (nouvelle) : au montage, `api<MyProcedure[]>
   ('/api/procedures/mine')`. Par item, une `Card` :
   - En-tête : nom de la procédure + `Badge` tier (`gold` pour COMPLET, `neutral` pour
     SIMPLE — variantes déjà supportées par `Badge`).
   - Ligne de statut :
     - `tier === 'SIMPLE'` → texte « Débloqué ».
     - `tier === 'COMPLET' && documentsUploaded < checklistTotal` → texte
       « {documentsUploaded} / {checklistTotal} documents déposés ».
     - `tier === 'COMPLET' && documentsUploaded === checklistTotal && checklistTotal > 0`
       → « Dossier complet » + `<Stamp size={36} delay={0}>` à côté (delay à 0 car la
       liste peut contenir plusieurs items — pas de cascade d'animation décalée
       comme sur le Hero, qui n'a qu'un seul Stamp).
   - Lien vers `/procedures/{slug}` pour continuer/consulter.
   - État vide (`[]`) : texte « Tu n'as encore acheté aucune procédure. » + lien vers
     `/procedures`.
6. Lien de bas de page : `Retour au dashboard` → `/dashboard` **corrigé en**
   `Retour aux procédures` → `/procedures` (dead link corrigé, voir Contexte).

Pas de react-hook-form introduit ici : la page utilise déjà `useState` pour le formulaire
mot de passe, on garde le même pattern pour la nouvelle section profil plutôt que de
mélanger deux approches sur une même page.

### 3.3 Validation client (optionnelle, légère)

Pas de nouveau fichier de validation partagé : les deux champs sont simples (nom
non-vide, téléphone au format E.164 optionnel) et la page fait déjà de la validation
inline pour le formulaire mot de passe sans zod côté client — on reste cohérent avec ce
pattern local plutôt que d'introduire zod pour deux champs. Le serveur reste la source de
vérité (`VALIDATION_FAILED`).

---

## 4. Tests

- `frontend/src/app/api/auth/me/route.test.ts` (existant, étendu) : `GET` renvoie
  `name`/`avatarUrl`/`phone`. Nouveaux cas `PATCH` : CSRF manquant → 403, non
  authentifié → 401, mise à jour nom seul, téléphone seul, les deux, effacement du
  téléphone (`phone: ""` → `null` en base), rejets (`name` vide, `name` > 100
  caractères, `phone` mal formé, corps sans aucun champ).
- Nouveau `frontend/src/app/api/procedures/mine/route.test.ts` : non authentifié → 401,
  liste vide, une procédure SIMPLE (`documentsUploaded: null`), une procédure COMPLET
  incomplète, une procédure COMPLET complète, mix des deux triées par `grantedAt` desc,
  chemin défensif catalogue invalide (l'item invalide est absent du résultat, les autres
  restent présents — teste explicitement la divergence documentée avec
  `[slug]/route.ts`).
- Pas de test pour `/settings` (page composant) — aligné avec la convention du projet
  (aucune page n'a de test dédié, ex. `/procedures/[slug]/page.tsx`).

---

## Hors scope (explicitement)

- Vérification du téléphone par SMS/OTP.
- Suppression de compte / export de données (RGPD) — pas demandé pour cette phase.
- Rendre le catalogue public `/procedures` "auth-aware" (badges de possession sur la
  page catalogue) — la section statut vit uniquement sur `/settings` pour cette phase.
- Avatar upload (le champ `avatarUrl` existe déjà, rempli uniquement par Google OAuth —
  pas d'upload manuel ajouté ici).
- Une vraie page `/dashboard` — le lien mort est corrigé vers `/procedures`, pas
  remplacé par une nouvelle page.
