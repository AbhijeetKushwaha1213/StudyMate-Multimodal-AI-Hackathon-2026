/**
 * Canonical Phase 4 — Step 2
 * Robust Answer Verification & Harder Misconception Detection Engine
 * 
 * ZERO-TRUST ARCHITECTURE:
 * - The LLM must NEVER sit in the critical grading path.
 * - Grading is deterministic and server-authoritative for all supported question types:
 *   1. NUMERICAL (delegates to canonical numericalVerifier.ts)
 *   2. MCQ (single-choice with distractor pedagogical metadata)
 *   3. MULTI_SELECT (set-based matching with controlled partial credit)
 *   4. TRUE_FALSE (strict boolean normalization and binary grading)
 *   5. SHORT_ANSWER (layered: exact match -> accepted variants -> component overlap -> safe fallback)
 * - Scores are strictly bounded in [0.0, 1.0].
 * - Client payloads cannot override answer keys, scores, tolerances, or error categories.
 * - Grounded feedback reuses the canonical Phase 3 citation verification engine.
 */

import type {
  SupportedQuestionType,
  MisconceptionCategory,
  AuthoritativeQuestion,
  AnswerSubmissionPayload,
  UniversalGradingResult,
  QuestionValidationResult,
  StudentFacingResult,
  QuestionOptionItem,
  TolerancePolicy,
  NumericalQuestion,
  NumericalAnswerSubmission,
} from './assessmentTypes.ts';

import { DEFAULT_TOLERANCE } from './assessmentTypes.ts';
import {
  gradeNumericalAnswer,
  parseStudentAnswer,
  verifyNumericalQuestion,
  computeNumericalFingerprint,
} from './numericalVerifier.ts';

import {
  verifyCitation,
  type CanonicalEvidenceIndex,
  type ResourceVerificationRecord,
} from './citationVerifier.ts';

export {
  computeNormalizedStem,
  computeQuestionFingerprint,
  calculateJaccardSimilarity,
  detectPromptLeakage,
  checkDistractorQuality,
  checkQuestionAmbiguity,
  checkQuestionConsistency,
  checkSemanticTopicRelevance,
  isGenericOrBoilerplate,
  generateBalancedPositions,
  balanceAndRandomizeQuestionOptions,
  detectNearDuplicate,
  verifyQuestionGrounding,
  validateHardenedQuestion,
  validateHardenedQuestionBatch,
} from './questionQualityValidator.ts';

// =========================================================================
// 1. Text Normalization Utilities
// =========================================================================

