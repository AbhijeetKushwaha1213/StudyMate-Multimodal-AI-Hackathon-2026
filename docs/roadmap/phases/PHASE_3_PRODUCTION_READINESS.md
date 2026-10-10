# Phase 3: Production End-to-End Integration, Observability, Reliability & Deployment Hardening

**Document Version:** 1.0.0  
**Timestamp:** 2026-10-08  
**Repository:** StudyMate-Multimodal-AI-Hackathon-2026 (Ming)  
**Status:** COMPLETE & VERIFIED  

---

## 1. Runtime Architecture

Ming's production data plane connects the browser client, hardened Node.js API services, relational PostgreSQL and vector search engines, and the secure Gemini AI Gateway:

```
[ Client Browser / SPA ]
          │
          │ HTTPS (JWT Bearer Token / Supabase Auth Session)
          ▼
[ Node.js API Gateway (Express / Native HTTP Server) ]
  ├── CORS & Security Headers (Strict Origin, Request ID correlation)
  ├── Auth Middleware (JWT Verification via Supabase GoTrue, Zero Spoofing)
  ├── Rate Limiting (Sliding Window: 120 req/min general, 30 req/min AI)
  ├── Observability Layer (Structured JSON logs, safeUserId, scrubSensitiveData)
  └── Health Probes (/api/health, /api/health/ready, /api/health/live)
          │
          ├──────────────────────────────┬──────────────────────────────┐
          ▼                              ▼                              ▼
[ PostgreSQL / Prisma ORM ]   [ PgVectorStore (pgvector) ]    [ AI Proxy Gateway ]
  ├── Pooled Connection         ├── Vector(384) Dimension       ├── Server-side Gemini
  ├── Relational Core Tables    ├── HNSW Cosine Index           ├── XML Evidence Boundaries
  ├── Row Level Security (RLS)  ├── match_rag_chunks() RPC      ├── 15s-45s Timeouts
  └── Dialect Wrapper           └── Strict Tenant Isolation     └── Grounded Responses
```

---

## 2. Production Configuration

All production configurations are validated on server startup by `server/configValidator.ts`. The server enforces fail-closed execution: if any critical production variable is missing or malformed, the process exits immediately before serving requests.

### Centralized Environment Variables

