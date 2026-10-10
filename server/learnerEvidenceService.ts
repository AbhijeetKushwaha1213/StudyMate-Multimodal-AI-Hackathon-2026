/**
 * Canonical Phase 5 — Step 1
 * Learner Evidence & Mastery Model Service
 * 
 * SERVER-AUTHORITATIVE LEARNER MODEL:
 * 1. Derives evidence exclusively from verified Phase 4 assessment grading.
 * 2. Normalizes concepts into canonical taxonomy identifiers.
 * 3. Enforces strict event idempotency (idem_<userId>_<attemptId>_<questionId>).
 * 4. Filters out invalid/unverifiable/quarantined submissions (never penalizes students for unverified items).
 * 5. Bounded, explainable Bayesian Knowledge Tracing updates with asymptotic confidence.
 * 6. 100% reproducible audit trail from underlying evidence events.
 */

import crypto from 'crypto';
import { prisma, ensureLearnerSchema } from './prisma.ts';
import type {
  CanonicalLearnerEvidence,
  ConceptIdentity,
  EvidenceBasedMasteryState,
  MasteryAuditRecord,
  EvidenceIngestionResult,
  EvidenceValidity,
} from './learnerTypes.ts';
import {
  calculateBKTUpdate,
  getDifficultyBKTParameters,
  calculateConfidence,
  determineMasteryStatus,
  DEFAULT_BKT_PARAMS,
  type BKTParameters,
  type MasteryStatus,
} from './bktService.ts';
import { calculateConceptRetention } from './bktCalibrationService.ts';
import { isGenericOrBoilerplate } from './questionQualityValidator.ts';

// =========================================================================
// 1. Concept Taxonomy Normalization
// =========================================================================

/**
 * Normalizes text for canonical concept comparison:
 * lowercase, removes non-alphanumeric characters, collapses spaces.
 */
