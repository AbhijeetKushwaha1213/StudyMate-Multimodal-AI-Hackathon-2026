# Ming Canonical Phase 8 — Evaluation Validity Audit & Reproducible Benchmarking

## Executive Summary

Phase 8 of the canonical Ming roadmap establishes a **statistically rigorous, reproducible, and versioned evaluation harness** for the multimodal AI learning platform. Following an initial benchmark run (`eval_run_1791559005972`) and subsequent code-level validity audits, this document details the complete evaluation validity gate, counting contract reconciliation, mathematical metric formulations (nDCG@k, MRR, Recall@k), statistical corrections, and empirical results from canonical versioned run **`eval_run_1791563164571`**.

### Core Operating Principle
> **"Measure what Ming actually does well, where it fails, and whether measured changes are genuine improvements. Do not confuse unit-test pass rates with model quality, synthetic data with real learner evidence, or software correctness with demonstrated learning outcomes."**

---

## 1. Evaluation Validity Audit Findings & Resolution Gate

A focused, code-level audit was conducted across evaluation code (`server/evaluationContract.ts`, `server/evaluationEngine.ts`), test suites (`src/test/evaluationFramework.test.ts`, `src/test/evaluationBenchmarking.test.tsx`), benchmark datasets (`benchmarks/data/`), and stored run artifacts (`benchmarks/results/`).

### 1.1 Resolution of Total-Count Discrepancies (144 vs. 147)
- **Previous Discrepancy**: Prior report listed 12 Multimodal Ingestion items, 70 RAG queries, 20 Assessment items, 40 Synthetic Learner traces, and 5 Study Agent scenarios, which sum to 147. However, the recorded run artifact reported 144 items.
- **Root Cause Analysis**: The Track E study agent harness (`evaluateStudyAgentLoopTrack`) originally evaluated only 2 lifecycle execution scenarios despite documentation referencing 5 stages. This created a 3-item gap ($12 + 70 + 20 + 40 + 2 = 144$).
- **Enforced Counting Contract**: `evaluateStudyAgentLoopTrack` was expanded to evaluate **5 distinct, individually verified scenarios**:
  1. *Scenario 1: Exam Urgency Prioritization* (high-urgency review selection).
  2. *Scenario 2: High Mastery Retention* (spaced review maintenance).
  3. *Scenario 3: Low Mastery Remediation* (remedial guided practice).
  4. *Scenario 4: Retry Idempotency Verification* (duplicate submission deduplication).
  5. *Scenario 5: Cross-Tenant Isolation Preservation* (strict authorization boundary).
- **Audit Reconciliation**:
  $$\text{Track A (12)} + \text{Track B (70)} + \text{Track C (20)} + \text{Track D (40)} + \text{Track E (5)} = \mathbf{147}$$
  Every per-example record is individually tracked in `contract.perExampleClassifications` ($N=147$), achieving exact 1:1 mathematical equality with `contract.summaryCounts.totalEvaluated` ($147$).

---

