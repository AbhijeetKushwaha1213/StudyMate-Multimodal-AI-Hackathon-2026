# Canonical Phase 5 — Learner Intelligence
## Complete Engineering Specification: Step 1, Step 2 & Step 3

**Status:**
- **Phase 5 Step 1 — Learner Evidence & Mastery Model Foundation:** **COMPLETE**
- **Phase 5 Step 2 — BKT Calibration, Retention & Mastery Reliability:** **COMPLETE**
- **Phase 5 Step 3 — Adaptive Learning Recommendations & Study Prioritization:** **COMPLETE**
- **Phase 6 (AI Study Agent & Autonomous Planning):** **NOT STARTED**

---

## 1. Executive Summary & Canonical Roadmap

The objective of Phase 5 is to establish rigorous, mathematically grounded, and auditable learner intelligence for Ming.
- **Step 1** established deterministic learner evidence extraction from Phase 4 assessments, idempotency protection (`idem_<userId>_<attemptId>_<questionId>`), concept taxonomy normalization (`c_<hash>`), and replayable mastery audits.
- **Step 2** established Bayesian Knowledge Tracing (BKT) parameter calibration contracts, mathematical validation metrics (LogLoss, Brier score, ECE), empirical dataset auditing (`CALIBRATION_NOT_YET_STATISTICALLY_JUSTIFIED`), and an Ebbinghaus exponential forgetting/retention model ($R = e^{-\Delta t / S}$) that separates latent competence from current retrieval probability.
- **Step 3** establishes an evidence-driven, explainable, and deterministic recommendation engine that evaluates learner mastery, retrieval decay, verified errors, and prerequisite readiness to determine what to study next, why, and with which validated content.

---

## 2. Phase 5 Step 3 — Mandatory Repository Audit

Prior to implementation, a complete audit was performed across existing systems:

### Audit Findings & Classification

| Component | Repository Location | Audit Status | Architectural Decision |
|---|---|---|---|
| **Core BKT Updates & Priors** | `server/bktService.ts` | `EXISTS_AND_CORRECT` | Reused directly; default parameter fallback added for safe invocation. |
| **Ebbinghaus Retention Model** | `server/bktCalibrationService.ts` | `EXISTS_AND_CORRECT` | Reused directly; computes current recall probability $p_{\text{recall}} = pL \times R(\Delta t)$. |
| **Concept Taxonomy Normalization** | `server/learnerEvidenceService.ts` | `EXISTS_AND_CORRECT` | Reused `computeCanonicalConceptId` and `normalizeConceptString` for stable cross-question hashing. |
| **Evidence Extraction & Idempotency** | `server/learnerEvidenceService.ts` | `EXISTS_AND_CORRECT` | Reused `extractLearnerEvidence` and `recordLearnerEvidence`; protects against duplicate attempts. |
| **Prerequisite DAG Graph** | `server/dagService.ts` | `EXISTS_AND_CORRECT` | Reused `getUserDAGs` to detect explicit node prerequisites (`locked` vs `available`). |
| **Course Resources & Questions** | `server/prisma.ts` | `EXISTS_AND_CORRECT` | Schema exists; queries scoped strictly to authenticated `userId`. |
| **Legacy Study Plan Logic** | `server/studyAgentService.ts` | `EXISTS_BUT_INCOMPLETE` | Contains topic-level daily planner for Phase 6; lacks concept-level canonical taxonomy and 6-category engine. Kept separate. |
| **Assessment Next Actions** | `server/assessmentIntelligenceService.ts` | `EXISTS_BUT_INCOMPLETE` | Ad-hoc post-assessment actions scoped to single attempt. Kept for backwards compatibility. |
| **Canonical Recommendation Engine** | `server/adaptiveRecommendationService.ts` | `MISSING` | **Implemented in Step 3**: deterministic multi-factor prioritization and 6 canonical categories. |
| **Authenticated Recommendation Route** | `server/learnerHandler.ts` | `MISSING` | **Implemented in Step 3**: `GET /api/learner/recommendations` with user isolation. |

---

## 3. Recommendation Categories & Eligibility Rules

Located in `server/adaptiveRecommendationService.ts`:

The system implements 6 mutually exclusive canonical recommendation categories:

1. **`ADDRESS_MISCONCEPTION`**:
   - **Eligibility:** Verified recurring misconception detected ($\ge 2$ recorded occurrences of an error category on this concept/topic from Phase 4 assessment evaluations).
   - **Reason Codes:** `['VERIFIED_RECURRING_MISCONCEPTION']`.
   - **Precedence:** 1 (Highest).