export function normalizeConceptString(str: string): string {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Derives a stable, canonical ConceptIdentity from topic, subtopic, and concept title.
 */
export function computeCanonicalConceptId(
  topic: string,
  subtopic?: string | null,
  conceptName?: string | null
): ConceptIdentity {
  const normTopic = normalizeConceptString(topic || 'general');
  const normSubtopic = normalizeConceptString(subtopic || '');
  const cleanName = (conceptName || subtopic || topic || 'core_concept').trim();
  const normName = normalizeConceptString(cleanName);

  const payload = `${normTopic}::${normSubtopic}::${normName}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex').substring(0, 16);
  const concept_id = `c_${hash}`;

  return {
    concept_id,
    concept_name: cleanName,
    topic: topic || 'General',
    subtopic: subtopic || null,
  };
}

/**
 * Computes deterministic idempotency key for an assessment evidence event.
 */
export function createIdempotencyKey(userId: string, attemptId: string, questionId: string): string {
  const cleanUser = String(userId || '').trim();
  const cleanAttempt = String(attemptId || '').trim();
  const cleanQuestion = String(questionId || '').trim();
  return `idem_${cleanUser}_${cleanAttempt}_${cleanQuestion}`;
}

// =========================================================================
// 2. Deterministic Evidence Extraction
// =========================================================================

/**
 * Extracts a CanonicalLearnerEvidence record from Phase 4 assessment evaluation output.
 * Flags unverified or invalid-format submissions as DISCARDED so they do not mutate mastery.
 */
export function extractLearnerEvidence(
  evaluation: any,
  context: {
    userId: string;
    attemptId: string;
    topic: string;
    subtopic?: string | null;
    difficulty?: string;
    tenantId?: string;
  }
): CanonicalLearnerEvidence {
  const qId = String(evaluation.questionId || evaluation.question_id || `q_${Date.now()}`);
  const classification = String(evaluation.classification || 'incorrect').toLowerCase() as
    | 'correct'
    | 'partially_correct'
    | 'incorrect'
    | 'invalid_format'
    | 'unverifiable';

  let validity: EvidenceValidity = 'VALID_EVIDENCE';
  if (
    classification === 'invalid_format' ||
    evaluation.is_valid === false ||
    evaluation.quality_valid === false ||
    (Array.isArray(evaluation.quality_issues) && evaluation.quality_issues.length > 0) ||
    isGenericOrBoilerplate(evaluation.question) ||
    isGenericOrBoilerplate(evaluation.concept)
  ) {
    validity = 'DISCARDED_INVALID';
  } else if (
    classification === 'unverifiable' ||
    evaluation.verifiability === 'UNVERIFIABLE' ||
    evaluation.verifiability === 'QUARANTINED'
  ) {
    validity = 'DISCARDED_UNVERIFIABLE';
  }

  const topic = evaluation.topic || context.topic || 'General';
  const subtopic = evaluation.subtopic || context.subtopic || null;
  const conceptStr = evaluation.detectedMisconception?.concept || evaluation.concept || subtopic || topic;
  const conceptIdentity = computeCanonicalConceptId(topic, subtopic, conceptStr);

  const credit = typeof evaluation.credit === 'number'
    ? Math.max(0.0, Math.min(1.0, evaluation.credit))
    : (evaluation.isCorrect ? 1.0 : 0.0);

  const isCorrect = Boolean(evaluation.isCorrect ?? (credit >= 0.75));
  const idempotencyKey = createIdempotencyKey(context.userId, context.attemptId, qId);
  const evidenceId = `evd_${crypto.createHash('sha256').update(idempotencyKey).digest('hex').substring(0, 16)}`;

  return {
    evidence_id: evidenceId,
    idempotency_key: idempotencyKey,
    user_id: context.userId,
    tenant_id: context.tenantId || context.userId,
    attempt_id: context.attemptId,
    question_id: qId,
    question_type: evaluation.questionType || evaluation.type || 'MCQ',
    topic,
    subtopic,
    concept_id: conceptIdentity.concept_id,
    concept_name: conceptIdentity.concept_name,
    timestamp: new Date().toISOString(),
    classification,
    credit,
    is_correct: isCorrect,
    error_category: evaluation.error_category || evaluation.errorCategory || null,
    difficulty: evaluation.difficulty || context.difficulty || 'medium',
    source_id: evaluation.location?.source_id || evaluation.sourceId || null,
    chunk_id: evaluation.location?.chunk_id || evaluation.chunkId || null,
    source_coordinate: evaluation.sourceCitation || evaluation.citation_label || null,
    validity,
  };
}

// =========================================================================
// 3. Evidence Ingestion & Idempotent Mastery Update
// =========================================================================

/**
 * Ingests a single learner evidence event into the learner model.
 * - Idempotency guarantee: Re-submitting the same attempt/question is detected and rejected without double-counting.
 * - Discard guarantee: Unverified or invalid format questions are discarded without penalizing the learner.
 */
export async function recordLearnerEvidence(
  evidence: CanonicalLearnerEvidence
): Promise<EvidenceIngestionResult> {
  await ensureLearnerSchema();

  // 1. Check validity: Do not apply discarded evidence to mastery
  if (evidence.validity !== 'VALID_EVIDENCE') {
    return {
      applied: false,
      duplicate: false,
      discarded: true,
      discard_reason: `Evidence discarded (${evidence.validity}): unverified or invalid format responses do not alter mastery.`,
      idempotency_key: evidence.idempotency_key,
    };
  }

  // 2. Check Idempotency: Has this exact (userId, attemptId, questionId) trial already been applied?
  const existingEvents: any[] = await prisma.$queryRawUnsafe(
    'SELECT id, posteriorMastery FROM learner_events WHERE userId = ? AND idempotencyKey = ? LIMIT 1',
    evidence.user_id,
    evidence.idempotency_key
  );

  if (existingEvents && existingEvents.length > 0) {
    // Duplicate detected! Return current mastery without double-counting
    const currentState = await getTopicMasteryState(evidence.user_id, evidence.topic, evidence.subtopic);
    return {
      applied: false,
      duplicate: true,
      discarded: false,
      idempotency_key: evidence.idempotency_key,
      updated_state: currentState,
    };
  }

  // 3. Retrieve or initialize current topic mastery
  const rawRecord: any[] = await prisma.$queryRawUnsafe(
    evidence.subtopic
      ? 'SELECT * FROM learner_mastery WHERE userId = ? AND topic = ? AND subtopic = ? LIMIT 1'
      : "SELECT * FROM learner_mastery WHERE userId = ? AND topic = ? AND (subtopic IS NULL OR subtopic = '') LIMIT 1",
    ...(evidence.subtopic ? [evidence.user_id, evidence.topic, evidence.subtopic] : [evidence.user_id, evidence.topic])
  );

  const isNew = !rawRecord || rawRecord.length === 0;
  const current = isNew ? null : rawRecord[0];

  const bktParams = getDifficultyBKTParameters(evidence.difficulty);
  const prior = isNew || Number(current.attempts) === 0 ? bktParams.pL0 : Number(current.masteryProbability);

  // 4. Calculate Bayesian Knowledge Tracing update
  const { posterior } = calculateBKTUpdate(prior, evidence.is_correct, bktParams, evidence.credit);

  const attempts = (isNew ? 0 : Number(current.attempts)) + 1;
  const isFullCredit = evidence.credit >= 0.75;
  const isPartial = evidence.credit > 0 && evidence.credit < 0.75;
  const correctCount = (isNew ? 0 : Number(current.correctCount)) + (isFullCredit ? 1 : 0);
  const incorrectCount = (isNew ? 0 : Number(current.incorrectCount)) + (isFullCredit ? 0 : 1);
  const partialCount = (isNew ? 0 : Number(current.partialCount || 0)) + (isPartial ? 1 : 0);

  const confidence = calculateConfidence(attempts);
  const status: MasteryStatus = determineMasteryStatus(attempts, posterior);
  const now = new Date().toISOString();

  // 5. Persist updated mastery record
  const masteryId = isNew ? `lm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}` : current.id;
  if (isNew) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO learner_mastery (id, userId, courseId, topic, subtopic, masteryProbability, attempts, correctCount, incorrectCount, confidence, status, lastAssessedAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      masteryId,
      evidence.user_id,
      null,
      evidence.topic,
      evidence.subtopic || null,
      posterior,
      attempts,
      correctCount,
      incorrectCount,
      confidence,
      status,
      now,
      now,
      now
    );
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE learner_mastery 
       SET masteryProbability = ?, attempts = ?, correctCount = ?, incorrectCount = ?, confidence = ?, status = ?, lastAssessedAt = ?, updatedAt = ?
       WHERE id = ?`,
      posterior,
      attempts,
      correctCount,
      incorrectCount,
      confidence,
      status,
      now,
      now,
      masteryId
    );
  }

  // 6. Persist auditable event with unique idempotencyKey
  const eventDetails = JSON.stringify({
    evidence_id: evidence.evidence_id,
    attempt_id: evidence.attempt_id,
    question_id: evidence.question_id,
    question_type: evidence.question_type,
    concept_id: evidence.concept_id,
    concept_name: evidence.concept_name,
    credit: evidence.credit,
    classification: evidence.classification,
    is_correct: evidence.is_correct,
    error_category: evidence.error_category,
    source_id: evidence.source_id,
    chunk_id: evidence.chunk_id,
    source_coordinate: evidence.source_coordinate,
  });

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO learner_events (id, userId, topic, subtopic, eventType, sourceId, priorMastery, posteriorMastery, isCorrect, difficulty, parametersJson, evidenceDetails, idempotencyKey, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      evidence.evidence_id,
      evidence.user_id,
      evidence.topic,
      evidence.subtopic || null,
      'ASSESSMENT_ANSWER',
      evidence.attempt_id,
      prior,
      posterior,
      evidence.is_correct ? 1 : 0,
      evidence.difficulty,
      JSON.stringify(bktParams),
      eventDetails,
      evidence.idempotency_key,
      evidence.timestamp || now
    );
  } catch (insertErr: any) {
    const errMsg = String(insertErr?.message || '');
    if (
      errMsg.includes('UNIQUE') ||
      errMsg.includes('unique') ||
      insertErr?.code === 'P2002' ||
      insertErr?.code === 2067
    ) {
      // Gracefully handle race-condition duplicate submissions without crashing or double-updating
      const currentState = await getTopicMasteryState(evidence.user_id, evidence.topic, evidence.subtopic);
      return {
        applied: false,
        duplicate: true,
        discarded: false,
        idempotency_key: evidence.idempotency_key,
        updated_state: currentState,
      };
    }
    throw insertErr;
  }

  const updated_state: EvidenceBasedMasteryState = {
    user_id: evidence.user_id,
    topic: evidence.topic,
    subtopic: evidence.subtopic || null,
    concept_id: evidence.concept_id,
    mastery_estimate: posterior,
    mastery_percentage: Math.round(posterior * 100),
    confidence,
    status,
    evidence_count: attempts,
    correct_count: correctCount,
    partial_count: partialCount,
    incorrect_count: incorrectCount,
    prior_mastery: prior,
    last_evaluated_at: now,
    bkt_parameters: bktParams,
    retention: calculateConceptRetention({
      initialMastery: posterior,
      lastAssessedAt: now,
      correctCount,
    }),
  };

  return {
    applied: true,
    duplicate: false,
    discarded: false,
    idempotency_key: evidence.idempotency_key,
    updated_state,
  };
}

