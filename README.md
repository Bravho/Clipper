# Clipper Platform — Phase 2A: Auth / Account Module

A clean, production-minded authentication and account foundation for the Clipper managed short-video production platform.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment variables
cp .env.example .env.local
# Fill in NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

# 3. Start the dev server
npm run dev

# 4. Run tests
npm test
```

App runs at: http://localhost:3000

---

## Test Accounts (Mock Data)

| Role      | Email                     | Password      |
|-----------|---------------------------|---------------|
| Requester | user@example.com          | password123   |
| Staff     | staff@clipper.internal    | staffpass123  |
| Admin     | admin@clipper.internal    | adminpass123  |

Seed data is loaded automatically on first access from `src/seed/mockData.ts`.

---

## Architecture Overview

```
src/
├── app/                    # Next.js App Router pages and API routes
│   ├── (public)/           # Unauthenticated pages (home, login, signup, legal)
│   ├── (auth)/             # Protected pages (dashboard, staff, admin, account)
│   ├── api/auth/           # NextAuth handler
│   └── api/register/       # Email registration endpoint
├── components/
│   ├── ui/                 # Primitive UI components (Button, Input, Card, etc.)
│   └── layout/             # Navbar, Footer
├── features/auth/          # Auth-specific components and validation
│   ├── components/         # LoginForm, SignupForm, GoogleSignInButton, etc.
│   └── validation/         # Zod schemas (loginSchema, signupSchema)
├── services/               # Business logic layer
│   ├── AccountService.ts   # Account creation orchestrator
│   ├── AuthService.ts      # Credential verification + OAuth user resolution
│   ├── CreditService.ts    # Credit wallet management
│   └── ConsentService.ts   # Legal policy acceptance
├── repositories/
│   ├── interfaces/         # TypeScript contracts (IUserRepository, etc.)
│   ├── mock/               # In-memory implementations (development)
│   └── index.ts            # Repository registry — swap here for PostgreSQL
├── domain/
│   ├── models/             # Core domain types (User, AuthIdentity, CreditWallet, etc.)
│   └── enums/              # Role, AuthProvider, TransactionType, PolicyType
├── lib/auth/               # Auth helpers (requireAuth, requireRole, getCurrentUser)
├── types/                  # Shared types + NextAuth type augmentation
├── config/                 # Credits config, policy versions, routes
└── seed/                   # Mock seed data for development
```

---

## Auth Flow

### Email / Password Registration
```
SignupForm (client)
  → POST /api/register
    → Zod validation
    → AccountService.createRequesterAccount()
      → userRepository.create()
      → authIdentityRepository.create()  (stores bcrypt hash)
      → CreditService.initialiseRequesterWallet()  (grants 30 credits)
      → ConsentService.recordConsents()  (records 4 policy acceptances)
    → 201 Created
  → signIn('credentials', { redirect: false })  [auto login]
  → redirect to /dashboard
```

### Email / Password Login
```
LoginForm (client)
  → signIn('credentials', { redirect: false })
    → NextAuth Credentials provider
      → AuthService.verifyCredentials()
        → userRepository.findByEmail()
        → authIdentityRepository.findCredentialsByUserId()
        → bcrypt.compare()
      → returns User or null
    → JWT callback: adds id, role, provider to token
    → Session callback: transfers to session.user
  → getSession() → read role → redirect to role home
```

### Google OAuth
```
GoogleSignInButton (client)
  → signIn('google')
    → Google OAuth redirect
    → NextAuth signIn callback
      → AuthService.findOrCreateGoogleUser()
        → If new: AccountService.createRequesterAccount()
      → JWT callback: enriches token with Clipper user data
  → redirect to callbackUrl (/dashboard)
```

### Route Protection
```
Middleware (middleware.ts)
  → withAuth() checks JWT exists
  → Unauthenticated → redirect to /login
  → Authenticated → role check:
      /admin → Admin only
      /staff → Staff or Admin
      /dashboard → Requester only
      /account → Any authenticated user
  → Wrong role → redirect to user's correct home
```

---

## Session

Session strategy: **JWT** (no database session table).

The JWT token contains:
- `id` — user UUID
- `email` — user email
- `name` — display name
- `role` — `requester | staff | admin`
- `provider` — `credentials | google`

Session expires after 30 days.

---

## Credit System

Business rules:
- Every new requester account receives **30 free credits** on signup.
- Credits are granted via `CreditService.initialiseRequesterWallet()`.
- The `initialCreditsGranted` flag on `CreditWallet` prevents double-grants.
- Each credit event is recorded as an immutable `CreditTransaction`.
- Staff and Admin accounts do not receive credit wallets.

---

## Legal Consent

At signup, users must accept all four policies:

| Policy | Type constant |
|--------|--------------|
| Terms of Service | `PolicyType.TermsOfService` |
| Ownership and Usage Rights | `PolicyType.OwnershipRights` |
| Privacy Policy | `PolicyType.PrivacyPolicy` |
| Storage and Retention | `PolicyType.StorageRetention` |

Each acceptance is recorded in `TermsAcceptance` with:
- `policyVersion` (e.g. `"1.0.0"`)
- `acceptedAt` timestamp
- `ipAddress`, `userAgent` (null in Phase 2A, populated in production)

To update a policy: bump the version in `src/config/policyVersions.ts` and implement re-acceptance flow at login.

---

## Replacing Mock Repositories with PostgreSQL

**Step 1:** Create PostgreSQL-backed implementations in `src/repositories/postgres/`:

```typescript
// src/repositories/postgres/PostgresUserRepository.ts
import { IUserRepository } from "@/repositories/interfaces/IUserRepository"
import { db } from "@/lib/db"  // your DB client (Drizzle, Prisma, Kysely)

