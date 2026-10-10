# Canonical Phase 7 — Production Scalability & Reliability Report

## Executive Summary

Phase 7 of Ming focused strictly on **auditing existing infrastructure**, **identifying concrete operational risks under load**, and **implementing targeted production hardening** while strictly preserving all existing behavior from completed roadmap phases (Phase 1 Foundation, Phase 2 Multimodal Ingestion, Phase 3 Grounding, Phase 4 Assessment Grading, Phase 5 Learner Intelligence, and Phase 6 Adaptive AI Study Agent).

Prior to this phase, Ming had already completed core infrastructure for PostgreSQL/pgvector, local SQLite dev/test dual-adapter compatibility, health probes, OpenTelemetry distributed tracing, and load tests. This phase audited the end-to-end stack, resolved 5 concrete production risks, added bounded concurrency limiting for heavy child processes, implemented a strictly tenant-isolated LRU/TTL read cache, added orphaned file retention cleanup, and verified the complete 58-file test suite with 944/944 passing tests and a successful production build.

---

## 1. Stage A — Infrastructure Audit Findings

| Infrastructure Area | Classification | Operational State & Concrete Evidence |
| :--- | :--- | :--- |
| **Database & ORM Layer** | **Implemented and verified** | Dual PostgreSQL/SQLite Prisma client architecture (`server/prisma.ts`). Connection pooling, raw SQL queries with tenant scoping, and runtime schema initialization (`ensureLearnerSchema`, `ensureResourceSchema`, `ensureDAGSchema`). |
| **Vector Store / pgvector** | **Implemented and verified** | `PgVectorStore` (`server/pgVectorStore.ts`) and Chroma fallback verified with parity tests (`src/test/ragVectorStoreEquivalence.test.ts`). Strict tenant filtering on `user_id` and `SYSTEM_PUBLIC`. |
| **Rate Limiting & Abuse Prevention** | **Partially implemented → Hardened** | Sliding window rate limiter in `server/authMiddleware.ts` was previously only enforced on `/api/ai/generate`. Now extended to distinct category buckets (`'ingest'`, `'rag'`, `'ai'`, `'general'`) with standard headers. |
| **Background Processing & CLI** | **Partially implemented → Hardened** | `server/ragHandler.ts` spawned unthrottled Python processes on each request. Wrapped with `ProcessConcurrencyLimiter` queue (default 8 concurrent, max queue 64) with 503 capacity rejection and graceful queue draining. |
| **Read Caching & Invalidation** | **Missing → Implemented** | Server read endpoints (`GET /api/resources`, `getUserDAGs`) previously hit the database directly on every request. Implemented `ServerReadCache` (`server/serverCache.ts`) with bounded LRU eviction (1,000 entries), TTL expiration, strict tenant key partitioning, and instant mutation invalidation. Correctness-sensitive learner BKT state is strictly never cached. |
| **File Storage & Cleanup** | **Partially implemented → Hardened** | Magic-byte MIME validation and path traversal sanitization in `server/fileValidator.ts` were solid, but orphaned temp uploads lacked automated retention cleanup. Implemented `cleanupStaleUploads(baseDir, maxAgeMs)`. |
| **Observability & Probes** | **Implemented and verified** | Health probes (`/api/health/live`, `/api/health/ready`, `/api/health`) distinguish process health from database readiness and vector store availability. Now includes cache and process queue telemetry. |
| **Schema Synchronization** | **Partially implemented → Hardened** | `StudyPlanItem` in `schema.prisma` and `schema.postgresql.prisma` were missing `conceptId`, `category`, and `questionId` fields used by Phase 6 study loop. Synchronized and regenerated Prisma clients cleanly. |

---

## 2. Concrete Production Risks & Resolutions

### Risk 1: Race Condition in Concurrent Duplicate Learner Evidence Submissions
- **Identified Gap**: Under high concurrency (e.g. rapid automated clicks or parallel network retries), two simultaneous requests with the same `(userId, idempotencyKey)` both passed the `SELECT ... WHERE idempotencyKey` pre-check, leading to an uncaught `SQLITE_CONSTRAINT_UNIQUE` (or Postgres `2067 / P2002`) exception and HTTP 500 crashes.
- **Resolution**: Wrapped the `INSERT INTO learner_events` call in `server/learnerEvidenceService.ts` in an explicit constraint violation catch block (`err.code === 'SQLITE_CONSTRAINT_UNIQUE'`, `2067`, `P2002`). If a concurrent write beats the current execution, the service safely handles it as `{ applied: false, duplicate: true, updated_state: currentState }` instead of failing.
- **Verification**: Verified via `src/test/productionScalabilityReliability.test.ts` firing 10 concurrent submissions with identical idempotency key: exactly 1 applied, 9 flagged as duplicates, 0 exceptions.

### Risk 2: OS Process Table Exhaustion via Unthrottled Python CLI Execution
- **Identified Gap**: Each RAG search, ingestion, and multimodal transcription spawned an unthrottled `execFile(python, ...)` process. Under sudden load spikes, this risked exhausting OS file descriptors and CPU/memory starvation.
- **Resolution**: Introduced `ProcessConcurrencyLimiter` in `server/ragHandler.ts` (`maxConcurrent = 8`, `maxQueueSize = 64`). Incoming tasks exceeding concurrency run in order; tasks arriving when the queue is saturated are rejected with HTTP 503 (`capacity exceeded`) and `Retry-After: 5`.
- **Verification**: Verified queueing, concurrency capping, and 503 rejection in unit tests.