export function normalizeText(str: string): string {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeSignificantWords(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function buildCoordinateLabel(q: AuthoritativeQuestion): string {
  if (q.page_number !== null && q.page_number !== undefined) {
    return `Page ${q.page_number}`;
  }
  if (q.slide_number !== null && q.slide_number !== undefined) {
    return `Slide ${q.slide_number}`;
  }
  if (q.timestamp_start !== null && q.timestamp_start !== undefined) {
    const mins = Math.floor(q.timestamp_start / 60);
    const secs = Math.floor(q.timestamp_start % 60);
    return `${mins}m${secs}s`;
  }
  return 'Course Material Excerpt';
}

function extractOptionText(opt: string | QuestionOptionItem): string {
  if (typeof opt === 'string') return opt.trim();
  if (opt && typeof opt === 'object' && typeof opt.text === 'string') {
    return opt.text.trim();
  }
  return String(opt ?? '').trim();
}

function extractOptionId(opt: string | QuestionOptionItem, index: number): string {
  if (typeof opt === 'object' && opt !== null && opt.id) {
    return opt.id.trim();
  }
  return String(index);
}

// =========================================================================
// 2. Answer-Key Integrity & Question Validation (Step 12 & 13)
// =========================================================================

/**
 * Validates the integrity of an assessment question prior to student delivery.
 * Rejects questions with invalid answer keys, duplicate option IDs/texts,
 * missing components, or unverifiable parameters.
 */
export function validateQuestionIntegrity(question: any): QuestionValidationResult {
  const errors: string[] = [];

  if (!question || typeof question !== 'object') {
    return { valid: false, errors: ['Question must be an object'] };
  }

  // Question ID
  if (!question.question_id && !question.id) {
    errors.push('Question missing question_id');
  }

  // Question Stem
  const stem = String(question.question || '').trim();
  if (stem.length < 8) {
    errors.push('Question stem too short (minimum 8 characters required)');
  }

  // Question Type
  const rawType = String(question.type || '').toUpperCase();
  const validTypes: SupportedQuestionType[] = [
    'NUMERICAL',
    'MCQ',
    'SHORT_ANSWER',
    'TRUE_FALSE',
    'MULTI_SELECT',
  ];
  if (!validTypes.includes(rawType as SupportedQuestionType)) {
    errors.push(`Unsupported question type: "${question.type}". Supported: ${validTypes.join(', ')}`);
    return { valid: false, errors };
  }
  const qType = rawType as SupportedQuestionType;

  // Correct Answer existence
  if (question.correct_answer === undefined && question.correctAnswer === undefined) {
    errors.push('Question missing correct_answer');
  }

  // Type-specific validation
  if (qType === 'NUMERICAL') {
    const correctVal = typeof question.correct_answer === 'number'
      ? question.correct_answer
      : parseFloat(String(question.correct_answer ?? '').replace(/[^\d.\-]/g, ''));

    if (isNaN(correctVal) || !isFinite(correctVal)) {
      errors.push('NUMERICAL question has NaN or infinite correct_answer');
    }

    const numericalQ: NumericalQuestion = {
      question_id: question.question_id || question.id || 'q_val',
      type: 'NUMERICAL',
      topic: question.topic || 'General',
      difficulty: question.difficulty || 'medium',
      question: stem,
      correct_answer: isNaN(correctVal) ? 0 : correctVal,
      correct_answer_raw: String(question.correct_answer ?? ''),
      tolerance: question.tolerance || DEFAULT_TOLERANCE,
      verifiability: question.verifiability || 'PENDING',
      explanation: question.explanation || '',
    };
    const numVerif = verifyNumericalQuestion(numericalQ);
    if (!numVerif.verified) {
      errors.push(`Numerical verification failed: ${numVerif.rejection_reason}`);
    }
  } else if (qType === 'MCQ') {
    const options: any[] = question.options || [];
    if (!Array.isArray(options) || options.length < 2) {
      errors.push('MCQ must have an options array with at least 2 distinct choices');
    } else {
      // Check for duplicate options
      const seenTexts = new Set<string>();
      const seenIds = new Set<string>();
      for (let i = 0; i < options.length; i++) {
        const text = normalizeText(extractOptionText(options[i]));
        const id = extractOptionId(options[i], i);

        if (seenTexts.has(text)) {
          errors.push(`MCQ contains duplicate option text: "${extractOptionText(options[i])}"`);
        }
        seenTexts.add(text);

        if (seenIds.has(id)) {
          errors.push(`MCQ contains duplicate option ID: "${id}"`);
        }
        seenIds.add(id);
      }

      // Verify that correct_answer corresponds to one of the options
      const correctRaw = String(question.correct_answer ?? question.correctAnswer ?? '').trim();
      const correctLower = correctRaw.toLowerCase();
      let matchesAny = false;

      // Check text match
      for (let i = 0; i < options.length; i++) {
        const optText = extractOptionText(options[i]).toLowerCase();
        const optId = extractOptionId(options[i], i).toLowerCase();
        if (optText === correctLower || optId === correctLower) {
          matchesAny = true;
          break;
        }
      }

      // Check numeric index match (e.g. "0", "1")
      const numIdx = parseInt(correctRaw, 10);
      if (!matchesAny && !isNaN(numIdx) && numIdx >= 0 && numIdx < options.length) {
        matchesAny = true;
      }

      if (!matchesAny) {
        errors.push(`MCQ correct_answer "${correctRaw}" does not match any choice in options array`);
      }
    }
  } else if (qType === 'MULTI_SELECT') {
    const options: any[] = question.options || [];
    if (!Array.isArray(options) || options.length < 2) {
      errors.push('MULTI_SELECT must have an options array with at least 2 distinct choices');
    } else {
      // Parse correct_answer into an array
      let correctList: string[] = [];
      const ca = question.correct_answer ?? question.correctAnswer;
      if (Array.isArray(ca)) {
        correctList = ca.map((item) => String(item).trim());
      } else if (typeof ca === 'string') {
        try {
          const parsed = JSON.parse(ca);
          if (Array.isArray(parsed)) {
            correctList = parsed.map((item) => String(item).trim());
          } else {
            correctList = ca.split(',').map((s) => s.trim()).filter(Boolean);
          }
        } catch {
          correctList = ca.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }

      if (correctList.length === 0) {
        errors.push('MULTI_SELECT correct_answer must contain at least 1 correct selection');
      }

      // Check that all correct options exist in options universe
      const optTexts = options.map((o) => extractOptionText(o).toLowerCase());
      const optIds = options.map((o, idx) => extractOptionId(o, idx).toLowerCase());

      for (const item of correctList) {
        const itemLower = item.toLowerCase();
        const numIdx = parseInt(item, 10);
        const matches = optTexts.includes(itemLower) ||
          optIds.includes(itemLower) ||
          (!isNaN(numIdx) && numIdx >= 0 && numIdx < options.length);
        if (!matches) {
          errors.push(`MULTI_SELECT correct option "${item}" does not exist in options array`);
        }
      }
    }
  } else if (qType === 'TRUE_FALSE') {
    const correctRaw = String(question.correct_answer ?? question.correctAnswer ?? '').trim().toLowerCase();
    const validBooleans = ['true', 'false', 't', 'f', 'yes', 'no', '1', '0'];
    if (!validBooleans.includes(correctRaw)) {
      errors.push(`TRUE_FALSE correct_answer must be a recognized boolean representation, got: "${correctRaw}"`);
    }
  } else if (qType === 'SHORT_ANSWER') {
    const correctRaw = String(question.correct_answer ?? question.correctAnswer ?? '').trim();
    if (correctRaw.length === 0) {
      errors.push('SHORT_ANSWER correct_answer cannot be empty');
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const sanitized: AuthoritativeQuestion = {
    question_id: question.question_id || question.id,
    assessment_id: question.assessment_id || question.assessmentId,
    type: qType,
    topic: question.topic || 'General',
    subtopic: question.subtopic || null,
    difficulty: question.difficulty || 'medium',
    question: stem,
    correct_answer: question.correct_answer ?? question.correctAnswer,
    correct_answer_raw: String(question.correct_answer ?? question.correctAnswer ?? ''),
    options: question.options,
    accepted_variants: question.accepted_variants || question.acceptedVariants,
    required_components: question.required_components || question.requiredComponents,
    expected_unit: question.expected_unit || question.expectedUnit,
    tolerance: question.tolerance || DEFAULT_TOLERANCE,
    verifiability: question.verifiability || 'VERIFIED',
    source_id: question.source_id || question.sourceId,
    resource_id: question.resource_id || question.resourceId,
    chunk_id: question.chunk_id || question.chunkId,
    page_number: question.page_number ?? question.pageNumber,
    slide_number: question.slide_number ?? question.slideNumber,
    timestamp_start: question.timestamp_start ?? question.timestampStart,
    timestamp_end: question.timestamp_end ?? question.timestampEnd,
    source_type: question.source_type || question.sourceType,
    explanation: question.explanation || '',
    fingerprint: question.fingerprint,
    normalized_question: question.normalized_question,
  };

  return { valid: true, errors: [], sanitized_question: sanitized };
}

// =========================================================================
// 3. Deterministic Question-Type Graders
// =========================================================================

/**
 * Deterministic MCQ Grader (Single Choice)
 */
export function gradeMCQ(
  submission: AnswerSubmissionPayload,
  q: AuthoritativeQuestion
): UniversalGradingResult {
  const coordLabel = buildCoordinateLabel(q);
  const userRaw = String(submission.raw_answer ?? '').trim();
  const correctRaw = String(q.correct_answer ?? '').trim();
  const options = q.options || [];

  // Empty answer
  if (!userRaw) {
    return {
      question_id: q.question_id,
      question_type: 'MCQ',
      classification: 'incorrect',
      credit: 0.0,
      is_correct: false,
      is_partial: false,
      error_category: 'INCOMPLETE_ANSWER',
      feedback: `No answer provided. Correct answer is "${correctRaw}" as verified in ${coordLabel}.`,
      explanation: q.explanation || '',
      source_citation: coordLabel,
      citation_label: coordLabel,
      location: {
        source_id: q.source_id,
        resource_id: q.resource_id,
        chunk_id: q.chunk_id,
        page_number: q.page_number,
        slide_number: q.slide_number,
        timestamp_start: q.timestamp_start,
        timestamp_end: q.timestamp_end,
        source_type: q.source_type,
      },
      raw_student_answer: submission.raw_answer,
    };
  }

  // Map options into normalized choices
  interface ResolvedChoice {
    index: number;
    id: string;
    text: string;
    normalizedText: string;
    distractorMetadata?: any;
  }

  const resolvedOptions: ResolvedChoice[] = options.map((opt, idx) => {
    const text = extractOptionText(opt);
    const id = extractOptionId(opt, idx);
    const distractorMetadata = typeof opt === 'object' && opt !== null ? (opt as QuestionOptionItem).distractorMetadata : undefined;
    return {
      index: idx,
      id,
      text,
      normalizedText: normalizeText(text),
      distractorMetadata,
    };
  });

  const userNorm = normalizeText(userRaw);
  const correctNorm = normalizeText(correctRaw);

  // If options array is empty or not provided, compare directly to correctRaw
  if (resolvedOptions.length === 0) {
    const isDirectMatch = userNorm === correctNorm || userRaw.toLowerCase() === correctRaw.toLowerCase();
    return {
      question_id: q.question_id,
      question_type: 'MCQ',
      classification: isDirectMatch ? 'correct' : 'incorrect',
      credit: isDirectMatch ? 1.0 : 0.0,
      is_correct: isDirectMatch,
      is_partial: false,
      error_category: isDirectMatch ? 'NO_MISCONCEPTION' : 'WRONG_OPTION',
      feedback: isDirectMatch
        ? `Correct! Verified in ${coordLabel}: ${correctRaw}`
        : `Incorrect. You answered "${userRaw}". Verified answer in ${coordLabel} is "${correctRaw}".`,
      explanation: q.explanation || '',
      source_citation: coordLabel,
      citation_label: coordLabel,
      location: {
        source_id: q.source_id,
        resource_id: q.resource_id,
        chunk_id: q.chunk_id,
        page_number: q.page_number,
        slide_number: q.slide_number,
        timestamp_start: q.timestamp_start,
        timestamp_end: q.timestamp_end,
        source_type: q.source_type,
      },
      raw_student_answer: submission.raw_answer,
      normalized_student_answer: userRaw,
    };
  }

  // Identify chosen option from student answer
  let chosenOption: ResolvedChoice | null = null;

  // 1. Check exact/normalized text match
  for (const opt of resolvedOptions) {
    if (opt.normalizedText === userNorm || opt.text.toLowerCase() === userRaw.toLowerCase()) {
      chosenOption = opt;
      break;
    }
  }

  // 2. Check option ID match (e.g. "A", "B", "opt_1")
  if (!chosenOption) {
    for (const opt of resolvedOptions) {
      if (opt.id.toLowerCase() === userRaw.toLowerCase()) {
        chosenOption = opt;
        break;
      }
    }
  }

  // 3. Check 0-based or 1-based index (e.g. "0", "1" or letter "A"=0, "B"=1)
  if (!chosenOption) {
    const numIdx = parseInt(userRaw, 10);
    if (!isNaN(numIdx)) {
      if (numIdx >= 0 && numIdx < resolvedOptions.length) {
        chosenOption = resolvedOptions[numIdx];
      } else if (numIdx >= 1 && numIdx <= resolvedOptions.length) {
        // 1-based index tolerance
        chosenOption = resolvedOptions[numIdx - 1];
      }
    } else if (/^[a-dA-D]$/.test(userRaw.trim())) {
      const charIdx = userRaw.trim().toUpperCase().charCodeAt(0) - 65; // 'A' -> 0
      if (charIdx >= 0 && charIdx < resolvedOptions.length) {
        chosenOption = resolvedOptions[charIdx];
      }
    }
  }

  // If student specified something completely outside option universe
  if (!chosenOption) {
    return {
      question_id: q.question_id,
      question_type: 'MCQ',
      classification: 'incorrect',
      credit: 0.0,
      is_correct: false,
      is_partial: false,
      error_category: 'INVALID_OPTION',
      feedback: `Invalid option selected ("${userRaw}"). Choice does not belong to the available options. Correct answer is "${correctRaw}" as verified in ${coordLabel}.`,
      explanation: q.explanation || '',
      source_citation: coordLabel,
      citation_label: coordLabel,
      location: {
        source_id: q.source_id,
        resource_id: q.resource_id,
        chunk_id: q.chunk_id,
        page_number: q.page_number,
        slide_number: q.slide_number,
        timestamp_start: q.timestamp_start,
        timestamp_end: q.timestamp_end,
        source_type: q.source_type,
      },
      raw_student_answer: submission.raw_answer,
    };
  }

  // Resolve authoritative correct option
  let authoritativeCorrectOption: ResolvedChoice | null = null;
  for (const opt of resolvedOptions) {
    if (opt.normalizedText === correctNorm || opt.text.toLowerCase() === correctRaw.toLowerCase() || opt.id.toLowerCase() === correctRaw.toLowerCase()) {
      authoritativeCorrectOption = opt;
      break;
    }
  }
  if (!authoritativeCorrectOption) {
    const numIdx = parseInt(correctRaw, 10);
    if (!isNaN(numIdx) && numIdx >= 0 && numIdx < resolvedOptions.length) {
      authoritativeCorrectOption = resolvedOptions[numIdx];
    }
  }

  const isMatch = authoritativeCorrectOption
    ? chosenOption.index === authoritativeCorrectOption.index
    : chosenOption.normalizedText === correctNorm;

  if (isMatch) {
    return {
      question_id: q.question_id,
      question_type: 'MCQ',
      classification: 'correct',
      credit: 1.0,
      is_correct: true,
      is_partial: false,
      error_category: 'NO_MISCONCEPTION',
      feedback: `Correct! Option ${chosenOption.index + 1} (${chosenOption.text}) matches ${coordLabel}.`,
      explanation: q.explanation || '',
      source_citation: coordLabel,
      citation_label: coordLabel,
      location: {
        source_id: q.source_id,
        resource_id: q.resource_id,
        chunk_id: q.chunk_id,
        page_number: q.page_number,
        slide_number: q.slide_number,
        timestamp_start: q.timestamp_start,
        timestamp_end: q.timestamp_end,
        source_type: q.source_type,
      },
      raw_student_answer: submission.raw_answer,
      normalized_student_answer: chosenOption.text,
    };
  }

  // Misconception identification for wrong option
  let errorCategory: MisconceptionCategory = 'WRONG_OPTION';
  let misconceptionDesc = `Selected "${chosenOption.text}", which is an incorrect option.`;

  // Step 10: If MCQ distractor has predefined pedagogical metadata, preserve it
  if (chosenOption.distractorMetadata) {
    if (chosenOption.distractorMetadata.misconceptionCategory) {
      errorCategory = chosenOption.distractorMetadata.misconceptionCategory;
    }
    if (chosenOption.distractorMetadata.rationale) {
      misconceptionDesc = chosenOption.distractorMetadata.rationale;
    }
  }

  return {
    question_id: q.question_id,
    question_type: 'MCQ',
    classification: 'incorrect',
    credit: 0.0,
    is_correct: false,
    is_partial: false,
    error_category: errorCategory,
    misconception_description: misconceptionDesc,
    feedback: `Incorrect. You chose option ${chosenOption.index + 1} ("${chosenOption.text}"). Correct answer is "${correctRaw}" as verified in ${coordLabel}.`,
    explanation: q.explanation || '',
    source_citation: coordLabel,
    citation_label: coordLabel,
    location: {
      source_id: q.source_id,
      resource_id: q.resource_id,
      chunk_id: q.chunk_id,
      page_number: q.page_number,
      slide_number: q.slide_number,
      timestamp_start: q.timestamp_start,
      timestamp_end: q.timestamp_end,
      source_type: q.source_type,
    },
    raw_student_answer: submission.raw_answer,
    normalized_student_answer: chosenOption.text,
  };
}

/**
 * Deterministic MULTI_SELECT Grader
 */
export function gradeMultiSelect(
  submission: AnswerSubmissionPayload,
  q: AuthoritativeQuestion
): UniversalGradingResult {
  const coordLabel = buildCoordinateLabel(q);
  const options = q.options || [];

  // Parse student selection into a set of tokens
  let rawStudentList: any[] = [];
  if (Array.isArray(submission.raw_answer)) {
    rawStudentList = submission.raw_answer;
  } else if (typeof submission.raw_answer === 'string') {
    const trimmed = submission.raw_answer.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        rawStudentList = JSON.parse(trimmed);
      } catch {
        rawStudentList = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
      }
    } else {
      rawStudentList = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    }
  } else if (submission.raw_answer !== null && submission.raw_answer !== undefined) {
    rawStudentList = [submission.raw_answer];
  }

  // Parse authoritative correct set
  let rawCorrectList: any[] = [];
  if (Array.isArray(q.correct_answer)) {
    rawCorrectList = q.correct_answer;
  } else if (typeof q.correct_answer === 'string') {
    const trimmed = q.correct_answer.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        rawCorrectList = JSON.parse(trimmed);
      } catch {
        rawCorrectList = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
      }
    } else {
      rawCorrectList = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  // Empty answer
  if (rawStudentList.length === 0) {
    return {
      question_id: q.question_id,
      question_type: 'MULTI_SELECT',
      classification: 'incorrect',
      credit: 0.0,
      is_correct: false,
      is_partial: false,
      error_category: 'INCOMPLETE_ANSWER',
      feedback: `No selections submitted. Select all required options verified in ${coordLabel}.`,
      explanation: q.explanation || '',
      source_citation: coordLabel,
      citation_label: coordLabel,
      location: {
        source_id: q.source_id,
        resource_id: q.resource_id,
        chunk_id: q.chunk_id,
        page_number: q.page_number,
        slide_number: q.slide_number,
        timestamp_start: q.timestamp_start,
        timestamp_end: q.timestamp_end,
        source_type: q.source_type,
      },
      raw_student_answer: submission.raw_answer,
    };
  }

  // Resolve option universe by canonical index
  const resolveOptionIndex = (item: any): number => {
    const strItem = String(item ?? '').trim();
    const strLower = strItem.toLowerCase();

    // Check by exact index
    const num = parseInt(strItem, 10);
    if (!isNaN(num) && num >= 0 && num < options.length) {
      return num;
    }

    // Check letter (A -> 0, B -> 1)
    if (/^[a-dA-D]$/.test(strItem)) {
      const cIdx = strItem.toUpperCase().charCodeAt(0) - 65;
      if (cIdx >= 0 && cIdx < options.length) return cIdx;
    }

    // Check text or ID
    for (let i = 0; i < options.length; i++) {
      const text = extractOptionText(options[i]).toLowerCase();
      const id = extractOptionId(options[i], i).toLowerCase();
      if (text === strLower || id === strLower) {
        return i;
      }
    }

    return -1;
  };

  const selectedIndices = new Set<number>();
  for (const item of rawStudentList) {
    const idx = resolveOptionIndex(item);
    if (idx === -1) {
      // Step 4: Invalid option ID must fail safely
      return {
        question_id: q.question_id,
        question_type: 'MULTI_SELECT',
        classification: 'incorrect',
        credit: 0.0,
        is_correct: false,
        is_partial: false,
        error_category: 'INVALID_OPTION',
        feedback: `Selection contains invalid option ID ("${item}"). All choices must be from the defined option set.`,
        explanation: q.explanation || '',
        source_citation: coordLabel,
        citation_label: coordLabel,
        location: {
          source_id: q.source_id,
          resource_id: q.resource_id,
          chunk_id: q.chunk_id,
          page_number: q.page_number,
          slide_number: q.slide_number,
          timestamp_start: q.timestamp_start,
          timestamp_end: q.timestamp_end,
          source_type: q.source_type,
        },
        raw_student_answer: submission.raw_answer,
      };
    }
    selectedIndices.add(idx);
  }

  const correctIndices = new Set<number>();
  for (const item of rawCorrectList) {
    const idx = resolveOptionIndex(item);
    if (idx !== -1) {
      correctIndices.add(idx);
    }
  }

  // Set comparison
  let correctChosen = 0;
  for (const s of selectedIndices) {
    if (correctIndices.has(s)) correctChosen++;
  }
  const extraIncorrect = selectedIndices.size - correctChosen;
  const missingCorrect = correctIndices.size - correctChosen;

  // Exact Match
  if (selectedIndices.size === correctIndices.size && extraIncorrect === 0 && missingCorrect === 0) {
    return {
      question_id: q.question_id,
      question_type: 'MULTI_SELECT',
      classification: 'correct',
      credit: 1.0,
      is_correct: true,
      is_partial: false,
      error_category: 'NO_MISCONCEPTION',
      feedback: `Correct! All required options accurately selected according to ${coordLabel}.`,
      explanation: q.explanation || '',
      source_citation: coordLabel,
      citation_label: coordLabel,
      location: {
        source_id: q.source_id,
        resource_id: q.resource_id,
        chunk_id: q.chunk_id,
        page_number: q.page_number,
        slide_number: q.slide_number,
        timestamp_start: q.timestamp_start,
        timestamp_end: q.timestamp_end,
        source_type: q.source_type,
      },
      raw_student_answer: submission.raw_answer,
      normalized_student_answer: Array.from(selectedIndices).sort(),
    };
  }

  // Controlled partial credit calculation strictly bounded in [0.0, 1.0]
  // Credit = max(0, (correctChosen - extraIncorrect) / correctIndices.size)
  const rawCredit = (correctChosen - (0.5 * extraIncorrect)) / Math.max(1, correctIndices.size);
  const boundedCredit = Math.max(0.0, Math.min(1.0, Math.round(rawCredit * 100) / 100));

  let errorCategory: MisconceptionCategory = 'WRONG_OPTION';
  if (missingCorrect > 0 && extraIncorrect === 0) {
    errorCategory = 'MISSING_REQUIRED_COMPONENT';
  } else if (extraIncorrect > 0 && missingCorrect === 0) {
    errorCategory = 'EXTRA_COMPONENT';
  } else if (missingCorrect > 0 && extraIncorrect > 0) {
    errorCategory = 'CONCEPTUAL_MISMATCH';
  }

  const isPartial = boundedCredit > 0.0 && boundedCredit < 1.0;
  const classification = isPartial ? 'partially_correct' : 'incorrect';

  return {
    question_id: q.question_id,
    question_type: 'MULTI_SELECT',
    classification,
    credit: boundedCredit,
    is_correct: false,
    is_partial: isPartial,
    error_category: errorCategory,
    misconception_description: `Selected ${selectedIndices.size} option(s); missed ${missingCorrect} required and chose ${extraIncorrect} extraneous option(s).`,
    feedback: isPartial
      ? `Partially correct (${Math.round(boundedCredit * 100)}% credit). You identified ${correctChosen} correct option(s) but missed ${missingCorrect} required option(s). Review ${coordLabel}.`
      : `Incorrect. Your selection did not match the required options as stated in ${coordLabel}.`,
    explanation: q.explanation || '',
    source_citation: coordLabel,
    citation_label: coordLabel,
    location: {
      source_id: q.source_id,
      resource_id: q.resource_id,
      chunk_id: q.chunk_id,
      page_number: q.page_number,
      slide_number: q.slide_number,
      timestamp_start: q.timestamp_start,
      timestamp_end: q.timestamp_end,
      source_type: q.source_type,
    },
    raw_student_answer: submission.raw_answer,
    normalized_student_answer: Array.from(selectedIndices).sort(),
  };
}

/**
 * Deterministic TRUE_FALSE Grader
 */
export function gradeTrueFalse(
  submission: AnswerSubmissionPayload,
  q: AuthoritativeQuestion
): UniversalGradingResult {
  const coordLabel = buildCoordinateLabel(q);
  const userRaw = String(submission.raw_answer ?? '').trim().toLowerCase();

  const parseBoolean = (val: string): boolean | null => {
    if (['true', 't', 'yes', 'y', '1'].includes(val)) return true;
    if (['false', 'f', 'no', 'n', '0'].includes(val)) return false;
    return null;
  };

  const studentBool = parseBoolean(userRaw);
  if (studentBool === null) {
    // Step 5: Invalid representations -> INVALID_FORMAT
    return {
      question_id: q.question_id,
      question_type: 'TRUE_FALSE',
      classification: 'invalid_format',
      credit: 0.0,
      is_correct: false,
      is_partial: false,
      error_category: 'PARSE_ERROR',
      feedback: `Invalid format: "${userRaw}". Expected True or False.`,
      explanation: q.explanation || '',
      source_citation: coordLabel,
      citation_label: coordLabel,
      location: {
        source_id: q.source_id,
        resource_id: q.resource_id,
        chunk_id: q.chunk_id,
        page_number: q.page_number,
        slide_number: q.slide_number,
        timestamp_start: q.timestamp_start,
        timestamp_end: q.timestamp_end,
        source_type: q.source_type,
      },
      raw_student_answer: submission.raw_answer,
    };
  }

  const correctRaw = String(q.correct_answer ?? '').trim().toLowerCase();
  const authoritativeBool = parseBoolean(correctRaw);

  const isMatch = studentBool === authoritativeBool;

  return {
    question_id: q.question_id,
    question_type: 'TRUE_FALSE',
    classification: isMatch ? 'correct' : 'incorrect',
    credit: isMatch ? 1.0 : 0.0,
    is_correct: isMatch,
    is_partial: false,
    error_category: isMatch ? 'NO_MISCONCEPTION' : 'WRONG_OPTION',
    feedback: isMatch
      ? `Correct! The statement is indeed ${studentBool ? 'True' : 'False'} as verified in ${coordLabel}.`
      : `Incorrect. The statement is ${authoritativeBool ? 'True' : 'False'} according to ${coordLabel}.`,
    explanation: q.explanation || '',
    source_citation: coordLabel,
    citation_label: coordLabel,
    location: {
      source_id: q.source_id,
      resource_id: q.resource_id,
      chunk_id: q.chunk_id,
      page_number: q.page_number,
      slide_number: q.slide_number,
      timestamp_start: q.timestamp_start,
      timestamp_end: q.timestamp_end,
      source_type: q.source_type,
    },
    raw_student_answer: submission.raw_answer,
    normalized_student_answer: studentBool,
  };
}

/**
 * Deterministic SHORT_ANSWER Grader (Layered Strategy)
 */
export function gradeShortAnswer(
  submission: AnswerSubmissionPayload,
  q: AuthoritativeQuestion
): UniversalGradingResult {
  const coordLabel = buildCoordinateLabel(q);
  const userRaw = String(submission.raw_answer ?? '').trim();
  const correctRaw = String(q.correct_answer ?? '').trim();

  // Layer 0: Empty answer
  if (!userRaw) {
    return {
      question_id: q.question_id,
      question_type: 'SHORT_ANSWER',
      classification: 'incorrect',
      credit: 0.0,
      is_correct: false,
      is_partial: false,
      error_category: 'INCOMPLETE_ANSWER',
      feedback: `Incomplete answer. Missing key conceptual components from ${coordLabel}.`,
      explanation: q.explanation || '',
      source_citation: coordLabel,
      citation_label: coordLabel,
      location: {
        source_id: q.source_id,
        resource_id: q.resource_id,
        chunk_id: q.chunk_id,
        page_number: q.page_number,
        slide_number: q.slide_number,
        timestamp_start: q.timestamp_start,
        timestamp_end: q.timestamp_end,
        source_type: q.source_type,
      },
      raw_student_answer: submission.raw_answer,
    };
  }

  const userNorm = normalizeText(userRaw);
  const correctNorm = normalizeText(correctRaw);

  // Layer 1: Deterministic exact/normalized string match
  if (userNorm === correctNorm || userRaw.toLowerCase() === correctRaw.toLowerCase()) {
    return {
      question_id: q.question_id,
      question_type: 'SHORT_ANSWER',
      classification: 'correct',
      credit: 1.0,
      is_correct: true,
      is_partial: false,
      error_category: 'NO_MISCONCEPTION',
      feedback: `Correct! Your response matches the verified answer in ${coordLabel}.`,
      explanation: q.explanation || '',
      source_citation: coordLabel,
      citation_label: coordLabel,
      location: {
        source_id: q.source_id,
        resource_id: q.resource_id,
        chunk_id: q.chunk_id,
        page_number: q.page_number,
        slide_number: q.slide_number,
        timestamp_start: q.timestamp_start,
        timestamp_end: q.timestamp_end,
        source_type: q.source_type,
      },
      raw_student_answer: submission.raw_answer,
      normalized_student_answer: userNorm,
    };
  }

  // Layer 2: Canonical accepted-answer variants match
  const variants = q.accepted_variants || [];
  for (const variant of variants) {
    if (normalizeText(variant) === userNorm || variant.toLowerCase().trim() === userRaw.toLowerCase()) {
      return {
        question_id: q.question_id,
        question_type: 'SHORT_ANSWER',
        classification: 'correct',
        credit: 1.0,
        is_correct: true,
        is_partial: false,
        error_category: 'NO_MISCONCEPTION',
        feedback: `Correct! Your response matches an accepted canonical variant verified in ${coordLabel}.`,
        explanation: q.explanation || '',
        source_citation: coordLabel,
        citation_label: coordLabel,
        location: {
          source_id: q.source_id,
          resource_id: q.resource_id,
          chunk_id: q.chunk_id,
          page_number: q.page_number,
          slide_number: q.slide_number,
          timestamp_start: q.timestamp_start,
          timestamp_end: q.timestamp_end,
          source_type: q.source_type,
        },
        raw_student_answer: submission.raw_answer,
        normalized_student_answer: userNorm,
      };
    }
  }

  // Layer 3: Structured token / required component overlap
  const userTokens = tokenizeSignificantWords(userRaw);
  const correctTokens = q.required_components && q.required_components.length > 0
    ? q.required_components.map((c) => c.toLowerCase().trim())
    : tokenizeSignificantWords(correctRaw);

  if (correctTokens.length > 0) {
    let matchedCount = 0;
    const missingTokens: string[] = [];

    for (const ct of correctTokens) {
      if (userTokens.includes(ct) || userNorm.includes(ct)) {
        matchedCount++;
      } else {
        missingTokens.push(ct);
      }
    }

    const overlapRatio = matchedCount / correctTokens.length;

    // High overlap: >= 75% -> Correct
    if (overlapRatio >= 0.75) {
      return {
        question_id: q.question_id,
        question_type: 'SHORT_ANSWER',
        classification: 'correct',
        credit: 1.0,
        is_correct: true,
        is_partial: false,
        error_category: 'NO_MISCONCEPTION',
        feedback: `Correct! Your response accurately captures the core principles verified in ${coordLabel}.`,
        explanation: q.explanation || '',
        source_citation: coordLabel,
        citation_label: coordLabel,
        location: {
          source_id: q.source_id,
          resource_id: q.resource_id,
          chunk_id: q.chunk_id,
          page_number: q.page_number,
          slide_number: q.slide_number,
          timestamp_start: q.timestamp_start,
          timestamp_end: q.timestamp_end,
          source_type: q.source_type,
        },
        raw_student_answer: submission.raw_answer,
        normalized_student_answer: userNorm,
      };
    }

    // Partial overlap: 35% to 74% -> Partially Correct
    if (overlapRatio >= 0.35 || userNorm.includes(correctNorm) || correctNorm.includes(userNorm)) {
      return {
        question_id: q.question_id,
        question_type: 'SHORT_ANSWER',
        classification: 'partially_correct',
        credit: 0.5,
        is_correct: false,
        is_partial: true,
        error_category: 'MISSING_REQUIRED_COMPONENT',
        misconception_description: `Omitted key components: ${missingTokens.slice(0, 3).join(', ')}.`,
        feedback: `Partially correct (${Math.round(overlapRatio * 100)}% coverage). You identified key concepts but missed critical details: ${missingTokens.slice(0, 3).join(', ')}. Review ${coordLabel}.`,
        explanation: q.explanation || '',
        source_citation: coordLabel,
        citation_label: coordLabel,
        location: {
          source_id: q.source_id,
          resource_id: q.resource_id,
          chunk_id: q.chunk_id,
          page_number: q.page_number,
          slide_number: q.slide_number,
          timestamp_start: q.timestamp_start,
          timestamp_end: q.timestamp_end,
          source_type: q.source_type,
        },
        raw_student_answer: submission.raw_answer,
        normalized_student_answer: userNorm,
      };
    }
  }

  // Layer 4: Below threshold
  return {
    question_id: q.question_id,
    question_type: 'SHORT_ANSWER',
    classification: 'incorrect',
    credit: 0.0,
    is_correct: false,
    is_partial: false,
    error_category: 'CONCEPTUAL_MISMATCH',
    misconception_description: `Response does not reflect course principles verified in ${coordLabel}.`,
    feedback: `Incorrect. Your response does not reflect the course principles verified in ${coordLabel}: "${correctRaw}".`,
    explanation: q.explanation || '',
    source_citation: coordLabel,
    citation_label: coordLabel,
    location: {
      source_id: q.source_id,
      resource_id: q.resource_id,
      chunk_id: q.chunk_id,
      page_number: q.page_number,
      slide_number: q.slide_number,
      timestamp_start: q.timestamp_start,
      timestamp_end: q.timestamp_end,
      source_type: q.source_type,
    },
    raw_student_answer: submission.raw_answer,
    normalized_student_answer: userNorm,
  };
}

/**
 * Deterministic NUMERICAL Grader (Delegates directly to canonical numericalVerifier.ts)
 */
export function gradeNumerical(
  submission: AnswerSubmissionPayload,
  q: AuthoritativeQuestion
): UniversalGradingResult {
  const coordLabel = buildCoordinateLabel(q);
  const correctVal = typeof q.correct_answer === 'number'
    ? q.correct_answer
    : parseFloat(String(q.correct_answer ?? '').replace(/[^\d.\-]/g, ''));

  if (isNaN(correctVal)) {
    return {
      question_id: q.question_id,
      question_type: 'NUMERICAL',
      classification: 'incorrect',
      credit: 0.0,
      is_correct: false,
      is_partial: false,
      error_category: 'PARSE_ERROR',
      feedback: 'Invalid numerical format for correct answer.',
      explanation: q.explanation || '',
      source_citation: coordLabel,
      citation_label: coordLabel,
      location: {
        source_id: q.source_id,
        resource_id: q.resource_id,
        chunk_id: q.chunk_id,
        page_number: q.page_number,
        slide_number: q.slide_number,
        timestamp_start: q.timestamp_start,
        timestamp_end: q.timestamp_end,
        source_type: q.source_type,
      },
      raw_student_answer: submission.raw_answer,
    };
  }

  const numericalQ: NumericalQuestion = {
    question_id: q.question_id,
    type: 'NUMERICAL',
    topic: q.topic || 'General',
    subtopic: q.subtopic,
    difficulty: q.difficulty || 'medium',
    source_id: q.source_id,
    chunk_id: q.chunk_id,
    page_number: q.page_number,
    slide_number: q.slide_number,
    timestamp_start: q.timestamp_start,
    timestamp_end: q.timestamp_end,
    question: q.question,
    correct_answer: correctVal,
    correct_answer_raw: q.correct_answer_raw || String(q.correct_answer),
    expected_unit: q.expected_unit,
    tolerance: q.tolerance || DEFAULT_TOLERANCE,
    verifiability: q.verifiability || 'VERIFIED',
    explanation: q.explanation || '',
  };

  const numSub: NumericalAnswerSubmission = {
    question_id: q.question_id,
    raw_answer: String(submission.raw_answer ?? ''),
  };

  const numResult = gradeNumericalAnswer(numSub, numericalQ);

  const isCorrect = numResult.classification === 'correct';
  const isPartial = numResult.classification === 'partially_correct';

  const categoryMap: Record<string, MisconceptionCategory> = {
    SIGN_ERROR: 'SIGN_ERROR',
    ROUNDING_ERROR: 'ROUNDING_ERROR',
    ORDER_OF_MAGNITUDE: 'ORDER_OF_MAGNITUDE',
    UNIT_MISMATCH: 'UNIT_MISMATCH',
    FORMULA_ERROR: 'FORMULA_ERROR',
    PARSE_ERROR: 'PARSE_ERROR',
    NONE: 'NO_MISCONCEPTION',
  };

  const errorCat = categoryMap[numResult.error_category || 'NONE'] || (isCorrect ? 'NO_MISCONCEPTION' : 'UNDETERMINED');

  return {
    question_id: q.question_id,
    question_type: 'NUMERICAL',
    classification: numResult.classification,
    credit: numResult.credit,
    is_correct: isCorrect,
    is_partial: isPartial,
    error_category: errorCat,
    feedback: numResult.feedback,
    explanation: q.explanation || '',
    source_citation: coordLabel,
    citation_label: coordLabel,
    location: {
      source_id: q.source_id,
      resource_id: q.resource_id,
      chunk_id: q.chunk_id,
      page_number: q.page_number,
      slide_number: q.slide_number,
      timestamp_start: q.timestamp_start,
      timestamp_end: q.timestamp_end,
      source_type: q.source_type,
    },
    raw_student_answer: submission.raw_answer,
    normalized_student_answer: numResult.student_value,
  };
}

// =========================================================================
// 4. Master Zero-Trust Grader Router (Step 16)
// =========================================================================

/**
 * Universal server-authoritative grader.
 * Guarantees zero-trust:
 * - Reads ONLY raw_answer from the submission payload.
 * - Completely ignores any client-supplied score, credit, correctAnswer, or tolerance.
 * - Scores are strictly bounded [0.0, 1.0].
 * - Deterministic: same inputs always produce identical output.
 */
export function gradeUniversalAnswer(
  submission: AnswerSubmissionPayload,
  authoritativeQuestion: AuthoritativeQuestion
): UniversalGradingResult {
  if (
    !authoritativeQuestion ||
    (authoritativeQuestion.correct_answer === undefined && (authoritativeQuestion as any).correctAnswer === undefined) ||
    authoritativeQuestion.verifiability === 'UNVERIFIABLE' ||
    authoritativeQuestion.verifiability === 'QUARANTINED' ||
    (authoritativeQuestion as any).is_valid === false
  ) {
    const coord = buildCoordinateLabel(authoritativeQuestion || ({} as any));
    const isValidationFailure =
      authoritativeQuestion?.verifiability === 'UNVERIFIABLE' ||
      authoritativeQuestion?.verifiability === 'QUARANTINED' ||
      (authoritativeQuestion as any)?.is_valid === false;
    return {
      question_id: authoritativeQuestion?.question_id || 'invalid_q',
      question_type: authoritativeQuestion?.type || 'MCQ',
      classification: 'unverifiable',
      credit: 0.0,
      is_correct: false,
      is_partial: false,
      error_category: 'UNVERIFIABLE',
      feedback: isValidationFailure
        ? 'Question cannot be verified or has been quarantined due to topic relevance/quality validation failure.'
        : 'Authoritative answer key is missing for this question.',
      explanation: authoritativeQuestion?.explanation || '',
      source_citation: coord,
      citation_label: coord,
      raw_student_answer: submission?.raw_answer,
    };
  }

  const cleanQ: AuthoritativeQuestion = {
    ...authoritativeQuestion,
    correct_answer: authoritativeQuestion.correct_answer !== undefined ? authoritativeQuestion.correct_answer : (authoritativeQuestion as any).correctAnswer,
  };
  const cleanSub: AnswerSubmissionPayload = {
    question_id: cleanQ.question_id,
    raw_answer: submission?.raw_answer,
  };

  let result: UniversalGradingResult;

  switch (cleanQ.type) {
    case 'NUMERICAL':
      result = gradeNumerical(cleanSub, cleanQ);
      break;
    case 'MCQ':
      result = gradeMCQ(cleanSub, cleanQ);
      break;
    case 'MULTI_SELECT':
      result = gradeMultiSelect(cleanSub, cleanQ);
      break;
    case 'TRUE_FALSE':
      result = gradeTrueFalse(cleanSub, cleanQ);
      break;
    case 'SHORT_ANSWER':
      result = gradeShortAnswer(cleanSub, cleanQ);
      break;
    default:
      result = {
        question_id: cleanQ.question_id,
        question_type: cleanQ.type,
        classification: 'unverifiable',
        credit: 0.0,
        is_correct: false,
        is_partial: false,
        error_category: 'UNVERIFIABLE',
        feedback: `Unsupported question type: ${cleanQ.type}`,
        explanation: cleanQ.explanation || '',
        raw_student_answer: cleanSub.raw_answer,
      };
      break;
  }

  // Strict score boundary enforcement [0.0, 1.0]
  result.credit = Math.max(0.0, Math.min(1.0, Number(result.credit) || 0.0));

  return result;
}

// =========================================================================
// 5. Grounded Feedback Integration (Step 14)
// =========================================================================

/**
 * Attaches grounded citation verification to an assessment result.
 * Reuses the canonical Phase 3 citation verification engine.
 * Critical guarantee: Feedback citation status NEVER alters the deterministic grade or credit.
 */
export async function attachGroundedFeedback(
  result: UniversalGradingResult,
  evidenceIndex?: CanonicalEvidenceIndex,
  resourceChecker?: (resourceId: string) => Promise<ResourceVerificationRecord | null>
): Promise<UniversalGradingResult> {
  if (!evidenceIndex || !result.location?.chunk_id) {
    return result;
  }

  try {
    const verifiedCit = await verifyCitation(
      {
        citation_number: 1,
        marker_text: '[EVIDENCE_1]',
        cited_evidence_id: 'EVIDENCE_1',
        chunk_id: result.location.chunk_id,
        resource_id: result.location.resource_id || result.location.source_id,
        source_type: (result.location.source_type as any) || 'TEXT',
        page_number: result.location.page_number ?? undefined,
        slide_number: result.location.slide_number ?? undefined,
        timestamp_start: result.location.timestamp_start ?? undefined,
        timestamp_end: result.location.timestamp_end ?? undefined,
      },
      {
        authenticatedUserId: evidenceIndex.contextUserId,
        evidenceIndex,
        resourceChecker,
      }
    );

    return {
      ...result,
      grounded_citation: verifiedCit,
      citation_label: verifiedCit.citation_label || result.citation_label,
    };
  } catch (err) {
    console.warn('Grounded feedback citation verification skipped:', err);
    return result;
  }
}

// =========================================================================
// 6. Student-Facing Sanitization (Step 15)
// =========================================================================

/**
 * Strips internal evaluation prompts, hidden answer keys, or tenant secrets
 * before returning assessment results to the student client.
 */
export function sanitizeResultForStudent(result: UniversalGradingResult): StudentFacingResult {
  return {
    question_id: result.question_id,
    question_type: result.question_type,
    classification: result.classification,
    credit: result.credit,
    is_correct: result.is_correct,
    is_partial: result.is_partial,
    error_category: result.error_category,
    feedback: result.feedback,
    explanation: result.explanation,
    citation_label: result.citation_label,
    location: result.location,
  };
}