export class PostgresUserRepository implements IUserRepository {
  async findByEmail(email: string) {
    return db.query.users.findFirst({ where: eq(users.email, email) })
  }
  // ... implement all methods
}
```

**Step 2:** Swap imports in `src/repositories/index.ts`:

```typescript
// BEFORE (mock)
import { MockUserRepository } from "./mock/MockUserRepository"
export const userRepository = new MockUserRepository()

// AFTER (PostgreSQL)
import { PostgresUserRepository } from "./postgres/PostgresUserRepository"
export const userRepository = new PostgresUserRepository()
```

That's it. Services and pages do not change.

**Step 3:** For atomic operations (account creation involves multiple writes), wrap in a database transaction:

```typescript
// AccountService.createRequesterAccount()
// TODO: PostgreSQL — wrap in db.transaction()
await db.transaction(async (tx) => {
  const user = await tx.insert(users).values(...).returning()
  await tx.insert(authIdentities).values(...)
  // etc.
})
```

---

## Environment Variables

See `.env.example` for all required variables.

Required for development:
```
NEXTAUTH_SECRET=       # Generate: openssl rand -base64 32
NEXTAUTH_URL=          # http://localhost:3000
GOOGLE_CLIENT_ID=      # From Google Cloud Console
GOOGLE_CLIENT_SECRET=  # From Google Cloud Console
```

For Google OAuth, configure your OAuth consent screen at:
https://console.developers.google.com

Add authorised redirect URI:
`http://localhost:3000/api/auth/callback/google`

---

## Running Tests

```bash
npm test              # Run all tests
npm test -- --watch   # Watch mode
npm test -- --coverage # Coverage report
```

Test files are in `tests/` and use isolated fresh repositories
(not the global singleton stores) for clean, independent test runs.

---

## HOW THIS AUTH / ACCOUNT MODULE PREPARES FOR THE NEXT CLIPPER MODULES

### Requester Request Submission (Phase 2B)
- `AccountService.getAccountProfile()` provides the user context needed to display credits before submission.
- `CreditService.hasEnoughCredits()` and `CreditService.deductCredits()` are ready for the request submission flow.
- `requireRole(Role.Requester)` in the submission page will protect the route automatically.
- The `referenceId` field on `CreditTransaction` is pre-designed to link to `clip_requests.id`.

### Requester Dashboard (Phase 2B)
- The `/dashboard` placeholder is already auth-protected and role-gated.
- `session.user.id` is available in all server components to query the user's requests.
- Credits balance is already fetched and displayed.

### Staff Workflow (future)
- `/staff` is auth-protected and role-gated to `[Role.Staff, Role.Admin]`.
- `requireRole(Role.Staff, Role.Admin)` can be used on any staff API route.
- The staff placeholder page is ready to receive request queue components.

### Admin Workflow (future)
- `/admin` is auth-protected to `Role.Admin` only.
- Admin can access `/staff` too (middleware allows it).
- All user/credit/consent repositories are accessible from admin services.

### Queue and Due-Date System (future)
- Plugs into the protected route structure with no auth changes needed.
- A `QueueRepository` and `QueueService` follow the same pattern as existing repos/services.

### DigitalOcean Spaces Upload Flow (future)
- Add `DO_SPACES_*` variables to `.env.local` (already listed in `.env.example`).
- Implement a `StorageService` using the Spaces S3-compatible API.
- The `referenceId` on `CreditTransaction` links uploads to requests.
- Raw files are tagged with `userId` from `session.user.id` for the 90-day retention policy.

### PostgreSQL Integration (future)
- See "Replacing Mock Repositories with PostgreSQL" section above.
- All services are decoupled from persistence — only `src/repositories/index.ts` needs updating.
- Suggested tables: `users`, `auth_identities`, `credit_wallets`, `credit_transactions`, `terms_acceptances`, `policy_versions`.
- Add a session table if switching NextAuth from JWT to database sessions.

### Subcontractor / Clipper Agent Service (future)
- The `Role` enum can be extended with `ClipperAgent` without breaking existing code.
- A new `/agent` route group follows the same auth-protection pattern.
- The `AuthIdentityRepository` supports multiple providers per user — ready for agent-specific auth.