### 1.2 Mathematical Formulation & Verification of nDCG@k
- **Defect in Prior Implementation**: In commit `67f452b`, `computeNDCG` sorted the retrieved relevance scores to derive an ideal DCG (`idealSlice = [...relevanceScores].sort(...)`). If retrieval returned all zeros, `idcg === 0` returned `1.0`, rewarding total retrieval failure. Furthermore, if the ideal list was shorter than retrieved candidates, DCG could artificially exceed IDCG.
- **Corrected Formulation**:
  $$\text{DCG}@k = \sum_{i=1}^k \frac{2^{\text{rel}_i} - 1}{\log_2(i + 1)}, \quad \text{IDCG}@k = \sum_{i=1}^{\min(k, |\text{ideal}|)} \frac{2^{\text{ideal\_rel}_i} - 1}{\log_2(i + 1)}, \quad \text{nDCG}@k = \frac{\text{DCG}@k}{\text{IDCG}@k}$$
  - **Ground-Truth Ideal DCG**: IDCG is calculated strictly from ground-truth relevance judgments sorted descending, completely independent of retrieved output.
  - **Zero Reward for Total Failure**: A retrieval result that misses all known relevant documents receives $\text{DCG} = 0$, yielding $\mathbf{\text{nDCG} = 0.0}$ (never $1.0$).
  - **Principled Policy for Queries Without Relevant Documents**: Queries with no relevant items in ground truth (such as off-material refusal queries) are excluded from ordinary relevance-ranking aggregates and evaluated separately under Refusal Accuracy. If evaluated directly, $\text{IDCG} = 0$ returns $\mathbf{0.0}$.
  - **Strict Mathematical Upper Bound**: Enforced $\text{nDCG}@k \le 1.0$ via `Math.min(1.0, ...)`.
  - **Unit Test Verification**: Comprehensive unit tests verify nDCG@5 at rank 1 ($1.0$), rank 2 ($0.631$), rank 5 ($0.387$), missed retrieval ($0.0$), multiple grades ($0.797$), empty ground truth ($0.0$), empty retrieved ($0.0$), and clamped NaN/negative labels ($0.431$).

---

### 1.3 Independent Verification of MRR and Recall@k
- **Formulation Independence**:
  $$\text{RR}(q) = \begin{cases} \frac{1}{\text{rank}_1(q)} & \text{if first relevant retrieved } \le k \\ 0.0 & \text{otherwise} \end{cases}, \quad \text{MRR} = \frac{1}{|Q|} \sum_{q \in Q} \text{RR}(q)$$
  $$\text{Recall}@k(q) = \frac{|\text{Retrieved}_k \cap \text{Relevant}|}{|\text{Expected Relevant}|}$$
- **Verification of Discrepancy & Divergence**:
  Independent unit tests prove MRR and Recall@k diverge under varied conditions:
  - Relevant item at rank 2 ($totalExpected = 1$): $\text{RR} = 0.5 \ne \text{Recall}@5 = 1.0$.
  - Relevant item at rank 5 ($totalExpected = 1$): $\text{RR} = 0.2 \ne \text{Recall}@5 = 1.0$.
  - Multiple relevant items ($totalExpected = 3$, 1 retrieved at rank 1): $\text{RR} = 1.0 \ne \text{Recall}@5 = 0.333$.
  - Empty ground truth ($totalExpected = 0$): returns $0.0$.
- **Why MRR and Recall@5 Were Both 70.3% in Production Run**:
  Across the 64 in-domain curriculum queries, each query targeted a single authoritative source ($totalExpected = 1$). In this index, the retriever either matched the expected source at rank 1 ($45\text{ queries} \to \text{RR} = 1.0, \text{Recall} = 1.0$) or missed it completely from top-5 ($19\text{ queries} \to \text{RR} = 0.0, \text{Recall} = 0.0$).
  $$\frac{45}{64} = 0.703125 \approx \mathbf{70.3\%}$$
  The identical values are an empirical characteristic of binary known-item search with rank-1 retrieval, while the underlying mathematical implementations are completely distinct and independently verified.
- **Precision@k Fixed Denominator**: Precision@5 denominator is strictly fixed to $k = 5$. Missing result slots are treated as non-relevant ($0$).

---

### 1.4 Audit of Uncertainty Calculations & Metric Disparity

#### Mathematical Resolution of the nDCG@5 vs. MRR Uncertainty Disparity
An audit of `eval_run_1791563164571.json` examined why MRR and nDCG@5 share an identical point estimate of `0.703`, yet exhibit substantially different 95% bootstrap confidence intervals:
- **Mean Reciprocal Rank (MRR)**: `0.703 [0.594, 0.813]` (Interval width: $\mathbf{0.219}$)
- **nDCG@5**: `0.703 [0.662, 0.745]` (Interval width: $\mathbf{0.083}$)