### Risk 3: Unprotected Search and Ingestion Rate Limiting
- **Identified Gap**: Only AI generation had rate limiting; heavy `/api/rag/ingest` and `/api/rag/search` endpoints were unthrottled.
- **Resolution**: Partitioned `checkRateLimit` into category buckets:
  - `ingest`: 20 requests/minute
  - `rag`: 60 requests/minute
  - `ai`: 30 requests/minute
  - `general`: 120 requests/minute
  Added `Retry-After`, `X-RateLimit-Limit`, and `X-RateLimit-Remaining` headers.
- **Verification**: Verified bucket limits and cross-category isolation in `productionScalabilityReliability.test.ts`.

### Risk 4: StudyPlanItem Schema Desynchronization
- **Identified Gap**: Phase 6 added `conceptId`, `category`, and `questionId` to study plan items, but `prisma/schema.prisma` and `prisma/schema.postgresql.prisma` had not reflected these columns.
- **Resolution**: Added optional `conceptId`, `category`, and `questionId` fields to `StudyPlanItem` in both schemas and regenerated Prisma clients.
- **Verification**: Prisma clients generated cleanly and compile with zero errors.

### Risk 5: Unbounded Read DB Load & Stale Cache Risks
- **Identified Gap**: High-traffic read requests for resources and DAGs repeatedly hit SQLite/Postgres.
- **Resolution**: Built `ServerReadCache` with:
  - Strict tenant key partitioning: `${userId}:::${category}:::${subKey}`
  - Maximum 1,000 entries with LRU eviction
  - 30-second TTL for resources, 60-second TTL for DAGs
  - Instant invalidation on mutation (`POST`, `DELETE`, `saveDAG`, `deleteDAG`, successful ingestion)
  - Explicit invariant: Correctness-sensitive learner BKT mastery state is **never** cached.
- **Verification**: Verified eviction, TTL expiry, tenant isolation, and mutation invalidation.

---

## 3. Storage Retention & Stale Upload Cleanup

Implemented `cleanupStaleUploads(baseDir, maxAgeMs)` in `server/fileValidator.ts`:
- Recursively scans upload directories.
- Safely unlinks orphaned files whose modification time is older than `maxAgeMs` (default 24 hours).
- Deletes empty parent directories where safe.
- Ignores `ENOENT` if the directory does not yet exist.
- Returns `{ scannedCount, deletedCount, freedBytes, errors }`.

---

## 4. Verification & Test Results

### 1. Dedicated Phase 7 Test Suite
`src/test/productionScalabilityReliability.test.ts` (11 tests, 100% pass):
1. `Evidence Ingestion & Idempotency Under Concurrency > gracefully handles simultaneous duplicate evidence submissions without constraint crashes` (PASS)
2. `Process Concurrency Limiter Queueing & Capacity Protection > limits concurrent process execution and tracks operational statistics` (PASS)
3. `Process Concurrency Limiter Queueing & Capacity Protection > rejects tasks with 503 capacity error when queue limit is exceeded` (PASS)
4. `Bounded Server Read Cache > strictly isolates cache entries between different tenants` (PASS)
5. `Bounded Server Read Cache > evicts oldest unaccessed items when maxEntries capacity is reached` (PASS)
6. `Bounded Server Read Cache > expires cached entries after TTL` (PASS)
7. `Bounded Server Read Cache > instant invalidation clears tenant data on mutation` (PASS)
8. `Categorized Rate Limiting > enforces specific request limits for ingest, rag, and ai categories` (PASS)
9. `Storage File Retention & Stale Upload Cleanup > cleans up orphaned files older than maxAgeMs while keeping recent files` (PASS)
10. `Storage File Retention & Stale Upload Cleanup > safely handles non-existent cleanup directory without throwing` (PASS)
11. `Production Telemetry & Cache Health Diagnostics > reports cache metrics in comprehensive health check without exposing secrets` (PASS)

### 2. Full Regression Test Suite
- Total Test Files: **58 passed (58)**
- Total Tests: **944 passed (944)**
- Failures: **0**
- Duration: **66.24s**

### 3. Static Type Checking & Production Build
- `npx tsc --noEmit`: 0 errors.
- `npm run build`: Production bundle generated successfully (`dist/index.html`, `dist/assets/index-Db1u-Rw9.css`, `dist/assets/index-CZSjgjFs.js`).

---

## 5. Deployment & Configuration Guidelines

### Environment Variables
| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `DATABASE_URL` | `file:./prisma/dev.db` | Primary database connection URL (PostgreSQL in production, SQLite in local dev) |
| `VECTOR_STORE` | `pgvector` or `chroma` | Active vector store backend |
| `PGVECTOR_URL` | Optional | Explicit pgvector database URL if separate from `DATABASE_URL` |
| `RAG_MAX_CONCURRENT_PROCESSES` | `8` | Maximum concurrent Python CLI child processes |
| `RAG_MAX_QUEUE_SIZE` | `64` | Maximum queue depth before returning HTTP 503 |
| `RAG_TIMEOUT_MS` | `45000` | Per-process execution timeout |

### Operational Failure Behavior
- **Database Unavailable**: `/api/health/ready` returns HTTP 503; server process remains responsive with cached static responses.
- **Process Overload**: Rejects with HTTP 503, includes `Retry-After: 5` header.
- **Rate Limit Exceeded**: Rejects with HTTP 429, includes `Retry-After: <seconds>` and limit headers.
- **Stale Cache Prevention**: Any mutation immediately flushes that user's cached reads.

---

## 6. Roadmap Boundary Compliance

- **Phase 1–6 Preservation**: Adaptive study loop, Bayesian Knowledge Tracing, citation verification, numerical grading, and multitenancy fully preserved and verified.
- **Phase 8 (Evaluation)**: Benchmark program untouched.
- **Phase 9 (Product readiness)**: Broad UI redesign avoided.
- **Phase 10 (Hackathon)**: Untouched.
