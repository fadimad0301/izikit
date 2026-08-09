# Phase 4 — Sélection de procédure + checklist + paiement (Accompagnement Simple)

## Contexte

Doxi propose deux formules : **Accompagnement Simple** (5 000 FCFA) et **Accompagnement Complet**
(hors scope, Phase 5+). La formule Simple donne accès à une checklist de documents pour UNE
procédure choisie (ex. Campus France, Chevening, bourse Canada...). Cette phase branche cet achat
sur le flux de paiement Bictorys déjà existant (`POST /api/orders`, webhook `onPaid`) sans créer de
nouvelle route de paiement.

**Décisions confirmées avec le fondateur avant rédaction de ce spec :**
1. La formule Simple ne débloque qu'une checklist de documents — pas de génération IA de documents
   (réservée à la formule Complet, Phase 5+).
2. Les procédures et leurs checklists sont saisies via un script de seed codé en dur (4-5 procédures
   réelles reprises de la landing page) — pas d'interface admin CRUD pour cette phase.
3. L'accès post-paiement est matérialisé par un nouveau modèle `ProcedureAccess`, créé par le
   webhook au moment de la confirmation de paiement — pas de vérification ad hoc de `Order.metadata`
   à chaque accès.

## Architecture

Réutilisation maximale de l'existant : `POST /api/orders` (CSRF + auth + idempotency-key déjà en
place) reçoit `metadata: {tier: 'SIMPLE', procedureId}`. Le webhook Bictorys existant
(`app/api/webhooks/bictorys/route.ts`, fichier NON protégé, déjà pensé comme point d'extension)
crée le `ProcedureAccess` dans la même transaction Serializable que la mise à jour de statut de
`Order`. Aucune nouvelle route de paiement, aucun nouveau kind d'outbox (réutilisation de
`notification.payment_received` / `email.payment_confirmation`), aucun fichier protégé touché.

## Modèle de données

Deux nouveaux modèles dans `frontend/prisma/schema.prisma`, ajoutés après le modèle `Order`
existant (le modèle `Order` gagne uniquement un champ de relation inverse, pas de renommage) :

```prisma
model Procedure {
  id        String   @id @default(cuid())
  slug      String   @unique
  name      String // "Campus France", "Chevening", "Bourse Canada"...
  country   String
  field     String? // domaine si pertinent (ex. "Master", "Ingénierie")
  tagline   String // une phrase d'accroche pour la carte de sélection
  checklist Json // [{ title: string; description?: string }] — contenu statique révélé après achat
  priceFcfa Int      @default(5000)
  createdAt DateTime @default(now())

  access ProcedureAccess[]

  @@index([slug])
}

model ProcedureAccess {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  procedureId String
  procedure   Procedure @relation(fields: [procedureId], references: [id], onDelete: Restrict)
  orderId     String   @unique
  order       Order    @relation(fields: [orderId], references: [id], onDelete: Restrict)
  grantedAt   DateTime @default(now())

  @@unique([userId, procedureId])
  @@index([userId])
}
```

Sur `Order`, ajout du champ de relation inverse requis par Prisma :
```prisma
procedureAccess ProcedureAccess?
```
Sur `User`, ajout de la relation inverse :
```prisma
procedureAccess ProcedureAccess[]
```

**Pourquoi JSON pour la checklist et non une table relationnelle `ProcedureChecklistItem`** : le
contenu est statique et en lecture seule pour cette phase (pas de coche par item, pas de CRUD admin,
pas de tri/filtre par item). Une table à part n'apporterait aucune capacité utilisée avant la Phase
5+ (suivi coché/non-coché par utilisateur). YAGNI — si le suivi par item devient nécessaire, il sera
introduit avec son propre modèle (`UserChecklistProgress` ou équivalent) à ce moment-là, sans
migration destructrice du contenu `Procedure.checklist`.

