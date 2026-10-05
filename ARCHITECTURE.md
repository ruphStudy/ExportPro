# ExportPro — Architecture Foundation (Sprint 1)

AI-powered import/export intelligence and automation SaaS platform. This
document describes the foundation laid in Sprint 1, before any business
module (opportunities, CRM, costing, compliance, ...) exists.

## Monorepo layout

```
apps/web/      Next.js 16 (App Router, TypeScript, Tailwind v4) — frontend
apps/api/      NestJS (TypeScript, Prisma, PostgreSQL) — backend
packages/types/  Shared API contracts (DTOs, enums, response envelopes)
```

npm workspaces wire the three together; `@exportpro/types` is built to
`dist/` and consumed as a normal package by both apps so neither one
depends on the other's source directly.

## Tenant isolation

Every tenant is an `Organization`. Identity (`User`) is global — a
person can belong to several organizations — and tenant-scoped data
hangs off `Membership`, never off `User` directly. The rule for every
future business table: it carries an `organizationId` and every query
filters by it. `TenantGuard` (`apps/api/src/common/guards/tenant.guard.ts`)
is the extension point a future org-scoped controller attaches to; it
isn't registered globally yet because Sprint 1 has no org-scoped routes.

## Audit strategy

`AuditService` (`apps/api/src/modules/audit/audit.service.ts`) is the
single write path for the audit trail. A feature that mutates sensitive
data calls `auditService.record(...)` from its own service rather than
writing to `AuditLog` directly, so every audit entry has the same shape
regardless of which module produced it. No module calls it yet — there
is nothing sensitive to audit until Sprint 2 adds real mutations.

## API conventions

- Global prefix `/api/v1`, Swagger at `/api/docs`.
- Every response is `ApiSuccessResponse<T>` or `ApiErrorResponse` (see
  `packages/types/src/api.ts`), produced by `ResponseInterceptor` /
  `HttpExceptionFilter` — controllers never format responses by hand.
- Every request gets a correlation id (`RequestIdMiddleware`), echoed in
  `x-request-id` and in the response envelope.
- `AuthGuard` is registered globally; a route opts out with `@Public()`.
  Sprint 2 fills in real session/JWT verification — right now it fails
  closed for anything not marked public, which is why only `/health` is
  public.

## Responsive strategy (tables)

`DataTable` uses horizontal scroll on narrow viewports rather than a
separate mobile card layout, so there is one column set and one render
path. `Column.hideOnMobile` drops low-priority columns below `sm`
instead of switching layouts entirely.

## Known limitations (intentional, Sprint 1 scope)

- `Select` is a native `<select>`, not a searchable combobox — adequate
  for short lists; a searchable combobox is deferred until a module
  (e.g. country/product pickers) actually needs one.
- No chart library is installed; `ChartWrapper` is the slot a real chart
  renders into once an analytics module has real data to plot.
- `hasPermission()` (`apps/web/src/lib/permissions.ts`) always returns
  `true` — there is no RBAC yet. The call sites and data shape
  (`NavItem.permission`, decorators on the API side) are already wired
  so Sprint 2 only has to change this one function's body.
- The frontend session store is seeded with a hardcoded
  `FOUNDATION_SESSION` (`apps/web/src/lib/session-store.ts`) instead of
  being hydrated from the API — there is no login flow yet.

## What Sprint 2 builds on top of this

- Real authentication (replaces `AuthGuard`'s body and the frontend's
  seeded session).
- Organization onboarding/switching (uses the existing `Organization` /
  `Membership` models as-is).
- RBAC (replaces `hasPermission()`; `MembershipRole` already exists).
