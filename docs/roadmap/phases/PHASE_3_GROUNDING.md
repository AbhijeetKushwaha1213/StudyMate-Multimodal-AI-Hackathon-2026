# CANONICAL PHASE 3 — GROUNDING
## Exact Evidence, Citation Verification & Source Navigation

Phase 3 builds the canonical grounding layer for Ming, ensuring that every AI tutor response, flashcard, and diagnostic answer is backed by authentic, verifiable evidence retrieved from ingested course materials with exact source coordinates and zero-trust security.

---

## STEP 1 — DATA CONTRACTS & CANONICAL TYPES (VERIFIED)

Established canonical grounding types in [server/groundingTypes.ts](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/server/groundingTypes.ts) and [src/types/resource.ts](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/src/types/resource.ts), reusing Phase 2 multimodal provenance contracts:

1. **`CanonicalEvidence`**: Normalized atomic evidence unit containing `evidence_id`, `chunk_id`, `resource_id`, `source_type`, `text`, exact coordinates (`page_number`, `slide_number`, `timestamp_start`, `timestamp_end`), `extraction_method`, `content_hash`, and `relevance_score`.
2. **`GroundedClaim`**: Atomic assertion linked to supporting evidence IDs with `ClaimSupportStatus` (`SUPPORTED` | `PARTIALLY_SUPPORTED` | `UNSUPPORTED`).
3. **`VerifiedCitation`**: Application-verified citation reference with exact `SourceLocation` and `CitationVerificationStatus` (`VERIFIED` | `PARTIALLY_VERIFIED` | `UNVERIFIED` | `SOURCE_UNAVAILABLE` | `CROSS_TENANT_REJECTED` | `COORDINATE_MISMATCH`).
4. **`GroundedAnswerContract`**: Structured AI answer schema guaranteeing claims, verified citations, refusal classification, and refusal explanations.

---

## STEP 2 — SECURE RESOURCE STREAMING & SOURCE ACCESS API (VERIFIED)

Step 2 establishes a single canonical, authenticated endpoint allowing the frontend to securely access original resource bytes for citation viewing, media playback, and document inspection.

### 1. Storage Backend Architecture
- **Discovered Storage Mechanism**:
  - **Local Filesystem Storage (Authoritative in Dev/Test/Hackathon)**: Original uploaded files are placed in owner-scoped directories:
    - Documents & images: `server/uploads/{userId}/{filename}`
    - Video uploads: `server/uploads/videos/{filename}`
    - SQLite / LibSQL & PostgreSQL store the metadata in `resources` (`id`, `userId`, `storagePath`, `fileUrl`, `type`, `tagsJson`).
  - **Supabase Storage (Production Object Store)**:
    - Resources can alternatively reference the `resource-files` bucket via `storagePath` and authenticated URLs.
  - **Single Point of Truth**: No second storage system created. The resource `id` is the authoritative key linking vectors, citations, and original files.

### 2. Canonical Authenticated Endpoint
- **Endpoint**: `GET /api/resources/:id/file` (implemented in [api/resources.ts](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/api/resources.ts), routed via [server/index.ts](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/server/index.ts)).
- **Client Helper**: `getResourceFileUrl(resourceId)` in [src/api/resourceAPI.ts](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/src/api/resourceAPI.ts).

### 3. Zero-Trust Authorization & Authentication Rules
1. **Mandatory Server-Side Authentication**:
   - Requires a valid Supabase JWT Bearer token or HMAC-signed test key (`x-ming-test-key` matching `MING_TEST_SECRET`).
   - Unauthenticated requests immediately reject with **`HTTP 401 Unauthorized`**.
2. **Never Trust Client Identity**:
   - The endpoint strictly rejects identity spoofing. Identity is never extracted from `req.query`, `req.body`, or client headers.
3. **Resource Existence & Deletion Invariant**:
   - Non-existent resource IDs return **`HTTP 404 Not Found`**.
   - Deleted resources (`prisma.resource.delete` or soft-deleted records) return **`HTTP 404 Not Found`**.