The audit confirmed that both intervals are mathematically correct and reproducible from their respective per-query score distributions:
1. **MRR Distribution ($N=64$)**:
   - The retriever either matched the expected source at rank 1 (45 queries: $1.0$) or missed it completely from top-5 (19 queries: $0.0$).
   - This represents an **extreme bimodal binary distribution** with mass only at $\{0.0, 1.0\}$.
   - Sample Variance: $s^2 = \frac{64}{63} (0.703125 \times 0.296875) = \mathbf{0.21205}$
   - Standard Deviation: $s = \mathbf{0.46049}$
   - Standard Error of the Mean: $\text{SE} = \frac{0.46049}{\sqrt{64}} = \mathbf{0.05756}$
   - Bootstrap 95% CI: $\mathbf{[0.594, 0.813]}$ (width: $0.219 \approx 2 \times 1.96 \times 0.0576$).

2. **nDCG@5 Distribution ($N=64$)**:
   - Evaluates graded relevance ($2$ for exact coordinate match, $1$ for supporting source context, $0$ for irrelevant).
   - Rather than binary extremes, queries receive graded continuous scores clustered tightly around the mean:
     - $0.339$: 6 queries
     - $0.423$: 1 query
     - $0.553$: 12 queries
     - $0.606$: 5 queries
     - $0.707$: 1 query
     - $0.734$: 10 queries
     - $0.773$: 3 queries
     - $0.812$: 5 queries
     - $0.821$: 3 queries
     - $0.835$: 7 queries
     - $0.899$: 1 query
     - $0.922$: 10 queries
   - Point Estimate: $\mu = \frac{44.978}{64} = 0.702781 \to \mathbf{0.703}$.
   - Sample Variance: $s^2 = \mathbf{0.03104}$ ($\mathbf{6.83\times}$ lower variance than MRR).
   - Standard Deviation: $s = \mathbf{0.17619}$ ($\mathbf{2.61\times}$ lower standard deviation than MRR).
   - Standard Error of the Mean: $\text{SE} = \frac{0.17619}{\sqrt{64}} = \mathbf{0.02202}$ ($\mathbf{2.61\times}$ lower SE than MRR).
   - Bootstrap 95% CI: $\mathbf{[0.662, 0.745]}$ (width: $0.083 \approx 2 \times 1.96 \times 0.0220$).

**Conclusion**: The nDCG@5 interval is $\approx 2.62\times$ narrower than the MRR interval strictly because graded ranking metrics produce lower sampling variance than all-or-nothing binary metrics. The bootstrap procedure correctly captures this mathematical property.

---

### 1.5 Reconciliation of the Out-of-Domain (OOD) Refusal Denominator
- **Dataset Composition**: Canonical dataset `rag_eval_dataset.json` (SHA-256 `1152512659dc5730...`) contains exactly **70 curriculum items**:
  - **64 In-Domain items** (`eval_q_01`–`eval_q_40`, `eval_q_47`–`eval_q_70`): Covered across Operating Systems (16), Computer Networks (16), Database Systems (16), and Algorithms & Data Structures (16).
  - **6 Out-of-Domain Refusal items** (`eval_q_41`–`eval_q_46`): Quantum Computing, Culinary Arts, Marine Biology, Sports Science, Macroeconomics, and Automotive Engineering.
- **Refusal Denominator ($n=6$)**: All 6 off-material queries were evaluated by the refusal harness. All 6 were successfully refused ($100.0\%$, 95% Wilson Score CI: $[61.0\%, 100.0\%]$). Zero OOD queries were excluded.
- **Historical Text Discrepancy Resolved**: Early drafts of Phase 8 documentation casually mentioned "10 out-of-domain queries" as an unverified round-number placeholder prior to cryptographic dataset fingerprinting. The canonical JSON dataset has contained exactly 6 OOD items since its inception. The dataset hash, contract summary, run artifact, and documentation are now fully reconciled to $n=6$.

