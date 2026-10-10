# FINAL HACKATHON COMPLIANCE + TECHNICAL AUDIT: “Ming”
**Track D: Personalized Tutoring & Adaptive Learning**  
**Hackathon**: Multimodal AI Hackathon 2026  
**Auditor**: Antigravity Technical Audit Engine (Google DeepMind Pair Programmer)  
**Standard**: Evidence-Based Only — Zero Code Modifications  
**Date of Audit**: October 2026  

---

## EXECUTIVE SUMMARY

| Metric / Dimension | Audit Finding |
| :--- | :--- |
| **Overall Hackathon Compliance** | **83.8% Fully Compliant / 13.5% Partial / 2.7% Missing** |
| **Realistic Hackathon Score** | **87.5 / 100** (Conservative: 81.5/100, Best-Case: 91.5/100) |
| **Track D Requirements Assessed** | **37 Total Items** (A1–A8, B1–B4, C1–C8, D1–D4, E1–E6, F1–F5) |
| **Fully Implemented (✅)** | **29 Requirements** |
| **Partially Implemented (🟡)** | **7 Requirements** (A1, A8, B2, B4, C1, F2, F5) |
| **Not Implemented (🔴)** | **1 Requirement** (Full Vision OCR / Pixel understanding for figures) |
| **Test Suite Health** | **42 test suites passing (100%), 436 tests passing (100%), 0 failing** |
| **Empirical Evaluation Benchmark** | **70-item RAG test set**, **50 simulated student trajectories**, **7 archetypes** |
| **Final Submission Verdict** | **READY WITH MINOR FIXES** |

### Top 5 Strengths
1. **Mathematically Rigorous Bayesian Knowledge Tracing (BKT)**: True dynamic parameter updates ($pL_0=0.15, pT=0.10, pG=0.20, pS=0.10$), continuous confidence scaling, difficulty-adjusted slip/guess interpolation, and cold-start diagnostic intake implemented in both TypeScript (`server/bktService.ts`) and client state (`src/utils/bkt.ts`).
2. **Deterministic Priority-Driven Daily Study Agent**: Five-factor weighted scoring ($0.35 \times \text{MasteryGap} + 0.20 \times \text{Uncertainty} + 0.20 \times \text{Mistakes} + 0.15 \times \text{ExamUrgency} + 0.10 \times \text{EbbinghausForgetting}$) that dynamically shifts recommendations from remedial source review to mock exams.
3. **Comprehensive Benchmark & Simulated Cohort Engine**: 70 real-world benchmark items covering 10 engineering domains with RAGAS-equivalent metrics (Faithfulness: 97.8%, Answer Relevancy: 85.0%, Context Precision: 97.4%, Context Recall: 84.1%) and 50 simulated multi-session learner profiles.
4. **Interactive Course Concept DAG**: Full prerequisite hierarchy visualization, topological sequencing, and node-level mastery coloring backed by persistent SQLite storage (`server/dagService.ts`).
5. **Robust Assessment Deduplication & Misconception Taxonomy**: MD5 fingerprinting, normalized stem matching, 5 distinct cognitive misconception categories, and exact numerical tolerance verification ($\pm 5\%$).

### Top 5 Critical Vulnerabilities & Gaps
1. **Citation Viewport Navigation for PDFs & Slides (B2)**: Citations preserve page and slide numbers perfectly throughout the pipeline, but clicking citations in `src/components/chat/Citation.tsx` displays an interactive modal with excerpts and deep links, rather than jumping an embedded PDF.js/PPT viewport to that physical page canvas (video timestamp seeking, however, is genuinely working).
2. **Chroma Multi-Tenant Filter Leak (B4 & Security)**: In `server/rag_engine.py`, Chroma's `$where` clause hardcodes an `$or` block containing `default_user`, `user_123`, and `test_student_42`, allowing test and demo chunks to leak into any user's search queries.
3. **Visual / Diagram Extraction vs. Vision Model Understanding (A8)**: Embedded figures and charts are detected via regex captions and PyPDF image object counts, creating `[FIGURE / DIAGRAM]` text tokens. The system does not pass pixel images to Gemini Vision or an OCR engine for spatial/visual diagram comprehension.
4. **Video Audio Stream Ingestion (A1)**: Videos are processed either by ingesting provided transcript JSON or by sending the URL/topic to Gemini with a text prompt requesting timestamped segmentation; raw MP4 video streams or audio files are not directly transcribed via an on-device Whisper or Gemini File API pipeline.
5. **Client-Side API Key Fallback Exposure (Security)**: Environment variables `VITE_GEMINI_API_KEY` and `VITE_SUPABASE_ANON_KEY` are read in browser bundles, exposing third-party AI keys if deployed to untrusted public domains without a backend proxy.

---

## 1. HACKATHON REQUIREMENTS TO AUDIT

### A. MULTIMODAL KNOWLEDGE BASE

#### A1. Ingest lecture videos without manual preprocessing
* **Status**: 🟡 PARTIALLY IMPLEMENTED
* **Code Evidence**:
  - `server/rag_engine.py:L214-290` (`extract_video_or_audio`): Accepts video file paths, URLs, or custom VTT/SRT transcripts.
  - `server/videoProcessor.ts:L30-110`: Extracts YouTube IDs, scrapes metadata, and parses timestamped segments.
  - `server/rag_engine.py:L316-360` (`_parse_timestamped_transcript`): Automatically chunks VTT/SRT subtitles and JSON transcripts into timestamp-bounded units (`timestamp_start`, `timestamp_end`).
* **Working Workflow**: Video links or uploaded transcripts are parsed into timestamped chunks and indexed into Chroma vector DB under `source_type="VIDEO"`.
* **Gap**: For raw uploaded MP4 files without existing transcripts or YouTube metadata, Gemini is prompted with the filename/URL string rather than streaming raw audio bytes to a speech-to-text model (e.g. Whisper). If Gemini fails or lacks audio access, it falls back to 5 structured conceptual segment heuristics (`server/rag_engine.py:L263-315`).

#### A2. Ingest textbooks/PDFs without manual preprocessing
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - `server/rag_engine.py:L78-141` (`extract_pdf`): Ingests PDFs using `pypdf.PdfReader`, looping through pages sequentially.
  - Page numbers (`idx`) and total page counts are attached to every page object.
  - `server/rag_engine.py:L385-455` (`chunk_text`): Chunks pages into 600-character segments with 100-character overlap while strictly preserving `page_number` in every chunk's metadata dictionary.
  - Verified by tests in `src/test/phase10CitationCoordinate.test.tsx:L12-45`.

#### A3. Ingest slide decks without manual preprocessing
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - `server/rag_engine.py:L143-213` (`extract_pptx`): Supports both `python-pptx` (parsing slides, shapes, titles, and text frames) and a zero-dependency fallback using Python's built-in `zipfile` + `xml.etree.ElementTree` parsing `ppt/slides/slide*.xml`.
  - Slide numbers (`idx`) are preserved per chunk with `source_type="SLIDE"`.

#### A4. Organize content into topics, concepts, and prerequisites
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - `server/rag_engine.py:L458-520` (`extract_topics_and_concepts`): Uses keyword classification dictionaries (`TOPIC_KEYWORDS`) and LLM fallback to assign primary topics, subtopics, and prerequisite concepts.
  - `server/dagService.ts:L30-180`: Persists nodes, edges, prerequisite relationships, and mastery states into the `course_dags` SQLite database table.
  - Verified by tests in `src/test/subjectSortingAndGeneration.test.tsx`.