4. **Ownership & Tenant Boundary Enforcement**:
   - Access permitted **only** if:
     $$\text{resource.userId} = \text{authenticatedUser.id} \quad \lor \quad \text{resource.tenantType} = \text{SYSTEM\_PUBLIC}$$
   - Any access attempt by User B to User A's private resource returns **`HTTP 403 Forbidden`**.
   - Preserves `SYSTEM_PUBLIC` accessibility for authenticated students while preventing unauthenticated leakage.

### 4. Content-Type Determination & Magic Byte Inspection
Content-Type is resolved from actual file bytes using Phase 2 magic byte inspection (`detectMagicSignature`):
- **PDF**: `application/pdf`
- **PNG**: `image/png`
- **JPEG**: `image/jpeg`
- **WEBP**: `image/webp`
- **MP4**: `video/mp4`
- **WEBM**: `video/webm`
- **WAV**: `audio/wav`
- **MP3**: `audio/mpeg`
- **PPTX**: `application/vnd.openxmlformats-officedocument.presentationml.presentation`
- **PPT**: `application/vnd.ms-powerpoint`
- **NOTE**: `text/plain; charset=utf-8`

### 5. HTTP Range Streaming (Media Seeking)
For video and audio streaming, HTTP Range requests are fully supported for browser seeking:
- **Header**: `Range: bytes=start-end`
- **Response**: **`HTTP 206 Partial Content`**
- **Response Headers**:
  - `Content-Range: bytes start-end/fileSize`
  - `Accept-Ranges: bytes`
  - `Content-Length: chunkSize`
  - `Content-Type: video/mp4` (or audio MIME)
  - `Cache-Control: private, no-cache, no-store, must-revalidate`
  - `X-Content-Type-Options: nosniff`
- **Invalid Range**: Handled safely with **`HTTP 416 Range Not Satisfiable`** with `Content-Range: bytes */fileSize`.
- Large media files are streamed via `fs.createReadStream` chunks, preventing out-of-memory loading.

### 6. Storage Security & Path Traversal Controls
- **Client controls only**: `resourceId`.
- **Server determines**: Actual storage location, file validation, and authorization.
- **Path Traversal Protection**:
  - Rejects null bytes in paths (`HTTP 400`).
  - Verifies that resolved file path resides strictly within `PROJECT_ROOT` or allowed tenant storage.
  - Blocks `/etc/passwd`, relative `../`, and arbitrary file reads with **`HTTP 403 Forbidden`**.
  - Missing storage objects return a controlled **`HTTP 404 Not Found`** without leaking server filesystem paths.
- **Secret Protection**:
  - Service-role keys (`SUPABASE_SERVICE_ROLE_KEY`), storage credentials, and tokens are never returned in response headers or error bodies.

---

## VERIFICATION & TEST RESULTS

### 1. Test Suite: `src/test/resourceStreaming.test.ts`
All 22 test cases pass cleanly:
- ✓ 1. Authenticated owner can access resource (`HTTP 200`, authentic bytes)
- ✓ 2. Unauthenticated request returns `HTTP 401 Unauthorized`
- ✓ 3. User B cannot access User A's resource (`HTTP 403 Forbidden`)
- ✓ 4. Spoofed userId query/body does not bypass authorization (`HTTP 403 Forbidden`)
- ✓ 5. Fake resource ID returns `HTTP 404 Not Found`
- ✓ 6. Deleted resource returns `HTTP 404 Not Found`
- ✓ 7. SYSTEM_PUBLIC resource follows existing public policy (User B -> 200, Unauthenticated -> 401)
- ✓ 8. Correct Content-Type for PDF (`application/pdf`)
- ✓ 9. Correct Content-Type for image (`image/png`)
- ✓ 10. Correct Content-Type for video (`video/mp4`)
- ✓ 11. Correct Content-Type for audio (`audio/mpeg`)
- ✓ 12. Video Range request returns `HTTP 206 Partial Content` with `Content-Range`
- ✓ 13. Audio Range request returns `HTTP 206 Partial Content` with `Content-Range`
- ✓ 14. Invalid Range is handled safely (`HTTP 416 Range Not Satisfiable`)
- ✓ 15. Path traversal attempt fails (`HTTP 403 Forbidden`)
- ✓ 16. Arbitrary filesystem path cannot be requested (`?path=/etc/passwd` ignored)
- ✓ 17. Private resource is not exposed through a public URL
- ✓ 18. Service-role credentials are never returned in headers or bodies
- ✓ 19. Missing storage object produces a controlled error (`HTTP 404`, no path leak)
- ✓ 20. Resource ID from citation cannot cross tenant boundaries (`HTTP 403 Forbidden`)
- ✓ 21. Supplementary: NOTE resources return `text/plain` with correct content
- ✓ 22. Supplementary: HEAD request returns metadata headers without body