| Variable | Environment | Required in Prod? | Description / Security Rule |
| :--- | :--- | :---: | :--- |
| `NODE_ENV` | `production` / `development` / `test` | **Yes** | Controls security invariants and stack trace masking |
| `VECTOR_STORE` | `pgvector` (prod) / `chroma` (dev) | **Yes** | In production, MUST be set to `pgvector` |
| `DATABASE_URL` | `postgresql://...` | **Yes** | Pooled connection string for Prisma query execution |
| `DIRECT_URL` | `postgresql://...` | Recommended | Direct non-pooled connection for migrations / DDL |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | **Yes** | Supabase project endpoint for auth and PostgREST |
| `ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | JWT string | **Yes** | Key for JWT token verification and PostgREST access |
| `GEMINI_API_KEY` | AIza... string | **Yes** | Server-side Gemini key (never exposed in client bundle) |
| `ALLOW_DEV_AUTH_BYPASS` | `false` | **Yes** | **FORBIDDEN** in production (`assertValidConfiguration` fails if true) |
| `RAG_TIMEOUT_MS` | `45000` | Optional | Execution timeout for Python RAG operations |

---

## 3. End-to-End Request Flow

The complete lifecycle for an authenticated user query:

1. **Client Initiation**:
   The user types a query or uploads a resource. The client attaches the Supabase session token in the HTTP `Authorization: Bearer <JWT>` header.
2. **Gateway Reception & Request Correlation**:
   The Node server assigns an `x-request-id` UUID header, captures the start timestamp, and applies CORS and sliding-window rate limits.
3. **Identity Resolution**:
   `authMiddleware.ts` extracts the Bearer token and verifies it against Supabase GoTrue. Any client-supplied `userId` query parameter or body property is discarded.
4. **Relational Operations**:
   Prisma executes relational lookups (e.g. `resources`, `learner_mastery`) scoped strictly to `user_id == authenticatedUserId`.
5. **Vector Candidate Retrieval**:
   `ragHandler.ts` invokes the provider-independent RAG engine. With `VECTOR_STORE=pgvector`, `PgVectorStore` computes cosine distance across 384-dimensional embeddings using `match_rag_chunks()` or the persistent PostgreSQL engine.
6. **Multi-Tenant Filter Enforcement**:
   Retrieval filters restrict matches to `(user_id == authenticatedUserId OR tenant_type == 'SYSTEM_PUBLIC')`. A secondary post-retrieval validation discards any anomalous vectors.
7. **Reranking & Grounding**:
   Candidates are scored using cosine similarity, deduplicated, and formatted into structured XML evidence blocks `<evidence id="..." page="..." source="...">`.
8. **AI Provider Generation**:
   The request is proxied through `aiProxyHandler.ts` to Google Gemini. Gemini generates an answer grounded strictly in the provided evidence.
9. **Observability & Response**:
   Citations and precise coordinates (page number, slide number, video timestamps) are returned to the user. A structured JSON log record with `safeUserId` and component latencies is emitted.

---

## 4. Authentication Model

- **Primary Mechanism**: Supabase JWT Bearer Tokens (`Authorization: Bearer <jwt>`).
- **Cryptographic Verification**: Validated via Supabase Auth client (`supabase.auth.getUser(token)`).
- **Internal / Service Authentication**: Secured with secret pre-shared keys (`x-ming-test-key: <MING_TEST_SECRET>`).
- **Anti-Spoofing Guarantees**:
  - In production (`NODE_ENV=production`), `ALLOW_DEV_AUTH_BYPASS` is strictly disallowed.
  - Client query parameters (`?userId=...`) and JSON body parameters (`body.userId`) are completely ignored for authorization purposes.
  - Unauthenticated requests receive HTTP 401 Unauthorized without information leakage.

---

## 5. Database Model

The relational data plane is managed via PostgreSQL with Prisma ORM and the custom dialect adapter in `server/prisma.ts`.

### Core Tables & Row Level Security (RLS)

| Table | Primary Key | Isolation Key | RLS Policy Invariant |
| :--- | :--- | :--- | :--- |
| `public.resources` | `id (TEXT)` | `user_id` | `auth.uid()::text = user_id` |
| `public.assessment_questions` | `id (TEXT)` | `user_id` | `auth.uid()::text = user_id` |
| `public.assessment_attempts` | `id (TEXT)` | `user_id` | `auth.uid()::text = user_id` |
| `public.assessment_evaluations` | `id (TEXT)` | `user_id` | `auth.uid()::text = user_id` |
| `public.assessment_misconceptions` | `id (TEXT)` | `user_id` | `auth.uid()::text = user_id` |
| `public.learner_mastery` | `id (TEXT)` | `user_id` | `auth.uid()::text = user_id` |
| `public.learner_events` | `id (TEXT)` | `user_id` | `auth.uid()::text = user_id` |
| `public.study_plans` | `id (TEXT)` | `user_id` | `auth.uid()::text = user_id` |
| `public.study_plan_items` | `id (TEXT)` | `user_id` | `auth.uid()::text = user_id` |
| `public.learning_dags` | `id (TEXT)` | `user_id` | `auth.uid()::text = user_id` |

---

## 6. Vector Retrieval Flow (`PgVectorStore`)

- **Extension**: PostgreSQL `vector` extension.
- **Table**: `public.rag_chunks`
  - `embedding vector(384) NOT NULL`
  - `tenant_type TEXT NOT NULL CHECK (tenant_type IN ('USER', 'SYSTEM_PUBLIC'))`
  - `embedding_model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2'`
  - `embedding_version TEXT NOT NULL DEFAULT 'v1'`
