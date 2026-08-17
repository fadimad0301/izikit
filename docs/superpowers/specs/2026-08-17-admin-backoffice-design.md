# Doxi — Phase 7: Admin back-office — Design

## Contexte

Phases 1-6 ont livré tout le parcours utilisateur (auth, CV builder IA, achat de
procédures Simple/Complet, upload de documents, compte). Un audit backend complet de
cette session a confirmé que le back-office reste celui du starter générique,
jamais adapté à Doxi :

- `GET /api/admin/orders` exclut `metadata` de son `select` — un admin ne peut pas voir
  quelle procédure/tier une commande concerne.
- Aucune route admin ne touche `Procedure`, `ProcedureAccess` ou `ProcedureDocument` — le
  catalogue de procédures ne peut être créé/édité qu'en modifiant
  `frontend/scripts/seed-procedures.ts` et en redéployant.
- Aucune page frontend `/admin/*` n'existe (seulement les références inutilisées dans
  `examples/frontend-pages/admin/`).
- Le système de retraits (`Withdrawal`, PIN, verrou avisoire) est une fonctionnalité du
  starter que Doxi ne déclenche jamais — Doxi ne verse jamais d'argent aux utilisateurs.

**Décisions confirmées (ne pas rediscuter) :**
1. Portée : visibilité support (commandes/dossiers d'un utilisateur) ET gestion du
   catalogue (créer/éditer des procédures), à parts égales.
2. Consultation des documents uploadés (passeport, relevés…) : ouverte à tout `ADMIN`,
   pas réservée à `SUPERADMIN` — mais chaque consultation reste tracée via
   `logAdminAction()`, l'audit remplaçant la restriction d'accès.
3. Gestion du catalogue : création **et** édition de procédures depuis l'admin — remplace
   le script de seed pour les opérations courantes (le script reste pour le seed initial /
   CI).
4. Une procédure peut être **archivée** (nouveau champ `isArchived`) plutôt que supprimée
   — la contrainte `onDelete: Restrict` sur `ProcedureAccess`/`ProcedureDocument` interdit
   de toute façon une vraie suppression dès qu'un achat existe.
5. Navigation : les achats/documents d'un utilisateur se consultent depuis sa fiche
   (`/admin/users/[id]`) — pas de vue séparée « par procédure » pour cette phase (YAGNI).
6. Le prix reste **non éditable par procédure** — constantes globales `pricing.ts`
   (décision actée en Phase 5), aucun champ prix dans les formulaires admin.
7. Pas d'écran « Retraits » — fonctionnalité du starter jamais utilisée par Doxi ; hors
   scope de cette phase (candidat à un pruning séparé, pas construit ni supprimé ici).

**Fichiers protégés concernés (ne pas modifier, seulement consommer) :**
`frontend/src/lib/server/middleware/index.ts` (import `requireAdmin`),
`frontend/src/lib/server/admin/audit.ts` (import `logAdminAction` — **tout** appelant
DOIT passer par lui, jamais `prisma.adminAction.create` direct),
`frontend/src/lib/server/slug.ts` (import `slugify`).

---

## 1. Modèle de données

**Modifier `frontend/prisma/schema.prisma`** — un seul champ ajouté sur `Procedure` :

```prisma
model Procedure {
  id          String   @id @default(cuid())
  slug        String   @unique
  name        String
  country     String
  field       String?
  tagline     String
  checklist   Json
  priceFcfa   Int      @default(5000)
  // Masque la procédure du catalogue public (GET /api/procedures) sans la
  // supprimer — les acheteurs existants (ProcedureAccess) gardent leur accès
  // intact. Une vraie suppression casserait onDelete:Restrict dès qu'un
  // achat existe ; l'archivage est le seul retrait possible.
  isArchived  Boolean  @default(false)
  createdAt   DateTime @default(now())

  access    ProcedureAccess[]
  documents ProcedureDocument[]

  @@index([slug])
}
```

**Modifier `frontend/src/app/api/procedures/route.ts`** (route publique existante) :
ajouter `isArchived: false` au `where` du `findMany`.

Migration : `pnpm db:migrate:dev --name doxi_procedure_archive`.

---

## 2. API

### 2.1 `GET /api/admin/orders` (existant, étendu)

Fichier : `frontend/src/app/api/admin/orders/route.ts`.

Ajouter `metadata: true` à `ORDER_SELECT`. `metadata` est déjà un `Json` contenant
`{tier, procedureId}` pour les commandes Doxi (posé par `POST /api/orders`) — aucun autre
changement de logique, c'est un ajout de champ pur.

### 2.2 `GET /api/admin/users/[id]` (existant, étendu)

Fichier : `frontend/src/app/api/admin/users/[id]/route.ts`.

Ajoute deux relations au `select` existant :

```ts
procedureAccess: {
  select: {
    tier: true,
    grantedAt: true,
    procedure: { select: { id: true, slug: true, name: true } },
  },
},
procedureDocuments: {
  select: {
    id: true,
    procedureId: true,
    checklistItemId: true,
    filename: true,
    mimeType: true,
    sizeBytes: true,
    uploadedAt: true,
  },
},
```

Pas d'URL signée dans cette réponse — la fiche liste les documents (nom, date, type), la
consultation du contenu passe par la route dédiée ci-dessous, à la demande.

### 2.3 `GET /api/admin/documents/[documentId]/url` (nouveau)

Nouveau fichier : `frontend/src/app/api/admin/documents/[documentId]/url/route.ts`.

```ts
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { getSignedDeliveryUrl } from '@/lib/server/upload/cloudinary-client';

const SIGNED_URL_TTL_SECONDS = 300;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { documentId } = await ctx.params;
    const doc = await prisma.procedureDocument.findUnique({
      where: { id: documentId },
      select: { id: true, userId: true, cloudinaryPublicId: true, resourceType: true },
    });
    if (!doc) {
      return NextResponse.json(
        { error: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const url = getSignedDeliveryUrl(doc.cloudinaryPublicId, doc.resourceType, expiresAt);

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'document.view',
      targetType: 'ProcedureDocument',
      targetId: doc.id,
      metadata: { ownerUserId: doc.userId },
    });

    return NextResponse.json(
      { url, expiresAt: new Date(expiresAt * 1000).toISOString() },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
```

Contrat : 200 `{url, expiresAt}` ; 404 `DOCUMENT_NOT_FOUND` si l'id n'existe pas ; 401/403
via `requireAdmin`. Même TTL (300s) que la route équivalente côté utilisateur
(`procedures/[slug]/documents/[itemId]/url/route.ts`, Phase 5) pour rester cohérent.

### 2.4 `GET`/`POST /api/admin/procedures` (nouveau)

Nouveau fichier : `frontend/src/app/api/admin/procedures/route.ts`.

- **`GET`** : liste paginée (pattern `clampLimit`/`cursorWhere`/`buildPage` de
  `pagination/paginate.ts`, identique à `admin/orders`), **sans** filtrer `isArchived`
  (l'admin doit voir les procédures archivées pour pouvoir les désarchiver). Select :
  `id, slug, name, country, field, tagline, isArchived, createdAt` (checklist exclue de la
  liste, trop volumineuse — récupérée seulement au détail).
- **`POST`** : crée une procédure.

```ts
const CreateBody = z.object({
  name: z.string().trim().min(1).max(200),
  country: z.string().trim().min(1).max(100),
  field: z.string().trim().min(1).max(100).optional(),
  tagline: z.string().trim().min(1).max(300),
  checklist: checklistSchema,
});
```

Slug généré via `slugify(parsed.data.name)` puis rendu unique via `ensureUniqueSlug`
(les deux importés de `frontend/src/lib/server/slug.ts`, protégé) :

```ts
const slug = await ensureUniqueSlug(
  slugify(parsed.data.name),
  (candidate) =>
    prisma.procedure.create({
      data: { ...parsed.data, slug: candidate },
      select: { id: true, slug: true },
    }),
);
```

`logAdminAction()` avec `action: 'procedure.create'`, `targetType: 'Procedure'`,
`targetId` = l'id créé. CSRF vérifié avant `requireAdmin` (route mutante).

### 2.5 `GET`/`PATCH /api/admin/procedures/[id]` (nouveau)

Nouveau fichier : `frontend/src/app/api/admin/procedures/[id]/route.ts`.

- **`GET`** : détail complet (y compris `checklist`), 404 `PROCEDURE_NOT_FOUND` si
  absent.
- **`PATCH`** : édite `name, country, field, tagline, checklist, isArchived` (tous
  optionnels, au moins un requis — même garde `Object.keys(data).length === 0` que
  `PATCH /api/auth/me`, Phase 6). **Jamais** `priceFcfa` ni `slug` (le slug ne change pas
  après création — un changement casserait les URLs déjà partagées/indexées).

```ts
const PatchBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  country: z.string().trim().min(1).max(100).optional(),
  field: z.string().trim().min(1).max(100).optional(),
  tagline: z.string().trim().min(1).max(300).optional(),
  checklist: checklistSchema.optional(),
  isArchived: z.boolean().optional(),
});
```

`logAdminAction()` avec `action: 'procedure.update'`, `metadata: { fields: Object.keys(data) }`
(pas les valeurs complètes — la checklist peut être volumineuse ; les noms de champs
modifiés suffisent pour l'audit).

---

## 3. Frontend — `/admin/*`

### 3.1 `frontend/src/app/admin/layout.tsx` (nouveau)

Adapté de `examples/frontend-pages/admin/layout.tsx` (gate `GET /api/admin/me`, redirige
vers `/` si non-admin), restylé aux tokens Doxi (`Card`, tokens `ink-900`/`seal-gold`,
police `font-serif` pour les titres — cohérent avec `/settings` et `/procedures`). Nav :

```
Utilisateurs · Commandes · Procédures · Journal d'audit
```

Pas d'entrée « Retraits » (voir décision confirmée #7).

### 3.2 Pages

| Fichier | Contenu |
|---|---|
| `admin/users/page.tsx` | Table paginée (recherche par email déjà supportée par `GET /api/admin/users` existant). |
| `admin/users/[id]/page.tsx` | Fiche : identité, rôle/statut, **section « Procédures achetées »** (tier, date, lien), **section « Documents »** (nom, date, bouton « Voir » → appelle `GET /api/admin/documents/[documentId]/url` à la demande, ouvre l'URL signée dans un nouvel onglet). |
| `admin/orders/page.tsx` | Table paginée, colonne « Procédure / Tier » dérivée de `metadata.procedureId`/`metadata.tier`. Le nom de procédure est résolu côté client : la page charge `GET /api/admin/procedures?limit=50` une fois au montage (catalogue de quelques procédures, une page suffit) et construit une `Map<id, name>` locale pour l'affichage — pas de join serveur supplémentaire. |
| `admin/procedures/page.tsx` | Table catalogue, badge « Archivée » si `isArchived`, bouton bascule archiver/désarchiver (PATCH direct), bouton « Nouvelle procédure ». |
| `admin/procedures/new/page.tsx` | Formulaire création : nom, pays, domaine, tagline, éditeur de checklist (liste dynamique d'items `{id, title, description?}`, `id` généré via `slugify(title)` côté client à titre de suggestion, éditable). |
| `admin/procedures/[id]/page.tsx` | Même formulaire, pré-rempli, PATCH au lieu de POST. |
| `admin/audit-log/page.tsx` | Liste paginée des `AdminAction` (route `GET /api/admin/audit-log` déjà existante — page jamais construite jusqu'ici). |

Aucun de ces fichiers n'existe aujourd'hui (vérifié : `find frontend/src/app -iname "*admin*"`
ne retourne que les routes API).

---

## 4. Tests

- `admin/procedures/route.test.ts` (nouveau) : liste (vide, paginée, inclut les
  archivées), création (succès, slug dupliqué → suffixe `-2`, validation checklist
  invalide → 400, `logAdminAction` appelé), gate `requireAdmin`.
- `admin/procedures/[id]/route.test.ts` (nouveau) : détail (200, 404), édition (champ
  seul, plusieurs champs, `isArchived` seul, corps vide → 400, `priceFcfa`/`slug` non
  acceptés même si envoyés — `z.object` sans `.passthrough()` les ignore silencieusement,
  test explicite que la valeur en base ne change pas), `logAdminAction` appelé.
- `admin/documents/[documentId]/url/route.test.ts` (nouveau) : 404 sur id inconnu, 200 +
  URL signée sur id valide, `logAdminAction` appelé avec `action: 'document.view'`, gate
  `requireAdmin`.
- `admin/orders/route.test.ts` (existant, étendu) : la réponse inclut désormais
  `metadata`.
- `admin/users/[id]/route.test.ts` (existant, étendu) : la réponse inclut
  `procedureAccess` et `procedureDocuments`.
- `procedures/route.test.ts` (existant, étendu) : une procédure `isArchived: true` est
  absente du catalogue public.
- Pas de test de page — convention déjà établie (aucune page de l'app n'a de test dédié).

---

## Hors scope (explicitement)

- Écran/route « Retraits » côté admin — fonctionnalité jamais utilisée par Doxi.
- Vue « par procédure » listant tous ses acheteurs — YAGNI pour cette phase, la fiche
  utilisateur suffit.
- Suppression réelle d'une procédure — impossible avec `onDelete: Restrict` dès qu'un
  achat existe ; l'archivage est la seule opération de retrait.
- Édition du prix par procédure — reste géré par les constantes globales `pricing.ts`.
- Restriction de la consultation des documents à `SUPERADMIN` — tout `ADMIN` y a accès,
  seule la traçabilité (`logAdminAction`) distingue cette action.
- Correctifs des dettes techniques identifiées par l'audit (validation serveur du montant
  de commande, rate-limit sur l'upload de documents, notifications/emails génériques non
  francisés) — hors périmètre de cette phase, à traiter séparément.