### 2. Security Regression Test Pipeline
- `src/test/resourceStreaming.test.ts`: **22/22 PASSED**
- `src/test/productionSecurityAndIsolation.test.ts`: **23/23 PASSED**
- `src/test/multimodalIngestion.test.ts`: **24/24 PASSED**
- `src/test/productionSmokeIntegration.test.ts`: **17/17 PASSED**
- `src/test/ragVectorStoreEquivalence.test.ts`: **8/8 PASSED**
- **TypeScript (`npx tsc --noEmit`)**: **0 errors**
- **Production Build (`npm run build`)**: **SUCCESS** (10.59s)

---

---

## STEP 3 — DETERMINISTIC CITATION & CLAIM VERIFICATION ENGINE (VERIFIED)

Step 3 implements Ming's canonical zero-trust, server-side citation and claim verification engine. It establishes that AI-generated citations and assertions can never be accepted merely because the model produced citation tags or cited valid chunk IDs.

### 1. Request-Local Canonical Evidence Indexing
- **Server-Side Construction**:
  - Retrieved vector chunks from the RAG search pass are indexed deterministically using request-local identifiers:
    `[EVIDENCE_1]`, `[EVIDENCE_2]`, `[EVIDENCE_3]`, ...
  - Implemented in `buildCanonicalEvidenceIndex()` ([server/citationVerifier.ts](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/server/citationVerifier.ts)).
  - Preserves complete Phase 2 provenance: `user_id`, `tenant_type`, `resource_id`, `document_id`, `source_id`, `chunk_id`, `source_type`, `page_number`, `slide_number`, `timestamp_start`, `timestamp_end`, `extraction_method`, `content_hash`, `chunk_index`, and `relevance_score`.
  - The model never sees or invents database keys or chunk IDs.

### 2. Structured Answer Generation & Evidence Referencing
- **Prompt Directive Hardening**:
  - The generation prompt in `grounded_chat` ([server/rag_engine.py](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/server/rag_engine.py)) strictly commands the AI model to:
    1. Ground responses exclusively in the provided `<EVIDENCE_DATA>` index.
    2. Reference source support using ONLY request-local tags (`[EVIDENCE_1]`, `[EVIDENCE_2]`, ...).
    3. Never fabricate citations or cite evidence merely because it is top-ranked.
    4. Explicitly mark claims lacking support as unverified rather than fabricating evidence.

### 3. Removal of Blind Top-3 Citation Fallback
- **Blind Fallback Eliminated**:
  - Removed legacy behavior where missing citation brackets triggered automatic fallback to `relevant_chunks[:3]`.
  - When no valid citation tags are produced by the generator:
    - No citations are manufactured or attached.
    - Unsupported claims are classified `UNVERIFIED`.
    - `grounded` is deterministically set to `false`.
    - `coverage_score` drops to `0.0`.
  - Also removed blind slicing in client-side fallback ([src/api/ragAPI.ts](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/src/api/ragAPI.ts)).

### 4. Deterministic Verification Pipeline
For every proposed citation and claim, `verifyCitation()` and `verifyGroundedAnswer()` execute:
1. **Request-Local Resolution**: Validates that cited `EVIDENCE_n` exists in the current request's retrieval index. Citations to unretrieved chunks or fabricated tokens reject as `UNVERIFIED`.
2. **Authoritative Resource & Tenant Revalidation**:
   - Re-checks that `canonical.user_id === authenticatedUserId` or `tenant_type === 'SYSTEM_PUBLIC'`.
   - Never trusts client-supplied `userId`, `tenantType`, or metadata overrides.
   - Cross-tenant references immediately reject with `CROSS_TENANT_REJECTED`.
3. **Resource Existence & Non-Deletion**:
   - Revalidates resource state in authoritative database records.
   - Missing or deleted resources (`isDeleted: true`) return `SOURCE_UNAVAILABLE`.