// =========================================================================
// 4. Query & Auditability Service
// =========================================================================

/**
 * Fetch current mastery state for a user's topic/subtopic.
 */
export async function getTopicMasteryState(
  userId: string,
  topic: string,
  subtopic?: string | null
): Promise<EvidenceBasedMasteryState> {
  await ensureLearnerSchema();

  const query = subtopic
    ? 'SELECT * FROM learner_mastery WHERE userId = ? AND topic = ? AND subtopic = ? LIMIT 1'
    : "SELECT * FROM learner_mastery WHERE userId = ? AND topic = ? AND (subtopic IS NULL OR subtopic = '') LIMIT 1";

  const params = subtopic ? [userId, topic, subtopic] : [userId, topic];
  const rows: any[] = await prisma.$queryRawUnsafe(query, ...params);

  if (!rows || rows.length === 0) {
    return {
      user_id: userId,
      topic,
      subtopic: subtopic || null,
      mastery_estimate: 0.0,
      mastery_percentage: 0,
      confidence: 0.0,
      status: 'unassessed',
      evidence_count: 0,
      correct_count: 0,
      partial_count: 0,
      incorrect_count: 0,
      prior_mastery: 0.0,
      last_evaluated_at: null,
      bkt_parameters: DEFAULT_BKT_PARAMS,
      retention: calculateConceptRetention({
        initialMastery: 0.0,
        lastAssessedAt: null,
        correctCount: 0,
      }),
    };
  }

  const r = rows[0];
  const p = Number(r.masteryProbability);
  const attempts = Number(r.attempts);
  const correct = Number(r.correctCount);
  const incorrect = Number(r.incorrectCount);
  const partial = Math.max(0, attempts - correct - incorrect);
  const lastAssessedAt = r.lastAssessedAt ? new Date(r.lastAssessedAt).toISOString() : null;

  return {
    user_id: r.userId,
    topic: r.topic,
    subtopic: r.subtopic || null,
    mastery_estimate: p,
    mastery_percentage: Math.round(p * 100),
    confidence: Number(r.confidence),
    status: r.status as MasteryStatus,
    evidence_count: attempts,
    correct_count: correct,
    partial_count: partial,
    incorrect_count: incorrect,
    prior_mastery: p,
    last_evaluated_at: lastAssessedAt,
    bkt_parameters: DEFAULT_BKT_PARAMS,
    retention: calculateConceptRetention({
      initialMastery: p,
      lastAssessedAt,
      correctCount: correct,
    }),
  };
}