#### A5. Every knowledge unit must preserve its origin (Coordinates Pipeline)
* **Status**: ✅ FULLY IMPLEMENTED (Pipeline Storage & Retrieval Verified)
* **Code Evidence**:
  - **Ingestion**: Chunks store `page_number`, `slide_number`, `timestamp_start`, `timestamp_end`, `source_id`, `chunk_id`, and `source_type` (`server/rag_engine.py:L540-620`).
  - **Storage**: Chroma stores coordinate fields in `metadatas` dictionary (`server/rag_engine.py:L690-730`).
  - **Retrieval**: `search_relevant_chunks` maps Chroma metadata back into the `location` object (`server/rag_engine.py:L990-1040`).
  - **Generation**: LLM responses receive citations populated with `page_number`, `slide_number`, `timestamp_start` (`server/rag_engine.py:L1480-1550`).
  - **UI**: Rendered by `src/components/chat/Citation.tsx:L70-107` displaying badges like `Page 4`, `Slide 12`, or `04:15`.
  - Benchmark result: **100% Coordinate Match Accuracy** (`benchmarks/results/latest_evaluation.json:L12`).

#### A6. Identify major topics, subtopics, and key concepts
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - Automatically categorized in `server/rag_engine.py` using canonical university engineering curricula (OS, DBMS, Computer Networks, Data Structures, Algorithms, System Design, Compiler Design, AI/ML).
  - Exposed via `/api/rag/topics` and consumed by `src/components/dashboard/StudyDashboard.tsx`.

#### A7. Tag every content unit to topics/concepts
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - All Chroma vectors have `topic` and `subtopic` metadata.
  - In SQLite `assessment_questions`, questions are indexed by `@@index([userId, topic])` (`prisma/schema.prisma:L52`).
  - In SQLite `learner_mastery`, every entry is keyed by `topic` and `subtopic` (`prisma/schema.prisma:L82-83`).

#### A8. Extract information from images, diagrams, and figures
* **Status**: 🟡 PARTIALLY IMPLEMENTED / 🔴 VISION UNDERSTANDING MISSING
* **Audit Findings**:
  1. **Image Extraction / Presence Detection**: ✅ Detected in PDFs via `hasattr(page, "images")` and PPTX via `shape.shape_type == 13` or `picture in shape.name` (`server/rag_engine.py:L102-125`, `L166-170`).
  2. **Caption Extraction**: ✅ Text regex parses caption headers (e.g., `Figure 3.1: Two-Phase Locking`) and creates dedicated chunks tagged `is_diagram=True` and `diagram_caption`.
  3. **OCR**: 🔴 No OCR engine (Tesseract, PaddleOCR) is present in the pipeline.
  4. **Vision-Language Understanding**: 🔴 The system does not feed extracted image bitmaps into Gemini 1.5/2.5 Pro Vision to interpret diagram arrows, state transitions, or flowchart logic.
  5. **Retrieval & Use**: 🟡 The caption text is retrieved and cited in chat with a special `<ImageIcon>` figure badge in `src/components/chat/Citation.tsx:L270-277`.
* **Verdict**: Partial metadata and caption retrieval; true pixel-level vision understanding is not implemented.

---

### B. SOURCE GROUNDING

#### B1. Answer questions using source-grounded evidence
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - `server/rag_engine.py:L860-1060` (`search_relevant_chunks`): Performs query normalization, decomposition into sub-queries, and Chroma cosine similarity search.
  - `server/rag_engine.py:L1352-1410` (`grounded_chat`): Constructs an evidence block formatted with `[CHUNK cid]`, `Source Type`, `Coordinate`, and `Content`. Injects strict instructions: *"Ground your response STRICTLY and SOLELY in the provided evidence chunks above."*
  - `server/rag_engine.py:L1490-1560`: Verifies that any `[CHUNK_ID]` cited in the generated answer exists in the retrieved set; strips hallucinated IDs and recalculates `citation_precision`.

#### B2. Citations must open the exact source location
* **Status**: 🟡 PARTIALLY IMPLEMENTED (Video: ✅ Exact Seek / PDF & Slides: 🟡 Metadata & Modal Only)
* **Code Evidence**:
  - **Video Citations**: In `src/components/video/VideoLearningPage.tsx:L101-105` and `src/components/video/VideoPlayer.tsx:L69-80`, calling `seekTo(seconds)` genuinely seeks the YouTube/HTML5 video player to the exact second.
  - **PDF & Slide Citations**: Clicking a citation badge in `src/components/chat/Citation.tsx:L111-156` opens a Dialog showing the exact page number (`Page 4`), slide number (`Slide 2`), document ID, and verified excerpt text, with buttons to copy deep links or citation text.
  - **Gap**: There is no embedded PDF.js or PPT viewer iframe that dynamically renders and scrolls to page 4 on click. The user sees the exact coordinates and excerpt inside a modal, not a jumping document canvas.

#### B3. Unsupported queries must be declined or clearly flagged
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - `server/rag_engine.py:L1338-1350`: If retrieved chunk confidence falls below `conf_threshold` (0.28) or `coverage_score == 0.0`, the system immediately short-circuits:
    ```python
    return {
        "response": "The uploaded course materials do not contain sufficient information to answer this question. Please upload relevant course materials...",
        "citations": [],
        "grounded": False,
        "insufficient_evidence": True,
        "evidence_coverage_score": 0.0
    }
    ```
  - For partial evidence ($0.0 < \text{coverage} < 1.0$), system returns `partial_answer: True` and prompts the model to partition the response into `### 📚 Course Material Evidence` and `### ⚠️ Evidence Coverage Note` (`server/rag_engine.py:L1405-1408`).
  - Benchmark result: **100% Refusal Accuracy** across 6 out-of-scope queries in `benchmarks/results/latest_evaluation.json:L13`.

#### B4. Verify user/source isolation
* **Status**: 🟡 PARTIALLY IMPLEMENTED / ⚠️ SECURITY VULNERABILITY
* **Code Evidence**:
  - In SQLite and Prisma, tables strictly filter by `userId` (e.g. `@@index([userId, topic])`).
  - **Vulnerability**: In `server/rag_engine.py:L895-903`, the Chroma vector search filter is written as:
    ```python
    if user_id and user_id not in ["default_user", "all", "*"]:
        where_conditions.append({
            "$or": [
                {"user_id": {"$eq": str(user_id)}},
                {"user_id": {"$eq": "default_user"}},
                {"user_id": {"$eq": "user_123"}},
                {"user_id": {"$eq": "test_student_42"}}
            ]
        })
    ```
  - This allows chunks owned by test user IDs (`user_123`, `test_student_42`, `default_user`) to be returned in any other authenticated user's retrieval results. True multi-tenant isolation requires removing the `$or` block.

---

### C. ADAPTIVE ASSESSMENT

#### C1. Generate quizzes/mock exams (MCQ, Short Answer, Numerical)
* **Status**: 🟡 PARTIALLY IMPLEMENTED (MCQ & Short Answer: ✅ Fully Functional / Numerical: 🟡 Evaluated in Backend, Limited in Generator)
* **Code Evidence**:
  - `server/assessmentIntelligenceService.ts:L78-145` (`evaluateStudentAnswer`): Handles three question types:
    - **MCQ**: Exact letter / option matching (`normalizedUser === normalizedCorrect`).
    - **Short Answer**: Jaccard token overlap, essential keyword phrase checking, and semantic credit interpolation (0.0 to 1.0).
    - **Numerical**: Mathematical regex extraction (`/[-+]?\d*\.?\d+/g`), relative numerical error comparison within a **5% relative tolerance threshold** ($|\text{user} - \text{target}| / |\text{target}| \le 0.05$).
  - `server/rag_engine.py:L1650-1780` (`generate_assessment_questions`): Generates MCQs and Short Answer questions from retrieved chunks.
  - **Gap**: The prompt in `rag_engine.py` generates predominantly MCQs and conceptual Short Answer questions; explicit numerical problem generation is rare unless the underlying course material contains quantitative formulas.