4. **Coordinate Accuracy Validation**:
   - PDF `page_number`, PPT `slide_number`, Video/Audio `timestamp_start`/`timestamp_end`.
   - Inconsistent coordinates reject with `COORDINATE_MISMATCH`. Coordinates are never silently inferred or fixed.
5. **Excerpt / Content Alignment**:
   - Compares quoted excerpts against canonical evidence text using normalized token-level analysis.
   - Malicious or hallucinated quotes reject with `UNVERIFIED` or `PARTIALLY_VERIFIED`.

### 5. Deterministic Claim Support States
Claims are evaluated into fine-grained support classifications:
- **`VERIFIED`**: Claim references valid evidence that is verified across tenant, resource, coordinate, and content checks.
- **`PARTIALLY_VERIFIED`**: Claim has partial supporting evidence or qualified support level.
- **`UNVERIFIED`**: Claim lacks evidence or references fabricated/unretrieved tokens.
- **`SOURCE_UNAVAILABLE`**: Underlying resource has been deleted or cannot be resolved.
- **`CROSS_TENANT_REJECTED`**: Evidence belongs to another student's private workspace.
- **`COORDINATE_MISMATCH`**: Cited page/slide/timestamp contradicts canonical provenance.

### 6. Grounded Answer Contract Integration
- Exposes complete machine-readable verification data via `GroundedAnswerContract`:
  ```json
  {
    "answer": "...",
    "claims": [
      {
        "claim_id": "c1",
        "text": "...",
        "evidence_ids": ["EVIDENCE_1"],
        "support_status": "VERIFIED",
        "citations": [...]
      }
    ],
    "citations": [
      {
        "citation_id": "cit_evidence_1_chk_001",
        "chunk_id": "chk_001",
        "resource_id": "res_001",
        "source_type": "PDF",
        "location": { "page_number": 42 },
        "excerpt": "...",
        "verification_status": "VERIFIED"
      }
    ],
    "unsupported_claims": [],
    "grounded": true,
    "coverage_score": 1.0
  }
  ```
- Output retains all canonical navigation metadata needed for Step 4 frontend viewers.
- `GET /api/resources/:id/file` remains the canonical source access mechanism.

---

## VERIFICATION & TEST RESULTS (STEP 3)

### 1. Test Suite: `src/test/groundingVerification.test.ts`
All 30 canonical test cases pass cleanly:
- ✓ 1. Correct single evidence citation -> VERIFIED
- ✓ 2. Multiple valid evidence citations -> VERIFIED
- ✓ 3. Missing citation for factual claim -> UNVERIFIED
- ✓ 4. Fabricated EVIDENCE ID -> UNVERIFIED
- ✓ 5. Fabricated chunk ID -> UNVERIFIED
- ✓ 6. Citation references evidence not present in current retrieval set -> UNVERIFIED
- ✓ 7. Correct PDF page coordinate -> VERIFIED
- ✓ 8. Wrong PDF page coordinate -> COORDINATE_MISMATCH
- ✓ 9. Correct PPT slide coordinate -> VERIFIED
- ✓ 10. Wrong PPT slide coordinate -> COORDINATE_MISMATCH
- ✓ 11. Correct video timestamp -> VERIFIED
- ✓ 12. Wrong video timestamp -> COORDINATE_MISMATCH
- ✓ 13. Correct audio timestamp -> VERIFIED
- ✓ 14. Cross-tenant evidence -> CROSS_TENANT_REJECTED
- ✓ 15. Deleted resource -> SOURCE_UNAVAILABLE
- ✓ 16. Missing resource -> SOURCE_UNAVAILABLE
- ✓ 17. SYSTEM_PUBLIC evidence -> follows existing public-access policy
- ✓ 18. OCR evidence -> VERIFIED when provenance matches
- ✓ 19. Vision evidence -> VERIFIED when provenance matches
- ✓ 20. Malicious/fabricated excerpt -> PARTIALLY_VERIFIED or UNVERIFIED
- ✓ 21. Valid chunk ID from another retrieval context -> UNVERIFIED
- ✓ 22. LLM attempts arbitrary resource ID -> rejected
- ✓ 23. Claim with partially supporting evidence -> PARTIALLY_VERIFIED
- ✓ 24. No blind top-3 fallback occurs
- ✓ 25. Multiple claims with mixed verification statuses
- ✓ 26. Verification result is deterministic across repeated runs
- ✓ 27. Client-supplied userId cannot alter verification result
- ✓ 28. Client-supplied tenant metadata cannot alter verification result
- ✓ 29. Coordinate mismatch cannot be silently corrected
- ✓ 30. VerifiedCitation retains canonical navigation metadata