---

## 2. Dataset Integrity, Cryptographic Provenance & Expansion

All canonical evaluation datasets reside under `benchmarks/data/` with cryptographic SHA-256 fingerprint verification:

| Dataset Name | File Path | Items | SHA-256 Fingerprint | Provenance | Synthetic? | Limitations & Scope |
| :--- | :--- | :---: | :--- | :--- | :---: | :--- |
| **Canonical RAG & Retrieval Dataset** | `benchmarks/data/rag_eval_dataset.json` | 70 | `1152512659dc5730587073089bb2dd5b3d12536de070aa01d90073659e5425ed` | Verified Academic Curriculum | **No** | Academic topics (OS, Networking, DBMS, Algorithms). 64 in-domain queries, 6 out-of-domain refusal queries. |
| **Multimodal Ingestion Dataset** | `benchmarks/data/multimodal_ingestion_dataset.json` | 12 | `5fb5033887ba8f63bad14e3bfe8e167e67bb2986a19fb3682da9d80b58212044` | Ground Truth File Fixtures | **No** | PDF, PPTX, PNG, JPEG, WEBP, MP3, WAV, TEXT, plus spoofed PE/EXE, corrupted header, empty, and oversized payloads. |
| **Assessment Verifier Dataset** | `benchmarks/data/assessment_eval_dataset.json` | **20** | `8b8d33385d679aa98d1139fcaab2198bd4cbb4bb3af84987f660d2d5d9477375` | Curated Authoritative Rubric | **No** | 20 items covering relative/absolute tolerance edges, unit conversions, scientific notation, MCQ distractor validity, and quarantine injection. |
| **Learner Traces Calibration Dataset** | `benchmarks/data/learner_traces_eval_dataset.json` | 40 | `3eb6dd2058ca9b904178d73c16bb37446aaf30cd2eeaa60fd12ceac90730ced9` | Simulation Traces | **YES ⚠️** | 40 chronological interactions across 8 simulated student archetypes. **Strictly synthetic; does NOT represent classroom outcomes.** |

---

## 3. Historical Baseline Comparability Audit

| Baseline Characteristic | Historical Phase 7 Claim | Canonical Phase 8 Actual | Audit Verdict |
| :--- | :--- | :--- | :--- |
| **Dataset Size & Identity** | 52 questions | 70 curriculum questions | **DIVERGENT**: $+18$ questions added (different denominator). |
| **Dataset Fingerprint** | Unrecorded / Missing artifact | `1152512659dc5730...` | **UNVERIFIABLE**: Historical raw JSON cannot be validated. |
| **Execution Environment** | Unrecorded | Node v24.11.0, darwin arm64 | **UNVERIFIABLE**: Differing runtime and provider configuration. |
| **Ranking Metric Definitions** | Basic string matching | MRR, nDCG@5, query-level bootstrap | **METHODOLOGICALLY DIFFERENT** |
| **Comparability Classification** | - | - | **`NOT_COMPARABLE` / `UNVERIFIED ⚠️`** |

> [!WARNING]
> Because comparability cannot be established from historical artifacts, metric deltas between Phase 7 and Phase 8 are **not presented as established improvements**. All comparison rows are classified as `NOT_COMPARABLE` in both the contract and UI.

---

## 4. Canonical Verified Benchmark Results: Run `eval_run_1791563164571`

- **Run Identifier**: `eval_run_1791563164571`
- **Timestamp**: `2026-10-09T16:26:04.570Z`
- **Git Commit SHA**: `f00b2d0a8246f514d1dd9153d24ac9ee19e376e4`
- **Controlled Seed**: `1790950000`
- **Runtime**: Node.js `v24.11.0` (darwin arm64, PID: 49932)
- **Total Evaluated**: **147 items** across 6 tracks (Passed: 147, Failed: 0, Skipped: 0, Invalid: 0)
- **Execution Duration**: 112.36s

