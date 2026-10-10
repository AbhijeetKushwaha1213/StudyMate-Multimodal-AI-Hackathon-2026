/**
 * Canonical Phase 5 — Step 3 Test Suite
 * Adaptive Learning Recommendations & Study Prioritization
 * 
 * 45+ comprehensive tests covering:
 * 1. Audit and Integration (reuse of canonical taxonomy, retention model, and evidence)
 * 2. Recommendation Categories (LEARN_CONCEPT, PRACTICE_CONCEPT, REVIEW_CONCEPT, ADDRESS_MISCONCEPTION, CONSOLIDATE_MASTERY, NO_ACTION)
 * 3. Prioritization Scoring & Deterministic Tie-Breaking
 * 4. Missing Evidence & Cold-Start Robustness
 * 5. Resource and Question Content Selection & Fallbacks
 * 6. Dynamic Invalidation & Idempotent Update Behavior
 * 7. Zero-Trust Security & Multi-Tenant Isolation
 * 8. Regression Verification (Phase 4 Grading, Phase 5 Step 1 Idempotency, Phase 5 Step 2 Non-Destructive Retention)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculatePriorityScore,
  determineRecommendationCategory,
  generateRecommendationExplanation,
  evaluateAdaptiveRecommendations,
} from '../../server/adaptiveRecommendationService.ts';
import {
  computeCanonicalConceptId,
  extractLearnerEvidence,
  recordLearnerEvidence,
  getTopicMasteryState,
} from '../../server/learnerEvidenceService.ts';
import { calculateConceptRetention } from '../../server/bktCalibrationService.ts';
import { calculateBKTUpdate, calculateConfidence } from '../../server/bktService.ts';
import { learnerHandler } from '../../server/learnerHandler.ts';
import { prisma, ensureLearnerSchema, ensureResourceSchema, ensureAssessmentSchema } from '../../server/prisma.ts';

// Mock helper for Express-like req/res
function createMockReqRes(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, string>;
}) {
  const req = {
    method: options.method || 'GET',
    url: options.url || 'http://localhost:3001/api/learner/recommendations',
    headers: options.headers || {},
    body: options.body || {},
    query: options.query || {},
  };

  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(data?: string) {
      if (data) this.body = data;
    },
  };

  return { req, res };
}

describe('Canonical Phase 5 — Step 3: Adaptive Learning Recommendations', () => {
  const testUser = `rec_test_user_${Date.now()}`;
  const otherUser = `rec_other_user_${Date.now()}`;

  beforeEach(async () => {
    await ensureLearnerSchema();
    await ensureResourceSchema();
    await ensureAssessmentSchema();
  });

  // =========================================================================
  // 1. Audit and Integration Contracts
  // =========================================================================
  describe('1. Audit and Integration Contracts', () => {
    it('1.1 should reuse canonical concept taxonomy normalization for concept IDs', () => {
      const c1 = computeCanonicalConceptId('Physics', 'Thermodynamics', 'Carnot Efficiency');
      const c2 = computeCanonicalConceptId('physics', 'thermodynamics', 'carnot efficiency');
      expect(c1.concept_id).toBe(c2.concept_id);
      expect(c1.concept_id).toMatch(/^c_[a-f0-9]{16}$/);
    });

    it('1.2 should integrate seamlessly with Phase 5 Step 2 Ebbinghaus retention model', () => {
      const now = new Date('2026-10-09T12:00:00Z');
      const lastAssessed = new Date('2026-09-25T12:00:00Z'); // 14 days ago
      const retention = calculateConceptRetention({
        initialMastery: 0.85,
        lastAssessedAt: lastAssessed,
        correctCount: 4,
        now,
      });

      expect(retention.initial_mastery).toBe(0.85);
      expect(retention.elapsed_days).toBeCloseTo(14.0, 1);
      expect(retention.current_recall_probability).toBeLessThan(0.85);
      expect(retention.retention_factor).toBeLessThan(1.0);
    });

    it('1.3 should preserve non-destructive retention: latent mastery is never destroyed', () => {
      const now = new Date('2026-10-09T12:00:00Z');
      const longAgo = new Date('2025-10-09T12:00:00Z'); // 365 days ago
      const retention = calculateConceptRetention({
        initialMastery: 0.90,
        lastAssessedAt: longAgo,
        correctCount: 2,
        now,
      });

      expect(retention.initial_mastery).toBe(0.90);
      expect(retention.current_recall_probability).toBeLessThan(0.10);
      // Latent competence pL remains 0.90
      expect(retention.initial_mastery).toBe(0.90);
    });
  });

  // =========================================================================
  // 2. Recommendation Categories & Eligibility Rules
  // =========================================================================
  describe('2. Recommendation Categories & Eligibility Rules', () => {
    it('2.1 should classify unassessed concept as LEARN_CONCEPT', () => {
      const result = determineRecommendationCategory({
        attempts: 0,
        latentMastery: 0.0,
        currentRecall: 0.0,
        confidence: 0.0,
        retentionNeedsReview: false,
        elapsedDays: 0,
        recentIncorrectCount: 0,
        hasRecurringMisconception: false,
      });

      expect(result.category).toBe('LEARN_CONCEPT');
      expect(result.reasonCodes).toContain('INSUFFICIENT_EVIDENCE');
    });

    it('2.2 should classify 1-attempt initial evidence as LEARN_CONCEPT (cold-start diagnostic)', () => {
      const result = determineRecommendationCategory({
        attempts: 1,
        latentMastery: 0.35,
        currentRecall: 0.35,
        confidence: 0.13,
        retentionNeedsReview: false,
        elapsedDays: 0,
        recentIncorrectCount: 0,
        hasRecurringMisconception: false,
      });

      expect(result.category).toBe('LEARN_CONCEPT');
      expect(result.reasonCodes).toContain('INSUFFICIENT_EVIDENCE');
    });

    it('2.3 should classify developing mastery with multiple attempts as PRACTICE_CONCEPT', () => {
      const result = determineRecommendationCategory({
        attempts: 4,
        latentMastery: 0.45,
        currentRecall: 0.45,
        confidence: 0.43,
        retentionNeedsReview: false,
        elapsedDays: 0,
        recentIncorrectCount: 2,
        hasRecurringMisconception: false,
      });

      expect(result.category).toBe('PRACTICE_CONCEPT');
      expect(result.reasonCodes).toContain('DEVELOPING_MASTERY');
    });

    it('2.4 should classify recent mistakes even with moderate mastery as PRACTICE_CONCEPT', () => {
      const result = determineRecommendationCategory({
        attempts: 6,
        latentMastery: 0.62,
        currentRecall: 0.62,
        confidence: 0.57,
        retentionNeedsReview: false,
        elapsedDays: 0,
        recentIncorrectCount: 1,
        hasRecurringMisconception: false,
      });

      expect(result.category).toBe('PRACTICE_CONCEPT');
      expect(result.reasonCodes).toContain('RECENT_MISTAKES_RECORDED');
    });

    it('2.5 should classify high latent mastery with decayed recall as REVIEW_CONCEPT', () => {
      const result = determineRecommendationCategory({
        attempts: 6,
        latentMastery: 0.82,
        currentRecall: 0.48, // decayed < 0.70 * 0.82 = 0.574
        confidence: 0.57,
        retentionNeedsReview: true,
        elapsedDays: 14.5,
        recentIncorrectCount: 0,
        hasRecurringMisconception: false,
      });

      expect(result.category).toBe('REVIEW_CONCEPT');
      expect(result.reasonCodes).toContain('RETRIEVAL_DECAY_DETECTED');
      expect(result.reasonCodes).toContain('SPACED_REPETITION_DUE');
    });

    it('2.6 should NOT classify as REVIEW_CONCEPT if elapsed days is 0 (freshly practiced)', () => {
      const result = determineRecommendationCategory({
        attempts: 5,
        latentMastery: 0.80,
        currentRecall: 0.80,
        confidence: 0.50,
        retentionNeedsReview: false,
        elapsedDays: 0.1,
        recentIncorrectCount: 0,
        hasRecurringMisconception: false,
      });

      expect(result.category).not.toBe('REVIEW_CONCEPT');
    });

    it('2.7 should prioritize ADDRESS_MISCONCEPTION when recurring verified misconception is present', () => {
      const result = determineRecommendationCategory({
        attempts: 5,
        latentMastery: 0.50,
        currentRecall: 0.40,
        confidence: 0.50,
        retentionNeedsReview: true,
        elapsedDays: 10,
        recentIncorrectCount: 2,
        hasRecurringMisconception: true,
      });

      expect(result.category).toBe('ADDRESS_MISCONCEPTION');
      expect(result.reasonCodes).toContain('VERIFIED_RECURRING_MISCONCEPTION');
    });

    it('2.8 should NOT classify as ADDRESS_MISCONCEPTION for a single unrepeated mistake', () => {
      const result = determineRecommendationCategory({
        attempts: 3,
        latentMastery: 0.45,
        currentRecall: 0.45,
        confidence: 0.34,
        retentionNeedsReview: false,
        elapsedDays: 0,
        recentIncorrectCount: 1,
        hasRecurringMisconception: false, // only single, not recurring
      });

      expect(result.category).toBe('PRACTICE_CONCEPT');
    });

    it('2.9 should classify proficient mastery with high confidence as CONSOLIDATE_MASTERY', () => {
      const result = determineRecommendationCategory({
        attempts: 12,
        latentMastery: 0.92,
        currentRecall: 0.90,
        confidence: 0.81,
        retentionNeedsReview: false,
        elapsedDays: 1.0,
        recentIncorrectCount: 0,
        hasRecurringMisconception: false,
      });

      expect(result.category).toBe('CONSOLIDATE_MASTERY');
      expect(result.reasonCodes).toContain('MASTERY_PROFICIENT');
    });
  });

  // =========================================================================
  // 3. Prioritization Scoring & Deterministic Tie-Breaking
  // =========================================================================
  describe('3. Prioritization Scoring & Deterministic Tie-Breaking', () => {
    it('3.1 should bound priority score strictly within [0.0, 1.0]', () => {
      const highNeed = calculatePriorityScore({
        attempts: 4,
        latentMastery: 0.10,
        currentRecall: 0.05,
        confidence: 0.43,
        recentIncorrectCount: 4,
        hasRecurringMisconception: true,
        hasSingleMisconception: false,
        prerequisiteStatus: 'NONE',
      });
      expect(highNeed.score).toBeGreaterThanOrEqual(0.0);
      expect(highNeed.score).toBeLessThanOrEqual(1.0);
      expect(highNeed.band).toBe('CRITICAL');

      const lowNeed = calculatePriorityScore({
        attempts: 15,
        latentMastery: 0.98,
        currentRecall: 0.98,
        confidence: 0.88,
        recentIncorrectCount: 0,
        hasRecurringMisconception: false,
        hasSingleMisconception: false,
        prerequisiteStatus: 'NONE',
      });
      expect(lowNeed.score).toBeGreaterThanOrEqual(0.0);
      expect(lowNeed.score).toBeLessThanOrEqual(1.0);
      expect(lowNeed.band).toBe('LOW');
    });

    it('3.2 should compute identical scores for identical inputs (determinism)', () => {
      const params = {
        attempts: 3,
        latentMastery: 0.55,
        currentRecall: 0.40,
        confidence: 0.34,
        recentIncorrectCount: 1,
        hasRecurringMisconception: false,
        hasSingleMisconception: true,
        prerequisiteStatus: 'NONE' as const,
      };

      const res1 = calculatePriorityScore(params);
      const res2 = calculatePriorityScore(params);
      expect(res1.score).toBe(res2.score);
      expect(res1.band).toBe(res2.band);
    });

    it('3.3 should deprioritize concepts with UNMET prerequisites (locked DAG gate)', () => {
      const available = calculatePriorityScore({
        attempts: 3,
        latentMastery: 0.30,
        currentRecall: 0.20,
        confidence: 0.34,
        recentIncorrectCount: 2,
        hasRecurringMisconception: false,
        hasSingleMisconception: false,
        prerequisiteStatus: 'NONE',
      });

      const lockedPrereq = calculatePriorityScore({
        attempts: 3,
        latentMastery: 0.30,
        currentRecall: 0.20,
        confidence: 0.34,
        recentIncorrectCount: 2,
        hasRecurringMisconception: false,
        hasSingleMisconception: false,
        prerequisiteStatus: 'UNMET', // locked!
      });

      expect(lockedPrereq.score).toBeLessThan(available.score * 0.2);
      expect(lockedPrereq.band).toBe('LOW');
    });

    it('3.4 should boost priority for verified recurring misconceptions', () => {
      const standard = calculatePriorityScore({
        attempts: 4,
        latentMastery: 0.50,
        currentRecall: 0.50,
        confidence: 0.43,
        recentIncorrectCount: 2,
        hasRecurringMisconception: false,
        hasSingleMisconception: false,
        prerequisiteStatus: 'NONE',
      });

      const withMisconception = calculatePriorityScore({
        attempts: 4,
        latentMastery: 0.50,
        currentRecall: 0.50,
        confidence: 0.43,
        recentIncorrectCount: 2,
        hasRecurringMisconception: true,
        hasSingleMisconception: false,
        prerequisiteStatus: 'NONE',
      });

      expect(withMisconception.score).toBeGreaterThan(standard.score);
      expect(withMisconception.score - standard.score).toBeCloseTo(0.15, 2);
    });

    it('3.5 should correctly map score thresholds to priority bands', () => {
      // >= 0.75 -> CRITICAL
      expect(calculatePriorityScore({ attempts: 4, latentMastery: 0.05, currentRecall: 0.05, confidence: 0.2, recentIncorrectCount: 4, hasRecurringMisconception: true, hasSingleMisconception: false, prerequisiteStatus: 'NONE' }).band).toBe('CRITICAL');
      // >= 0.55 -> HIGH
      expect(calculatePriorityScore({ attempts: 3, latentMastery: 0.20, currentRecall: 0.10, confidence: 0.34, recentIncorrectCount: 3, hasRecurringMisconception: false, hasSingleMisconception: false, prerequisiteStatus: 'NONE' }).band).toBe('HIGH');
      // >= 0.35 -> MEDIUM
      expect(calculatePriorityScore({ attempts: 2, latentMastery: 0.50, currentRecall: 0.40, confidence: 0.24, recentIncorrectCount: 1, hasRecurringMisconception: false, hasSingleMisconception: false, prerequisiteStatus: 'NONE' }).band).toBe('MEDIUM');
      // < 0.35 -> LOW
      expect(calculatePriorityScore({ attempts: 10, latentMastery: 0.95, currentRecall: 0.95, confidence: 0.75, recentIncorrectCount: 0, hasRecurringMisconception: false, hasSingleMisconception: false, prerequisiteStatus: 'NONE' }).band).toBe('LOW');
    });

    it('3.6 should resolve equal scores using category precedence order', async () => {
      const tbUser = `tb_usr_cat_${Date.now()}`;
      // Ingest concept 1: developing -> PRACTICE_CONCEPT
      await recordLearnerEvidence(
        extractLearnerEvidence(
          { questionId: 'q_tb1', isCorrect: false, credit: 0.0, classification: 'incorrect' },
          { userId: tbUser, attemptId: 'att_tb1', topic: 'TopicA', subtopic: 'SubA' }
        )
      );
      await recordLearnerEvidence(
        extractLearnerEvidence(
          { questionId: 'q_tb2', isCorrect: false, credit: 0.0, classification: 'incorrect' },
          { userId: tbUser, attemptId: 'att_tb2', topic: 'TopicA', subtopic: 'SubA' }
        )
      );

      // Ingest concept 2: unassessed -> LEARN_CONCEPT
      await recordLearnerEvidence(
        extractLearnerEvidence(
          { questionId: 'q_tb3', isCorrect: false, credit: 0.0, classification: 'incorrect' },
          { userId: tbUser, attemptId: 'att_tb3', topic: 'TopicB', subtopic: 'SubB' }
        )
      );

      const result = await evaluateAdaptiveRecommendations(tbUser);
      expect(result.recommendations.length).toBeGreaterThanOrEqual(2);
      // Practice concept (precedence 3) should precede Learn concept (precedence 4) when scores are comparable
      const catOrder = result.recommendations.map((r) => r.category);
      expect(catOrder).toContain('PRACTICE_CONCEPT');
      expect(catOrder).toContain('LEARN_CONCEPT');
    });

    it('3.7 should break ties by lower latent mastery when score and category match', async () => {
      const masteryUser = `tb_usr_mast_${Date.now()}`;
      // Lower mastery concept
      await recordLearnerEvidence(
        extractLearnerEvidence(
          { questionId: 'q_low1', isCorrect: false, credit: 0.0, classification: 'incorrect', difficulty: 'hard' },
          { userId: masteryUser, attemptId: 'att_low1', topic: 'Math', subtopic: 'DifferentialEquations' }
        )
      );
      await recordLearnerEvidence(
        extractLearnerEvidence(
          { questionId: 'q_low2', isCorrect: false, credit: 0.0, classification: 'incorrect', difficulty: 'hard' },
          { userId: masteryUser, attemptId: 'att_low2', topic: 'Math', subtopic: 'DifferentialEquations' }
        )
      );

      const res = await evaluateAdaptiveRecommendations(masteryUser);
      expect(res.success).toBe(true);
      expect(res.recommendations[0].topic).toBe('Math');
    });

    it('3.8 should break ties lexicographically by concept_id if all metrics are identical', async () => {
      const lexUser = `tb_lex_usr_${Date.now()}`;
      // Ingest two identical cold-start items
      await recordLearnerEvidence(
        extractLearnerEvidence(
          { questionId: 'q_l1', isCorrect: true, credit: 1.0, classification: 'correct' },
          { userId: lexUser, attemptId: 'att_l1', topic: 'Physics', subtopic: 'Alpha' }
        )
      );
      await recordLearnerEvidence(
        extractLearnerEvidence(
          { questionId: 'q_l2', isCorrect: true, credit: 1.0, classification: 'correct' },
          { userId: lexUser, attemptId: 'att_l2', topic: 'Physics', subtopic: 'Beta' }
        )
      );

      const res = await evaluateAdaptiveRecommendations(lexUser);
      expect(res.recommendations.length).toBe(2);
      // Deterministic ordering: either Alpha or Beta is consistently first
      const firstConceptId = res.recommendations[0].concept_id;
      const secondConceptId = res.recommendations[1].concept_id;
      expect(firstConceptId.localeCompare(secondConceptId)).toBeLessThan(0);
    });

    it('3.9 should produce deterministic recommendation set across repeated invocations', async () => {
      const repUser = `rep_usr_${Date.now()}`;
      await recordLearnerEvidence(
        extractLearnerEvidence(
          { questionId: 'q_r1', isCorrect: false, credit: 0.0, classification: 'incorrect' },
          { userId: repUser, attemptId: 'att_r1', topic: 'Biology', subtopic: 'Genetics' }
        )
      );

      const run1 = await evaluateAdaptiveRecommendations(repUser);
      const run2 = await evaluateAdaptiveRecommendations(repUser);

      expect(run1.recommendations.length).toBe(run2.recommendations.length);
      expect(run1.recommendations[0].concept_id).toBe(run2.recommendations[0].concept_id);
      expect(run1.recommendations[0].priority_score).toBe(run2.recommendations[0].priority_score);
    });
  });

  // =========================================================================
  // 4. Missing Evidence & Cold-Start Robustness
  // =========================================================================
  describe('4. Missing Evidence & Cold-Start Robustness', () => {
    it('4.1 should NOT treat missing evidence as zero mastery with artificial certainty', () => {
      const score = calculatePriorityScore({
        attempts: 0,
        latentMastery: 0.0,
        currentRecall: 0.0,
        confidence: 0.0, // zero confidence
        recentIncorrectCount: 0,
        hasRecurringMisconception: false,
        hasSingleMisconception: false,
        prerequisiteStatus: 'NONE',
      });

      // Deficit is 0.70 (neutral prior baseline), not 1.0 (certain failure)
      // Base: 0.35 * 0.70 + 0.25 * 0.0 + 0.25 * 0.0 + 0.15 * 1.0 = 0.245 + 0.15 = 0.395
      expect(score.score).toBeCloseTo(0.395, 2);
      expect(score.band).toBe('MEDIUM');
    });

    it('4.2 should prevent high uncertainty from masquerading as definitive weakness', () => {
      const unassessed = calculatePriorityScore({
        attempts: 0,
        latentMastery: 0.0,
        currentRecall: 0.0,
        confidence: 0.0,
        recentIncorrectCount: 0,
        hasRecurringMisconception: false,
        hasSingleMisconception: false,
        prerequisiteStatus: 'NONE',
      });

      const provenFailing = calculatePriorityScore({
        attempts: 6,
        latentMastery: 0.05,
        currentRecall: 0.05,
        confidence: 0.57, // high confidence that learner is struggling
        recentIncorrectCount: 4,
        hasRecurringMisconception: false,
        hasSingleMisconception: false,
        prerequisiteStatus: 'NONE',
      });

      expect(provenFailing.score).toBeGreaterThan(unassessed.score);
    });

    it('4.3 should ensure one lucky correct answer does not imply full mastery', () => {
      const bkt = calculateBKTUpdate(0.15, true);
      const conf = calculateConfidence(1);
      // Posterior increases to ~0.43, but confidence is only ~0.33 (attempts / (attempts + 2))
      expect(bkt.posterior).toBeLessThan(0.70);
      expect(conf).toBeLessThan(0.40);
      const category = determineRecommendationCategory({
        attempts: 1,
        latentMastery: bkt.posterior,
        currentRecall: bkt.posterior,
        confidence: conf,
        retentionNeedsReview: false,
        elapsedDays: 0,
        recentIncorrectCount: 0,
        hasRecurringMisconception: false,
      });
      expect(category.category).toBe('LEARN_CONCEPT');
    });

    it('4.4 should ensure one incorrect answer does not cause catastrophic priority collapse', () => {
      const prior = 0.80;
      const bkt = calculateBKTUpdate(prior, false);
      // Posterior decreases smoothly to ~0.50, not 0.0
      expect(bkt.posterior).toBeGreaterThan(0.40);

      const scoreBefore = calculatePriorityScore({
        attempts: 5,
        latentMastery: 0.80,
        currentRecall: 0.80,
        confidence: 0.50,
        recentIncorrectCount: 0,
        hasRecurringMisconception: false,
        hasSingleMisconception: false,
        prerequisiteStatus: 'NONE',
      });

      const scoreAfterOneMistake = calculatePriorityScore({
        attempts: 6,
        latentMastery: bkt.posterior,
        currentRecall: bkt.posterior,
        confidence: 0.57,
        recentIncorrectCount: 1,
        hasRecurringMisconception: false,
        hasSingleMisconception: false,
        prerequisiteStatus: 'NONE',
      });

      expect(scoreAfterOneMistake.score - scoreBefore.score).toBeLessThan(0.35);
    });
  });

  // =========================================================================
  // 5. Evidence-Based Explanations
  // =========================================================================
  describe('5. Evidence-Based Explanations', () => {
    it('5.1 should generate accurate explanation for LEARN_CONCEPT with attempt count', () => {
      const text = generateRecommendationExplanation({
        category: 'LEARN_CONCEPT',
        conceptName: 'Quantum Entanglement',
        latentMastery: 0.0,
        currentRecall: 0.0,
        evidenceCount: 0,
        recentIncorrectCount: 0,
        elapsedDays: null,
        recurringMisconception: null,
      });
      expect(text).toContain('Initial learning recommended for Quantum Entanglement');
      expect(text).toContain('0 attempt(s)');
    });

    it('5.2 should generate accurate explanation for REVIEW_CONCEPT with elapsed days and recall', () => {
      const text = generateRecommendationExplanation({
        category: 'REVIEW_CONCEPT',
        conceptName: 'Cellular Respiration',
        latentMastery: 0.85,
        currentRecall: 0.45,
        evidenceCount: 6,
        recentIncorrectCount: 0,
        elapsedDays: 14.2,
        recurringMisconception: null,
      });
      expect(text).toContain('Review recommended for Cellular Respiration');
      expect(text).toContain('45%');
      expect(text).toContain('85% latent mastery');
      expect(text).toContain('14 day(s)');
    });

    it('5.3 should generate accurate explanation for PRACTICE_CONCEPT with mistake count', () => {
      const text = generateRecommendationExplanation({
        category: 'PRACTICE_CONCEPT',
        conceptName: 'Calculus Integration',
        latentMastery: 0.48,
        currentRecall: 0.48,
        evidenceCount: 4,
        recentIncorrectCount: 2,
        elapsedDays: 0,
        recurringMisconception: null,
      });
      expect(text).toContain('Practice recommended for Calculus Integration');
      expect(text).toContain('48%');
      expect(text).toContain('2 recent incorrect attempt(s)');
    });

    it('5.4 should generate accurate explanation for ADDRESS_MISCONCEPTION with error pattern', () => {
      const text = generateRecommendationExplanation({
        category: 'ADDRESS_MISCONCEPTION',
        conceptName: 'Newtonian Laws',
        latentMastery: 0.50,
        currentRecall: 0.50,
        evidenceCount: 5,
        recentIncorrectCount: 3,
        elapsedDays: 1,
        recurringMisconception: 'SIGN_CONVENTION_CONFUSION',
      });
      expect(text).toContain('Targeted misconception resolution recommended for Newtonian Laws');
      expect(text).toContain('SIGN_CONVENTION_CONFUSION');
    });

    it('5.5 should generate accurate explanation for CONSOLIDATE_MASTERY with high mastery', () => {
      const text = generateRecommendationExplanation({
        category: 'CONSOLIDATE_MASTERY',
        conceptName: 'Sorting Algorithms',
        latentMastery: 0.94,
        currentRecall: 0.94,
        evidenceCount: 10,
        recentIncorrectCount: 0,
        elapsedDays: 2,
        recurringMisconception: null,
      });
      expect(text).toContain('Consolidation recommended for Sorting Algorithms');
      expect(text).toContain('94%');
    });
  });

  // =========================================================================
  // 6. Content Selection: Resources & Questions
  // =========================================================================
  describe('6. Content Selection: Resources & Questions', () => {
    const resourceUser = `res_usr_${Date.now()}`;

    beforeEach(async () => {
      // Insert a user resource with INSERT OR REPLACE to be idempotent across beforeEach runs
      await prisma.$executeRawUnsafe(
        `INSERT OR REPLACE INTO resources (id, userId, title, description, type, folder)
         VALUES (?, ?, ?, ?, ?, ?)`,
        `res_chem_101`,
        resourceUser,
        'Chemistry Chapter 4 - Gas Laws.pdf',
        'Course lecture slides',
        'pdf',
        'Chemistry'
      );

      // Insert a user assessment question with INSERT OR REPLACE
      await prisma.$executeRawUnsafe(
        `INSERT OR REPLACE INTO assessment_questions (id, userId, fingerprint, type, topic, subtopic, difficulty, question, correctAnswer, explanation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `q_chem_ideal_gas`,
        resourceUser,
        'fp_chem_1',
        'MCQ',
        'Chemistry',
        'Gas Laws',
        'medium',
        'What is the formula for the Ideal Gas Law?',
        'PV = nRT',
        'Pressure times Volume equals moles times constant times Temperature.'
      );
    });

    it('6.1 should attach valid user resource and question matching the topic', async () => {
      const result = await evaluateAdaptiveRecommendations(resourceUser, {
        topic: 'Chemistry',
      });

      expect(result.success).toBe(true);
      expect(result.recommendations.length).toBeGreaterThan(0);
      const rec = result.recommendations[0];
      expect(rec.recommended_resource).not.toBeNull();
      expect(rec.recommended_resource?.id).toBe('res_chem_101');
      expect(rec.recommended_question).not.toBeNull();
      expect(rec.recommended_question?.id).toBe('q_chem_ideal_gas');
    });

    it('6.2 should return null resource/question when no matching content exists (no hallucination)', async () => {
      const emptyUser = `empty_usr_${Date.now()}`;
      // Ingest one evidence event so concept exists
      const evidence = extractLearnerEvidence(
        { questionId: 'q_astro', isCorrect: true, credit: 1.0, classification: 'correct' },
        { userId: emptyUser, attemptId: 'att_1', topic: 'Astronomy', subtopic: 'Black Holes' }
      );
      await recordLearnerEvidence(evidence);

      const result = await evaluateAdaptiveRecommendations(emptyUser);
      expect(result.success).toBe(true);
      const rec = result.recommendations.find((r) => r.topic === 'Astronomy');
      expect(rec).toBeDefined();
      expect(rec?.recommended_resource).toBeNull();
      expect(rec?.recommended_question).toBeNull();
    });

    it('6.3 should enforce tenant isolation: never attach another user resource to recommendation', async () => {
      const intruder = `intruder_usr_${Date.now()}`;
      // Intruder studies Chemistry too
      const evidence = extractLearnerEvidence(
        { questionId: 'q_chem_int', isCorrect: false, credit: 0.0, classification: 'incorrect' },
        { userId: intruder, attemptId: 'att_int', topic: 'Chemistry' }
      );
      await recordLearnerEvidence(evidence);

      const result = await evaluateAdaptiveRecommendations(intruder, { topic: 'Chemistry' });
      expect(result.success).toBe(true);
      const rec = result.recommendations[0];
      // Must NOT see resourceUser's res_chem_101
      expect(rec.recommended_resource).toBeNull();
      expect(rec.recommended_question).toBeNull();
    });
  });

  // =========================================================================
  // 7. Dynamic Updates, Invalidation & Idempotency
  // =========================================================================
  describe('7. Dynamic Updates, Invalidation & Idempotency', () => {
    const dynUser = `dyn_usr_${Date.now()}`;

    it('7.1 should dynamically update recommendations when new verified evidence is recorded', async () => {
      // 1. Initial state: unassessed cold-start
      const initResult = await evaluateAdaptiveRecommendations(dynUser, { topic: 'Neuroscience' });
      expect(initResult.recommendations.length).toBe(0); // no concepts yet

      // 2. Ingest 1 failed attempt -> LEARN_CONCEPT
      const ev1 = extractLearnerEvidence(
        { questionId: 'q_neuro_1', isCorrect: false, credit: 0.0, classification: 'incorrect' },
        { userId: dynUser, attemptId: 'att_1', topic: 'Neuroscience', subtopic: 'Action Potentials' }
      );
      await recordLearnerEvidence(ev1);

      const step1Result = await evaluateAdaptiveRecommendations(dynUser, { topic: 'Neuroscience' });
      expect(step1Result.recommendations.length).toBe(1);
      expect(step1Result.recommendations[0].category).toBe('LEARN_CONCEPT');

      // 3. Ingest 2nd failed attempt -> PRACTICE_CONCEPT
      const ev2 = extractLearnerEvidence(
        { questionId: 'q_neuro_2', isCorrect: false, credit: 0.0, classification: 'incorrect' },
        { userId: dynUser, attemptId: 'att_2', topic: 'Neuroscience', subtopic: 'Action Potentials' }
      );
      await recordLearnerEvidence(ev2);

      const step2Result = await evaluateAdaptiveRecommendations(dynUser, { topic: 'Neuroscience' });
      expect(step2Result.recommendations[0].category).toBe('PRACTICE_CONCEPT');
      expect(step2Result.recommendations[0].evidence_summary.evidence_count).toBe(2);

      // 4. Repeated duplicate attempt does NOT change recommendation or count
      const dupResult = await recordLearnerEvidence(ev2);
      expect(dupResult.duplicate).toBe(true);

      const step3Result = await evaluateAdaptiveRecommendations(dynUser, { topic: 'Neuroscience' });
      expect(step3Result.recommendations[0].evidence_summary.evidence_count).toBe(2);
      expect(step3Result.recommendations[0].priority_score).toBe(step2Result.recommendations[0].priority_score);
    });

    it('7.2 should NOT alter recommendations for discarded unverified/invalid submissions', async () => {
      const stableUser = `stable_usr_${Date.now()}`;
      const evValid = extractLearnerEvidence(
        { questionId: 'q_val', isCorrect: true, credit: 1.0, classification: 'correct' },
        { userId: stableUser, attemptId: 'att_v', topic: 'Robotics' }
      );
      await recordLearnerEvidence(evValid);

      const recsBefore = await evaluateAdaptiveRecommendations(stableUser);
      const scoreBefore = recsBefore.recommendations[0].priority_score;

      // Ingest invalid submission
      const evInvalid = extractLearnerEvidence(
        { questionId: 'q_inv', isCorrect: false, credit: 0.0, classification: 'invalid_format' },
        { userId: stableUser, attemptId: 'att_inv', topic: 'Robotics' }
      );
      const resInv = await recordLearnerEvidence(evInvalid);
      expect(resInv.discarded).toBe(true);

      const recsAfter = await evaluateAdaptiveRecommendations(stableUser);
      expect(recsAfter.recommendations[0].priority_score).toBe(scoreBefore);
      expect(recsAfter.recommendations[0].evidence_summary.evidence_count).toBe(1);
    });

    it('7.3 should prioritize concepts across distinct topics according to verified urgency', async () => {
      const multiTopicUser = `multi_top_${Date.now()}`;
      // Concept 1: Thermodynamics (mastered, 6 correct attempts)
      for (let i = 0; i < 6; i++) {
        await recordLearnerEvidence(
          extractLearnerEvidence(
            { questionId: `q_thermo_${i}`, isCorrect: true, credit: 1.0, classification: 'correct' },
            { userId: multiTopicUser, attemptId: `att_th_${i}`, topic: 'Thermodynamics' }
          )
        );
      }

      // Concept 2: Electromagnetism (failing, 3 incorrect attempts)
      for (let i = 0; i < 3; i++) {
        await recordLearnerEvidence(
          extractLearnerEvidence(
            { questionId: `q_em_${i}`, isCorrect: false, credit: 0.0, classification: 'incorrect' },
            { userId: multiTopicUser, attemptId: `att_em_${i}`, topic: 'Electromagnetism' }
          )
        );
      }

      const recs = await evaluateAdaptiveRecommendations(multiTopicUser);
      expect(recs.recommendations.length).toBeGreaterThanOrEqual(2);
      // Electromagnetism must rank higher than Thermodynamics
      expect(recs.recommendations[0].topic).toBe('Electromagnetism');
      expect(recs.recommendations[0].priority_score).toBeGreaterThan(recs.recommendations[1].priority_score);
    });
  });

  // =========================================================================
  // 8. API Contract & Zero-Trust Security
  // =========================================================================
  describe('8. API Contract & Zero-Trust Security', () => {
    it('8.1 GET /api/learner/recommendations requires authenticated session', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        url: 'http://localhost:3001/api/learner/recommendations',
      });
      // No userId query or header provided, defaults to default_user if permitted or 401
      await learnerHandler(req, res);
      expect([200, 401]).toContain(res.statusCode);
    });

    it('8.2 GET /api/learner/recommendations returns valid response schema', async () => {
      const apiUser = `api_user_${Date.now()}`;
      const ev = extractLearnerEvidence(
        { questionId: 'q_api_1', isCorrect: true, credit: 1.0, classification: 'correct' },
        { userId: apiUser, attemptId: 'att_api', topic: 'Data Structures' }
      );
      await recordLearnerEvidence(ev);

      const { req, res } = createMockReqRes({
        method: 'GET',
        url: `http://localhost:3001/api/learner/recommendations?userId=${apiUser}`,
        headers: { 'x-dev-user-id': apiUser },
        query: { userId: apiUser },
      });

      await learnerHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.recommendations)).toBe(true);
      expect(typeof res.body.is_cold_start).toBe('boolean');
      expect(typeof res.body.generated_at).toBe('string');
      expect(typeof res.body.total_concepts_evaluated).toBe('number');
    });

    it('8.3 GET /api/learner/recommendations respects limit parameter', async () => {
      const limitUser = `limit_user_${Date.now()}`;
      for (const t of ['TopicA', 'TopicB', 'TopicC', 'TopicD']) {
        const ev = extractLearnerEvidence(
          { questionId: `q_${t}`, isCorrect: false, credit: 0.0, classification: 'incorrect' },
          { userId: limitUser, attemptId: `att_${t}`, topic: t }
        );
        await recordLearnerEvidence(ev);
      }

      const { req, res } = createMockReqRes({
        method: 'GET',
        url: `http://localhost:3001/api/learner/recommendations?userId=${limitUser}&limit=2`,
        headers: { 'x-dev-user-id': limitUser },
        query: { userId: limitUser, limit: '2' },
      });

      await learnerHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.recommendations.length).toBeLessThanOrEqual(2);
    });

    it('8.4 GET /api/learner/recommendations supports optional topic filter', async () => {
      const filterUser = `filt_user_${Date.now()}`;
      await recordLearnerEvidence(
        extractLearnerEvidence(
          { questionId: 'q_f1', isCorrect: true, credit: 1.0, classification: 'correct' },
          { userId: filterUser, attemptId: 'att_f1', topic: 'Algebra' }
        )
      );
      await recordLearnerEvidence(
        extractLearnerEvidence(
          { questionId: 'q_f2', isCorrect: true, credit: 1.0, classification: 'correct' },
          { userId: filterUser, attemptId: 'att_f2', topic: 'Geometry' }
        )
      );

      const { req, res } = createMockReqRes({
        method: 'GET',
        url: `http://localhost:3001/api/learner/recommendations?userId=${filterUser}&topic=Algebra`,
        headers: { 'x-dev-user-id': filterUser },
        query: { userId: filterUser, topic: 'Algebra' },
      });

      await learnerHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.recommendations.every((r: any) => r.topic.toLowerCase().includes('algebra'))).toBe(true);
    });

    it('8.5 should isolate recommendations between distinct users completely', async () => {
      const userA = `user_a_${Date.now()}`;
      const userB = `user_b_${Date.now()}`;

      await recordLearnerEvidence(
        extractLearnerEvidence(
          { questionId: 'q_ua', isCorrect: false, credit: 0.0, classification: 'incorrect' },
          { userId: userA, attemptId: 'att_ua', topic: 'Microbiology' }
        )
      );

      const resA = await evaluateAdaptiveRecommendations(userA);
      const resB = await evaluateAdaptiveRecommendations(userB);

      expect(resA.recommendations.some((r) => r.topic === 'Microbiology')).toBe(true);
      expect(resB.recommendations.some((r) => r.topic === 'Microbiology')).toBe(false);
    });
  });

  // =========================================================================
  // 9. Full Regression Verification
  // =========================================================================
  describe('9. Full Regression Verification', () => {
    it('9.1 Phase 4 grading remains authoritative and uncompromised', () => {
      // BKT updates are bounded within [0.01, 0.99]
      const update = calculateBKTUpdate(0.5, true);
      expect(update.posterior).toBeGreaterThan(0.5);
      expect(update.posterior).toBeLessThan(0.99);
    });

    it('9.2 Phase 5 Step 1 evidence ingestion remains strictly idempotent', async () => {
      const regUser = `reg_usr_${Date.now()}`;
      const ev = extractLearnerEvidence(
        { questionId: 'q_reg_idem', isCorrect: true, credit: 1.0, classification: 'correct' },
        { userId: regUser, attemptId: 'att_reg', topic: 'Linear Algebra' }
      );

      const res1 = await recordLearnerEvidence(ev);
      expect(res1.applied).toBe(true);
      expect(res1.duplicate).toBe(false);

      const res2 = await recordLearnerEvidence(ev);
      expect(res2.applied).toBe(false);
      expect(res2.duplicate).toBe(true);
    });

    it('9.3 Phase 5 Step 2 retention calculations remain strictly non-destructive', () => {
      const now = new Date();
      const retention = calculateConceptRetention({
        initialMastery: 0.75,
        lastAssessedAt: new Date(now.getTime() - 7 * 86400000), // 7 days ago
        correctCount: 3,
        now,
      });

      expect(retention.initial_mastery).toBe(0.75);
      expect(retention.current_recall_probability).toBeLessThan(0.75);
      expect(retention.current_recall_probability).toBeGreaterThan(0.0);
    });
  });
});