### 2. Full Regression Suite Results
- `src/test/groundingVerification.test.ts`: **30/30 PASSED**
- `src/test/productionSecurityAndIsolation.test.ts`: **23/23 PASSED**
- `src/test/resourceStreaming.test.ts`: **22/22 PASSED**
- `src/test/multimodalIngestion.test.ts`: **24/24 PASSED**
- `src/test/productionSmokeIntegration.test.ts`: **17/17 PASSED**
- `src/test/ragVectorStoreEquivalence.test.ts`: **8/8 PASSED**
- **Total Combined Tests**: **124/124 PASSED** (0 failures)
- **TypeScript Compilation (`npx tsc --noEmit`)**: **0 errors**
- **Production Bundle Build (`npm run build`)**: **SUCCESS** (9.68s)

---

## STEP 4 — EXACT SOURCE VIEWERS & CITATION NAVIGATION (VERIFIED)

Step 4 delivers the complete user-facing source navigation layer for Ming, allowing students to click verified citations and immediately inspect original evidence materials at exact coordinates (`page_number`, `slide_number`, `timestamp_start`/`end`, or text excerpt) via the canonical streaming endpoint `GET /api/resources/:id/file`.

### 1. Source Viewer Architecture
Implemented a modular, reusable modal dialog and viewer shell in [src/components/viewer/SourceViewer.tsx](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/src/components/viewer/SourceViewer.tsx):
- **`SourceViewer`**: Master viewer shell checking server-side verification status, rendering source metadata, status badges, and dispatching to specialized sub-viewers.
- **`PdfViewer`** ([src/components/viewer/PdfViewer.tsx](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/src/components/viewer/PdfViewer.tsx)):
  - Streams original document bytes via `fetchResourceFile(resourceId)`.
  - Navigates immediately to verified `#page=N` via PDF open parameters and iframe viewport.
  - Page jump controls (previous, next, exact page indicator), zoom controls (60% to 200%), external tab opener, and verified evidence quote callout.
- **`PresentationViewer`** ([src/components/viewer/PresentationViewer.tsx](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/src/components/viewer/PresentationViewer.tsx)):
  - Connects to cited presentation resource.
  - Navigates to verified `slide_number` with slide navigation controls.
  - Renders authentic Phase 2 extracted slide contents, structured headings, speaker notes, and diagram captions, with direct PPTX download support.
- **`ImageViewer`** ([src/components/viewer/ImageViewer.tsx](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/src/components/viewer/ImageViewer.tsx)):
  - Displays high-resolution visual evidence (PNG, JPEG, WEBP).
  - Zoom controls (50% to 300%), pan/scroll viewport, full-size opener, and Vision/OCR caption evidence callout.
- **`VideoViewer`** ([src/components/viewer/VideoViewer.tsx](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/src/components/viewer/VideoViewer.tsx)):
  - Streams lecture video via canonical endpoint with HTTP Range support.
  - Automatically seeks to verified `timestamp_start` (`player.currentTime = timestamp_start`).
  - Respects `timestamp_end` window (pauses when reaching segment end).
  - Custom timeline scrubber, play/pause, mute/volume, and "Jump to Cited Segment" quick button.
- **`AudioViewer`** ([src/components/viewer/AudioViewer.tsx](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/src/components/viewer/AudioViewer.tsx)):
  - Streams audio briefings/recordings (MP3, WAV).
  - Seeks to verified `timestamp_start`, pauses at `timestamp_end`.
  - Scrubber, speed selector (1.0x, 1.25x, 1.5x, 2.0x), volume, and verified quote transcript box.
- **`TextViewer`** ([src/components/viewer/TextViewer.tsx](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/src/components/viewer/TextViewer.tsx)):
  - Displays original study notes and text materials with copy quote controls and evidence excerpt highlighting.