2. **`REVIEW_CONCEPT`**:
   - **Eligibility:** Latent mastery exists ($pL \ge 0.50$), but current retrieval probability has decayed ($p_{\text{recall}} < 0.70 \times pL$ or `retention.needs_review === true`), and elapsed time $\Delta t \ge 1.0$ day.
   - **Reason Codes:** `['RETRIEVAL_DECAY_DETECTED', 'SPACED_REPETITION_DUE']`.
   - **Precedence:** 2.

3. **`PRACTICE_CONCEPT`**:
   - **Eligibility:** Evidence exists ($N \ge 2$), but mastery is developing ($pL < 0.60$) OR recent verified errors occurred ($E_{\text{recent}} > 0$).
   - **Reason Codes:** `['DEVELOPING_MASTERY', 'RECENT_MISTAKES_RECORDED']`.
   - **Precedence:** 3.

4. **`LEARN_CONCEPT`**:
   - **Eligibility:** Insufficient evidence ($N < 2$, cold-start unassessed concept).
   - **Reason Codes:** `['INSUFFICIENT_EVIDENCE', 'COLD_START_DIAGNOSTIC']`.
   - **Precedence:** 4.

5. **`CONSOLIDATE_MASTERY`**:
   - **Eligibility:** Strong verified latent competence ($pL \ge 0.85$), high statistical confidence ($C \ge 0.70$), and recall probability intact ($p_{\text{recall}} \ge 0.70 \times pL$).
   - **Reason Codes:** `['MASTERY_PROFICIENT', 'STRENGTHEN_STABILITY']`.
   - **Precedence:** 5.

6. **`NO_ACTION`**:
   - **Eligibility:** Baseline proficiency targets are met with no active decay, errors, or unassessed material.
   - **Reason Codes:** `['NO_ACTIVE_INTERVENTION_CRITERIA_MET']`.
   - **Precedence:** 6 (Lowest).

---

## 4. Prioritization Scoring & Mathematical Formula

Located in `server/adaptiveRecommendationService.ts`:

### 1. Multi-Factor Formula
The priority score is deterministic, normalized, and strictly bounded within $[0.0, 1.0]$:

$$\text{Base Score} = 0.35 \cdot M_{\text{def}} + 0.25 \cdot R_{\text{def}} + 0.25 \cdot E_{\text{recent}} + 0.15 \cdot U$$

$$\text{Final Score} = \min\left(1.0, \max\left(0.0, (\text{Base Score} + B_{\text{misc}} + B_{\text{prereq}}) \times P_{\text{gate}}\right)\right)$$

Where:
- **Mastery Deficit ($M_{\text{def}}$):**
  - If $N = 0$: $M_{\text{def}} = 0.70$ (neutral prior baseline; learning needed, but does not falsely declare student failure).
  - If $N > 0$: $M_{\text{def}} = \max(0.05, 1.0 - pL)$.
- **Retrieval Deficit ($R_{\text{def}}$):**
  - Gap between latent mastery and current recall: $R_{\text{def}} = \max(0.0, pL - p_{\text{recall}})$. (Zero for cold start).
- **Recent Mistakes Rate ($E_{\text{recent}}$):**
  - Scaled by recent incorrect verified attempts: $E_{\text{recent}} = \min(1.0, \text{recentIncorrect} \times 0.25)$.
- **Uncertainty Factor ($U$):**
  - $U = \max(0.0, 1.0 - C)$, where $C(N) = \frac{N}{N + 2.0}$.
- **Misconception Boost ($B_{\text{misc}}$):**
  - Recurring verified misconception ($\ge 2$ instances): $+0.15$.
  - Single verified misconception: $+0.05$.
- **Prerequisite Gating ($P_{\text{gate}}$):**
  - If explicit prerequisite is unmet (`status === 'locked'` in user DAG): $P_{\text{gate}} = 0.10$ (heavily deprioritized so learners are not pushed into advanced material prematurely).
  - If prerequisite is met and concept unblocks next nodes: $B_{\text{prereq}} = +0.05$.

### 2. Priority Bands
- **`CRITICAL`**: $\text{Score} \ge 0.75$
- **`HIGH`**: $0.55 \le \text{Score} < 0.75$
- **`MEDIUM`**: $0.35 \le \text{Score} < 0.55$
- **`LOW`**: $\text{Score} < 0.35$

