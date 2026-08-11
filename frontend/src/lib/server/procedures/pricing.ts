// Doxi Phase 5 — single source of truth for procedure pricing. Global and
// fixed across all procedures (confirmed design decision — not configurable
// per procedure). GET /api/procedures and GET /api/procedures/[slug] read
// these instead of Procedure.priceFcfa; the webhook's onPaid handler
// enforces payment amounts against these same constants.
export const PROCEDURE_SIMPLE_PRICE_FCFA = 5000;
export const PROCEDURE_COMPLET_PRICE_FCFA = 20000;
export const PROCEDURE_UPGRADE_PRICE_FCFA = 15000; // Simple -> Complet differential