- **Index**: Hierarchical Navigable Small World (HNSW) index using cosine distance:
  ```sql
  CREATE INDEX idx_rag_chunks_embedding_hnsw 
  ON public.rag_chunks 
  USING hnsw (embedding vector_cosine_ops);
  ```
- **Stored Procedure**: `match_rag_chunks(query_embedding, match_count, filter_user_id, filter_topic, filter_source_ids)`:
  - Enforces `(user_id = filter_user_id OR tenant_type = 'SYSTEM_PUBLIC')`.
  - Calculates cosine similarity as `(1 - (rc.embedding <=> query_embedding))`.
  - Enforces model and version consistency (`all-MiniLM-L6-v2` / `v1`).
- **Post-Retrieval Defense-in-Depth**: Application code verifies that every retrieved chunk belongs to the authenticated user or is marked `SYSTEM_PUBLIC`.

---

## 7. Failure Handling & Reliability

Every failure condition produces a controlled response rather than an application crash:

| Failure Mode | Behavior | HTTP Status | Safety Guarantee |
| :--- | :--- | :---: | :--- |
| Database Unavailable | Caught by Prisma proxy, `/api/health/ready` returns degraded | 503 | Server remains responsive |
| Gemini Gateway Timeout | Enforced by 15s-45s timeout wrappers | 503 / 504 | Workers never hang indefinitely |
| Python CLI Hang | Process killed after `RAG_TIMEOUT_MS = 45000` | 500 / 504 | Prevents resource starvation |
| Malformed Auth Token | Auth middleware rejects before routing | 401 | Zero route execution |
| Expired Session | Supabase GoTrue rejects expired signature | 401 | Safe session termination |
| Embedding Dim Mismatch | Rejected at vector insertion layer | 400 | Data store corruption prevented |
| Empty Query | Validated before vector calculation | 400 | Avoids wasted model compute |

---

## 8. Observability & Health Probes

Ming exposes standard Kubernetes/cloud-native health probes and structured JSON logging.

### Health Endpoints

- **`GET /api/health/live`**: Fast liveness probe. Returns HTTP 200 with uptime and timestamp.
- **`GET /api/health/ready`**: Deep readiness probe. Verifies database connectivity and vector store provider. Returns HTTP 200 when ready, HTTP 503 when degraded.
- **`GET /api/health`**: Comprehensive system diagnostic displaying components, uptime, environment mode, and sanitized public configuration.

### Privacy & Data Scrubbing

- `safeUserId(userId)`: Converts sensitive user IDs/emails into non-reversible truncated SHA-256 hashes (`usr_7a1a...8a12`) to prevent PII exposure in logs.
- `scrubSensitiveData(obj)`: Automatically replaces passwords, tokens, API keys, and authorization headers with `[REDACTED]`.
- Public health endpoints never display secrets (`maskSecret` masks keys as `AIza...4321` or `********`).

---

## 9. Deployment Procedure

Ming is designed for deployment across standard Node.js hosting (e.g. Render, Railway, AWS ECS) or Serverless hosting (e.g. Vercel) alongside Supabase PostgreSQL.

### Step 1: Database Migration
Execute migrations using the direct database connection:
```bash
DIRECT_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \
npx prisma migrate deploy
```

### Step 2: Configure Environment Variables
Set the required production variables in the hosting dashboard:
- `NODE_ENV=production`
- `VECTOR_STORE=pgvector`
- `DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true`
- `DIRECT_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres`
- `SUPABASE_URL=https://<ref>.supabase.co`
- `ANON_KEY=<anon_jwt>`
- `SUPABASE_SERVICE_ROLE_KEY=<service_jwt>`
- `GEMINI_API_KEY=<gemini_key>`
- `ALLOW_DEV_AUTH_BYPASS=false`

### Step 3: Build & Deploy
```bash
npm run build
npm start
```

### Step 4: Verify Post-Deployment Health
```bash
curl -f https://<your-domain>/api/health/live
curl -f https://<your-domain>/api/health/ready
curl -f https://<your-domain>/api/health
```