### 3. Deterministic Multi-Level Tie-Breaking
When candidates have identical properties, ranking is guaranteed deterministic through a 5-tier tie-breaking hierarchy:
1. `priority_score DESC`
2. `category` precedence order: `ADDRESS_MISCONCEPTION` (1) > `REVIEW_CONCEPT` (2) > `PRACTICE_CONCEPT` (3) > `LEARN_CONCEPT` (4) > `CONSOLIDATE_MASTERY` (5) > `NO_ACTION` (6)
3. `latent_mastery ASC` (prioritizes lower underlying competence)
4. `current_recall_probability ASC` (prioritizes lower retrieval availability)
5. `concept_id ASC` (lexicographical string comparison)

---

## 5. Content Selection & Grounding Rules

- **Resource Selection:** Searches `resources` table strictly where `userId === authenticatedUser`. Matches by topic, subtopic, or folder name.
- **Question Selection:** Searches `assessment_questions` table strictly where `userId === authenticatedUser`. Matches by topic or subtopic.
- **Safe Fallback:** If no valid matching content exists in the user's account, the system sets `recommended_resource: null` and `recommended_question: null`. **It never hallucinates or fabricates content IDs.**
- **Tenant Isolation:** A student cannot see or receive recommendations referencing another student's uploaded notes, files, or questions.

---

## 6. Truthful, Evidence-Based Explanations

Explanations are deterministically assembled from actual observed metrics, preventing hallucinated rationales:
- **`ADDRESS_MISCONCEPTION`:**
  `"Targeted misconception resolution recommended for ${concept_name}: persistent error pattern (${recurring_misconception}) detected across verified attempts."`
- **`REVIEW_CONCEPT`:**
  `"Review recommended for ${concept_name}: estimated recall probability has declined to ${recallPct}% (from ${pLMastPct}% latent mastery) over ${daysText} since last review."`
- **`PRACTICE_CONCEPT`:**
  `"Practice recommended for ${concept_name}: developing mastery (${pLMastPct}%) with ${recentIncorrectCount} recent incorrect attempt(s) recorded."`
- **`LEARN_CONCEPT`:**
  `"Initial learning recommended for ${concept_name}: insufficient evidence (${evidenceCount} attempt(s)) to reliably estimate mastery."`
- **`CONSOLIDATE_MASTERY`:**
  `"Consolidation recommended for ${concept_name}: strong verified mastery (${pLMastPct}%) achieved with high confidence to reinforce long-term retention."`
- **`NO_ACTION`:**
  `"No immediate study action required for ${concept_name}: current mastery and retention meet proficiency targets."`

---

## 7. Dynamic Updates, Invalidation & Idempotency

1. **Dynamic Evaluation:** Recommendations are computed on-demand from authoritative database state (`learner_mastery`, `learner_events`, `resources`, `assessment_questions`). There are no stale cached snapshots that can diverge from reality.
2. **Immediate Evidence Propagation:** When an authoritative Phase 4 assessment result is ingested via `recordLearnerEvidence`, the new evidence updates the posterior mastery and retention state. Subsequent calls to `evaluateAdaptiveRecommendations` immediately reflect the updated state.
3. **Idempotency Protection:** Duplicate evidence submissions with existing `idempotencyKey` values are rejected without mutating mastery counts or inflating recommendation urgency.
4. **Discarded Evidence Filtering:** Invalid or unverifiable submissions discarded in Phase 4 never update mastery or alter recommendation priority.

---

## 8. Authenticated API Contract

### `GET /api/learner/recommendations`
- **Authentication:** Required. Server derives identity strictly via `resolveContextUser`.
- **Query Parameters:**
  - `topic` (optional string): Filter recommendations to a specific topic.
  - `limit` (optional integer, default 5, min 1, max 20): Maximum recommendations to return.