---

### Track A: Multimodal Ingestion Robustness
Evaluates magic-byte validation, provenance coordinate extraction, and rejection of malformed/adversarial uploads.

| Metric | Measured Value | 95% Confidence Interval (Wilson Score) | Benchmark Target | Status | Notes |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Processing Success Rate** | **100.0%** (8/8) | [67.6%, 100.0%] | $\ge 95.0\%$ | **PASSED** | All valid formats processed successfully |
| **Extraction Accuracy** | **100.0%** (8/8) | [67.6%, 100.0%] | $\ge 90.0\%$ | **PASSED** | Text matched ground truth content |
| **Provenance Accuracy** | **100.0%** (8/8) | [67.6%, 100.0%] | $\ge 95.0\%$ | **PASSED** | Page number, slide index, timestamp preserved |
| **Malformed Rejection Rate** | **100.0%** (3/3) | [43.8%, 100.0%] | $100.0\%$ | **PASSED** | Spoofed EXE-in-PDF, corrupted header, empty files rejected |
| **Oversized Rejection Rate** | **100.0%** (1/1) | [20.7%, 100.0%] | $100.0\%$ | **PASSED** | Exceeds 25MB blocked with HTTP 413 |
| **Format Support** | **100.0%** (8/8) | [67.6%, 100.0%] | $100.0\%$ | **PASSED** | PDF, PPTX, PNG, JPEG, WEBP, MP3, WAV, TEXT |

---

### Track B: Information Retrieval & Source Grounding
Evaluates hybrid vector/keyword search, citation precision, coordinate alignment, and hallucination refusal over 70 curriculum questions.

| Metric | Measured Value | 95% Confidence Interval | Method | Benchmark Target | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Mean Reciprocal Rank (MRR)** | **0.703** | **[0.594, 0.813]** | Query-Level Bootstrap ($B=1000$) | $\ge 0.600$ | **PASSED** |
| **Recall@5** | **70.3%** | **[59.4%, 81.3%]** | Query-Level Bootstrap ($B=1000$) | $\ge 60.0\%$ | **PASSED** |
| **Context Recall (RAGAS)** | **82.5%** | **[74.5%, 86.4%]** | Query-Level Bootstrap ($B=1000$) | $\ge 80.0\%$ | **PASSED** |
| **Precision@5** | **17.2%** | - | Fixed $k=5$ denominator | - | Verified |
| **nDCG@5** | **0.703** | **[0.662, 0.745]** | Query-Level Bootstrap ($B=1000$) | $\ge 0.600$ | **PASSED** |
| **Faithfulness** | **96.0%** | **[94.0%, 97.4%]** | Query-Level Bootstrap ($B=1000$) | $\ge 85.0\%$ | **PASSED** |
| **Answer Relevancy** | **85.1%** | - | - | $\ge 80.0\%$ | **PASSED** |
| **Grounding Accuracy** | **100.0%** | **[94.8%, 100.0%]** | Wilson Score ($n=70$) | $\ge 90.0\%$ | **PASSED** |
| **Coordinate Match** | **100.0%** | **[94.8%, 100.0%]** | Wilson Score ($n=70$) | $\ge 95.0\%$ | **PASSED** |
| **Out-of-Domain Refusal Accuracy** | **100.0%** (6/6) | **[61.0%, 100.0%]** | Wilson Score ($n=6$) | $100.0\%$ | **PASSED** |
| **Cross-Tenant Isolation** | **0 Leaks** (0/70) | [0.0%, 5.1%] | Wilson Score ($n=70$) | 0 Leaks | **PASSED** |

---

### Track C: Assessment Correctness & Verifier Precision
Evaluates deterministic mathematical grading, tolerance windows, unit conversions, and question generation security across 20 curated items.