/**
 * Replays an evidence sequence from baseline pL0 to verify mathematical reproducibility.
 */
export function replayEvidenceTrail(
  evidenceTrail: CanonicalLearnerEvidence[],
  initialPL0?: number
): { posterior: number; attempts: number; confidence: number } {
  let validCount = 0;
  let p = typeof initialPL0 === 'number'
    ? initialPL0
    : (evidenceTrail.length > 0 ? getDifficultyBKTParameters(evidenceTrail[0].difficulty).pL0 : DEFAULT_BKT_PARAMS.pL0);

  for (const ev of evidenceTrail) {
    if (ev.validity !== 'VALID_EVIDENCE') continue;
    const bktParams = getDifficultyBKTParameters(ev.difficulty);
    const update = calculateBKTUpdate(p, ev.is_correct, bktParams, ev.credit);
    p = update.posterior;
    validCount++;
  }

  return {
    posterior: validCount === 0 ? 0.0 : p,
    attempts: validCount,
    confidence: calculateConfidence(validCount),
  };
}

/**
 * Replays an evidence sequence either from an in-memory trail or from the database for a user.
 */
export async function replayEvidenceMastery(
  evidenceTrailOrUserId: CanonicalLearnerEvidence[] | string,
  topicOrInitialPL0?: string | number,
  subtopic?: string | null
): Promise<any> {
  if (Array.isArray(evidenceTrailOrUserId)) {
    const pl0 = typeof topicOrInitialPL0 === 'number' ? topicOrInitialPL0 : DEFAULT_BKT_PARAMS.pL0;
    return replayEvidenceTrail(evidenceTrailOrUserId, pl0);
  }

  const userId = String(evidenceTrailOrUserId);
  const topic = String(topicOrInitialPL0 || '');
  const audit = await getLearnerMasteryAudit(userId, topic, subtopic);
  const replayed = replayEvidenceTrail(audit.evidence_trail);
  const delta = Math.abs(replayed.posterior - audit.current_state.mastery_estimate);

  return {
    verified: delta <= 0.01,
    event_count: audit.evidence_trail.length,
    replayed_mastery: replayed.posterior,
    recorded_mastery: audit.current_state.mastery_estimate,
    delta,
    confidence: replayed.confidence,
  };
}

