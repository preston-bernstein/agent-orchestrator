# Deterministic Architecture Rules

This repo applies deterministic placement and boundary rules to reduce ambiguity.

## File placement

- Shared exported interfaces/types for a family live in `types.ts`.
- Runtime validators live in `schema.ts`.
- Pure helper functions live in `utils/*.ts`.
- IO edges (fs/network/process/db) live in `adapters/*.ts`.
- Family public surface is `index.ts`.

## Utility rules

- `utils/*.ts` must stay pure and must not import from `adapters/`.
- If helper logic is reused in 2+ places or tested independently, move it to `utils/`.
- One-off helpers can remain private to a module.

## Enforcement scope

Enforcement now scans all `src/**/*.ts`.

- Exported interfaces/types must live in `types.ts` (or `schema.ts` / `*.schema.ts`).
- Existing legacy exceptions are tracked in `docs/architecture/allowlist.json`.
- New files are expected to follow placement rules by default.

## Boundary rule

- Cross-family deep imports are discouraged; consume family entrypoints/types where available.
- In pilot families, types are imported from local `types.ts` for deterministic placement.