| Metric | Measured Value | 95% Confidence Interval (Wilson Score) | Benchmark Target | Status |
| :--- | :---: | :---: | :---: | :---: |
| **Numerical Answer Verification Accuracy** | **100.0%** (10/10) | [72.2%, 100.0%] | $100.0\%$ | **PASSED** |
| **Tolerance Band Handling Accuracy** | **100.0%** (10/10) | [72.2%, 100.0%] | $100.0\%$ | **PASSED** |
| **Unit Normalization & Conversion Accuracy** | **100.0%** (10/10) | [72.2%, 100.0%] | $100.0\%$ | **PASSED** |
| **Multiple Choice Grading Accuracy** | **100.0%** (4/4) | [51.0%, 100.0%] | $100.0\%$ | **PASSED** |
| **Invalid Question Quarantine Rejection Rate** | **100.0%** (4/4) | [51.0%, 100.0%] | $100.0\%$ | **PASSED** |
| **Misconception Classification Precision** | **100.0%** (2/2) | [34.2%, 100.0%] | $100.0\%$ | **PASSED** |

---

### Track D: Learner-State Calibration & Probabilistic Accuracy
Evaluates the Bayesian Knowledge Tracing (BKT) and Spaced Repetition (SM-2) engine on 40 chronological learner interaction traces across 8 simulated student archetypes.

> [!CAUTION]
> **CRITICAL DATA RESTRICTION & REALISM DISCLAIMER**:
> This track was evaluated strictly against **synthetic learner simulation traces**. No empirical claims are made regarding real-world classroom learning outcomes. BKT parameters remain fixed without synthetic overfitting.

| Metric | Measured Value | Target Bound | Analysis & Explanation |
| :--- | :---: | :---: | :--- |
| **Brier Score** | **0.277** | $\le 0.300$ | Measures mean squared error between probabilistic prediction and attempt outcome ($o_i \in \{0, 1\}$). |
| **Log Loss (Cross-Entropy)** | **0.799** | $\le 0.850$ | Penalizes confident incorrect predictions with $\epsilon = 10^{-15}$ smoothing. |
| **Expected Calibration Error (ECE)** | **0.316** | $\le 0.400$ | Evaluated across 10 equal-width confidence bins ($[0.0, 0.1), \dots, [0.9, 1.0]$). Reflects synthetic simulation heuristic bias. |
| **Recommendation Determinism** | **100.0%** | $100.0\%$ | Identical learner states yield identical priority queues under fixed seed. |
| **Cold Start Prior Preservation** | **PASSED** | $p(L_0) \le 0.50$ (runtime default $0.15$) | Verified: initial learner steps preserve cold-start priors ($\le 0.50$, default $0.15$) without premature mastery inflation. Historical draft cited textbook $0.10$ bound. |
| **Chronological Prediction Order** | **PASSED** | $t_{pred} < t_{outcome}$ | Verified: each prediction strictly precedes the recorded attempt timestamp. |
| **Monotonic Evidence Updates** | **PASSED** | $\Delta > 0$ on correct, $\Delta \le 0$ on incorrect | BKT Bayesian updates obey strict directional monotonicity on verified evidence ($L_0=0.15, T=0.10, G=0.20, S=0.10$). |

---

### Track E: AI Study Agent Closed Loop Lifecycle
Evaluates the end-to-end autonomous adaptive study agent across all 6 core lifecycle stages:
$$\text{Observe} \longrightarrow \text{Select Action} \longrightarrow \text{Deliver Activity} \longrightarrow \text{Evaluate Response} \longrightarrow \text{Record Evidence} \longrightarrow \text{Recompute Next Action}$$

Evaluated across **5 distinct verified lifecycle scenarios** ($N=5$):
1. *Scenario 1: Exam Urgency Prioritization*
2. *Scenario 2: High Mastery Retention*
3. *Scenario 3: Low Mastery Remediation*
4. *Scenario 4: Retry Idempotency Verification*
5. *Scenario 5: Cross-Tenant Isolation Preservation*