- **Response Schema:**
  ```json
  {
    "success": true,
    "recommendations": [
      {
        "recommendation_id": "rec_8f1a2c3d4e5f",
        "user_id": "usr_123",
        "category": "REVIEW_CONCEPT",
        "priority_band": "HIGH",
        "priority_score": 0.684,
        "concept_id": "c_9e1b2f4a5c6d7e8f",
        "concept_name": "Carnot Engines",
        "topic": "Thermodynamics",
        "subtopic": "Heat Engines",
        "explanation": "Review recommended for Carnot Engines: estimated recall probability has declined to 45% (from 85% latent mastery) over 14 day(s) since last review.",
        "reason_codes": [
          "RETRIEVAL_DECAY_DETECTED",
          "SPACED_REPETITION_DUE"
        ],
        "evidence_summary": {
          "latent_mastery": 0.85,
          "current_recall_probability": 0.452,
          "confidence": 0.75,
          "evidence_count": 6,
          "recent_incorrect_count": 0,
          "days_since_last_review": 14.2,
          "recurring_misconception": null,
          "prerequisite_status": "NONE"
        },
        "recommended_resource": {
          "id": "res_thermo_slides",
          "title": "Thermodynamics Chapter 4.pdf",
          "type": "pdf",
          "folder": "Thermodynamics",
          "storage_path": "/uploads/res_thermo_slides.pdf"
        },
        "recommended_question": {
          "id": "q_carnot_calc",
          "question_text": "Calculate the theoretical maximum efficiency of a Carnot cycle...",
          "type": "NUMERICAL",
          "difficulty": "medium",
          "topic": "Thermodynamics",
          "subtopic": "Heat Engines",
          "source_id": "res_thermo_slides"
        },
        "generated_at": "2026-10-09T12:00:00.000Z"
      }
    ],
    "is_cold_start": false,
    "generated_at": "2026-10-09T12:00:00.000Z",
    "total_concepts_evaluated": 12
  }
  ```

---

## 9. Verification & Test Suite Summary

### Dedicated Test Suite: `src/test/adaptiveRecommendations.test.ts`
- **44 comprehensive tests** across 9 functional categories:
  1. Audit & Integration Contracts (3 tests)
  2. Recommendation Categories & Eligibility Rules (9 tests)
  3. Prioritization Scoring & Deterministic Tie-Breaking (9 tests)
  4. Missing Evidence & Cold-Start Robustness (4 tests)
  5. Evidence-Based Explanations (5 tests)
  6. Content Selection: Resources & Questions (3 tests)
  7. Dynamic Updates, Invalidation & Idempotency (3 tests)
  8. API Contract & Zero-Trust Security (5 tests)
  9. Full Regression Verification (3 tests)
- **Result:** **44 / 44 PASS**.

### Full Regression Suite: 14 Test Files, 476 Tests Passing (100%)
- **Phase 4 & 5 Assessment & Intelligence:**
  - `src/test/adaptiveRecommendations.test.ts`: **44 / 44 PASS**
  - `src/test/bktCalibrationRetention.test.ts`: **53 / 53 PASS**
  - `src/test/learnerEvidenceMastery.test.ts`: **43 / 43 PASS**
  - `src/test/questionQualityValidation.test.ts`: **50 / 50 PASS**
  - `src/test/answerVerification.test.ts`: **40 / 40 PASS**
  - `src/test/numericalAssessment.test.ts`: **78 / 78 PASS**
- **Grounding, Source Tracking & Ingestion:**
  - `src/test/groundingVerification.test.ts`: **30 / 30 PASS**
  - `src/test/sourceNavigation.test.tsx`: **25 / 25 PASS**
  - `src/test/multimodalIngestion.test.ts`: **24 / 24 PASS**
  - `src/test/ragVectorStoreEquivalence.test.ts`: **8 / 8 PASS**
  - `src/test/resourceStreaming.test.ts`: **22 / 22 PASS**
- **Security, Isolation & Production Integration:**
  - `src/test/productionSecurityAndIsolation.test.ts`: **23 / 23 PASS**
  - `src/test/productionSmokeIntegration.test.ts`: **17 / 17 PASS**
  - `src/test/phase9AssessmentIntelligence.test.tsx`: **19 / 19 PASS**
- **Total Tests Passing:** **476 / 476 PASS**
- **TypeScript Typecheck (`tsc --noEmit`):** **0 errors**.
- **Production Bundle (`vite build`):** **SUCCESS** (exit code 0; 3298 modules transformed).

---

## 10. Honest Limitations & Scope Boundaries

1. **Empirical Learning Gains:** Current prioritization formulas are based on established cognitive science heuristics (Ebbinghaus decay, Corbett & Anderson BKT). We do not claim proven empirical learning gain optimizations without a longitudinal human student study.
2. **Prerequisite Discovery:** Prerequisites are enforced strictly when explicitly defined in `learning_dags`. The recommendation engine does not hallucinate automated latent prerequisite trees without explicit data.
3. **Canonical Scope Boundary:** Phase 5 Step 3 delivers an explainable, deterministic recommendation engine. Autonomous proactive agents, conversational tutors, scheduled background check-ins, and study session orchestration are strictly reserved for Phase 6 (AI Study Agent).