/**
 * Generates an auditable report tracing how a user's mastery estimate was derived.
 */
export async function getLearnerMasteryAudit(
  userId: string,
  topic: string,
  subtopic?: string | null
): Promise<MasteryAuditRecord & {
  mastery_estimate: number;
  confidence: number;
  evidence_count: number;
  events: CanonicalLearnerEvidence[];
  verified: boolean;
}> {
  await ensureLearnerSchema();

  const currentState = await getTopicMasteryState(userId, topic, subtopic);

  // Retrieve raw events in chronological order
  const query = subtopic
    ? 'SELECT * FROM learner_events WHERE userId = ? AND topic = ? AND subtopic = ? ORDER BY timestamp ASC, rowid ASC'
    : "SELECT * FROM learner_events WHERE userId = ? AND topic = ? AND (subtopic IS NULL OR subtopic = '') ORDER BY timestamp ASC, rowid ASC";

  const params = subtopic ? [userId, topic, subtopic] : [userId, topic];
  const rawEvents: any[] = await prisma.$queryRawUnsafe(query, ...params);

  const evidence_trail: CanonicalLearnerEvidence[] = rawEvents.map((r) => {
    let details: any = {};
    try {
      details = r.evidenceDetails ? JSON.parse(r.evidenceDetails) : {};
    } catch {
      details = {};
    }

    const isCorrect = details.is_correct !== undefined
      ? Boolean(details.is_correct)
      : (r.isCorrect === true || r.isCorrect === 1 || r.isCorrect === '1');

    const credit = details.credit !== undefined
      ? Number(details.credit)
      : (isCorrect ? 1.0 : 0.0);

    return {
      evidence_id: r.id,
      idempotency_key: r.idempotencyKey || r.id,
      user_id: r.userId,
      attempt_id: details.attempt_id || r.sourceId || '',
      question_id: details.question_id || '',
      question_type: details.question_type || 'MCQ',
      topic: r.topic,
      subtopic: r.subtopic || null,
      concept_id: details.concept_id || '',
      concept_name: details.concept_name || r.topic,
      timestamp: r.timestamp,
      classification: details.classification || (isCorrect ? 'correct' : 'incorrect'),
      credit,
      is_correct: isCorrect,
      error_category: details.error_category || null,
      difficulty: r.difficulty || 'medium',
      source_id: details.source_id || null,
      chunk_id: details.chunk_id || null,
      source_coordinate: details.source_coordinate || null,
      validity: 'VALID_EVIDENCE',
    };
  });

  const replay = replayEvidenceTrail(evidence_trail);
  // Compare replayed posterior with stored estimate within epsilon
  const isReproducible = currentState.evidence_count === 0
    ? true
    : Math.abs(replay.posterior - currentState.mastery_estimate) <= 0.01;

  return {
    user_id: userId,
    topic,
    subtopic: subtopic || null,
    current_state: currentState,
    evidence_trail,
    reproducible: isReproducible,
    replayed_posterior: replay.posterior,
    audit_timestamp: new Date().toISOString(),
    mastery_estimate: currentState.mastery_estimate,
    confidence: currentState.confidence,
    evidence_count: currentState.evidence_count,
    events: evidence_trail,
    verified: isReproducible,
  };
}