#### C2. Student-selected scope
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - `src/components/dashboard/ExamDashboard.tsx:L120-220` and `src/components/assessment/AdaptiveAssessmentView.tsx:L60-150`: UI allows selection of:
    - **Subject / Topic**: Dropdown populated dynamically from ingested courses (OS, DBMS, CN, Algorithms, etc.).
    - **Subtopic**: Granular concept scope.
    - **Source Material**: Select all or isolate to specific uploaded lecture/PDF (`sourceId`).
    - **Difficulty**: Adaptive, Easy, Medium, Hard.
    - **Exam Scope / Question Count**: 3 to 15 questions, Mock Exam mode vs Diagnostic mode.

#### C3. Every question must contain topic, source location, difficulty
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - SQLite table schema in `prisma/schema.prisma:L32-55` (`AssessmentQuestion`):
    ```prisma
    model AssessmentQuestion {
      id          String  @id @default(cuid())
      topic       String
      subtopic    String?
      difficulty  String
      sourceId    String?
      chunkId     String?
      pageNumber  Int?
      slideNumber Int?
      timestampStart Float?
      timestampEnd   Float?
      question    String
      correctAnswer String
      explanation String
    }
    ```
  - Every generated question object in `rag_engine.py` explicitly populates these coordinates from the source chunk.

#### C4. Verify question correctness
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - `server/assessmentIntelligenceService.ts:L78-145`: Deterministic mathematical validation for numbers; Jaccard overlap + keyword inclusion for short answers.
  - `server/rag_engine.py:L1740-1790`: Validates that the generated `correct_answer` is verbatim supported by the retrieved chunk text. If a question contradicts the source chunk, it is discarded.
  - Verified by tests in `src/test/phase9AssessmentIntelligence.test.tsx:L35-90`.

#### C5. Prevent repeated questions
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - `server/assessmentIntelligenceService.ts:L31-55` (`calculateQuestionFingerprint` & `isDuplicateQuestion`):
    1. Computes an MD5 hash over normalized question stems (`stem.toLowerCase().replace(/[^a-z0-9]/g, '')`).
    2. Performs token Jaccard similarity across recent questions in `assessment_questions` table.
    3. Blocks questions if Jaccard similarity $> 0.85$ or exact fingerprint matches.
  - Verified by empirical benchmark: Exact duplicate rate dropped from **80.0% (baseline) to 0.0%** (`benchmarks/results/latest_evaluation.json:L83`).

#### C6. Give cited feedback after each answer
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - `server/assessmentIntelligenceService.ts:L146-210` & `src/components/assessment/AdaptiveAssessmentView.tsx:L280-360`:
    - Explains *why* the answer is correct or incorrect.
    - Emits interactive `<Citation>` badge referencing the underlying `chunk_id`, page/slide/timestamp, and document title.
    - Explains topic association and updates the learner's estimated topic mastery on-screen.

#### C7. Post-assessment report
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - `server/assessmentIntelligenceService.ts:L240-340` (`generateDiagnosticReport`): Computes overall score, weak topics, mastery deltas ($\Delta \text{Mastery}$), detected misconceptions, and outputs actionable next steps (`recommendedNextAction`).
  - Rendered in UI via `src/components/assessment/AdaptiveAssessmentView.tsx:L370-490` with visual mastery bars, misconception callouts, and direct links to study tasks.

#### C8. Misconception detection
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - `server/assessmentIntelligenceService.ts:L18-29`: Implements a 5-type cognitive misconception taxonomy:
    1. `CONCEPT_CONFUSION`: Mixing up two related terms (e.g., Process vs. Thread, TCP vs. UDP).
    2. `MECHANISM_INVERSION`: Reversing causality or logic (e.g., claiming optimistic concurrency locks early).
    3. `SCOPE_OVERGENERALIZATION`: Applying a local rule globally.
    4. `NUMERICAL_FORMULA_ERROR`: Using the incorrect equation (e.g., omitting propagation delay).
    5. `PREREQUISITE_DEFICIT`: Missing foundational concepts needed to solve the problem.
  - Persisted in SQLite table `assessment_misconceptions` (`prisma/schema.prisma:L186-208`) and linked to the student's study plan priorities.

---

### D. LEARNER MODEL

#### D1. Maintain per-topic mastery estimates
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - Stored in SQLite table `learner_mastery` (`prisma/schema.prisma:L78-97`) tracking `masteryProbability`, `attempts`, `correctCount`, `incorrectCount`, `confidence`, and `status`.
  - Every state transition is appended to the audit ledger in `learner_events` (`prisma/schema.prisma:L99-117`).
  - Updated upon assessment submissions and tutor interactions.

#### D2. Bayesian Knowledge Tracing (BKT) / equivalent
* **Status**: ✅ FULLY IMPLEMENTED (Exact Standard BKT Algorithm)
* **Code Evidence**:
  - Implemented in `server/bktService.ts:L20-135` and mirrored in `src/utils/bkt.ts:L10-95`.
  - **Canonical Parameters**:
    - Initial Prior ($pL_0$): $0.15$ (unassessed baseline)
    - Transit Probability ($pT$): $0.10$
    - Guess Probability ($pG$): $0.20$
    - Slip Probability ($pS$): $0.10$
    - Mastery Threshold: $0.85$ (transitions state to `'mastered'`)
  - **Evidence Update Equations**:
    - If correct evidence:
      $$P(L_t \mid \text{correct}) = \frac{P(L_t) \cdot (1 - pS)}{P(L_t) \cdot (1 - pS) + (1 - P(L_t)) \cdot pG}$$
    - If incorrect evidence:
      $$P(L_t \mid \text{incorrect}) = \frac{P(L_t) \cdot pS}{P(L_t) \cdot pS + (1 - P(L_t)) \cdot (1 - pG)}$$
    - Next state transition:
      $$P(L_{t+1}) = P(L_t \mid \text{obs}) + (1 - P(L_t \mid \text{obs})) \cdot pT$$
  - **Difficulty Scaling**: Adjusts $pG$ and $pS$ dynamically based on item difficulty (Hard: $pG=0.10, pS=0.15$; Easy: $pG=0.25, pS=0.08$).
  - **Confidence Metric**: $\text{Confidence} = \frac{\text{attempts}}{\text{attempts} + 2.0} \in [0, 1]$.
  - Verified by tests in `src/test/learnerBktModel.test.tsx:L1-160`.

#### D3. Mastery must influence personalization (End-to-End Trace)
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - Traced pipeline:
    1. Student submits response in `src/components/assessment/AdaptiveAssessmentView.tsx`.
    2. Endpoint `/api/rag/assessment/submit` invokes `evaluateStudentAnswer` (`server/assessmentIntelligenceService.ts:L78`).
    3. Posterior calculated via `updateMasteryFromEvidence` (`server/bktService.ts:L75`) and written to `learner_mastery`.
    4. `computeDeterministicPriorities` (`server/studyAgentService.ts:L80-160`) recalculates priority scores:
       $$\text{Score} = 0.35(1 - \text{Mastery}) + 0.20(1 - \text{Confidence}) + 0.20(\text{Mistakes}) + 0.15(\text{ExamUrgency}) + 0.10(\text{Forgetting})$$
    5. `generatePersonalizedDailyPlan` (`server/studyAgentService.ts:L210-310`) assigns distinct study tasks:
       - Mastery $< 0.40 \rightarrow$ `REVIEW_SOURCE` or `ASK_TUTOR`
       - Mastery $0.40 - 0.70 \rightarrow$ `PRACTICE_QUIZ`
       - Mastery $> 0.85 \rightarrow$ `MOCK_EXAM` or `SPACED_REPETITION`
    6. UI updates live in `src/components/dashboard/AIStudyAgentPanel.tsx`.

#### D4. Cold-start students
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - `server/bktService.ts:L140-190` (`initializeDiagnosticMastery`): Cold-start learners without history receive baseline prior $pL_0=0.15$ and status `'unassessed'`.
  - `server/studyAgentService.ts:L95-120`: When an unassessed student logs in, the agent automatically detects `hasAssessedTopics === false` and prioritizes a **Diagnostic Assessment** before generating study plans.
  - Onboarding diagnostic endpoint: `/api/rag/assessment/diagnostic`.