### 2. Elimination of Simulated Navigation
- Completely removed simulated toasts from [src/components/chat/Citation.tsx](file:///Users/abhijeetkushwaha/Hackathon/StudyMate-Multimodal-AI-Hackathon-2026/src/components/chat/Citation.tsx):
  - Removed `"Simulating document viewport navigation to cited page."`
  - Removed `"Simulating presentation deck navigation to cited slide."`
  - Removed `"Simulating lecture video player seek to timestamp."`
- Citation clicks now trigger real, interactive source navigation via `SourceViewer`.

### 3. Zero-Trust Security & Failure Handling
- **Server Remains Authoritative**: The frontend never manufactures verification status or overrides coordinates.
- **Blocked State for Untrusted Citations**: If `verification_status` is `UNVERIFIED`, `SOURCE_UNAVAILABLE`, `CROSS_TENANT_REJECTED`, or `COORDINATE_MISMATCH`, `SourceViewer` renders a blocked dialog explaining the rejection reason instead of fabricating source access.
- **Graceful Error Responses**:
  - `HTTP 401`: Renders `"Authentication Required"` state prompting the user to sign in.
  - `HTTP 403`: Renders `"Access Denied"` state protecting private workspace materials.
  - `HTTP 404`: Renders `"Source Unavailable"` state when materials were deleted post-generation.
- **Zero Leakage**: No local filesystem paths (`/Users/`, `/home/`, `/tmp/`) or Supabase service keys are rendered in the client.

---

## VERIFICATION & TEST RESULTS (STEP 4)

### 1. Test Suite: `src/test/sourceNavigation.test.tsx`
All 25 canonical Step 4 test cases pass cleanly:
- ✓ 1. Verified PDF citation opens PDF viewer
- ✓ 2. PDF citation navigates to correct page (`#page=7`)
- ✓ 3. Verified PPT citation opens presentation viewer
- ✓ 4. PPT citation navigates to correct slide (`Slide #12`)
- ✓ 5. Verified image citation opens image viewer
- ✓ 6. Verified video citation opens video player
- ✓ 7. Video citation seeks to exact `timestamp_start` (125.4s)
- ✓ 8. Video citation respects `timestamp_end` when available
- ✓ 9. Verified audio citation opens audio player
- ✓ 10. Audio citation seeks to exact `timestamp_start` (102.5s)
- ✓ 11. NOTE citation opens text source
- ✓ 12. Unverified citation cannot trigger trusted source navigation
- ✓ 13. SOURCE_UNAVAILABLE displays source unavailable state
- ✓ 14. CROSS_TENANT_REJECTED cannot open private source
- ✓ 15. COORDINATE_MISMATCH cannot trigger navigation
- ✓ 16. Deleted resource produces controlled error state
- ✓ 17. 401 response produces authentication state
- ✓ 18. 403 response produces access-denied state
- ✓ 19. 404 response produces source-unavailable state
- ✓ 20. Citation click no longer invokes simulated navigation
- ✓ 21. Resource URL is generated only through `getResourceFileUrl()`
- ✓ 22. No local filesystem path appears in frontend output
- ✓ 23. No Supabase service-role key appears in frontend output
- ✓ 24. Multiple citations can open independently
- ✓ 25. Mobile viewer renders without breaking layout

### 2. Full Regression Suite Results
- `src/test/sourceNavigation.test.tsx`: **25/25 PASSED**
- `src/test/groundingVerification.test.ts`: **30/30 PASSED**
- `src/test/productionSecurityAndIsolation.test.ts`: **23/23 PASSED**
- `src/test/resourceStreaming.test.ts`: **22/22 PASSED**
- `src/test/multimodalIngestion.test.ts`: **24/24 PASSED**
- `src/test/productionSmokeIntegration.test.ts`: **17/17 PASSED**
- `src/test/ragVectorStoreEquivalence.test.ts`: **8/8 PASSED**
- **Total Combined Tests**: **149/149 PASSED** (100% green, 0 failures)
- **TypeScript Compilation (`npx tsc --noEmit`)**: **0 errors**
- **Production Bundle Build (`npm run build`)**: **SUCCESS** (9.61s)

---

## NEXT CANONICAL MILESTONE: PHASE 4 — ASSESSMENT (NOT YET STARTED)
Do not proceed to Phase 4 until instructed.