**Pourquoi `ProcedureAccess.userId` est non-nullable** (contrairement à `Order.userId`, nullable au
niveau schéma pour un futur guest-checkout générique) : `POST /api/orders` exige déjà
`requireAuth()` dans son implémentation actuelle (commentaire code : "no guest checkout in v1"),
donc `order.userId` est garanti non-null en pratique pour toute commande créée par ce flux. Le
webhook peut donc lire `order.userId!` en toute sécurité au moment de créer le `ProcedureAccess`.

`@@unique([userId, procedureId])` rend la création idempotente : un replay de webhook ou une
double notification ne créera jamais deux accès pour le même utilisateur/procédure (upsert au lieu
d'un create qui échouerait).

## Seed

Nouveau script `frontend/scripts/seed-procedures.ts`, exécuté manuellement (`pnpm --filter frontend
exec tsx scripts/seed-procedures.ts`), pas branché sur un cron ni sur le boot de l'app. Contient 4-5
procédures réelles avec checklist rédigée à la main, cohérentes avec les pays/programmes déjà cités
sur la landing page (TrustBar). Upsert par `slug` pour être rejouable sans doublons.

## Intégration webhook

Dans `frontend/src/app/api/webhooks/bictorys/route.ts`, la fonction `onPaid(payload, tx)` :
1. Comportement actuel inchangé : mise à jour `Order` → `status: 'PAID'`, `paidAt`, enqueue des
   deux événements outbox existants.
2. **Ajout** : après la mise à jour de `Order`, si `order.metadata` contient
   `{tier: 'SIMPLE', procedureId: string}` (validation Zod légère inline, pas de nouveau module), et
   que `order.userId` est défini, `tx.procedureAccess.upsert({where: {userId_procedureId: {...}},
   create: {...}, update: {}})` dans la même transaction Serializable — l'octroi d'accès doit être
   atomique avec la confirmation de paiement, donc il ne passe PAS par l'outbox (l'outbox est pour
   les effets de bord asynchrones comme l'email, pas pour l'état transactionnel critique).
3. Si `procedureId` ne correspond à aucune `Procedure` existante, l'upsert échoue avec une erreur de
   contrainte de clé étrangère — logué et laissé remonter (le webhook `handler.ts` protégé gère déjà
   la capture d'erreur au niveau transaction ; ce cas ne devrait jamais se produire en pratique
   puisque `POST /api/orders` valide `procedureId` avant de créer la commande — voir routes
   ci-dessous).

## Routes API nouvelles

Toutes sous `frontend/src/app/api/procedures/`, `runtime = 'nodejs'` :

- **`GET /api/procedures`** — liste publique, pas d'auth requise. Retourne
  `{id, slug, name, country, field, tagline, priceFcfa}[]` — jamais `checklist` (contenu vendu).
- **`GET /api/procedures/[slug]`** — `optionalAuth()`. Cherche la `Procedure` par slug (404 si
  absente). Si utilisateur authentifié ET `ProcedureAccess` existe pour `(userId, procedureId)` :
  réponse inclut `checklist` et `hasAccess: true`. Sinon : `checklist` omis, `hasAccess: false`.
