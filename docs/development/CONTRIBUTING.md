# Contributing to Ming AI

Welcome to Ming (Multimodal AI Study Companion)! We appreciate your interest in contributing. This guide covers repository conventions, architecture principles, development workflows, and testing standards.

---

## 🏛️ Repository Architecture

Ming is organized into clear domain areas:

- **`src/`**: Modern React 18, TypeScript, Tailwind CSS frontend.
  - `src/components/`: Modular feature components (`ai/`, `chat/`, `dashboard/`, `flashcards/`, `layout/`, `notion/`, `planner/`, `video/`, etc.).
  - `src/hooks/`: Reusable React hooks for state, audio, shortcuts, and synchronization.
  - `src/pages/`: Top-level application routes.
  - `src/services/` & `src/utils/`: Local data stores, citation rendering, and study plan generators.
  - `src/test/`: Unit, integration, and security test suites using Vitest.
- **`server/`**: Node.js/TypeScript backend runtime and Python multimodal engines.
  - HTTP handlers (`ragHandler.ts`, `learnerHandler.ts`, `studyAgentHandler.ts`, `evaluationHandler.ts`, `videoHandler.ts`, `analyticsHandler.ts`).
  - Domain services (`bktService.ts`, `assessmentIntelligenceService.ts`, `studyAgentService.ts`, `citationVerifier.ts`, `observability.ts`).
  - Multimodal Python extractors and RAG engines (`rag_engine.py`, `multimodal_ingest.py`, `semantic_chunker.py`, `vector_store_pgvector.py`).
- **`scripts/`**: Development orchestration, load benchmarks, migration tools, and test suites.
- **`benchmarks/`**: Controlled evaluation datasets, benchmark runner, and historical evaluation reports.
- **`prisma/`**: Database schemas for SQLite (`schema.prisma`) and PostgreSQL/pgvector (`schema.postgresql.prisma`).
- **`supabase/`**: Edge functions, migrations, and database initialization SQL.
- **`docs/`**: Comprehensive project documentation taxonomy:
  - `docs/architecture/`: System design, component responsibilities, and data flows.
  - `docs/setup/`: Environment configuration, Supabase authentication, and local development.
  - `docs/evaluation/`: Canonical benchmark results, methodology, and compliance audits.
  - `docs/roadmap/phases/`: Historical development reports (Phase 2 through Phase 10).
  - `docs/demo/` & `docs/pitch/`: Presentation assets, demo scripts, and pitch materials.
  - `docs/development/`: Developer guides and repository audits.

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js**: v20+ or v22+ (tested with Node.js v23)
- **npm**: v10+
- **Python**: v3.11+ with virtual environment (`.venv/`)
- **Docker / PostgreSQL** (optional for local pgvector)

### Local Development Commands
```bash
# Install Node dependencies and generate Prisma clients
npm install

# Setup Python virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Start integrated dev server (Node API on 3001 + Vite frontend on 3000)
npm run dev

# Start frontend only
npm run dev:vite

# Start Node API only
npm run dev:api
```

---

## 🧪 Testing and Verification

Before submitting changes, run the appropriate test suites:

```bash
# Run the complete Vitest test suite
npm test

# Run production build
npm run build

# Run evaluation benchmarks
npm run eval

# Run concurrency and load benchmark
npm run loadtest

# Run Python module verification
./.venv/bin/python -m py_compile server/*.py scripts/*.py
```

---

## 🔒 Safety and Code Quality Standards

1. **Zero-Trust Multi-Tenancy**: Every database query, vector search, and citation retrieval must be strictly scoped to the requesting `userId`. Never bypass tenant isolation.
2. **Mathematically Grounded Mastery**: Bayesian Knowledge Tracing parameters and SM-2 interval formulas are rigorously verified. Do not alter probabilistic state transitions arbitrarily.
3. **Evidence-Grounded Citations**: Multimodal citations must include bounding coordinates (`page_number`, `slide_number`, `timestamp_start`/`end`).
4. **Non-Destructive Operations**: Never run broad destructive commands (`git clean -fd`, database resets). Preserve user changes and test fixtures.
5. **No Secrets in Version Control**: Ensure `.env` is never committed. Use `.env.example` with sanitized placeholders.

---

## 📝 Pull Request Workflow

1. Fork and create a topic branch from `main`: `git checkout -b feat/your-feature-name`.
2. Follow commit message conventions (e.g., `feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
3. Ensure all tests and production builds pass.
4. Submit a Pull Request with a clear description of changes, motivation, and verification steps.