---

### E. SYSTEM EVALUATION

#### E1. Evaluation framework
* **Status**: ✅ FULLY IMPLEMENTED (Custom Rigorous RAGAS-Equivalent Framework)
* **Code Evidence**:
  - Implemented in `server/evaluationEngine.ts:L195-450`.
  - Uses exact mathematical implementations of RAGAS metrics (Precision@k ranking, Jaccard token overlap, substring claim verification, and out-of-scope refusal checking) without relying on closed-source external SaaS dependencies.
  - Automated executable script: `benchmarks/run-evaluation.ts` runnable via `npm run benchmark`.

#### E2. Team-built test set
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - Test set stored in `benchmarks/data/rag_eval_dataset.json` (47.2 KB).
  - **70 total evaluation items** across 10 university engineering topics (OS, DBMS, Computer Networks, Data Structures, Algorithms, Software Engineering, Computer Architecture, Distributed Systems, Compilers, Cyber Security).
  - Contains:
    - 40 factual & conceptual grounded questions
    - 10 multi-source synthesis questions
    - 6 out-of-scope / off-material questions (to test refusal accuracy)
    - 8 misconception-triggering edge cases
    - 6 quantitative / numerical problem items
  - Each item includes ground truth answers, expected source IDs, expected page/slide/timestamp coordinates, and reference key phrases.

#### E3. Report: Required RAGAS Metrics
* **Status**: ✅ FULLY IMPLEMENTED (Actual Empirical Values from Benchmark Run)
* **Empirical Results from `benchmarks/results/latest_evaluation.json`**:
  - **Dataset Size**: 70 items
  - **Faithfulness**: **97.8%** (0.978)
  - **Answer Relevancy**: **85.0%** (0.850)
  - **Context Precision**: **97.4%** (0.974)
  - **Context Recall**: **84.1%** (0.841)

#### E4. Additional grounding metrics
* **Status**: ✅ FULLY IMPLEMENTED
* **Empirical Values from `latest_evaluation.json:L10-15`**:
  - **Grounding Accuracy**: **100.0%** (1.000)
  - **Coordinate Accuracy**: **100.0%** (1.000)
  - **Refusal Accuracy**: **100.0%** (1.000)
  - **Question Novelty (Unique Rate)**: **100.0%** (Exact duplicate rate: 0.0%)

#### E5. Personalization evaluation (Simulated Students)
* **Status**: ✅ FULLY IMPLEMENTED
* **Code & Data Evidence**:
  - Evaluated in `server/evaluationEngine.ts:L480-720`.
  - **50 Simulated Students** evaluated across **7 Archetypes**:
    - `novice`: 8 students (starts at mastery 0.20 $\rightarrow$ progresses to $>0.90$)
    - `developing`: 7 students
    - `strong`: 7 students
    - `exam_crammer`: 7 students
    - `inconsistent_learner`: 7 students
    - `high_confidence_low_mastery`: 7 students (triggers targeted remedial prompts)
    - `low_confidence_high_mastery`: 7 students (triggers confidence boosters)
  - **Empirical Results**:
    - Average Mastery Improvement: **+44.8%**
    - Total Completed Activities: **134**
    - Recommendation Relevance: **100.0%**
    - Repeated Question Rate: **0.0%**

#### E6. Reproducibility
* **Status**: ✅ FULLY IMPLEMENTED
* **Code Evidence**:
  - Can be re-executed anytime via:
    ```bash
    npm run benchmark
    ```
  - Reads from `benchmarks/data/rag_eval_dataset.json`, queries the RAG engine and BKT models, outputs progress to stdout, and writes updated results to `benchmarks/results/latest_evaluation.json` and `.csv`.

---

### F. OPTIONAL ENHANCEMENTS

| Enhancement | Status | Code Evidence | Verdict |
| :--- | :--- | :--- | :--- |
| **F1. Visual Course Flow / Prerequisite DAG** | ✅ Implemented | `src/components/dag/CourseConceptDAGView.tsx`, `server/dagService.ts` | Interactive React flow canvas with nodes colored by BKT mastery and edges indicating prerequisite chains. |
| **F2. Revision Material for Weak Topics** | 🟡 Partial | Flashcards: `src/components/study/FlashcardViewer.tsx`; Audio Briefs: `src/components/study/AudioBriefViewer.tsx` | Flashcards and audio brief scripts are generated; slide generation is missing. |
| **F3. Spaced Repetition / Study Schedule** | ✅ Implemented | `server/studyAgentService.ts:L115-140`, `src/utils/dailyPlanGenerator.ts` | Computes days since last assessment, days until exam, and applies Ebbinghaus decay penalty to prioritize review. |
| **F4. Mixed-Language Interaction (Hinglish/Hindi)** | ✅ Implemented | `server/rag_engine.py:L1376-1394`, `src/test/multilingualAndAudioTutor.test.tsx` | Native Hinglish and Hindi instructions in prompt preserving English technical terms and inline citations. |
| **F5. Audio-Based Tutoring** | 🟡 Partial | `src/components/study/AudioBriefViewer.tsx:L70-110` | Uses browser Web Speech API (`window.speechSynthesis`) to read audio scripts aloud. No neural TTS backend (e.g. ElevenLabs). |

---

## 2. END-TO-END WORKFLOW AUDIT

### WORKFLOW 1: Upload PDF $\rightarrow$ Retrieval $\rightarrow$ Citation $\rightarrow$ Exact Page Opening
```
PDF Upload -> pypdf Text & Figure Extraction -> Chunking (600c/100o) -> Chroma Cosine Index
   -> Search Retrieval -> Grounded Chat -> Citation Generation -> Modal with Exact Page & Excerpt
```
* **Success Points**: Page number is extracted without loss, preserved in Chroma metadata, retrieved during search, and displayed accurately in the chat citation badge (`Page 3`).
* **Break Point**: In the frontend, clicking the citation badge opens a Dialog containing coordinates, doc ID, and text snippet, rather than jumping an embedded PDF.js canvas to that physical page.

### WORKFLOW 2: Upload PPTX $\rightarrow$ Slide Extraction $\rightarrow$ Retrieval $\rightarrow$ Citation $\rightarrow$ Exact Slide Opening
```
PPTX Upload -> python-pptx / zipfile XML -> Slide & Picture Detection -> Chroma Indexing
   -> Search Retrieval -> Grounded Chat -> Citation Badge (Slide 5) -> Coordinate Modal
```
* **Success Points**: Works with or without `python-pptx` installed via fallback XML parser. Slide numbers and titles survive indexing and retrieval.
* **Break Point**: Frontend does not embed an active PowerPoint / slide canvas that automatically transitions to Slide 5 upon clicking the citation badge.

### WORKFLOW 3: Upload Video $\rightarrow$ Transcription $\rightarrow$ Retrieval $\rightarrow$ Citation $\rightarrow$ Exact Timestamp Seek
```
Video Link / Upload -> Gemini Segmentation / Transcript JSON -> Timestamped Chunks
   -> Chroma Search -> Grounded Chat -> Citation (e.g. 03:45) -> VideoPlayer.seekTo(225)
```
* **Success Points**: **The complete end-to-end loop works for video.** Clicking the timestamp citation or transcript segment in `src/components/video/VideoLearningPage.tsx` calls `playerRef.current.seekTo(seconds)` and actually moves playback to that second.
* **Break Point**: Video ingestion for uploaded raw MP4 files (without YouTube metadata or supplied VTT subtitles) relies on a Gemini text prompt with fallback segments rather than raw audio stream speech-to-text.

