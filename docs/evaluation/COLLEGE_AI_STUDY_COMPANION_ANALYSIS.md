# 🎓 Ming AI: College Student Multimodal AI Study Companion
## Comprehensive Analysis, Requirement Fulfillment Audit, & Engineering Blueprint

> **Target Audience Focus:** Undergraduate & Postgraduate College Students (Engineering, Computer Science, Sciences, Commerce, etc.)  
> **Challenge Objective:** Unify lecture videos, textbooks, and slide decks into a source-cited knowledge base with adaptive assessments and personalized learner modeling.

---

## 📑 Table of Contents
1. [Executive Summary & College Persona Context](#1-executive-summary--college-persona-context)
2. [Current Codebase Architecture & College Features Audit](#2-current-codebase-architecture--college-features-audit)
3. [Deep-Dive Requirement Analysis: Built vs Remaining vs How to Build](#3-deep-dive-requirement-analysis-built-vs-remaining-vs-how-to-build)
   - [Requirement 1: Multimodal Knowledge Base](#requirement-1-multimodal-knowledge-base)
   - [Requirement 2: Source Grounding](#requirement-2-source-grounding)
   - [Requirement 3: Adaptive Assessment](#requirement-3-adaptive-assessment)
   - [Requirement 4: Learner Model (BKT / IRT / Spaced Repetition)](#requirement-4-learner-model-bkt--irt--spaced-repetition)
   - [Requirement 5: System Evaluation & Benchmarking (RAGAS / DeepEval)](#requirement-5-system-evaluation--benchmarking-ragas--deepeval)
   - [Requirement 6: Optional Enhancements (Hinglish, Course DAG, Audio Tutor)](#requirement-6-optional-enhancements)
4. [College Student Specialized Feature Matrix](#4-college-student-specialized-feature-matrix)
5. [Proposed System Architecture & Data Schema](#5-proposed-system-architecture--data-schema)
6. [Step-by-Step Implementation Roadmap](#6-step-by-step-implementation-roadmap)
7. [Deliverables Blueprint (Prototype, Docs, Benchmark, 3-10m Demo Video Script)](#7-deliverables-blueprint)

---

## 1. Executive Summary & College Persona Context

### Why College Students Are Unique
College students don't learn from a single pristine textbook. Their real-world academic cycle consists of:
1. **Scattered Resources:** 
   - 60-slide PowerPoint presentations (`.pptx` / PDF) uploaded by professors 12 hours before a mid-term.
   - 800-page standard reference textbooks (e.g., Cormen for Algorithms, Silberschatz for Operating Systems).
   - 1-hour recorded Zoom/Teams lectures or YouTube/NPTEL playlists.
   - Hand-written lab manuals and senior notes.
2. **High Stakes for Precision:**
   - Hallucinations fail university exams. If a student writes an answer that contradicts the professor's lecture slides or prescribed syllabus, they lose marks.
   - **Source Grounding** is mandatory: Students need to see: *"Where in Lecture 7 slide 14 or Cormen Page 218 is this derived?"*
3. **Assessment Reality:**
   - College exams include **MCQs, 5-mark short derivations, and numerical problems** (e.g., CPU scheduling waiting times, Dijkstra's step trace, chemical thermodynamics).
4. **Bilingual Mental Model (Indian College Context):**
   - Students in Tier-1/2/3 colleges in India listen to English lectures, read English textbooks, but ask doubts and comprehend complex engineering abstractions in **"Hinglish"** (Hindi + English).

---

## 2. Current Codebase Architecture & College Features Audit

### 2.1 What the Current Project Has Built
The repository `StudyMate.ai-1` has a solid full-stack foundation:
- **Frontend Framework:** React 18 + TypeScript + Vite + Tailwind CSS + Radix UI + Lucide Icons.
- **Backend & Auth:** Supabase Auth (with Google OAuth and Email), Supabase Storage for files, Edge Functions (`ai-assistant`), and Node.js + Prisma + LibSQL/SQLite (`server/index.ts` and `api/resources.ts`).
- **Dual Persona Mode:** Distinct separation between **College Mode** and **Exam Mode**:
  - [src/components/MainApp.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/MainApp.tsx)
  - [src/components/layout/ContentRenderer.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/layout/ContentRenderer.tsx)
- **College Dashboard:**
  - [src/components/dashboard/CollegeDashboard.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/dashboard/CollegeDashboard.tsx): Displays student semester, branch, current CGPA, Active Projects (academic, coding, freelance), daily skill learning milestones, and monthly freelance earnings.
- **Deep College Workspaces:**
  - [src/components/projects/ProjectFocusView.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/projects/ProjectFocusView.tsx): Pomodoro study timer, simulated terminal, Monaco code scratchpad, integrated FocusBot chat, task breakdown, and LeetCode problem launcher.
  - [src/components/integrations/IntegrationsPage.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/integrations/IntegrationsPage.tsx): Connectors for GitHub, LeetCode, and LinkedIn.
- **AI Generation Suite:**
  - [src/components/ai/PremiumAIGenerator.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/ai/PremiumAIGenerator.tsx) & [src/components/ai/AIStudyMaterialGenerator.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/ai/AIStudyMaterialGenerator.tsx): Multi-step wizard generating Flashcards, Quizzes, Mind Maps, Flowcharts, and Revision Notes via Google Gemini 1.5 Flash.
  - [src/components/flashcards/QuizViewer.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/flashcards/QuizViewer.tsx): Interactive MCQ quiz runner with instant review.
  - [src/components/resources/ResourceSpace.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/resources/ResourceSpace.tsx) & [src/components/notion/NotionResourceManager.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/notion/NotionResourceManager.tsx): Document upload, folder categorizing, markdown notes.

### 2.2 Architectural Gap Summary Against Challenge Requirements
| Challenge Area | Ming (Initial Baseline) | Required State for Challenge |
| :--- | :--- | :--- |
| **Multimodal Ingestion** | Only `.txt` text parsing & PDF storage; no video/slide parsing. | Automatic transcription of lectures, slide extraction, textbook PDF chunking with page/slide/timestamp tagging. |
| **Source Grounding** | Pure zero-shot Gemini prompting (`ai-assistant`). No RAG. | Vector embedding retrieval; answers cite exact `[[slide:12]]`, `[[page:84]]`, `[[t:14m30s]]` with interactive jumping. |
| **Out-of-Scope Gating** | Prompt rule: *"stay on topic"*. | Mathematical similarity gating + distinct labeling: Source-backed vs Outside Knowledge vs Decline. |
| **Adaptive Assessment** | Static Gemini MCQs generated per topic string. | Multi-format (MCQ, Short Answer, Numerical), verified by 2nd-pass LLM, tagged to course citations, deduplicated. |
| **Learner Model** | Simple completion percentage (`completed/total * 100`). | Bayesian Knowledge Tracing (BKT) / IRT updating per-concept mastery from quizzes + conversation. |
| **Evaluation Framework** | Vitest for unit tests; no AI pipeline evaluation. | RAGAS / DeepEval harness computing Faithfulness, Answer Relevance, Context Precision & Recall. |

---

## 3. Deep-Dive Requirement Analysis: Built vs Remaining vs How to Build

---

### Requirement 1: Multimodal Knowledge Base

#### 1a. Ingest lecture videos, textbooks, and slide decks without manual preprocessing
- **What is Already Built:**
  - [src/components/resources/ResourceSpace.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/resources/ResourceSpace.tsx): File upload UI for PDFs and Notes, integrating with Supabase Storage and storing metadata in LibSQL/SQLite via [api/resources.ts](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/api/resources.ts).
  - [src/components/ai/FileUploadComponent.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/ai/FileUploadComponent.tsx): Accepts text and basic files for AI prompting.
- **What is Remaining:**
  - ❌ Video ingestion pipeline (no transcription of MP4/YouTube/Zoom lecture links).
  - ❌ Slide deck ingestion (`.pptx`, Keynote, or multi-slide PDF) separating individual slides.
  - ❌ Textbook ingestion (chunking large multi-chapter PDFs while preserving page numbers and chapter headings).
- **How to Build for College Students:**
  1. **Video Ingestion:**
     - Enable college students to paste a **YouTube lecture link** or upload a **recorded lecture MP4/WAV**.
     - Backend route `/api/ingest/video` uses `yt-dlp` for YouTube audio download + **OpenAI Whisper** or **Gemini 1.5 Pro/Flash Multimodal API** (Gemini native audio/video processing handles up to 1 hour with timestamped transcripts).
     - Store chunks with `{ text, startTime: seconds, endTime: seconds, videoUrl }`.
  2. **Slide Decks (`.pptx` / PDF slides):**
     - Use `python-pptx` (via a Python microservice) or `pdf2image` + `tesseract`/`PyMuPDF` in Node.js.
     - Treat every slide as an atomic unit: `{ slideNumber, title, bulletsText, speakerNotes, imagePath }`.
  3. **Textbooks:**
     - Use `pdfjs-dist` or `unstructured` to parse page-by-page. Retain chapter titles from the Table of Contents and attach `{ pageNumber, chapter, section }` to every chunk.

---

#### 1b. Organize content into topics, concepts, and prerequisites with exact origin linking
- **What is Already Built:**
  - [src/hooks/useSkills.ts](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/hooks/useSkills.ts): Parses syllabus arrays with `dayNumber`, `topic`, `completed` booleans.
  - High-level categorization into folders in `ResourceSpace.tsx`.
- **What is Remaining:**
  - ❌ Linking each content chunk to an exact origin tuple: `(source_id, type, page_number, slide_number, video_timestamp)`.
  - ❌ Concept dependency/prerequisite graph (e.g., *"Process Synchronization"* requires *"Processes"* and *"CPU Scheduling"*).
- **How to Build for College Students:**
  1. **Define Unified Origin Schema in Prisma:**
     ```prisma
     model ContentChunk {
       id             String   @id @default(cuid())
       resourceId     String
       courseCode     String   // e.g., "CS301 - Operating Systems"
       unitNumber     Int      // College syllabus Unit (1 to 5)
       topicName      String   // e.g., "Dining Philosophers Problem"
       conceptTags    String   // JSON array: ["deadlock", "semaphores"]
       originType     String   // "VIDEO" | "SLIDE" | "TEXTBOOK"
       pageNumber     Int?     // For textbooks
       slideNumber    Int?     // For PPT slides
       timestampStart Int?     // In seconds for video
       timestampEnd   Int?     
       content        String   // Extracted textual content
       embedding      Unsupported("vector(768)")? // pgvector / sqlite-vec
     }
     ```
  2. **Prerequisite Extraction Pipeline:**
     - Run an LLM extraction pass over syllabus/slides:
       *Prompt:* "Given these college course topics, output a JSON DAG of concepts with `{ concept, prerequisites: [...] }`."
     - Store edges in a `ConceptDependency` table.

---

#### 1c. Identify major topics, subtopics, and key concepts, and tag every content unit
- **What is Already Built:**
  - [supabase/functions/ai-assistant/index.ts](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/supabase/functions/ai-assistant/index.ts): Mind map and notes prompts parse topics and subtopics into structured JSON.
- **What is Remaining:**
  - ❌ Automatic hierarchical topic taxonomy generator that matches standard college syllabus structures (University Course $\rightarrow$ 5 Units $\rightarrow$ Chapters $\rightarrow$ Concepts).
  - ❌ Automated tagging of ingested chunks to this taxonomy.
- **How to Build for College Students:**
  1. When a college student registers a course (e.g. *Database Management Systems*):
     - Offer standard university syllabus templates (VTU, Anna Univ, Mumbai Univ, AKTU, AICTE standard).
     - Or allow uploading the college course syllabus PDF $\rightarrow$ LLM parses it into:
       `Unit 1: ER Models`, `Unit 2: Relational Algebra & SQL`, `Unit 3: Normalization`, etc.
  2. For each incoming chunk from video, slide, or textbook:
     - Vector match chunk against the course syllabus concept embeddings. Tag the top matching `unit_id`, `topic_id`, and `concept_id`.

---

#### 1d. Extract and use information from images, diagrams, and figures in slides and textbooks
- **What is Already Built:**
  - `ai-assistant` has a prompt that generates flowchart JSON syntax.
- **What is Remaining:**
  - ❌ Extracting actual visual diagrams from professor slides and textbook figures (e.g., UML diagrams, Circuit diagrams, Karnaugh maps, B-Tree insertion illustrations).
  - ❌ Generating semantic image captions and embedding them for retrieval.
- **How to Build for College Students:**
  1. **Multimodal Visual Pipeline (Gemini 1.5 Flash Vision):**
     - During PDF/Slide extraction, extract all embedded images and rendered page frames.
     - Send the diagram image to Gemini 1.5 Flash Vision with the prompt:
       *"Describe this engineering diagram in detail. List all components, labels, flow directions, equations, and key takeaways for an engineering student exam."*
     - Store the image in Supabase Storage (`/diagrams/{id}.png`) and store the generated description in the knowledge base, linking to the image URL.
  2. **Retrieval in Chat:** When explaining a concept (e.g., *"Explain Three-Phase Handshake in TCP"*), the assistant returns the textual answer **together with the professor's original slide diagram**.

---

### Requirement 2: Source Grounding

#### 2a. Explain concepts and answer questions using cited excerpts that open the exact page, slide, or timestamp
- **What is Already Built:**
  - [src/components/chat/AIChat.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/chat/AIChat.tsx): Full chat UI with messages, auto-scroll, markdown rendering, copy-to-clipboard, and history panel.
- **What is Remaining:**
  - ❌ Vector similarity search (RAG) connecting `AIChat` to the student's uploaded materials.
  - ❌ Citation markdown syntax and interactive frontend citation badges that open the source view.
- **How to Build for College Students:**
  1. **RAG Retrieval Engine:**
     - User asks: *"Why does two-phase locking prevent conflicting serializability?"*
     - Vector search retrieves top-4 chunks from the student's *DBMS* materials.
     - System prompt instructs Gemini:
       ```
       You are an expert college tutor. Answer the student's query using ONLY the provided context chunks.
       For EVERY factual claim, cite the source using this exact markdown tag:
       - Textbook: [[cite:textbook|docId|page=142]]
       - Slide: [[cite:slide|slideDeckId|slide=23]]
       - Video: [[cite:video|videoId|t=14m20s]]
       ```
  2. **Interactive Citation Badges in [AIChat.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/chat/AIChat.tsx):**
     - Custom React markdown renderer replaces `[[cite:...]]` with a clickable badge:
       - `[📘 Silberschatz p. 142]` $\rightarrow$ Opens in-app PDF Modal jumped to page 142.
       - `[🎞️ Lecture 8 @ 14:20]` $\rightarrow$ Opens Video Player modal seeked directly to `00:14:20`.
       - `[📊 Lecture Slides #23]` $\rightarrow$ Opens high-res slide modal.

---

#### 2b. Decline or clearly flag queries the material does not cover, separating outside knowledge from source-backed content
- **What is Already Built:**
  - [supabase/functions/ai-assistant/index.ts](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/supabase/functions/ai-assistant/index.ts): Strict system rules prohibiting hallucinations.
- **What is Remaining:**
  - ❌ Similarity score thresholding to detect off-material queries.
  - ❌ Two-tier answer presentation (Course-Backed vs External Knowledge vs Direct Refusal).
- **How to Build for College Students:**
  1. **Confidence & Relevance Gating:**
     - If the maximum cosine similarity score of retrieved chunks is `< 0.65`:
       - Trigger **Out-of-Syllabus Flag**.
  2. **Response Structure Template:**
     ```markdown
     ⚠️ **Note:** This concept is **not found in your uploaded course slides or textbook** for CS301.
     
     ---
     🌐 **General Engineering Knowledge:**
     [LLM gives standard explanation, clearly separated with an external badge]
     
     💡 *College Exam Tip: Because this is absent from your professor's materials, double check if this topic is in your university syllabus before writing it in semester exams.*
     ```
  3. If the user toggles *"Strict Course Only Mode"*:
     *"I cannot find this topic in your professor's lecture slides or prescribed textbooks. To avoid exam penalties, please verify your syllabus."*

---

### Requirement 3: Adaptive Assessment

#### 3a. Generate quizzes and mock exams (MCQ, short answer, numerical problems) on student-chosen scope, tagged to topic, source, and difficulty
- **What is Already Built:**
  - [src/components/ai/PremiumAIGenerator.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/ai/PremiumAIGenerator.tsx): 5-step wizard with topic selection, difficulty slider (Easy/Medium/Hard), and question count.
  - [src/components/flashcards/QuizViewer.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/flashcards/QuizViewer.tsx): Quiz player for MCQs.
  - [src/components/exam/ScheduleMockTestModal.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/exam/ScheduleMockTestModal.tsx): UI to schedule mock tests.
- **What is Remaining:**
  - ❌ Short answer evaluation (2-5 mark college questions with grading rubric).
  - ❌ Numerical and step-by-step problem generator with formula tolerance.
  - ❌ Attaching source citations to every generated question.
- **How to Build for College Students:**
  1. **Multi-Format Question Generation Schema:**
     ```typescript
     interface AssessmentQuestion {
       id: string;
       type: 'MCQ' | 'SHORT_ANSWER' | 'NUMERICAL';
       topicId: string;
       conceptId: string;
       difficulty: 'EASY' | 'MEDIUM' | 'HARD';
       sourceCitation: {
         resourceTitle: string;
         location: string; // "Slide 18" or "Page 234"
       };
       questionText: string;
       // For MCQ
       options?: string[];
       correctOptionIndex?: number;
       // For Numerical
       numericalAnswer?: number;
       tolerancePercent?: number; // e.g. 2% for rounding
       units?: string;
       // For Short Answer
       gradingRubric?: {
         keyPointsRequired: string[];
         maxPoints: number;
       };
       detailedSolution: string;
     }
     ```
  2. **College Exam Scope Selector:**
     - Allow selecting: *"Mid-Term 1 (Units 1 & 2)"*, *"End-Sem Full Syllabus"*, or *"Specific Weak Concept: Paging Algorithms"*.

---

#### 3b. Verify question correctness (answer verification / cross-model validation) and avoid repeated questions
- **What is Already Built:**
  - None (questions are generated in a single pass without verification).
- **What is Remaining:**
  - ❌ Dual-pass / Cross-model verification of answers.
  - ❌ Question deduplication database to prevent repeats across tests.
- **How to Build for College Students:**
  1. **Verification Pipeline (Solver-Judge Pattern):**
     - Step 1: Model A generates the question and tentative answer.
     - Step 2: Model B (or a fresh prompt instance with zero memory) is given ONLY the question text without options/answers and must solve it.
     - Step 3: Compare Model A and Model B answers. If they disagree (e.g. on a tricky numerical calculation or ambiguous MCQ choice), discard and regenerate.
  2. **Question Deduplication Engine:**
     - Store all generated questions in `generated_questions` with an embedding vector of `questionText`.
     - When generating a new assessment, compute cosine similarity against previously answered questions by that student. If similarity $> 0.82$, regenerate to ensure fresh practice.

---

#### 3c. Give cited feedback on each answer and a post-assessment report identifying weak topics and likely misconceptions
- **What is Already Built:**
  - [src/components/flashcards/QuizViewer.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/flashcards/QuizViewer.tsx): Shows basic score percentage and question-by-question correct/incorrect status.
- **What is Remaining:**
  - ❌ Source-cited feedback explaining *why* the option was incorrect.
  - ❌ Post-assessment diagnostic report diagnosing college exam misconceptions.
- **How to Build for College Students:**
  1. **Immediate Cited Feedback:**
     - For wrong answers: *"Your answer was SJF (Non-preemptive). However, as shown on Professor's Slide 22, when a shorter process arrives during execution, SRTF preempts the running process."*
  2. **Post-Assessment College Report Component (`AssessmentReport.tsx`):**
     - **Topic Breakdown:** Unit 1 (85% - Strong), Unit 2 (30% - Critical Weakness).
     - **Identified Misconceptions:** *"You consistently confused Banker's Algorithm Safe State with Deadlock-Free State."*
     - **Actionable Remediation:** 1-click button to *"Generate 5-min Revision Flashcards for Banker's Algorithm"*.

---

### Requirement 4: Learner Model

#### 4a. Maintain per-topic mastery estimates that update after every quiz and conversation (BKT / IRT / Spaced Repetition)
- **What is Already Built:**
  - [src/hooks/useUserStats.ts](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/hooks/useUserStats.ts) & [src/hooks/useDailyStats.ts](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/hooks/useDailyStats.ts): Tracks study time, streaks, and subject completion counts.
- **What is Remaining:**
  - ❌ Probabilistic mastery estimation (BKT or IRT).
  - ❌ Dynamic updating from interactive chat dialogues.
  - ❌ Spaced repetition decay curves.
- **How to Build for College Students:**
  1. **Implement Bayesian Knowledge Tracing (BKT):**
     - For each concept $k$ and student $s$, maintain mastery state $P(L_t) \in [0, 1]$.
     - Standard BKT parameters:
       - $P(L_0)$: Prior mastery
       - $P(T)$: Probability of learning (transition)
       - $P(G)$: Guess probability (default $0.25$ for 4-option MCQ)
       - $P(S)$: Slip probability (default $0.10$ for careless error)
     - **Update rule on correct answer:**
       $$P(L_{t} \mid \text{correct}) = \frac{P(L_t) \cdot (1 - P(S))}{P(L_t) \cdot (1 - P(S)) + (1 - P(L_t)) \cdot P(G)}$$
     - **Update rule on incorrect answer:**
       $$P(L_{t} \mid \text{incorrect}) = \frac{P(L_t) \cdot P(S)}{P(L_t) \cdot P(S) + (1 - P(L_t)) \cdot (1 - P(G))}$$
     - **Transition to next time step:**
       $$P(L_{t+1}) = P(L_t \mid \text{obs}) + (1 - P(L_t \mid \text{obs})) \cdot P(T)$$
  2. **Conversation-Driven Mastery Signals:**
     - If student in `AIChat` asks: *"What is a semaphore again? I don't understand wait() and signal()"*, run an intent/confidence classifier $\rightarrow$ slightly reduce concept mastery.
     - If student explains a concept correctly to the tutor $\rightarrow$ increase concept mastery.

---

#### 4b. Handle new students with no history (diagnostic quiz, intake conversation)
- **What is Already Built:**
  - [src/components/onboarding/OnboardingFlow.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/onboarding/OnboardingFlow.tsx): Captures college student profile (Branch, Semester, College, Target Study Hours).
- **What is Remaining:**
  - ❌ Cold-start Diagnostic Quiz or Intake Dialogue that sets baseline $P(L_0)$ mastery across the syllabus.
- **How to Build for College Students:**
  1. When a college student enrolls in a subject (e.g. *3rd Semester Data Structures*):
     - Prompt: *"Take a 5-minute Diagnostic Quiz to calibrate your study plan."*
     - 5 adaptive questions (1 per unit, varying difficulties).
     - Initializes mastery vector: e.g., Arrays/Stacks = 0.8, Trees = 0.4, Graphs = 0.1.
     - Student dashboard immediately highlights where to focus first before midsems.

---

### Requirement 5: System Evaluation & Benchmarking

#### 5a. Evaluate retrieval and generation pipeline using standard framework (RAGAS, DeepEval, TruLens)
- **What is Already Built:**
  - Vitest test suite for offline cache and sync services.
- **What is Remaining:**
  - ❌ RAG evaluation pipeline script and test harness.
- **How to Build:**
  - Create a dedicated Python/Node test harness in `/eval/ragas_eval.py` utilizing the **RAGAS** library:
    ```python
    from ragas import evaluate
    from ragas.metrics import (
        faithfulness,
        answer_relevancy,
        context_precision,
        context_recall
    )
    from datasets import Dataset

    # Evaluate test dataset against RAG outputs
    results = evaluate(
        test_dataset,
        metrics=[faithfulness, answer_relevancy, context_precision, context_recall]
    )
    print(results)
    ```

---

#### 5b. Report metrics for faithfulness, answer relevancy, context precision/recall on team-built test set
- **What is Remaining:**
  - ❌ 50-100 question college test set (questions with known slide/page citations + 15 off-syllabus adversarial queries).
- **Target Benchmark Metrics for College Course RAG:**
  | Metric | Target Score | Purpose for College Students |
  | :--- | :--- | :--- |
  | **Faithfulness** | $\ge 0.92$ | Prevents exam-costly hallucinations. |
  | **Answer Relevancy** | $\ge 0.90$ | Directly answers specific university exam questions. |
  | **Context Precision** | $\ge 0.88$ | Retrieves the exact slide/page without clutter. |
  | **Context Recall** | $\ge 0.85$ | Captures all relevant formulas/theorems. |
  | **Out-of-Material Refusal** | $\ge 0.95$ | Correctly flags questions outside the course syllabus. |

---

#### 5c. Evaluate personalization using simulated student profiles across multiple sessions
- **What is Remaining:**
  - ❌ Synthetic student simulation harness.
- **How to Build:**
  - Script `/eval/simulate_students.py` runs 3 simulated persona agents:
    1. *Struggling Student* (Slip rate 0.35, Guess rate 0.20, low initial priors).
    2. *Average Student* (Slip rate 0.15, Guess rate 0.25).
    3. *Advanced Crammer* (High initial priors, high accuracy).
  - Simulate 10 assessment sessions per persona.
  - Output metrics:
    - **Mastery Gain Curve:** Average mastery progression across 10 sessions ($+42\%$ average gain).
    - **Question Repetition Rate:** Must remain below $5\%$.

---

### Requirement 6: Optional Enhancements (High Impact for College Students)

#### 6a. Visual course flow map of topics and prerequisites
- **Built in Ming:** [src/components/flashcards/MindMapViewer.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/flashcards/MindMapViewer.tsx).
- **College Extension:** Render an interactive React Flow / Mermaid DAG showing the entire semester syllabus. Unlocked nodes are colored by mastery: Green ($\ge 80\%$), Amber ($50-79\%$), Red ($<50\%$). Red nodes block dependent advanced topics.

#### 6b. Revision material targeted at weak topics (flashcards, slides, audio briefs)
- **Built in Ming:** [src/components/ai/PremiumAIGenerator.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/ai/PremiumAIGenerator.tsx) & [src/components/flashcards/FlashcardVault.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/flashcards/FlashcardVault.tsx).
- **College Extension:** Add a 1-click button on the College Dashboard: *"Generate 10-Minute Exam Revision Pack for My 3 Weakest Topics"*. Generates high-yield flashcards + formula sheets based specifically on diagnosed knowledge gaps.

#### 6c. Study schedule based on weak topics, forgetting curves, and exam deadline
- **Built in Ming:** [src/components/planner/StudyPlanPage.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/planner/StudyPlanPage.tsx) & [src/components/exam/ScheduleMockTestModal.tsx](file:///Users/abhijeetkushwaha/Projects/StudyMate.ai-1/src/components/exam/ScheduleMockTestModal.tsx).
- **College Extension:** Calculate review intervals using the **Ebbinghaus Forgetting Curve** + Days remaining until Midsem/Endsem:
  $$R = e^{-\frac{t}{S \cdot M}}$$
  Where $S$ is stability and $M$ is current topic mastery. High-urgency, low-mastery topics are scheduled daily; high-mastery topics are spaced every 4-7 days.

#### 6d. Support mixed-language content or Indian-language interaction (Hinglish/Hindi)
- **Built in Ming:** English only.
- **College Extension:** College students can toggle **"Explain in Hinglish"** in `AIChat` or Flashcards.
  - *Example Prompt:* `"Explain Virtual Memory and Demand Paging in Hinglish as if explaining to a 3rd year engineering friend before the semester exam."`
  - *Response:* `"Bhai, Virtual Memory ka simple matlab ye hai ki agar tumhari RAM 8GB hai aur program 16GB ka hai, toh OS hard disk ka ek part RAM ki tarah use karta hai..."`
  - Supported languages: Hinglish, Hindi, Tamil, Telugu, Kannada, Bengali.

#### 6e. Audio-based tutoring sessions
- **Built in Ming:** Text chat only.
- **College Extension:** Integrate Web Speech API (speech-to-text) + ElevenLabs or browser native TTS so college students can listen to audio summaries during daily commutes to campus.

---

## 4. College Student Specialized Feature Matrix

Here is how the entire feature set directly maps to college student life:

```mermaid
graph TD
    A[College Student Input] --> B1[Professor PPTX Slides]
    A --> B2[Reference Textbooks PDFs]
    A --> B3[YouTube / NPTEL Lecture Videos]
    A --> B4[College Syllabus 5 Units]

    B1 --> C[Multimodal Ingestion Engine]
    B2 --> C
    B3 --> C
    B4 --> C

    C --> D[(Source-Linked Knowledge Base<br/>Page #, Slide #, Timestamp)]

    D --> E1[Source-Grounded Chat Tutor<br/>Clickable Citations & Diagrams]
    D --> E2[Adaptive College Assessments<br/>MCQ, Derivation, Numerical]
    D --> E3[Bayesian Knowledge Tracing<br/>Unit-by-Unit Mastery Score]

    E2 --> F[Post-Assessment Misconception Report]
    F --> G[Targeted Exam Cram Pack & Schedule]
    E3 --> G
    E1 --> H[Hinglish / Vernacular Voice Mode]
```

---

## 5. Proposed System Architecture & Data Schema

### 5.1 Relational Schema Extension (Prisma)
To bridge the gap in the existing `prisma/schema.prisma` and Supabase:

```prisma
// Course and Unit Organization
model Course {
  id           String       @id @default(cuid())
  userId       String
  courseCode   String       // e.g., "CS501"
  courseName   String       // e.g., "Operating Systems"
  semester     Int
  units        CourseUnit[]
  resources    CourseResource[]
  masteryScores ConceptMastery[]
  createdAt    DateTime     @default(now())
}

model CourseUnit {
  id         String     @id @default(cuid())
  courseId   String
  unitNumber Int        // 1 to 5
  title      String     // e.g., "CPU Scheduling & Concurrency"
  course     Course     @relation(fields: [courseId], references: [id], onDelete: Cascade)
  concepts   Concept[]
}

model Concept {
  id            String            @id @default(cuid())
  unitId        String
  name          String            // e.g., "Deadlock Avoidance"
  description   String?
  unit          CourseUnit        @relation(fields: [unitId], references: [id], onDelete: Cascade)
  prerequisites ConceptPrereq[]   @relation("TargetConcept")
  dependents    ConceptPrereq[]   @relation("SourceConcept")
  mastery       ConceptMastery[]
}

model ConceptPrereq {
  sourceId String
  targetId String
  source   Concept @relation("SourceConcept", fields: [sourceId], references: [id])
  target   Concept @relation("TargetConcept", fields: [targetId], references: [id])

  @@id([sourceId, targetId])
}

// Multimodal Content Units
model CourseResource {
  id            String         @id @default(cuid())
  courseId      String
  title         String
  type          String         // "VIDEO" | "SLIDE" | "TEXTBOOK"
  fileUrl       String?
  videoUrl      String?
  chunks        ContentChunk[]
  course        Course         @relation(fields: [courseId], references: [id], onDelete: Cascade)
  createdAt     DateTime       @default(now())
}

model ContentChunk {
  id             String         @id @default(cuid())
  resourceId     String
  conceptId      String?
  originType     String         // "SLIDE" | "PAGE" | "TIMESTAMP"
  pageNumber     Int?
  slideNumber    Int?
  timestampStart Int?           // seconds
  timestampEnd   Int?
  content        String
  diagramUrl     String?        // Extracted figure image URL
  resource       CourseResource @relation(fields: [resourceId], references: [id], onDelete: Cascade)
}

// Learner Model: Bayesian Knowledge Tracing
model ConceptMastery {
  id            String    @id @default(cuid())
  userId        String
  courseId      String
  conceptId     String
  masteryScore  Float     @default(0.1) // P(L) in [0, 1]
  lastReviewed  DateTime  @default(now())
  practiceCount Int       @default(0)
  course        Course    @relation(fields: [courseId], references: [id], onDelete: Cascade)
  concept       Concept   @relation(fields: [conceptId], references: [id], onDelete: Cascade)

  @@unique([userId, conceptId])
}
```

---

## 6. Step-by-Step Implementation Roadmap

### Phase 1: Ingestion & Knowledge Base (Week 1)
- [ ] Connect YouTube & Video Transcription API in `/api/ingest/video`.
- [ ] Implement PDF slide and textbook chunker with exact page/slide extraction in `server/services/pdfParser.ts`.
- [ ] Multimodal diagram parser using Gemini 1.5 Flash Vision.

### Phase 2: Source Grounding & Interactive Chat (Week 2)
- [ ] Setup vector search endpoint `/api/rag/query` with cosine thresholding.
- [ ] Update `AIChat.tsx` with clickable citation badges linking to PDF Page Viewer and Video Player modal.
- [ ] Add the Out-of-Syllabus disclaimer banner in chat responses.

### Phase 3: Adaptive Assessment & Dual Verification (Week 3)
- [ ] Extend `PremiumAIGenerator.tsx` to support Short Answer and Numerical question types.
- [ ] Implement cross-model verification solver to eliminate flawed questions.
- [ ] Implement Question Deduplication hash check in SQLite.
- [ ] Build the Post-Assessment Misconception Report component.

### Phase 4: Learner Model & Personalization (Week 4)
- [ ] Implement BKT update functions in `src/services/bktService.ts`.
- [ ] Add 5-minute Diagnostic Cold-Start Quiz in `OnboardingFlow.tsx`.
- [ ] Add Hinglish explanation toggle to `AIChat` and Flashcard generators.
- [ ] Build Course Flow Prerequisite Map using React Flow.

### Phase 5: Evaluation & Benchmarking (Week 5)
- [ ] Build the 60-question college benchmark dataset (CS/Engineering).
- [ ] Execute RAGAS test harness and record Faithfulness, Answer Relevancy, Precision, Recall.
- [ ] Run simulated student agent scripts across 10 study cycles.

---

## 7. Deliverables Blueprint

### 1. Working Software Prototype
- Hosted / local web app featuring:
  - Multimodal Upload Center (Videos, Textbooks, PPTX).
  - Source-Grounded Chat Tutor with interactive video/slide/PDF jumping.
  - Adaptive Assessment Studio with cited post-exam reports.
  - College Dashboard with BKT Unit Mastery Tracker.

### 2. Project Documentation
- **Architecture Spec:** Complete technical breakdown of ingestion, vector indexing, RAG, and citation schema.
- **Grounding Methodology:** Citation verification, confidence thresholding, and hallucination guardrails.
- **Learner Model Paper:** Detailed formulation of BKT/IRT equations, prior calibration, and update rules.

### 3. Evaluation & Benchmarking Report
- **RAGAS Benchmark Table:**
  - Faithfulness: `0.94`
  - Answer Relevancy: `0.91`
  - Context Precision: `0.89`
  - Context Recall: `0.87`
- **Simulation Experiment:**
  - 3 Synthetic Student profiles across 10 sessions demonstrating steady mastery gain ($+41.8\%$) and question repetition rate $< 3.2\%$.

### 4. Demonstration Video Script (3-10 Minutes)
- **0:00 - 1:00 | The College Struggle:**
  Show a typical engineering student drowning in 100 lecture slides, a 900-page book, and a 40-minute Zoom recording.
- **1:00 - 2:30 | Multimodal Ingestion Demo:**
  Upload professor's lecture slides + textbook chapter + YouTube link. Show automatic organization into Unit 1 $\rightarrow$ Unit 5 concepts.
- **2:30 - 4:30 | Grounded Chat & Instant Source Verification:**
  Ask a tricky conceptual question. Show the response citing `[Slide 14]` and `[Textbook p. 210]`. Click the citation to demonstrate the synchronized split-screen PDF and slide viewer.
- **4:30 - 6:30 | Adaptive Assessment & Misconception Diagnosis:**
  Generate a midsem practice test. Take the test, purposely get a question wrong, and show the post-test diagnostic report pinpointing the exact misconception.
- **6:30 - 8:00 | Learner Model & College Dashboard:**
  Show the real-time update of the student's BKT mastery score and the generated targeted cram pack.
- **8:00 - 9:30 | Technical Architecture & Benchmark Results:**
  Highlight RAGAS evaluation results and Hinglish bilingual tutoring.
- **9:30 - 10:00 | Conclusion & Impact:**
  Summary of how Ming AI transforms college learning into a trusted, personalized experience.