- **`GET /api/orders/[id]`** — `requireAuth()`. Retourne `{status, amount, currency, metadata}` pour
  la commande si `order.userId === auth.user.sub` (404 sinon, pour ne pas révéler l'existence d'une
  commande d'un autre utilisateur). Route générique au flux `Order`, pas spécifique aux procédures —
  c'est le point d'extension pour toute future page de confirmation de paiement, pas seulement
  Phase 4. Consommée par `/orders/[id]/success` et `/orders/[id]/failed` (voir ci-dessous) pour
  savoir, une fois arrivé sur la page de retour Bictorys, quelle procédure vient d'être payée et si
  le webhook a déjà traité le paiement (`status === 'PAID'`).

Modification de `POST /api/orders` : **aucune**, la route accepte déjà `metadata` librement. La
validation que `procedureId` existe avant de créer la commande se fait côté page (`fetch` du détail
procédure avant d'afficher le bouton payer) plutôt que dans la route générique `/api/orders`, qui
reste agnostique du domaine métier — cohérent avec son rôle de route de paiement générique
réutilisable.

## Écrans

- **`/procedures`** — grille de cartes (`Card` existant), une par procédure (nom, pays, tagline,
  prix formaté via `formatPrice`). Clique → `/procedures/[slug]`.
- **`/procedures/[slug]`** — détail. Si `hasAccess: false` : tagline, prix, bouton "Débloquer pour
  5 000 FCFA". Le clic génère une `Idempotency-Key` (`crypto.randomUUID()`), appelle `POST
  /api/orders` avec `{amount: priceFcfa, currency: 'XOF', metadata: {tier: 'SIMPLE', procedureId}}`,
  redirige vers `paymentUrl` retourné. Si `hasAccess: true` : affiche la checklist dans un
  `Accordion` existant.
- **Bandeau in-app browser** : avant le bouton de paiement, si `isInAppBrowser()` (déjà dans
  `lib/utils.ts`) retourne `true`, afficher un avertissement — "Pour un paiement mobile money sans
  problème, ouvre ce lien dans Chrome ou Safari" — car les webviews Instagram/TikTok cassent
  fréquemment les redirections Wave/Orange Money.
- **`/orders/[id]/success`** et **`/orders/[id]/failed`** — nouvelles pages (route dynamique par id,
  PAS query string) car `POST /api/orders` redirige réellement vers
  `${PUBLIC_URL}/orders/{id}/success` et `/failed` — les pages d'exemple
  (`examples/frontend-pages/payment-{success,failure}.tsx`) documentent une convention `/payment
  /success?o=` obsolète/erronée par rapport au code réel, donc elles ne sont pas réutilisées telles
  quelles. `success/page.tsx` appelle `GET /api/orders/[id]` côté client : si `status === 'PAID'` et
  `metadata.procedureSlug` présent, affiche une confirmation avec un lien direct vers
  `/procedures/{slug}` ; si `status === 'PENDING'` (webhook pas encore arrivé), affiche un message
  "confirmation en cours" avec un rafraîchissement automatique (`setInterval` court, arrêté dès que
  le statut change ou après quelques tentatives) plutôt qu'un état bloquant. `failed/page.tsx`
  affiche un message d'échec et un lien retour vers `/procedures/{slug}` pour réessayer (slug lu
  depuis `metadata.procedureSlug` via le même `GET /api/orders/[id]`).

  `metadata` transmis à `POST /api/orders` par la page `/procedures/[slug]` contient donc
  `{tier: 'SIMPLE', procedureId, procedureSlug}` — `procedureSlug` est dupliqué dans les métadonnées
  uniquement pour éviter un aller-retour supplémentaire depuis les pages de retour ; `procedureId`
  reste la clé utilisée par le webhook pour créer le `ProcedureAccess` relationnel.

## Hors scope (Phase 5+)

Génération IA de documents pour la formule Simple. CRUD admin des procédures. Suivi coché/non-coché
par item de checklist. Remboursement/annulation de `ProcedureAccess` sur `Order.status = REFUNDED`
(actuellement non géré — un remboursement Bictorys ne révoque pas l'accès ; acceptable pour le
lancement, à revisiter si les remboursements deviennent fréquents).

## Tests

- Modèle : migration Prisma appliquée proprement (`pnpm db:push` en dev), seed rejouable.
- `onPaid` : test couvrant la création de `ProcedureAccess` sur paiement réussi avec métadonnées
  `tier: 'SIMPLE'`, l'idempotence de l'upsert sur double webhook, et l'absence de création quand
  `metadata` ne contient pas `procedureId`.
- `GET /api/procedures/[slug]` : test des deux branches (avec/sans accès), 404 sur slug inconnu.
- `GET /api/procedures` : test de la forme de réponse (pas de fuite de `checklist`).
- `GET /api/orders/[id]` : test 404 quand la commande appartient à un autre utilisateur ou
  n'existe pas, test 200 avec `metadata` pour le propriétaire.