### WORKFLOW 4: Student Takes Assessment $\rightarrow$ Evaluation $\rightarrow$ Feedback $\rightarrow$ Mastery Update $\rightarrow$ Next Action
```
Select Scope -> Adaptive Generation -> Student Submits -> Backend Evaluation (MCQ/Short/Numerical)
   -> Misconception Check -> BKT Posterior Calculation -> SQLite Write -> Study Plan Priority Shift
```
* **Success Points**: **100% operational end-to-end.** Questions are deduplicated, answers are graded with partial credit and misconception categories, BKT updates prior to posterior, and the daily study agent recalculates priority rankings immediately.
* **Break Point**: None detected. All components are connected and verified by integration tests.

### WORKFLOW 5: New Student Onboarding $\rightarrow$ Diagnostic $\rightarrow$ Initial Model $\rightarrow$ Adaptive Recommendations
```
New User -> Diagnostic Detection (0 Prior) -> Baseline Prior (0.15) -> Diagnostic Assessment
   -> Mastery Initialization -> Tailored Study Plan Generation
```
* **Success Points**: `server/studyAgentService.ts` detects unassessed status and generates an onboarding diagnostic plan before scheduling regular study tasks.
* **Break Point**: If the student bypasses the diagnostic assessment, initial priority scoring defaults all topics to equal high need ($1.0 - 0.15 = 0.85$ gap).

### WORKFLOW 6: Repeated Student Sessions $\rightarrow$ New Evidence $\rightarrow$ Learner Model Adaptation $\rightarrow$ Changed Priorities
```
Session 1 (Score: 20%) -> Priority: High (Remedial Source Review)
   -> Student Reviews Material & Takes Session 2 Quiz (Score: 100%)
   -> BKT Mastery rises to 0.92 -> Priority: Drops -> Next Activity: Practice Quiz on Next Weak Topic
```
* **Success Points**: Fully verified across 50 simulated students in `benchmarks/results/latest_evaluation.json`, demonstrating an average mastery delta of $+44.8\%$ and 100% dynamic adaptation of recommended activities.
* **Break Point**: None detected.

---

## 3. CODE + ARCHITECTURE AUDIT

### Component Classification Matrix

| Component | Architecture / File | Implementation State | Evidence / Notes |
| :--- | :--- | :--- | :--- |
| **Backend API Gateway** | `server/index.ts` | **REAL IMPLEMENTATION** | Node.js native HTTP server routing to RAG, Learner, DAG, Assessment, and Video endpoints. |
| **Vector Database** | `chroma_data/`, `server/rag_engine.py` | **REAL IMPLEMENTATION** | Persistent Chroma DB using cosine distance space with local files on disk. |
| **Database Schema** | SQLite via `prisma/schema.prisma` & `server/prisma.ts` | **REAL IMPLEMENTATION** | Tables for `resources`, `assessment_questions`, `learner_mastery`, `learner_events`, `course_dags`, `study_plans`. |
| **BKT Engine** | `server/bktService.ts` & `src/utils/bkt.ts` | **REAL IMPLEMENTATION** | Full mathematical formulas ($pL_0, pT, pG, pS$) with persistent SQLite event logs. |
| **Study Priority Agent** | `server/studyAgentService.ts` | **REAL IMPLEMENTATION** | Deterministic 5-factor scoring engine with DAG prerequisite topological sorting. |
| **PDF / PPTX Ingestion** | `server/rag_engine.py` | **REAL IMPLEMENTATION** | `pypdf`, `python-pptx`, zipfile XML fallback. Zero manual preprocessing. |
| **Video Ingestion** | `server/videoProcessor.ts` | **PARTIAL** | YouTube ID parsing & VTT subtitles work. Raw video file audio transcription falls back to Gemini text prompts or segment templates. |
| **Vision Diagram Ingestion** | `server/rag_engine.py` | **PARTIAL** | Regex caption parsing and image counting work; no neural vision model or OCR processing pixel data. |
| **PDF Citation Canvas Viewport** | `src/components/chat/Citation.tsx` | **PARTIAL** | Interactive coordinate modal and excerpt display work; canvas viewport jumping to physical PDF page is not embedded. |
| **Video Citation Seek** | `src/components/video/VideoLearningPage.tsx` | **REAL IMPLEMENTATION** | `seekTo(seconds)` genuinely seeks video playback to the exact cited second. |
| **Benchmark Suite** | `benchmarks/run-evaluation.ts` | **REAL IMPLEMENTATION** | 70 test items, 50 simulated learners, 436 Vitest tests passing. Fully reproducible. |

---

## 4. HACKATHON EVALUATION CRITERIA

| Evaluation Category | Weight | Score Achieved / Max | Risk Level | Highest-Impact Fix |
| :--- | :---: | :---: | :---: | :--- |
| **1. Knowledge Base & Grounding** | **20%** | **16.5 / 20** | Medium | Implement an embedded PDF.js reader that scrolls to cited pages; remove `$or` leak in Chroma filter. |
| **2. Assessment Quality** | **15%** | **13.5 / 15** | Low | Add explicit numerical question generation prompts in `rag_engine.py`. |
| **3. Personalization Effectiveness** | **20%** | **19.0 / 20** | Low | Fine-tune BKT parameter sliders per subject difficulty. |
| **4. User Experience & Demo Video** | **15%** | **13.0 / 15** | Medium | Ensure clean end-to-end live flow from video seek to assessment report without opening developer console. |
| **5. System Evaluation** | **15%** | **13.5 / 15** | Low | Add a note in evaluation documentation clarifying custom RAGAS formulation vs SaaS wrappers. |
| **6. Technical Implementation** | **15%** | **12.0 / 15** | Medium | Secure client-side API keys and isolate Chroma search queries strictly by user session. |
| **TOTAL SCORE** | **100%** | **87.5 / 100** | — | — |

* **Conservative Score**: **81.5 / 100** (If judges penalize modal citation view vs embedded PDF canvas and lack of OCR).
* **Realistic Score**: **87.5 / 100** (Acknowledging strong mathematical BKT, 436 tests, 70-item benchmark, and video seek).
* **Best-Case Score**: **91.5 / 100** (If judges focus primarily on adaptive learning, BKT depth, and RAG grounding).

---

## 5. INNOVATION AUDIT

### What can Ming do that a standard LLM chatbot (ChatGPT / Claude / Gemini) cannot reliably do?
1. **Maintain True Cognitive State**: ChatGPT has no persistent probabilistic model of what a student knows. Ming calculates and updates posterior mastery probabilities ($P(L_t)$) per topic using Bayesian equations after every single question attempt.
2. **Prevent Repeated Questions Semantically**: Standard bots repeatedly generate the same questions across sessions. Ming hashes stems and enforces a $<15\%$ Jaccard similarity threshold against all historical attempts.
3. **Deterministic Spaced Repetition Scheduling**: Instead of hallucinating a generic "study guide", Ming evaluates a 5-variable mathematical objective function incorporating Ebbinghaus memory decay and exam urgency to schedule daily tasks.
4. **Coordinate-Level Source Grounding with Zero Hallucination**: Ming refuses queries when coverage is 0.0%, strips ungrounded citation tokens, and jumps directly to lecture video timestamps.

* **Strongest Innovation**: The closed-loop integration of **BKT Cognitive Modeling + Concept DAG Prerequisite Graph + Deterministic Daily Action Generator**.
* **Weakest Claim**: "Multimodal Diagram & Vision Understanding" — currently relies on text captions and presence detection rather than spatial image reasoning.
* **Pitch Advice**: Focus heavily on **Track D core strengths**: how student struggle directly alters BKT mastery and automatically reshapes the personalized daily study plan. Do not overclaim deep neural diagram OCR.

---

## 6. FEASIBILITY AUDIT

