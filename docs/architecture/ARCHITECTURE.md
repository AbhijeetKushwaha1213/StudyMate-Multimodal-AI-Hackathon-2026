# Ming Production Architecture Specification
## Phase 2: Production Data Plane (PostgreSQL + pgvector & VectorStore Abstraction)

---

## 1. Executive Summary & Architecture Topology

Ming is an adaptive, multimodal AI study companion designed to empower college and university students. The Phase 2 architecture transitions the data plane from local SQLite and tightly-coupled ChromaDB into a production-grade, horizontally scalable, multi-tenant cloud architecture.

### Current Architecture (Local / Prototype)
```
Browser → Vite Dev Server → Node API (Port 3001) → SQLite/LibSQL + ChromaDB (Local Files) + Gemini Gateway
```

### Production Architecture (Phase 2 Target)
```
Browser (React SPA)
       │
       ▼ HTTPS / JWT Bearer
Node API Gateway (Express / Fastify / Node API)
       │
       ├─────────────────────────────────────────┐
       ▼                                         ▼
PostgreSQL Relational DB (Supabase)        Pluggable VectorStore
  • 11 Core Models                          ├── ChromaVectorStore (Local / Dev)
  • Row-Level Security (RLS)                └── PgVectorStore (PostgreSQL + pgvector)
  • ACID Transactions                             • 384-d Cosine HNSW Index
       │                                          • Zero-Trust Tenant Scoping
       └────────────────────┬────────────────────┘
                            │
                            ▼ HTTPS
                  Google Gemini AI Proxy Gateway
                    (Timeout & Prompt Defense)
```

---

## 2. Pluggable VectorStore Provider Abstraction

All RAG, citation resolution, and grounding pipelines in Ming depend strictly on the `BaseVectorStore` interface (`server/vector_store.py`) rather than concrete database drivers.

### Provider Interface Contract
```python
class BaseVectorStore(ABC):
    @property
    def provider_name(self) -> str: ...
    def add_documents(self, chunks: List[Dict[str, Any]]) -> Dict[str, Any]: ...
    def query_candidates(self, query_texts: List[str], top_k: int = 10, ...) -> Dict[str, List[Any]]: ...
    def get_chunk(self, chunk_id: str) -> Optional[Dict[str, Any]]: ...
    def delete_by(self, user_id=None, source_id=None, document_id=None) -> int: ...
    def count(self, user_id=None) -> int: ...
    def health_check(self) -> Dict[str, Any]: ...
```

### Concrete Implementations
1. **ChromaVectorStore** (`server/vector_store_chroma.py`):
   - Local on-disk embedding store (`./chroma_data`).
   - Selected when `VECTOR_STORE=chroma` (Default for local development).
   - Preserves Phase 1 zero-trust tenant isolation.
2. **PgVectorStore** (`server/vector_store_pgvector.py`):
   - PostgreSQL table `public.rag_chunks` with `vector(384)` column.
   - HNSW cosine nearest-neighbor search (`vector_cosine_ops`).
   - Supports Supabase PostgREST / RPC stored procedure `match_rag_chunks`.
   - Selected when `VECTOR_STORE=pgvector`.
   - **Fail-Closed Guarantee**: If `VECTOR_STORE=pgvector` is set but PostgreSQL/pgvector configuration is missing, the engine raises a fatal error immediately. It **never silently downgrades to Chroma in production**.

---

## 3. Embedding Model Specification & Compatibility Invariant

Embedding vectors must remain immutable and strictly compatible across all storage backends:

| Parameter | Value | Enforcement |
| :--- | :--- | :--- |
| **Model** | `all-MiniLM-L6-v2` | Stored in `embedding_model` column / metadata |
| **Model Version** | `v1` | Stored in `embedding_version` column / metadata |
| **Dimensionality** | **384** | Hard constraint in `rag_chunks.embedding vector(384)` |
| **Distance Metric** | **Cosine Distance** | `1 - (rc.embedding <=> query_embedding)` |
| **Index Strategy** | **HNSW** | `USING hnsw (embedding vector_cosine_ops)` |

> [!IMPORTANT]
> Incompatible embedding models or dimensions are rejected immediately upon insertion and cannot be mixed in the same index.

---

## 4. Multi-Tenant Isolation & Zero-Trust Model

Tenant isolation is non-negotiable across relational and vector planes:

1. **Authenticated Session Authority**:
   - `user_id` is always extracted from the verified JWT session or cryptographic token via `resolveContextUser()`.
   - `req.body.userId`, `req.query.userId`, or client-supplied tenant fields are **never trusted**.
2. **Public Curriculum Access**:
   - Only server-side verified ingestion processes can mark chunks as `SYSTEM_PUBLIC`.
   - Client uploads are strictly assigned `tenant_type = 'USER'` with `user_id = session.user.id`.
3. **Database-Level Row Level Security (RLS)**:
   - Relational tables enforce `auth.uid()::text = user_id`.
   - Vector table enforces `tenant_type = 'SYSTEM_PUBLIC' OR auth.uid()::text = user_id` on read, and `auth.uid()::text = user_id AND tenant_type = 'USER'` on insert.
4. **Post-Retrieval Defense-in-Depth**:
   - All vector query responses undergo a secondary verification check inside `rag_engine.py` to discard any candidate not matching the session user or verified public curriculum.

---

## 5. Environment Configuration

### Development Mode (Local Default)
```env
# Vector Database
VECTOR_STORE="chroma"
CHROMA_DATA_PATH="./chroma_data"

# Relational Database (SQLite)
DATABASE_URL="file:./prisma/dev.db"

# AI Provider Gateway
GEMINI_API_KEY="AIzaSy..."
```

### Production Mode (PostgreSQL + pgvector on Supabase)
```env
# Vector Database
VECTOR_STORE="pgvector"

# Relational Database (PostgreSQL)
DATABASE_URL="postgres://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
DIRECT_URL="postgres://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"

# Supabase REST / PostgREST Config
SUPABASE_URL="https://[PROJECT-REF].supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJhbG..."

# AI Provider Gateway
GEMINI_API_KEY="AIzaSy..."
```

---

## 6. Migration Runbooks

### A. Deploy PostgreSQL & pgvector Schema
Run the idempotent SQL migration against your Supabase or PostgreSQL database:
```bash
# Using Supabase CLI:
supabase db push

# Or using psql directly:
psql "$DATABASE_URL" -f supabase/migrations/20261008000000_production_data_plane_postgres_and_pgvector.sql
```

### B. Migrate Relational SQLite Data to PostgreSQL
Transfer existing development records from `prisma/dev.db` to PostgreSQL:
```bash
node scripts/migrate-sqlite-to-postgres.ts
```
The script validates total source rows against migrated rows and verifies sample records for all 11 models.

### C. Migrate Chroma Vectors to pgvector
Transfer vector chunks, embeddings, and multimodal coordinates from Chroma to pgvector:
```bash
.venv/bin/python scripts/migrate_chroma_to_pgvector.py
```
- Safe and idempotent (can be executed multiple times without duplicates).
- Preserves exact IDs, documents, embeddings, and 18 metadata fields.
- Non-destructive (Chroma data on disk is never altered or deleted).

---

## 7. Rollback Procedure

If a production vector or database rollback is required:
1. **Switch Vector Provider**:
   Set `VECTOR_STORE=chroma` in the environment and restart the API server.
2. **Revert Relational Changes**:
   Revert `DATABASE_URL` to the backup SQLite or prior PostgreSQL snapshot.
3. Because all vector migrations are strictly additive, ChromaDB remains completely intact with 0 data loss.