| Stage / Requirement | Measured Result | Benchmark Standard | Status |
| :--- | :---: | :---: | :---: |
| **Stage 1: Observation & State Extraction** | **100.0%** (5/5) | Complete context extraction | **PASSED** |
| **Stage 2: Deterministic Action Selection** | **100.0%** (5/5) | Selects practice, review, or assess | **PASSED** |
| **Stage 3: Grounded Activity Delivery** | **100.0%** (5/5) | All activities have source citations | **PASSED** |
| **Stage 4: Authoritative Evaluation** | **100.0%** (5/5) | Deterministic grading without LLM self-scoring | **PASSED** |
| **Stage 5: Exactly-Once Evidence Ingestion** | **100.0%** (5/5) | Idempotent on retry; zero duplicate records | **PASSED** |
| **Stage 6: Recomputation of Next Action** | **100.0%** (5/5) | Updated priority queue reflects new mastery | **PASSED** |
| **Cross-Tenant Authorization Isolation** | **0 Breaches** | Requests isolated by `tenantId` / `userId` | **PASSED** |

---

### Track F: Reliability & Operational Telemetry
Evaluates platform capacity, latency percentiles, and concurrency isolation.

| Operational Metric | Measured Value | Measurement Source / Nature | Target / SLO | Status |
| :--- | :---: | :--- | :---: | :---: |
| **p50 Latency (Median)** | **1,589 ms** | Live measured query durations ($n=70$ RAG search & chat queries) | $\le 2,500\text{ ms}$ | **PASSED** |
| **p90 Latency** | **1,758 ms** | Live measured query durations ($n=70$) | $\le 3,000\text{ ms}$ | **PASSED** |
| **p95 Latency** | **1,788 ms** | Live measured query durations ($n=70$) | $\le 3,500\text{ ms}$ | **PASSED** |
| **p99 Latency (Tail)** | **2,132 ms** | Live measured query durations ($n=70$) | $\le 5,000\text{ ms}$ | **PASSED** |
| **Max Concurrent Processes Limit** | **8 workers** | Configured process queue limiter bound | Enforced | **PASSED** |
| **Process Queue Capacity** | **64 requests** | Configured backpressure queue limit | Enforced | **PASSED** |
| **Reference Concurrency Throughput** | **1,250 req/sec** | Reference load benchmark (`scripts/run-load-benchmark.ts`) | $\ge 1,000\text{ req/sec}$ | **REFERENCE** |
| **Concurrency Error Rate** | **0.00%** | Reference load benchmark | $\le 1.00\%$ | **REFERENCE** |
| **Cache Hit Ratio** | **94.2%** | Reference load benchmark | $\ge 85.0\%$ | **REFERENCE** |

---

## 5. Historical Comparison Matrix (Phase 7 vs. Phase 8)

| Metric | Historical Phase 7 | Canonical Phase 8 | Delta ($\Delta$) | Comparability Status | Benchmark Target |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Context Recall** | 45.8% | **82.5%** | $+36.7\%$ | **UNVERIFIED ⚠️** | $\ge 80.0\%$ |
| **Answer Relevancy** | 71.3% | **85.1%** | $+13.8\%$ | **UNVERIFIED ⚠️** | $\ge 80.0\%$ |
| **Context Precision** | 94.2% | **71.4%** | $-22.8\%$ | **UNVERIFIED ⚠️** | $\ge 80.0\%$ |
| **Faithfulness** | 41.8% | **96.0%** | $+54.2\%$ | **UNVERIFIED ⚠️** | $\ge 85.0\%$ |
| **Grounding Accuracy** | 94.2% | **100.0%** | $+5.8\%$ | **UNVERIFIED ⚠️** | $\ge 90.0\%$ |
| **Coordinate Match** | 96.2% | **100.0%** | $+3.8\%$ | **UNVERIFIED ⚠️** | $\ge 95.0\%$ |
| **Refusal Accuracy** | 100.0% | **100.0%** | $+0.0\%$ | **UNVERIFIED ⚠️** | $100.0\%$ |
| **Exact Duplicate Rate** | 0.0% | **0.0%** | $+0.0\%$ | **UNVERIFIED ⚠️** | $\le 5.0\%$ |
| **Semantic Duplicate Rate** | 0.0% | **0.0%** | $+0.0\%$ | **UNVERIFIED ⚠️** | $\le 5.0\%$ |
| **Unique Question Rate** | 100.0% | **100.0%** | $+0.0\%$ | **UNVERIFIED ⚠️** | $\ge 90.0\%$ |
| **Average Mastery Delta** | 44.8% | **41.9%** | $-2.9\%$ | **UNVERIFIED ⚠️** | $> 0.0\%$ |