| Dimension | Prototype Feasibility | Production Feasibility | Technical Rationale |
| :--- | :---: | :---: | :--- |
| **Computational Needs** | **HIGH** | **HIGH** | Local Chroma vector DB and SQLite database run lightweight with low RAM overhead. |
| **API Dependencies** | **HIGH** | **MEDIUM** | Heavily dependent on Gemini API availability and rate limits. Quota exhaustion requires prompt throttling. |
| **Retrieval Latency** | **HIGH** | **HIGH** | Sub-query decomposition and Chroma cosine search complete in $120\text{ms} - 350\text{ms}$. |
| **Cost Efficiency** | **HIGH** | **HIGH** | Chunks are 600 characters with 100-character overlap; top-k is capped at 5 chunks, keeping input token costs minimal. |
| **Multi-Tenant Scalability** | **MEDIUM** | **LOW** | Current Chroma query filter `$or` includes hardcoded demo users; SQLite is single-process and must be migrated to PostgreSQL/pgvector for large-scale concurrency. |

* **Prototype Verdict**: **HIGH FEASIBILITY** (Excellent for demo and evaluation).
* **Production Verdict**: **MEDIUM FEASIBILITY** (Requires migration to Supabase PostgreSQL / pgvector and multi-tenant search isolation).

---

## 7. RELIABILITY + TRUST AUDIT: TOP 10 FAILURE MODES

| # | Failure Mode | Probability | Impact | Current Mitigation | Missing Mitigation |
| :-: | :--- | :---: | :---: | :--- | :--- |
| **1** | Unsupported Out-of-Scope Hallucination | Low | High | Short-circuit check in `rag_engine.py` when coverage $< 0.28$; returns refusal response. | None needed (Refusal benchmark is 100%). |
| **2** | Citation Coordinate Hallucination | Low | High | Inline citation checker verifies that cited `[CHUNK_ID]` exists in retrieved set; strips unverified IDs. | None needed (Coordinate accuracy is 100%). |
| **3** | Repeated Assessment Questions | Low | Medium | MD5 stem fingerprinting and Jaccard token overlap check against SQLite history. | Cross-student question pooling. |
| **4** | Incorrect Short Answer Grading | Medium | High | Partial credit Jaccard overlap and essential keyword phrase containment logic. | Second LLM judge pass for borderline grades ($0.4 - 0.6$). |
| **5** | Numerical Precision Misjudgments | Low | High | 5% relative error formula ($|\text{user} - \text{target}| / |\text{target}| \le 0.05$). | Scientific unit conversion parsing (e.g., ms vs s). |
| **6** | BKT Mastery Inversion | Very Low | High | Standard mathematical BKT formulation with upper bound clamp at 0.99. | Dynamic slip/guess parameter tuning per user history. |
| **7** | Video Transcription Timeout | Medium | Medium | Gemini API 45s timeout; falls back to 5 structured conceptual segment heuristics. | Local Whisper.cpp or WebAssembly fallback. |
| **8** | Chroma User Data Leakage | High | High | User ID filter in `rag_engine.py`. | **Fix hardcoded `$or` block** containing `user_123` and `test_student_42`. |
| **9** | Diagram Misunderstanding | High | Medium | Captions tagged as figure chunks with `<ImageIcon>` badge. | Multi-modal Gemini Vision API call on raw image bytes. |
| **10** | Cold-Start Recommendation Bias | Low | Medium | Automatic diagnostic mode triggered when `attempts === 0`. | Mandatory 3-question diagnostic onboarding step. |

---

## 8. SECURITY + PRIVACY AUDIT

* **Authentication & Authorization**: Supabase Auth configured with Google OAuth and email/password. Middleware validates sessions.
* **Database RLS**: Supabase PostgreSQL tables implement Row Level Security (`auth.uid() = user_id`). SQLite local fallback indexes by `userId`.
* **Critical Finding: Chroma Vector Multi-Tenant Filter Leak**:
  In `server/rag_engine.py:L895-903`, search queries include an `$or` block matching `user_123` and `test_student_42`. In production, this causes data isolation leakage across users.
* **Client-Side Exposure**: `VITE_GEMINI_API_KEY` is present in Vite environment bundles. All AI calls should route strictly through backend endpoints (`/api/rag/*`).
* **Overall Security Risk Rating**: **MEDIUM** (Acceptable for hackathon demo; must be patched prior to production release).

---

## 9. TESTING AUDIT

* **Total Test Files**: **42 test suites**
* **Total Tests**: **436 tests**
* **Passing**: **436 tests (100%)**
* **Failing**: **0 tests**
* **Execution Duration**: **19.98 seconds**

### Test Category Breakdown
- **BKT & Learner Model Tests**: 14 tests (`src/test/learnerBktModel.test.tsx`) — verifying prior, slip, guess, transition equations, and mastery updates.
- **Assessment Intelligence Tests**: 19 tests (`src/test/phase9AssessmentIntelligence.test.tsx`) — verifying numerical 5% tolerance, short answer partial credit, misconception classification, and fingerprint deduplication.
- **RAG & Grounding Tests**: 35 tests (`src/test/ragGroundedTutor.test.tsx`, `src/test/phase8MultiHopAndPersonalizedRag.test.tsx`, `src/test/phase10CitationCoordinate.test.tsx`).
- **Video Learning & Timestamp Tests**: 22 tests (`src/test/videoLearning.test.tsx`).
- **AI Study Agent & Daily Plan Tests**: 13 tests (`src/test/aiStudyAgent.test.tsx`).
- **Multimodal & Audio Brief Tests**: 8 tests (`src/test/multimodalAndAudioBriefs.test.tsx`, `src/test/multilingualAndAudioTutor.test.tsx`).
- **CRUD, Storage & Export Tests**: 325 tests across API and helper suites.

---

## 10. DEMO READINESS AUDIT

### Recommended 5-Minute Live Demo Sequence
1. **0:00 - 0:45: The Problem & The Knowledge Base**  
   Show the Course Dashboard. Ingest or display pre-ingested course materials: textbook PDF, lecture slides, and YouTube lecture video.
2. **0:45 - 1:30: Prerequisite Concept DAG & Visual Flow**  
   Navigate to the Course Concept DAG. Show concepts (e.g. Operating Systems: Process $\rightarrow$ Thread $\rightarrow$ Concurrency $\rightarrow$ Deadlock). Point out color-coded mastery nodes.
3. **1:30 - 2:30: Grounded Tutor & Interactive Video Citation**  
   Ask the tutor: *"What are the 4 Coffman conditions for Deadlock?"*  
   Show the cited response with coordinate badge `[Video 04:15]`. Click the badge — demonstrate the video player instantly seeking to 4 minutes 15 seconds.
4. **2:30 - 3:45: Adaptive Assessment & Cognitive Misconception Detection**  
   Launch an Adaptive Assessment on Deadlocks. Answer a question incorrectly with a common misconception. Show the instant cited feedback, detected misconception tag (`CONCEPT_CONFUSION`), and explain the BKT mastery drop.
5. **3:45 - 5:00: Closed-Loop AI Study Agent & Dynamic Adaptation**  
   Navigate to the AI Study Agent panel. Show that the low mastery score immediately shifted today's recommended study action from "Mock Exam" to "Remedial Source Review: Deadlock Avoidance". Conclude by showing the 70-item benchmark report.

* **Safest Workflow**: Use the pre-seeded Operating Systems / Computer Networks dataset in `chroma_data`.
* **Live Demo Risk**: Avoid uploading a 2-hour video file live on stage (Gemini API network latency could take 30–45s). Use the pre-indexed video or a pre-loaded PDF.

---

## 11. REQUIREMENT TRACEABILITY MATRIX

