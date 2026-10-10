# PHASE 4 — ASSESSMENT
## Step 1: Numerical Question Generation & Deterministic Answer Verification

**Status:** COMPLETE ✅  
**Phase:** 4 of 7 (Canonical Roadmap)  
**Prerequisite:** Phase 3 — Grounding (COMPLETE)

---

## Objective

Build a **server-authoritative, deterministic numerical answer verification engine** that:

1. Safely parses student numerical answers (no `eval()`, `Function()`, or dynamic execution)
2. Normalizes units across equivalent representations
3. Grades answers using configurable tolerance bands
4. Detects specific error categories (sign, rounding, OOM, unit mismatch)
5. Verifies generated numerical questions before presenting to students
6. Rejects unverifiable questions (zero-trust: if can't verify → reject)

---

## Zero-Trust Grading Boundary

> **The LLM must NEVER sit in the critical grading path.**

| Guarantee | Implementation |
|-----------|---------------|
| No `eval()` | Safe recursive-descent expression parser with bounded depth |
| No `Function()` | Tokenizer only allows: digits, operators (+−×÷*/^), parentheses |
| No dynamic code | All grading is pure arithmetic comparison |
| Server-authoritative | `gradeNumericalAnswer()` is the single source of truth |
| Deterministic | Same inputs → identical outputs, always |
| Verifiable questions | `verifyNumericalQuestion()` rejects unverifiable NUMERICAL questions |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                   Assessment Generation Pipeline                  │
│                                                                    │
│  LLM generates question + correct_answer                          │
│           │                                                        │
│           ▼                                                        │
│  ┌─────────────────────────┐    ┌──────────────────────────────┐  │
│  │ normalizeCorrectAnswer  │───▶│ verifyNumericalQuestion      │  │
│  │ (parse LLM output)      │    │ (reject if unverifiable)     │  │
│  └─────────────────────────┘    └──────────┬───────────────────┘  │
│                                             │                      │
│                              VERIFIED ─────▶│◀───── REJECTED       │
│                              (present)       │      (suppress)     │
│                                              ▼                     │
│                                    Student sees question           │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                   Answer Grading Pipeline                          │
│                                                                    │
│  Student types answer                                              │
│           │                                                        │
│           ▼                                                        │
│  ┌─────────────────────────┐    ┌──────────────────────────────┐  │
│  │ parseStudentAnswer      │───▶│ gradeNumericalAnswer         │  │
│  │ (safe parser, no eval)  │    │ (tolerance + unit + error)   │  │
│  └─────────────────────────┘    └──────────┬───────────────────┘  │
│                                             │                      │
│                                             ▼                      │
│                                   NumericalGradingResult           │
│                                   { classification, credit,        │
│                                     error_category, feedback }     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Files Created / Modified

### New Files

| File | Purpose |
|------|---------|
| `server/assessmentTypes.ts` | Canonical Phase 4 data contracts (NumericalQuestion, NumericalGradingResult, TolerancePolicy, unit equivalences, verifiability) |
| `server/numericalVerifier.ts` | Deterministic numerical answer verification engine (safe parser, grading, verification, batch processing) |
| `src/test/numericalAssessment.test.ts` | 78 tests covering all verification components |
| `PHASE_4_ASSESSMENT.md` | This document |

### Modified Files

| File | Change |
|------|--------|
| `server/assessmentIntelligenceService.ts` | NUMERICAL branch now delegates to `gradeNumericalAnswer()` from Phase 4 verifier |
| `server/ragHandler.ts` | Assessment generation pipeline verifies NUMERICAL questions server-side before persisting |

---

## Components

### 1. Safe Expression Evaluator (`safeEvaluateExpression`)

Recursive-descent parser supporting:
- Arithmetic: `+`, `-`, `*`, `/`, `^`
- Parenthesized grouping
- Unary minus/plus
- Scientific notation (`1.5e3`)

**Safety bounds:**
- Max expression length: 500 characters
- Max nesting depth: 20 levels
- Division by zero → returns `null`
- Invalid characters → returns `null`

### 2. Student Answer Parser (`parseStudentAnswer`)

Parses raw student input into structured `ParsedStudentAnswer`:

| Format | Example | Handling |
|--------|---------|----------|
| Plain number | `42`, `3.14`, `-7.5` | `parseFloat` |
| Scientific notation | `6.022e23` | Standard JS parsing |
| × 10^ notation | `1.6 × 10^-19` | Unicode-normalized, custom parser |
| Fractions | `3/4`, `22/7` | Numerator ÷ denominator |
| Percentages | `85%`, `12.5 percent` | Value extracted, flag set |
| Expressions | `2 * 3 + 1` | Safe recursive-descent evaluator |
| With units | `9.8 m/s^2` | Value + unit separated |
| Thousands | `1,000,000` | Commas stripped |

### 3. Unit Normalization

35 canonical unit groups covering SI, imperial, computing, and scientific units.
Each group maps variant spellings to a canonical form:

```
kilogram, kilograms, kgs → kg
meter, meters, metre → m
percent, percentage, pct → %
celsius, degrees celsius → °C
megabyte, megabytes → MB
```

### 4. Tolerance-Band Grading

Four tolerance modes:

| Mode | Description | Default |
|------|-------------|---------|
| `EXACT` | Within floating-point epsilon | 1e-9 |
| `RELATIVE` | Within % of correct value | 3% (with 0.01 floor) |
| `ABSOLUTE` | Within fixed absolute difference | Configurable |
| `SIGNIFICANT_FIGURES` | Correct to N sig figs | Configurable |

**Grading cascade:**
1. Within 3% tolerance → **CORRECT** (1.0 credit)
2. Sign error detected → **PARTIALLY_CORRECT** (0.5 credit)
3. Within 10% tolerance → **PARTIALLY_CORRECT** (0.5 credit)
4. Correct value, wrong unit → **PARTIALLY_CORRECT** (0.5 credit)
5. Unparseable input → **INVALID_FORMAT** (0.0 credit)
6. Otherwise → **INCORRECT** (0.0 credit)

### 5. Error Category Detection

| Category | Detection Logic |
|----------|-----------------|
| `SIGN_ERROR` | Magnitude within 3% but sign is inverted |
| `ROUNDING_ERROR` | Within 3–10% relative error |
| `ORDER_OF_MAGNITUDE` | Ratio ≈ 10^n (n=1,2,3) |
| `UNIT_MISMATCH` | Value correct, unit wrong |
| `FORMULA_ERROR` | >10% relative error |
| `PARSE_ERROR` | Could not parse student input |

### 6. Question Verification

Before any NUMERICAL question is presented to a student, the server verifies:

1. `correct_answer` is a finite number
2. `correct_answer_raw` parses to the same value (consistency check)
3. `expected_unit` is recognized (if specified)
4. Question stem contains quantitative keywords
5. Tolerance is well-formed (positive value, valid mode)
6. Explanation is present and substantive

**Rejected questions are logged and suppressed — never shown to students.**

---

## Test Suite Summary

**78 tests across 11 describe blocks:**

| Block | Tests | Coverage |
|-------|-------|----------|
| Safe Expression Evaluator | 12 | Arithmetic, precedence, parentheses, unary, division-by-zero, injection rejection |
| Student Answer Parser | 12 | Plain, decimal, negative, scientific, fractions, percentages, units, thousands, errors |
| Unit Normalization | 7 | Canonical mapping, equivalence, null handling |
| Tolerance Checking | 6 | Exact, relative, absolute, significant figures |
| Error Category Detection | 7 | Sign, OOM, unit mismatch, parse, rounding, formula, exact match |
| Numerical Grading Pipeline | 12 | Full grading cascade: correct, partial, incorrect, invalid, units, fractions, sci notation, OOM, coordinate feedback |
| Question Verification | 7 | Accept valid, reject NaN/Infinity/short/non-quantitative/no-explanation/negative-tolerance |
| Batch Verification | 2 | Mixed batch, all-valid batch |
| Normalization & Fingerprinting | 5 | Valid/invalid normalization, deterministic fingerprints |
| Significant Figures | 4 | Various formats |
| Zero-Trust Safety | 4 | Code injection rejection, function syntax, semicolons, determinism proof |

---

## Integration Points

### With Phase 2 (Knowledge Ingestion)
- Questions reference `source_id`, `chunk_id`, `page_number`, `slide_number`, `timestamp_start`
- Source provenance types (`SourceType`, `ExtractionMethod`) are re-exported from `ingestionTypes.ts`

### With Phase 3 (Grounding)
- Question verification uses the same coordinate-label pattern as `VerifiedCitation`
- Feedback references source coordinates for student review

### With Assessment Intelligence Service
- NUMERICAL branch of `evaluateSingleAnswer()` now delegates to `gradeNumericalAnswer()`
- Misconception detection benefits from structured error categories

### With RAG Handler Pipeline
- Assessment generation (`POST /api/rag/assessment/generate`) now runs numerical verification
- Unverifiable NUMERICAL questions are rejected before persistence

---

## Definition of Done (Step 1)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `assessmentTypes.ts` defines NumericalQuestion, TolerancePolicy, NumericalGradingResult | ✅ |
| 2 | Safe expression evaluator: no eval/Function/dynamic code | ✅ |
| 3 | Student answer parser handles 8+ formats | ✅ |
| 4 | Unit normalization with 35 equivalence groups | ✅ |
| 5 | 4 tolerance modes (exact, relative, absolute, sig figs) | ✅ |
| 6 | Error category detection (6 categories) | ✅ |
| 7 | Full grading pipeline with deterministic partial credit | ✅ |
| 8 | Question verification rejects unverifiable questions | ✅ |
| 9 | Batch verification for generation pipeline | ✅ |
| 10 | Answer normalization for LLM output | ✅ |
| 11 | Deterministic fingerprinting for deduplication | ✅ |
| 12 | Integration with assessmentIntelligenceService | ✅ |
| 13 | Integration with ragHandler generation pipeline | ✅ |
| 14 | 78 numerical assessment tests pass | ✅ |
| 15 | Existing regression suites pass | ✅ |
| 17 | Documentation complete | ✅ |

---

# CANONICAL PHASE 4 — STEP 2
## Robust Answer Verification & Harder Misconception Detection

**Status:** COMPLETE ✅  
**Phase:** 4 of 7 (Canonical Roadmap)  
**Roadmap Progress:**
- Phase 4 Step 1: COMPLETE ✅
- Phase 4 Step 2: COMPLETE ✅
- Phase 4 Step 3+: NOT STARTED ⏳

---

## 1. Executive Summary

Phase 4 Step 2 establishes Ming's **Universal Server-Authoritative Grading Engine** (`robustAnswerVerifier.ts`) across all supported question types:
- `NUMERICAL`
- `MCQ`
- `SHORT_ANSWER`
- `TRUE_FALSE`
- `MULTI_SELECT`

The LLM is **strictly excluded** from authoritative grading, scoring, answer keys, tolerance, and verifiability. Deterministic grading executes server-side, with error and misconception detection bound to provable evidence. Explanatory feedback is grounded via Phase 3's deterministic citation verification pipeline (`citationVerifier.ts`).

---

## 2. Question-Type Grading Matrix

| Question Type | Authoritative Storage | Normalization Strategy | Correctness Engine | Partial Credit Policy | Deterministic Error / Misconception Detection |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`NUMERICAL`** | `correct_answer` (numeric / expression) + `expected_unit` + `tolerance` | `parseStudentAnswer()` + `normalizeUnit()` via `numericalVerifier.ts` | Tolerance bounds (`EXACT`, `RELATIVE`, `ABSOLUTE`, `SIG_FIGS`) | 0.0, 0.5 (sign/unit/rounding), 1.0 | `SIGN_ERROR`, `ORDER_OF_MAGNITUDE`, `UNIT_MISMATCH`, `ROUNDING_ERROR`, `FORMULA_ERROR`, `PARSE_ERROR` |
| **`MCQ`** | `correct_answer` matching authoritative option ID / label | Trimming, uppercase label mapping (e.g. "A" vs ID "opt_a") | Strict ID/label identity against authoritative answer | Discrete: `0.0` or `1.0` only | `INVALID_OPTION`, distractor pedagogical metadata (if defined), else `WRONG_OPTION` |
| **`MULTI_SELECT`** | `correct_answers` or `correct_answer[]` array of valid option IDs | Array unique-set normalization, whitespace trimmed | Set equality against server expected options | Controlled set overlap: `|selected ∩ correct| / |correct| - 0.5 * |extra| / |all_options|`, clamped $[0.0, 1.0]$ | `INVALID_OPTION`, `MISSING_REQUIRED_COMPONENT`, `EXTRA_COMPONENT`, `NO_MISCONCEPTION` |
| **`TRUE_FALSE`** | `correct_answer` strictly `"true"` or `"false"` (boolean/string) | Canonical token parser (`true`/`t`/`yes`/`1` vs `false`/`f`/`no`/`0`) | Strict boolean equivalence | Discrete: `0.0` or `1.0` only | `INVALID_FORMAT` (on unparseable input), `CONCEPTUAL_MISMATCH`, `NO_MISCONCEPTION` |
| **`SHORT_ANSWER`** | `correct_answer` + optional `accepted_variants[]` + `required_components[]` | Case-insensitive trimmed punctuation strip | Layered: 1. Exact match, 2. Accepted variant match, 3. Component overlap | Controlled: Ratio of present required components clamped $[0.0, 1.0]$; or 0.0 / 1.0 | `MISSING_REQUIRED_COMPONENT`, `INCOMPLETE_ANSWER`, `UNVERIFIABLE` (fallback without guessing) |

---

## 3. Preservation of Numerical Verifier

The Phase 4 Step 1 `numericalVerifier.ts` remains the **sole arithmetic authority**.
- Zero `eval()`, zero `Function()`, zero dynamic execution.
- Recursive-descent expression evaluator with depth and character bounds.
- 35 canonical unit groups with automatic SI/imperial/computing normalization.
- 4 tolerance evaluation modes.
- `robustAnswerVerifier.ts` delegates all `NUMERICAL` grading directly to `gradeNumericalAnswer()`, preserving 100% backward compatibility and test contracts.

---

## 4. Deterministic Non-Numerical Verifiers

### 4.1 Deterministic MCQ Verification
- Authoritative option IDs are loaded from server state.
- Option membership validation: submitted options that do not exist in question definition immediately yield `INVALID_OPTION` (0.0 credit).
- Distractor metadata preservation: if distractors define pedagogical misconceptions (e.g. `sign_confusion`, `formula_confusion`), the student's selected option yields that exact diagnosis deterministically. If absent, system reports `WRONG_OPTION`.

### 4.2 Deterministic Multi-Select Verification
- Set intersection and difference:
  - Exact match: `CORRECT` (1.0 credit).
  - Subset with missing options: `PARTIALLY_CORRECT` / `INCORRECT` with `MISSING_REQUIRED_COMPONENT`.
  - Superset with extra distractors: `PARTIALLY_CORRECT` / `INCORRECT` with `EXTRA_COMPONENT`.
  - Invalid option ID submitted: yields `INVALID_OPTION`.
- Partial credit is bounded by policy and never arbitrarily assigned.

### 4.3 Deterministic True/False Verification
- Strict canonical parsing handles standard boolean aliases (`"true"`, `"t"`, `"yes"`, `"1"` vs `"false"`, `"f"`, `"no"`, `"0"`).
- Invalid representations (e.g. `"maybe"`, random strings) produce `INVALID_FORMAT` (0.0 credit).

### 4.4 Layered Short-Answer Verification
- **Layer 1:** Canonical exact/normalized string match.
- **Layer 2:** Authoritative accepted variants match (`accepted_variants` list).
- **Layer 3:** Structured component presence verification (`required_components` keywords).
- **Layer 4 (Safe Fallback):** When answer matches neither exact, variant, nor components, and cannot be deterministically verified, the system marks it `UNVERIFIABLE` with error `UNVERIFIABLE` or `UNDETERMINED`. The server never invents correctness or hallucinated misconception diagnoses.

---

## 5. Harder Misconception Detection Engine

The system supports 15 structured error categories without LLM speculation:
```typescript
type MisconceptionCategory =
  | 'SIGN_ERROR'
  | 'ORDER_OF_MAGNITUDE'
  | 'UNIT_MISMATCH'
  | 'ROUNDING_ERROR'
  | 'FORMULA_ERROR'
  | 'PARSE_ERROR'
  | 'WRONG_OPTION'
  | 'INVALID_OPTION'
  | 'MISSING_REQUIRED_COMPONENT'
  | 'EXTRA_COMPONENT'
  | 'CONCEPTUAL_MISMATCH'
  | 'INCOMPLETE_ANSWER'
  | 'UNVERIFIABLE'
  | 'UNDETERMINED'
  | 'NO_MISCONCEPTION';
```

Rule: If the system cannot prove why an answer is wrong, it returns `UNDETERMINED`. Fabricated diagnoses (e.g. guessing student cognitive deficits) are strictly prohibited.

---

## 6. Pre-Delivery Answer-Key & Question Integrity

Implemented in `validateQuestionIntegrity(question)`:
- Validates question stem (minimum length $\ge 8$).
- Validates answer key presence.
- For `MCQ`: validates at least 2 options, no duplicate option IDs, and correct answer points to an existing option ID/label.
- For `MULTI_SELECT`: validates at least 2 options, all correct answers point to existing options.
- For `NUMERICAL`: passes `verifyNumericalQuestion()` (finite value, valid units, valid tolerance, quantitative keywords).
- For `TRUE_FALSE`: verifies answer resolves strictly to `"true"` or `"false"`.
- Questions failing integrity checks are quarantined/rejected prior to student delivery.

---

## 7. Zero-Trust Submission Security

1. **Client Tampering Defense:**
   - Client submission payload cannot dictate `correct_answer`, `score`, `tolerance`, `unit`, `rubric`, or `errorCategory`.
   - The server resolves the authoritative question directly from the database or question registry.
2. **Student-Facing Result Sanitization:**
   - `sanitizeResultForStudent(result)` strips internal rubric models, prompt templates, and hidden distractor metadata.
   - Hidden answer keys are withheld unless the assessment policy explicitly permits post-submission review.
3. **Cross-Tenant Isolation:**
   - Assessment submissions and grounded feedback strictly adhere to tenant authorization boundaries.

---

## 8. Grounded Feedback Integration

Reuses Phase 3's canonical Grounding layer:
- Post-grading feedback can attach source citations via `attachGroundedFeedback(result, citations, tenantId)`.
- Reuses `verifyCitation()` from `citationVerifier.ts`.
- Cross-tenant citations are rejected (`CROSS_TENANT_REJECTED` / `TENANT_VIOLATION`).
- Deleted or unavailable sources gracefully mark citation as `SOURCE_UNAVAILABLE`.
- Citations do **not** alter the deterministic grade or score.

---

## 9. Verification & Quality Gates

### Test Suites Passed
- `src/test/answerVerification.test.ts`: **40/40 PASS**
- `src/test/numericalAssessment.test.ts`: **78/78 PASS**
- `src/test/phase9AssessmentIntelligence.test.tsx`: **19/19 PASS**
- `src/test/groundingVerification.test.ts`: **30/30 PASS**
- `src/test/sourceNavigation.test.tsx`: **25/25 PASS**
- `src/test/productionSecurityAndIsolation.test.ts`: **23/23 PASS**
- `src/test/resourceStreaming.test.ts`: **22/22 PASS**
- `src/test/multimodalIngestion.test.ts`: **24/24 PASS**
- `src/test/productionSmokeIntegration.test.ts`: **17/17 PASS**
- `src/test/ragVectorStoreEquivalence.test.ts`: **8/8 PASS**

**Total Baseline Test Suite:** **286 / 286 PASS (100%)**

### Compilation & Build
- `npx tsc --noEmit`: **0 errors**
- `npm run build`: **SUCCESS** (vite v5.4.21 bundle transformed and minified cleanly in 9.98s)

---

## 10. Definition of Done (Step 2)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Grading matrix defined for all supported types (`NUMERICAL`, `MCQ`, `SHORT_ANSWER`, `TRUE_FALSE`, `MULTI_SELECT`) | ✅ |
| 2 | `numericalVerifier.ts` preserved as sole numerical authority | ✅ |
| 3 | MCQ deterministic verification with distractor misconception awareness | ✅ |
| 4 | Multi-select deterministic verification with controlled partial credit | ✅ |
| 5 | True/False deterministic verification with strict format validation | ✅ |
| 6 | Layered short-answer evaluation with safe `UNVERIFIABLE` fallback | ✅ |
| 7 | Bounded $[0.0, 1.0]$ deterministic server-computed scoring | ✅ |
| 8 | Structured misconception detection (15 categories) without LLM speculation | ✅ |
| 9 | Pre-delivery question and answer-key integrity verification | ✅ |
| 10 | Zero-trust submission security (client cannot manipulate grade/answer key) | ✅ |
| 11 | Phase 3 grounded feedback integration with citation verification | ✅ |
| 12 | 40/40 tests in `src/test/answerVerification.test.ts` pass | ✅ |
| 13 | All 286 regression tests pass | ✅ |
| 14 | TypeScript 0 errors | ✅ |
| 15 | Production build succeeds | ✅ |
| 16 | Documentation complete | ✅ |

---

# CANONICAL PHASE 4 — STEP 3
## Assessment Quality, Ambiguity & Generation Hardening

**Status:** COMPLETE ✅  
**Phase:** 4 of 7 (Canonical Roadmap)  
**Roadmap Progress:**
- Phase 4 Step 1: COMPLETE ✅
- Phase 4 Step 2: COMPLETE ✅
- Phase 4 Step 3: COMPLETE ✅
- Phase 5+: NOT STARTED ⏳

---

## 1. Executive Summary

Phase 4 Step 3 establishes Ming's **Assessment Quality, Ambiguity & Generation Hardening Engine** (`server/questionQualityValidator.ts`).
While the LLM may propose candidate assessment items, the server remains **strictly authoritative** over:
- Question validity
- Structural well-formedness
- System prompt leakage and script injection detection
- Type-specific integrity and distractor quality
- Ambiguity detection
- Internal question/answer/explanation consistency
- Deterministic SHA-256 question fingerprinting and near-duplicate protection
- Traceable source grounding and tenant authorization
- Fail-closed batch quarantine prior to student presentation

No generated question can bypass these deterministic quality gates or reach student-facing views without passing verification.

---

## 2. Canonical Question Quality Contract

Every candidate question is evaluated against strict type-specific invariants:

| Category | Requirement & Validation Policy | Rejection Code |
| :--- | :--- | :--- |
| **General Structure** | Non-empty question stem; minimum 8 characters; valid question type; valid metadata; answer key presence. | `MISSING_STEM`, `STEM_TOO_SHORT`, `UNSUPPORTED_TYPE`, `MISSING_ANSWER_KEY` |
| **Prompt Leakage & Script Defense** | Scans stem, options, explanation for system instruction markers (`"You are an AI"`, `"System prompt:"`, `"Return ONLY JSON"`, `"[EVIDENCE_"`, `"<script>"`, `"javascript:"`, `"ignore previous instructions"`). | `PROMPT_LEAKAGE` |
| **MCQ Options & Distractors** | Minimum 2 options (3–5 preferred); unique option IDs; non-empty option text; no duplicate options; exactly one correct choice matching available options; no empty distractors. | `INSUFFICIENT_OPTIONS`, `DUPLICATE_OPTION_ID`, `DUPLICATE_OPTION_TEXT`, `EMPTY_OPTION_TEXT`, `CORRECT_OPTION_NOT_FOUND`, `DISTRACTOR_EQUALS_CORRECT` |
| **Multi-Select Set Integrity** | Minimum 2 options; unique option IDs; at least 1 correct option; all correct choices must exist in options universe; no duplicate option texts. | `INSUFFICIENT_OPTIONS`, `DUPLICATE_OPTION_TEXT`, `CORRECT_OPTION_NOT_FOUND`, `MISSING_ANSWER_KEY` |
| **True/False Assertion** | Canonical boolean representation (`true`/`false`/`t`/`f`/`yes`/`no`/`1`/`0`); unparseable, evasive, or ambiguous representations (`"maybe"`, `"sometimes"`) rejected as hard errors. | `MALFORMED_BOOLEAN` |
| **Numerical Specification** | Finite expected value (rejects NaN/Infinity); safe expression evaluation (rejects division-by-zero); valid positive tolerance; verifier contract compatibility via `verifyNumericalQuestion()`. | `NON_FINITE_NUMERICAL`, `MATHEMATICALLY_INVALID`, `INVALID_TOLERANCE`, `UNVERIFIABLE_NUMERICAL` |
| **Short-Answer Specifics** | Non-empty canonical answer; distinct accepted variants; non-contradictory required components. | `EMPTY_SHORT_ANSWER`, `CONTRADICTORY_COMPONENTS` |

---

## 3. Validation States & Ambiguity Policy

The validator emits a canonical three-state verdict:
1. **`VALID`**: Passes all structural, type, distractor, consistency, duplicate, and grounding checks. Safe for delivery.
2. **`REVIEW_REQUIRED`**: Soft ambiguity detected (e.g. excessively broad tolerance $\ge 50\%$, stem asking for units without `expected_unit`, near-duplicate question with Jaccard similarity $\ge 0.85$). Quarantined from automated student delivery.
3. **`INVALID`**: Hard violation (missing stem, contradictory answer key, prompt leakage, duplicate option IDs, cross-tenant evidence). Quarantined and suppressed.

Ambiguity is never resolved by guessing or unconstrained LLM heuristics. Ambiguous content is rejected or quarantined.

---

## 4. Deterministic Question Fingerprinting & Deduplication

### 4.1 SHA-256 Fingerprint
A stable, normalized fingerprint is computed for every question:
$$\text{payload} = \text{type} \mathbin{::} \text{normalized\_stem} \mathbin{::} \text{sorted\_normalized\_options} \mathbin{::} \text{normalized\_answer}$$
$$\text{fingerprint} = \text{SHA-256}(\text{payload})$$

Features:
- Case-insensitive, punctuation-stripped, whitespace-collapsed.
- Permutation-invariant across option presentation orders.
- Identical questions produce identical 64-character hex strings across sessions and databases.

### 4.2 Near-Duplicate Detection
Calculates word set Jaccard similarity:
$$J(A, B) = \frac{|A \cap B|}{|A \cup B|}$$
- If exact fingerprint or exact normalized stem match $\to$ `DUPLICATE_QUESTION` (`REJECT`).
- If $J \ge 0.85$ $\to$ `NEAR_DUPLICATE_QUESTION` (`REVIEW_REQUIRED`).
- If $J < 0.85$ $\to$ Allowed as a distinct question.

---

## 5. Source Grounding Requirement (Phase 3 Integration)

For source-grounded assessments, candidate questions must provide verifiable provenance:
1. **Evidence Resolution**: Looks up `chunk_id` in the local canonical evidence index (`buildCanonicalEvidenceIndex`).
2. **Tenant Isolation**: Verifies `chunk.user_id === authenticated_user_id` or `SYSTEM_PUBLIC`. Cross-tenant chunks are rejected with `CROSS_TENANT_REJECTED`.
3. **Resource Availability**: Verifies that the underlying document/resource exists and is not soft-deleted. Deleted resources return `SOURCE_UNAVAILABLE`.
4. **Coordinate Integrity**: Checks that question coordinates (`page_number`, `slide_number`) match the underlying chunk coordinates. Mismatches return `COORDINATE_MISMATCH`.

If grounding fails, the question is **quarantined** and never delivered as a valid grounded assessment item.

---

## 6. Question / Answer / Explanation Consistency

Deterministic consistency verification prevents contradictory items:
- **MCQ**: Explanation cannot explicitly designate a different option (e.g. key is A, but explanation says "The correct answer is B").
- **True/False**: Explanation cannot contradict the truth value (e.g. key is True, but explanation begins "False. ...").
- **Numerical**: Calculation numbers cited in explanation cannot contradict the authoritative expected value by $> 30\%$.
- **Short-Answer**: Required components cannot contradict the canonical answer.

---

## 7. Fail-Closed Batch Generation & Quarantine

Implemented in `validateHardenedQuestionBatch(questions, context)`:
- Processes the full array of candidate items proposed by the generation engine.
- Performs **intra-batch deduplication** (if two questions in the same batch share a fingerprint, the second is quarantined).
- Quarantines invalid or review-required items with detailed error codes.
- Only completely `VALID` questions are persisted and delivered to students.
- In `/api/rag/assessment/generate`, if all proposed items fail validation, the endpoint returns an empty set of valid questions without delivering broken or corrupted questions.

---

## 8. Zero-Trust Grading Preservation

The generation hardening engine sits strictly **before delivery**.
Once delivered, student submissions are graded by `robustAnswerVerifier.ts` from Step 2:
- Student submission payloads cannot provide answer keys, scores, tolerances, or error categories.
- Authoritative question data is loaded from the database by ID.
- Student-facing responses pass through `sanitizeResultForStudent()`, stripping hidden prompts and internal diagnostic keys.

---

## 9. Verification & Quality Gates

### Test Suites Passed
- `src/test/questionQualityValidation.test.ts`: **50/50 PASS**
- `src/test/numericalAssessment.test.ts`: **78/78 PASS**
- `src/test/answerVerification.test.ts`: **40/40 PASS**
- `src/test/phase9AssessmentIntelligence.test.tsx`: **19/19 PASS**
- `src/test/groundingVerification.test.ts`: **30/30 PASS**
- `src/test/sourceNavigation.test.tsx`: **25/25 PASS**
- `src/test/productionSecurityAndIsolation.test.ts`: **23/23 PASS**
- `src/test/resourceStreaming.test.ts`: **22/22 PASS**
- `src/test/multimodalIngestion.test.ts`: **24/24 PASS**
- `src/test/productionSmokeIntegration.test.ts`: **17/17 PASS**
- `src/test/ragVectorStoreEquivalence.test.ts`: **8/8 PASS**

**Total Baseline Test Suite:** **336 / 336 PASS (100%)**

### Compilation & Build
- `npx tsc --noEmit`: **0 errors**
- `npm run build`: **SUCCESS** (vite v5.4.21 bundle transformed and minified cleanly in 9.86s)

---

## 10. Definition of Done (Step 3)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Canonical question quality contract defined across all types | ✅ |
| 2 | Prompt leakage and script injection detection | ✅ |
| 3 | Distractor quality verification (uniqueness, plausibility, non-empty) | ✅ |
| 4 | Deterministic ambiguity detection with `REVIEW_REQUIRED` state | ✅ |
| 5 | Question-answer-explanation consistency checks | ✅ |
| 6 | SHA-256 fingerprinting and near-duplicate detection | ✅ |
| 7 | Source grounding verification reusing Phase 3 contracts | ✅ |
| 8 | Fail-closed batch generation and quarantine pipeline | ✅ |
| 9 | Zero-trust submission security preserved via Step 2 engine | ✅ |
| 10 | 50/50 tests in `src/test/questionQualityValidation.test.ts` pass | ✅ |
| 11 | All 336 regression tests pass | ✅ |
| 12 | TypeScript 0 errors | ✅ |
| 13 | Production build succeeds | ✅ |
| 14 | Documentation complete | ✅ |