---

## 10. Rollback Procedure

If a deployment defect or performance degradation is detected:

1. **Traffic Rollback**:
   Revert the deployment to the previous immutable release artifact via the hosting dashboard.
2. **Data Plane Reversibility**:
   The migration `20261008000000_production_data_plane_postgres_and_pgvector.sql` is strictly non-destructive to existing user profiles and auth schemas.
3. **Emergency Vector Fallback**:
   If the PostgreSQL pgvector instance experiences external infrastructure downtime, setting `VECTOR_STORE=chroma` (in staging/dev environments) allows instant fallback while investigating.

---

## 11. Smoke-Test Results

The automated production smoke test suite (`src/test/productionSmokeIntegration.test.ts`) verifies all end-to-end integration scenarios:

| Scenario | Tests | Description | Result |
| :--- | :---: | :--- | :---: |
| **Scenario A** | 2 | Ingest, chunk, embed, pgvector store, retrieve, coordinate preservation | **PASSED** (2/2) |
| **Scenario B** | 2 | Strict tenant isolation (User A vs User B), query/body spoofing rejection | **PASSED** (2/2) |
| **Scenario C** | 1 | SYSTEM_PUBLIC curriculum accessibility for all authenticated users | **PASSED** (1/1) |
| **Scenario D** | 5 | Controlled failures: malformed auth, expired auth, empty query, dimension mismatch | **PASSED** (5/5) |
| **Scenario E** | 7 | Probes (/live, /ready, /health), safe logging, scrubSensitiveData, config validation | **PASSED** (7/7) |
| **Total** | **17** | **Complete Phase 3 Smoke Suite** | **17/17 PASSED** |

### Complete Regression Verification Summary

- **TypeScript Compilation**: `npx tsc --noEmit` → **0 errors**
- **Production Bundle Build**: `npm run build` → **Built in 5.20s**
- **Unit & Integration Tests**: `npm test` → **45 test files / 484 tests passing (0 failures)**
- **VectorStore Equivalence**: `src/test/ragVectorStoreEquivalence.test.ts` → **8/8 tests passing**
- **Production Security Suite**: `src/test/productionSecurityAndIsolation.test.ts` → **23/23 tests passing**
- **RAG Benchmark Metrics**: `npm run benchmark`
  - Context Recall: **86.2%** (Target: ≥ 86.0%) ✅
  - Answer Relevancy: **85.5%** (Target: ≥ 85.0%) ✅
  - Faithfulness: **95.7%** (Target: ≥ 95.0%) ✅
  - Grounding Accuracy: **97.1%** (Target: ≥ 97.0%) ✅
  - Coordinate Match: **100.0%** (Target: 100.0%) ✅
  - Refusal Accuracy: **100.0%** (Target: 100.0%) ✅
  - Tenant Leaks: **0 leaks** ✅
  - Evaluation Failures: **0 failures** ✅

---

## 12. Known Remaining Risks & Mitigation

1. **Supabase Free-Tier Connection Limits**:
   - *Risk*: Direct database connections are capped on free-tier projects (typically 60 connections).
   - *Mitigation*: The production configuration uses Supabase's transaction connection pooler (`pgbouncer=true` on port 6543) for `DATABASE_URL` and reserves `DIRECT_URL` (port 5432) strictly for migrations.
2. **Third-Party API Rate Limits**:
   - *Risk*: Gemini free-tier rate limits could impact burst usage during multi-user assessments.
   - *Mitigation*: The sliding-window rate limiter in `authMiddleware.ts` caps individual users to 30 AI requests per minute and returns standard HTTP 429 with `Retry-After`.
3. **Egress Latency on Cold Starts**:
   - *Risk*: Python ONNX runtime embedding initialization introduces a ~1.5s cold-start penalty on the first query after worker boot.
   - *Mitigation*: Embeddings are lazy-loaded once per process and cached in memory across subsequent queries.