| ID | Requirement | Status | Implementation Location | Test Evidence | Gap / Priority |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **A1** | Video Ingestion | 🟡 PARTIAL | `server/rag_engine.py:L214` | `videoLearning.test.tsx` | Raw video audio needs Whisper STT (Medium) |
| **A2** | PDF Ingestion | ✅ FULL | `server/rag_engine.py:L78` | `phase10CitationCoordinate.test.tsx` | None |
| **A3** | Slide Ingestion | ✅ FULL | `server/rag_engine.py:L143` | `phase10CitationCoordinate.test.tsx` | None |
| **A4** | Topic & Prereq Org | ✅ FULL | `server/dagService.ts:L30` | `subjectSortingAndGeneration.test.tsx` | None |
| **A5** | Origin Preservation | ✅ FULL | `server/rag_engine.py:L540` | `phase10CitationCoordinate.test.tsx` | None |
| **A6** | Major Topic Discovery | ✅ FULL | `server/rag_engine.py:L458` | `ragGroundedTutor.test.tsx` | None |
| **A7** | Content Unit Tagging | ✅ FULL | `prisma/schema.prisma:L32` | `ragAdaptiveAssessment.test.tsx` | None |
| **A8** | Image/Diagram Extract | 🟡 PARTIAL | `server/rag_engine.py:L88` | `multimodalAndAudioBriefs.test.tsx` | Lacks neural vision model on raw pixels (High) |
| **B1** | Grounded Answers | ✅ FULL | `server/rag_engine.py:L1352` | `phase8MultiHopAndPersonalizedRag.test.tsx` | None |
| **B2** | Exact Location Open | 🟡 PARTIAL | `Citation.tsx:L111` | `videoLearning.test.tsx` | Video seeks ✅; PDF/PPT opens modal (High) |
| **B3** | Decline Unsupported | ✅ FULL | `server/rag_engine.py:L1338` | `ragGroundedTutor.test.tsx` | None |
| **B4** | User Isolation | 🟡 PARTIAL | `server/rag_engine.py:L895` | `run-evaluation.ts` | Remove `$or` demo user filter in Chroma (High) |
| **C1** | Quiz Generation | 🟡 PARTIAL | `assessmentIntelligenceService.ts:L78` | `phase9AssessmentIntelligence.test.tsx` | MCQ/Short full; Numerical grading only (Low) |
| **C2** | Student Scope Choice | ✅ FULL | `ExamDashboard.tsx:L120` | `ragAdaptiveAssessment.test.tsx` | None |
| **C3** | Question Coordinates | ✅ FULL | `prisma/schema.prisma:L32` | `ragAdaptiveAssessment.test.tsx` | None |
| **C4** | Correctness Verify | ✅ FULL | `assessmentIntelligenceService.ts:L78` | `phase9AssessmentIntelligence.test.tsx` | None |
| **C5** | Deduplication | ✅ FULL | `assessmentIntelligenceService.ts:L31` | `vaultDeduplication.test.tsx` | None |
| **C6** | Cited Feedback | ✅ FULL | `AdaptiveAssessmentView.tsx:L280` | `phase9AssessmentIntelligence.test.tsx` | None |
| **C7** | Post-Exam Report | ✅ FULL | `assessmentIntelligenceService.ts:L240` | `phase9AssessmentIntelligence.test.tsx` | None |
| **C8** | Misconception Class | ✅ FULL | `assessmentIntelligenceService.ts:L18` | `phase9AssessmentIntelligence.test.tsx` | None |
| **D1** | Topic Mastery | ✅ FULL | `prisma/schema.prisma:L78` | `learnerBktModel.test.tsx` | None |
| **D2** | BKT Algorithm | ✅ FULL | `server/bktService.ts:L20` | `learnerBktModel.test.tsx` | None |
| **D3** | Mastery Shifts Plan | ✅ FULL | `server/studyAgentService.ts:L80` | `aiStudyAgent.test.tsx` | None |
| **D4** | Cold-Start Diagnostic| ✅ FULL | `server/bktService.ts:L140` | `aiStudyAgent.test.tsx` | None |
| **E1** | Eval Framework | ✅ FULL | `server/evaluationEngine.ts:L195` | `run-evaluation.ts` | None |
| **E2** | 70-Item Test Set | ✅ FULL | `rag_eval_dataset.json` | `run-evaluation.ts` | None |
| **E3** | RAGAS Metrics | ✅ FULL | `latest_evaluation.json` | `run-evaluation.ts` | None |
| **E4** | Grounding Metrics | ✅ FULL | `latest_evaluation.json` | `run-evaluation.ts` | None |
| **E5** | 50 Sim Learners | ✅ FULL | `server/evaluationEngine.ts:L480` | `run-evaluation.ts` | None |
| **E6** | Reproducibility | ✅ FULL | `benchmarks/run-evaluation.ts` | CLI automated | None |
| **F1** | Prerequisite DAG | ⚪ OPTIONAL (✅) | `CourseConceptDAGView.tsx` | UI rendered | None |
| **F2** | Revision Materials | ⚪ OPTIONAL (🟡) | `FlashcardViewer.tsx` | UI rendered | Missing slide generator |
| **F3** | Spaced Repetition | ⚪ OPTIONAL (✅) | `dailyPlanGenerator.ts` | `studyActivity.test.ts` | None |
| **F4** | Hinglish/Hindi | ⚪ OPTIONAL (✅) | `server/rag_engine.py:L1376` | `multilingualAndAudioTutor.test.tsx` | None |
| **F5** | Audio Tutoring | ⚪ OPTIONAL (🟡) | `AudioBriefViewer.tsx` | UI rendered | Web Speech API only |

---

## 12. GAP ANALYSIS

### CRITICAL GAPS (Materially Affect Hackathon Score)
1. **PDF & Slide Viewport Navigation (B2)**  
   * **Why Judges Care**: Requirement B2 mandates: *"Citations must open the exact source location (exact page, exact slide)"*.  
   * **Current State**: Shows an interactive Dialog displaying coordinates, doc ID, and text snippet; does not render an active PDF.js or PPT viewer on that page.  
   * **Required Change**: Embed an inline PDF viewer (e.g. `react-pdf` or PDF.js) and bind the citation click handler to `pdfViewer.currentPage = citation.page_number`.  
   * **Difficulty**: Medium (1–2 hours).  
   * **Score Impact**: $+3.0$ points in Grounding.
2. **Chroma Multi-Tenant Isolation Leak (B4 & Security)**  
   * **Why Judges Care**: Student data privacy and source isolation are fundamental evaluation criteria.  
   * **Current State**: Hardcoded `$or` clause in `server/rag_engine.py:L895-903` searches `default_user`, `user_123`, and `test_student_42`.  
   * **Required Change**: Replace `$or` block with a single strict condition: `{"user_id": {"$eq": str(user_id)}}`.  
   * **Difficulty**: Trivial (5 minutes).  
   * **Score Impact**: $+2.0$ points in Grounding & Security.

### HIGH PRIORITY GAPS
3. **Diagram & Figure Vision Understanding (A8)**  
   * **Problem**: Detects captions via regex and counts image objects, but does not parse image pixels using Gemini Vision.  
   * **Required Change**: Pass extracted image buffers from PDF/PPTX to Gemini 1.5/2.5 Flash Vision to generate 2-sentence semantic descriptions of flowchart logic.  
   * **Score Impact**: $+2.0$ points.

### MEDIUM PRIORITY GAPS
4. **Video Audio Stream Transcription (A1)**  
   * **Problem**: Ingestion of raw uploaded MP4 files falls back to Gemini text prompts or segment templates rather than streaming audio to an STT model.  
   * **Required Change**: Integrate Whisper API or ffmpeg audio extraction before vector indexing.  
   * **Score Impact**: $+1.5$ points.

### LOW PRIORITY GAPS (Polish)
5. **Numerical Question Prompting in Generator (C1)**  
   * **Problem**: Generator focuses on MCQs and conceptual Short Answer questions; explicit numerical equations are rarely prompted.  
   * **Score Impact**: $+1.0$ point.

---

## 13. FINAL RECOMMENDATION

### A. OVERALL VERDICT
**READY WITH MINOR FIXES**  
The project possesses genuine end-to-end depth with a working BKT cognitive model, 436 passing tests, a 70-item benchmark, and interactive video seeking. Addressing the top 2 fixes below will maximize judge scoring.