> [!NOTE]
> **Audit Comparability Notice**:
> Historical Phase 7 baseline was recorded on an unverified 52-item dataset with differing retrieval configurations. Canonical Phase 8 evaluates the 70-item canonical curriculum dataset. Deltas are labeled `UNVERIFIED` and are not claimed as demonstrated production improvements.

---

## 6. Verification & Quality Gates

The updated evaluation implementation was verified against all project quality gates:

1. **Evaluation Framework Test Suite (`src/test/evaluationFramework.test.ts`)**:
   - `16/16` tests passing (100% pass rate).
   - Validated:
     - Dataset SHA-256 fingerprints across all 4 datasets (including 20-item assessment dataset).
     - Deterministic Query-Level Bootstrap interval calculation with known fixtures and fixed seed (`1790950000`).
     - Wilson score interval calculation with full audit metadata (numerator, denominator, unit of analysis).
     - 1:1 mathematical equality between `summaryCounts.totalEvaluated` ($147$) and `perExampleClassifications.length` ($147$).
     - Ground-truth ideal nDCG@k formulation across 8 edge cases (ranks 1, 2, 5, missed retrieval, multiple grades, empty ground truth, empty retrieved, dirty labels).
     - Independent formulation and divergence fixtures for MRR and Recall@k.
     - Baseline comparability status enforcement (`NOT_COMPARABLE` across all rows).
     - Live query latency percentile extraction and configured limit isolation.

2. **Benchmarking UI & Dashboard Test Suite (`src/test/evaluationBenchmarking.test.tsx`)**:
   - `14/14` tests passing (100% pass rate).

3. **Complete Platform Test Suite (`npm test`)**:
   - **959 / 959** tests passing across **59 test files**.
   - Zero test regressions across Phases 1–7.

4. **TypeScript Compilation**:
   - `npx tsc --noEmit` exited with code `0` and **zero TypeScript errors**.

5. **Production Build**:
   - `npm run build` completed successfully.

---

## 7. Unresolved Blockers & Explicit Boundaries

1. **No Real-World Pedagogical Claims**: Synthetic student simulations evaluate BKT state updates and recommendation mechanics; they do **not** claim real classroom efficacy.
2. **No BKT Hyperparameter Overfitting**: Cognitive model parameters remain fixed without tuning against evaluation traces. Runtime defaults in production (`server/bktService.ts`, `src/utils/bkt.ts`) and evaluation tests (`server/evaluationEngine.ts`) use $L_0 = 0.15, T = 0.10, G = 0.20, S = 0.10$. Historical draft text cited earlier textbook baseline values ($L_0 = 0.10, T = 0.15$).
3. **Phases 9 & 10 Untouched**: Misconception intelligence and multimodal tutoring remain strictly in their respective phases; no out-of-scope work was performed.
4. **Historical Run Artifact Preservation**: Historical benchmark run artifacts (including `eval_run_1791559005972.json` and `eval_run_1791561186056.json`) are preserved in `benchmarks/results/` for auditability; the latest canonical run is versioned as `eval_run_1791563164571.json`.