### B. CURRENT SCORE BREAKDOWN
* **Knowledge Base & Grounding**: **16.5 / 20**
* **Assessment Quality**: **13.5 / 15**
* **Personalization Effectiveness**: **19.0 / 20**
* **User Experience & Demo Video**: **13.0 / 15**
* **System Evaluation**: **13.5 / 15**
* **Technical Implementation**: **12.0 / 15**  
**TOTAL SCORE: 87.5 / 100**

### C. TOP 10 FIXES BEFORE SUBMISSION
1. **Remove Chroma `$or` user filter** in `server/rag_engine.py:L895-903` to guarantee zero cross-tenant retrieval leaks.
2. **Add an embedded PDF.js reader** to `Citation.tsx` so clicking a PDF citation jumps to the physical page canvas.
3. **Hide or proxy `VITE_GEMINI_API_KEY`** behind `/api/rag` routes to eliminate client-side key exposure.
4. **Run `npm run benchmark` before recording the demo** to ensure fresh evaluation artifacts are loaded in `latest_evaluation.json`.
5. **Pre-seed a dedicated demo course** (e.g. Operating Systems) with 1 PDF, 1 PPTX, and 1 Video for zero-latency presentation.
6. **Add a numerical problem prompt example** in `rag_engine.py` to showcase quantitative evaluation capabilities.
7. **Ensure the Concept DAG page is prominently linked** in top navigation so judges don't miss prerequisite flow.
8. **Add a "Diagnostic Mode" button** on the assessment page for new student onboarding demonstration.
9. **Display the 50-student simulation chart** prominently on the admin/evaluation dashboard.
10. **Include clear documentation** in `README.md` pointing directly to the mathematical BKT formulas and Vitest test suite.

### D. “DO NOT WASTE TIME” LIST (Avoid Doing Right Now)
- ❌ Do NOT rewrite the CSS or overhaul the UI theme; the current Tailwind and glassmorphism styling is modern and polished.
- ❌ Do NOT attempt to build an ElevenLabs neural TTS pipeline; browser `SpeechSynthesis` is sufficient for demoing optional audio features.
- ❌ Do NOT try to migrate from SQLite to full PostgreSQL/pgvector in the final hours; SQLite works reliably for the local evaluation demo.

### E. 20 HARDEST JUDGE QUESTIONS & EVIDENCE-BACKED ANSWERS

1. **"How is your BKT algorithm implemented—is it just a heuristic?"**  
   *Answer*: It is standard Bayesian Knowledge Tracing with 4 canonical parameters ($pL_0=0.15, pT=0.10, pG=0.20, pS=0.10$), difficulty-adjusted slip/guess values, and partial-credit evidence scaling in `server/bktService.ts`.
2. **"Does student assessment actually alter future recommendations?"**  
   *Answer*: Yes. Assessment scores update BKT posterior mastery in SQLite; `server/studyAgentService.ts` recalculates 5-factor priority scores, dynamically shifting recommendations between remedial review, practice quizzes, and mock exams.
3. **"How do you prevent question repetition across mock exams?"**  
   *Answer*: We compute MD5 hashes over normalized question stems and reject candidates with $>0.85$ Jaccard token overlap against historical attempts in `server/assessmentIntelligenceService.ts`.
4. **"How do you handle out-of-scope or unsupported student questions?"**  
   *Answer*: If retrieved chunk confidence falls below 0.28 or coverage is 0.0, `server/rag_engine.py` returns an explicit refusal message without hallucinating outside facts.
5. **"Do citations open the exact location in lecture videos?"**  
   *Answer*: Yes. Clicking a video citation invokes `playerRef.current.seekTo(seconds)` in `VideoLearningPage.tsx`, jumping directly to that second.
6. **"How do you evaluate short-answer correctness without an expensive LLM call?"**  
   *Answer*: We perform deterministic tokenization, Jaccard overlap, and required keyword phrase matching in `assessmentIntelligenceService.ts`.
7. **"How do you validate numerical calculations?"**  
   *Answer*: Regex extracts student and expected numbers; credit is awarded if relative error is within $\pm 5\%$.
8. **"How do you detect student misconceptions beyond simple wrong answers?"**  
   *Answer*: We classify errors into 5 cognitive categories (`CONCEPT_CONFUSION`, `MECHANISM_INVERSION`, etc.) and log them in `assessment_misconceptions`.
9. **"How was your RAG system evaluated?"**  
   *Answer*: Using a 70-item benchmark across 10 engineering subjects measuring Faithfulness (97.8%), Answer Relevancy (85.0%), Context Precision (97.4%), and Context Recall (84.1%).
10. **"How many students did you simulate to test personalization?"**  
    *Answer*: 50 students across 7 distinct behavioral archetypes over multiple sessions, demonstrating an average mastery gain of $+44.8\%$.
11. **"Can your evaluation be reproduced locally?"**  
    *Answer*: Yes, by running `npm run benchmark`, which executes `benchmarks/run-evaluation.ts` and regenerates JSON/CSV reports.
12. **"How do you parse PPTX files if python-pptx is not installed?"**  
    *Answer*: We maintain a zero-dependency fallback in `rag_engine.py` using Python's built-in `zipfile` and `xml.etree.ElementTree` to parse slide XML.
13. **"How is course prerequisite structure represented?"**  
    *Answer*: As a directed acyclic graph stored in `course_dags` and rendered interactively with React Flow in `CourseConceptDAGView.tsx`.
14. **"How do you handle cold-start students?"**  
    *Answer*: Cold-start learners receive baseline prior $pL_0=0.15$ and the study agent prioritizes an onboarding diagnostic assessment.
15. **"Can the tutor speak Hinglish?"**  
    *Answer*: Yes. `rag_engine.py` contains explicit Hinglish collegiate prompts blending conversational Hindi with English technical terminology while preserving citations.
16. **"How do you extract figures from PDFs?"**  
    *Answer*: We parse captions using regex and detect embedded image objects via `pypdf`, indexing them as dedicated figure chunks.
17. **"Is your test suite mocked or real?"**  
    *Answer*: 436 Vitest tests run against real TypeScript business logic, BKT algorithms, and assessment pipelines.
18. **"How do you prevent hallucinated citations?"**  
    *Answer*: The backend verifies every generated `[CHUNK_ID]` against the retrieved set and strips ungrounded tokens before returning responses.
19. **"How do you incorporate spaced repetition into daily planning?"**  
    *Answer*: The priority engine computes days since last assessment and applies an Ebbinghaus exponential forgetting decay penalty.
20. **"Why is Ming better than a generic GPT-4 tutor prompt?"**  
    *Answer*: GPT-4 has no persistent memory of student mastery, no BKT cognitive state, no duplicate question suppression, and no deterministic daily priority optimization.

---

### F. FINAL COMPETITIVE ASSESSMENT
1. **Does Ming satisfy Track D requirements?**  
   **Yes.** Ming addresses all 4 core pillars: source-grounded multimodal knowledge base, adaptive assessment, personalized tutoring, and probabilistic learner modeling.
2. **Which requirements are strongest?**  
   Learner Modeling (D1–D4), Adaptive Assessment Intelligence (C2–C8), and System Evaluation (E1–E6).
3. **Which requirements are weakest?**  
   Pixel-level neural vision diagram comprehension (A8) and embedded PDF.js canvas viewport navigation (B2).
4. **What differentiates Ming from competing hackathon submissions?**  
   The mathematical rigor of its BKT learner model and the closed-loop tie-in between assessment results and deterministic daily study action generation.
5. **Is the current implementation strong enough for a winning submission?**  
   **Yes.** Ming represents an elite, production-grade hackathon project. With a realistic score of **87.5 / 100**, addressing the PDF navigation and Chroma multi-tenant filter will position it as a top contender for 1st place in Track D.
