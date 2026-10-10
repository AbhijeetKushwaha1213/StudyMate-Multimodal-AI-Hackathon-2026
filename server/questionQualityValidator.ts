/**
 * Canonical Phase 4 — Step 3
 * Assessment Quality, Ambiguity & Generation Hardening Engine
 * 
 * Enforces zero-trust server-side validation over generated assessment items:
 * 1. Structural well-formedness and minimum meaningful length
 * 2. System prompt leakage and script injection detection
 * 3. Type-specific integrity and distractor quality
 * 4. Deterministic ambiguity detection
 * 5. Deterministic question-answer-explanation consistency
 * 6. SHA-256 fingerprinting and near-duplicate detection
 * 7. Source grounding verification with tenant security (reusing Phase 3)
 * 8. Fail-closed batch quarantine for student safety
 * 
 * ZERO-TRUST BOUNDARY:
 * - The LLM is NEVER the authority over question validity, answer keys, or grading.
 * - All validation is server-side and deterministic.
 * - Malformed, ambiguous, contradictory, ungrounded, or duplicate items are quarantined.
 */

import crypto from 'crypto';
import type {
  SupportedQuestionType,
  AuthoritativeQuestion,
  QuestionValidationStatus,
  QualityIssueCode,
  QuestionQualityIssue,
  AmbiguityCheckResult,
  ConsistencyCheckResult,
  DistractorQualityResult,
  GroundingValidationResult,
  DuplicateCheckResult,
  HardenedQuestionValidationResult,
  QuestionValidationContext,
  TopicRelevanceCheckResult,
  TolerancePolicy,
  NumericalQuestion,
} from './assessmentTypes.ts';
import {
  DEFAULT_TOLERANCE,
  UNIT_EQUIVALENCES,
} from './assessmentTypes.ts';
import {
  verifyNumericalQuestion,
  safeEvaluateExpression,
  normalizeUnit,
} from './numericalVerifier.ts';

// =========================================================================
// Normalization & Fingerprinting
// =========================================================================

/**
 * Normalizes question stem for canonical comparison:
 * lowercase, removes punctuation, collapses whitespace.
 */
export function computeNormalizedStem(stem: string): string {
  if (!stem || typeof stem !== 'string') return '';
  return stem
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts normalized option text.
 */
export function extractOptionText(option: any): string {
  if (typeof option === 'string') return option.trim();
  if (option && typeof option === 'object') {
    return String(option.text || option.option_text || option.label || option.value || '').trim();
  }
  return String(option ?? '').trim();
}

/**
 * Extracts option ID.
 */
export function extractOptionId(option: any, index: number): string {
  if (option && typeof option === 'object' && option.id) {
    return String(option.id).trim();
  }
  return String.fromCharCode(65 + index); // 'A', 'B', 'C', ...
}

/**
 * Deterministic SHA-256 Question Fingerprint.
 * Incorporates normalized type, stem, sorted normalized options, and answer.
 */
export function computeQuestionFingerprint(question: any): string {
  const type = String(question.type || 'MCQ').toUpperCase().trim();
  const stem = computeNormalizedStem(question.question || question.stem || '');
  
  // Normalized options list (sorted for permutation invariance)
  const rawOpts = question.options || [];
  const normOpts = Array.isArray(rawOpts)
    ? rawOpts.map((o) => computeNormalizedStem(extractOptionText(o))).filter(Boolean).sort().join('|')
    : '';
  
  // Normalized answer
  let normAns = '';
  const rawAns = question.correct_answer ?? question.correctAnswer ?? '';
  if (Array.isArray(rawAns)) {
    normAns = rawAns.map((a) => computeNormalizedStem(String(a))).sort().join('|');
  } else {
    normAns = computeNormalizedStem(String(rawAns));
  }

  const payload = `${type}::${stem}::${normOpts}::${normAns}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Computes word set Jaccard similarity between two texts:
 * J(A, B) = |A ∩ B| / |A ∪ B|
 */
export function calculateJaccardSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(computeNormalizedStem(textA).split(' ').filter((w) => w.length > 2));
  const wordsB = new Set(computeNormalizedStem(textB).split(' ').filter((w) => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersectionSize = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersectionSize++;
  }
  const unionSize = wordsA.size + wordsB.size - intersectionSize;
  return unionSize > 0 ? intersectionSize / unionSize : 0;
}

// =========================================================================
// Prompt Leakage & Injection Detection
// =========================================================================

const PROMPT_LEAKAGE_PATTERNS = [
  /you are an ai\b/i,
  /as an ai language model\b/i,
  /as an ai\b/i,
  /system prompt\b/i,
  /system instructions?\b/i,
  /strict grounding rules?\b/i,
  /generation instructions?\b/i,
  /return only a valid json\b/i,
  /return only json\b/i,
  /output json format\b/i,
  /ignore previous instructions?\b/i,
  /do not grade this\b/i,
  /\[evidence_\d+\]/i,
  /<script\b/i,
  /javascript:/i,
  /\bonload\s*=/i,
  /\bonerror\s*=/i,
];

/**
 * Detects system prompt leakage, prompt injection markers, or executable scripts
 * inside student-facing question fields.
 */
export function detectPromptLeakage(question: any): { leaked: boolean; matches: string[] } {
  const matches: string[] = [];
  const fieldsToCheck: string[] = [];

  if (typeof question.question === 'string') fieldsToCheck.push(question.question);
  if (typeof question.explanation === 'string') fieldsToCheck.push(question.explanation);
  if (Array.isArray(question.options)) {
    for (const opt of question.options) {
      fieldsToCheck.push(extractOptionText(opt));
    }
  }
  if (typeof question.correct_answer === 'string') fieldsToCheck.push(question.correct_answer);

  for (const text of fieldsToCheck) {
    for (const pattern of PROMPT_LEAKAGE_PATTERNS) {
      if (pattern.test(text)) {
        matches.push(pattern.toString());
      }
    }
  }

  return {
    leaked: matches.length > 0,
    matches: Array.from(new Set(matches)),
  };
}

// =========================================================================
// Semantic Topic Relevance, Tautology & Generic Boilerplate Validation
// =========================================================================

export const GENERIC_BOILERPLATE_PATTERNS: Array<{
  pattern: RegExp;
  description: string;
  code: QualityIssueCode;
}> = [
  {
    pattern: /\b(?:speculative guesswork|guesswork)\b/i,
    description: 'Trivial absurd distractor using speculative guesswork placeholder',
    code: 'TRIVIAL_ABSURD_DISTRACTOR',
  },
  {
    pattern: /\bcontradict (?:verified )?(?:empirical|theoretical) (?:laws|foundations)\b/i,
    description: 'Trivial absurd distractor contradicting empirical/theoretical laws',
    code: 'TRIVIAL_ABSURD_DISTRACTOR',
  },
  {
    pattern: /\b(?:the )?foundational principles and mechanisms governing\b/i,
    description: 'Generic boilerplate tautology phrase in options',
    code: 'GENERIC_FILLER_BOILERPLATE',
  },
  {
    pattern: /\bmethodologically sound(?: approach)?\b/i,
    description: 'Generic filler question asking for methodologically sound approach without domain content',
    code: 'GENERIC_FILLER_BOILERPLATE',
  },
  {
    pattern: /\bprimary distinguishing criterion\b/i,
    description: 'Generic boilerplate comparative question without concrete domain models',
    code: 'GENERIC_FILLER_BOILERPLATE',
  },
  {
    pattern: /\bshortest textual name\b/i,
    description: 'Trivial absurd distractor based on shortest textual name',
    code: 'TRIVIAL_ABSURD_DISTRACTOR',
  },
  {
    pattern: /\bdiscarding mathematical consistency\b/i,
    description: 'Trivial absurd distractor discarding mathematical consistency',
    code: 'TRIVIAL_ABSURD_DISTRACTOR',
  },
  {
    pattern: /\bassuming all methodologies produce identical outcomes\b/i,
    description: 'Trivial absurd distractor assuming all methodologies produce identical outcomes',
    code: 'TRIVIAL_ABSURD_DISTRACTOR',
  },
  {
    pattern: /\brelying on arbitrary heuristics without verifying prerequisite constraints\b/i,
    description: 'Trivial absurd distractor relying on arbitrary heuristics',
    code: 'TRIVIAL_ABSURD_DISTRACTOR',
  },
  {
    pattern: /\bto prevent systematic analysis of\b/i,
    description: 'Trivial absurd distractor preventing systematic analysis',
    code: 'TRIVIAL_ABSURD_DISTRACTOR',
  },
  {
    pattern: /\btransient calculation error that does not reflect verified\b/i,
    description: 'Generic filler distractor about transient calculation error',
    code: 'GENERIC_FILLER_BOILERPLATE',
  },
  {
    pattern: /\bunrelated secondary hypothesis rejected by standard\b/i,
    description: 'Generic filler distractor about unrelated secondary hypothesis',
    code: 'GENERIC_FILLER_BOILERPLATE',
  },
  {
    pattern: /\bnon-standard convention unsupported by peer-reviewed\b/i,
    description: 'Generic filler distractor about non-standard convention',
    code: 'GENERIC_FILLER_BOILERPLATE',
  },
  {
    pattern: /\beliminate quantitative evaluation\b/i,
    description: 'Trivial absurd distractor eliminating quantitative evaluation',
    code: 'TRIVIAL_ABSURD_DISTRACTOR',
  },
  {
    pattern: /\bconfusing surface-level terminology with deep structural\b/i,
    description: 'Generic filler distractor about surface-level terminology',
    code: 'GENERIC_FILLER_BOILERPLATE',
  },
  {
    pattern: /\bwhich statement accurately defines (?:the fundamental concept of )?core principles\b/i,
    description: 'Generic circular question stem about Core Principles',
    code: 'CIRCULAR_DEFINITION',
  },
  {
    pattern: /\bprimary role or mechanism of core principles\b/i,
    description: 'Generic boilerplate question stem about Core Principles',
    code: 'GENERIC_FILLER_BOILERPLATE',
  },
  {
    pattern: /\bapplying core principles to solve practical problems\b/i,
    description: 'Generic boilerplate question stem about applying Core Principles',
    code: 'GENERIC_FILLER_BOILERPLATE',
  },
  {
    pattern: /\bto explain and predict core interactions and structural relationships in\b/i,
    description: 'Generic boilerplate answer option lacking technical mechanism',
    code: 'GENERIC_FILLER_BOILERPLATE',
  },
];

/**
 * Checks if a string or concept title matches generic boilerplate or empty filler patterns.
 */
export function isGenericOrBoilerplate(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase().trim();
  if (/^(?:the\s+)?core\s+principles?$/i.test(lower)) return true;
  for (const item of GENERIC_BOILERPLATE_PATTERNS) {
    if (item.pattern.test(lower)) return true;
  }
  return false;
}

const STOPWORDS_SET = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'about', 'against',
  'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'from', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
  'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'can', 'will', 'just', 'should', 'now', 'which', 'what', 'who', 'whom',
  'this', 'that', 'these', 'those', 'am', 'it', 'its', 'their', 'they', 'them',
]);

const META_ACADEMIC_SET = new Set([
  'core', 'principle', 'principles', 'concept', 'concepts', 'fundamental',
  'foundational', 'mechanism', 'mechanisms', 'methodology', 'methodologies',
  'methodological', 'framework', 'frameworks', 'approach', 'approaches',
  'theory', 'theories', 'theoretical', 'empirical', 'standard', 'verified',
  'phenomenon', 'phenomena', 'study', 'studying', 'practical', 'problem',
  'problems', 'distinguishing', 'criterion', 'criteria', 'application',
  'applications', 'accurate', 'accurately', 'definition', 'definitions',
  'role', 'roles', 'model', 'models', 'technique', 'techniques',
  'systematically', 'applying', 'solve', 'solving', 'sound', 'misconception',
  'misconceptions', 'general', 'primary', 'governing', 'constituting',
  'underlying', 'deep', 'surface', 'level', 'terminology', 'speculative',
  'guesswork', 'unrelated', 'secondary', 'hypothesis', 'transient',
  'calculation', 'error', 'nonstandard', 'convention', 'unsupported',
  'peerreviewed', 'literature', 'laws', 'statement', 'accurately',
]);

/**
 * Validates semantic topic relevance, tautologies, circular definitions,
 * and generic boilerplate filler phrases across any subject/topic dynamically.
 */
export function checkSemanticTopicRelevance(
  question: any,
  context?: QuestionValidationContext
): TopicRelevanceCheckResult {
  const issues: string[] = [];
  const detected_boilerplate: string[] = [];

  const stem = String(question.question || question.stem || '').trim();
  const rawAns = String(question.correct_answer ?? question.correctAnswer ?? '').trim();
  const expl = String(question.explanation || '').trim();
  const options = Array.isArray(question.options) ? question.options : [];

  const allTexts: string[] = [stem, rawAns, expl];
  for (const opt of options) {
    allTexts.push(extractOptionText(opt));
  }

  // 1. Scan for explicit generic boilerplate / filler patterns
  for (const item of GENERIC_BOILERPLATE_PATTERNS) {
    for (const text of allTexts) {
      if (item.pattern.test(text)) {
        const issueMsg = `Detected generic boilerplate filler: "${item.description}"`;
        if (!issues.includes(issueMsg)) {
          issues.push(issueMsg);
          detected_boilerplate.push(item.description);
        }
      }
    }
  }

  // 2. Circular Definition & Tautology Check
  const stemLower = stem.toLowerCase();
  const ansLower = rawAns.toLowerCase();

  // Pattern A: "Which statement accurately defines... X in Y" -> "The foundational principles and mechanisms governing X"
  if (
    stemLower.includes('accurately defines') &&
    (ansLower.includes('principles and mechanisms governing') ||
     ansLower.includes('foundational principles'))
  ) {
    issues.push('Circular definition detected: question asks for definition but answer merely asserts governing principles without content.');
  }

  // Pattern B: Stem repeats concept name and answer only repeats concept name with no attributes
  const topicWords = [
    ...(context?.topic ? context.topic.toLowerCase().split(/\s+/) : []),
    ...(context?.subtopic ? context.subtopic.toLowerCase().split(/\s+/) : []),
    ...(question.topic ? String(question.topic).toLowerCase().split(/\s+/) : []),
    ...(question.subtopic ? String(question.subtopic).toLowerCase().split(/\s+/) : []),
  ].filter((w) => w.length > 2);

  // 3. Domain Substantive Content Ratio (DSCR)
  // Ensure the question stem and options contain real technical domain terms,
  // not just meta-academic buzzwords + repeated topic names.
  const combinedTokens = allTexts
    .join(' ')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  let totalContentWords = 0;
  let substantiveWords = 0;

  for (const tok of combinedTokens) {
    if (STOPWORDS_SET.has(tok)) continue;
    totalContentWords++;

    const isTopicWord = topicWords.includes(tok);
    const isMetaAcademic = META_ACADEMIC_SET.has(tok);

    if (!isTopicWord && !isMetaAcademic) {
      substantiveWords++;
    }
  }

  const substantive_ratio = totalContentWords > 0 ? substantiveWords / totalContentWords : 0;

  if (totalContentWords >= 15 && substantive_ratio < 0.22) {
    issues.push(
      `Question lacks domain-specific technical substance (substantive ratio ${Math.round(substantive_ratio * 100)}% < 22%). Appears to be generic meta-academic boilerplate filler.`
    );
  }

  return {
    is_relevant: issues.length === 0,
    issues,
    substantive_ratio,
    detected_boilerplate: detected_boilerplate.length > 0 ? detected_boilerplate : undefined,
  };
}

// =========================================================================
// Correct-Option Balancing & Authoritative Key Synchronization
// =========================================================================

function createPRNG(seedInput?: number | string): () => number {
  let s: number;
  if (typeof seedInput === 'number') {
    s = seedInput >>> 0;
  } else if (typeof seedInput === 'string') {
    let hash = 0;
    for (let i = 0; i < seedInput.length; i++) {
      hash = (Math.imul(31, hash) + seedInput.charCodeAt(i)) | 0;
    }
    s = hash >>> 0;
  } else {
    const buf = crypto.randomBytes(4);
    s = buf.readUInt32BE(0);
  }

  return function next(): number {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates balanced, non-repeating target positions for a batch of questions.
 * Avoids all-A bias, avoids predictable cycles (0, 1, 2, 3, 0), and avoids adjacent duplicates.
 */
export function generateBalancedPositions(
  count: number,
  numChoices = 4,
  rng?: () => number
): number[] {
  const rand = rng || (() => Math.random());
  if (count <= 0) return [];
  if (count === 1) return [Math.floor(rand() * numChoices)];

  const pool: number[] = [];
  while (pool.length < count) {
    const chunk = Array.from({ length: numChoices }, (_, i) => i);
    for (let i = chunk.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [chunk[i], chunk[j]] = [chunk[j], chunk[i]];
    }
    pool.push(...chunk);
  }
  const positions = pool.slice(0, count);

  for (let attempt = 0; attempt < 20; attempt++) {
    let hasAdjacentIdentical = false;
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] === positions[i - 1]) {
        hasAdjacentIdentical = true;
        for (let j = 0; j < positions.length; j++) {
          if (positions[j] !== positions[i] && (j === 0 || positions[j - 1] !== positions[i])) {
            [positions[i], positions[j]] = [positions[j], positions[i]];
            break;
          }
        }
      }
    }
    const isPredictableAscending = positions.slice(0, 4).every((v, i) => v === i);
    if (!hasAdjacentIdentical && !isPredictableAscending) {
      break;
    }
    const i1 = Math.floor(rand() * positions.length);
    const i2 = Math.floor(rand() * positions.length);
    [positions[i1], positions[i2]] = [positions[i2], positions[i1]];
  }

  const allIdentical = positions.every((p) => p === positions[0]);
  if (allIdentical && positions.length > 1) {
    for (let i = 1; i < positions.length; i++) {
      positions[i] = (positions[i - 1] + 1) % numChoices;
    }
  }

  return positions;
}

/**
 * Balances and randomizes multiple-choice options across questions so correct
 * answer positions are distributed fairly across options (A, B, C, D) without
 * positional bias while strictly preserving authoritative answer keys.
 */
export function balanceAndRandomizeQuestionOptions(
  questions: any[],
  opts?: { seed?: number | string; strategy?: 'balanced' | 'random' }
): any[] {
  if (!Array.isArray(questions) || questions.length === 0) return [];
  const rng = createPRNG(opts?.seed);

  const mcqIndices: number[] = [];
  questions.forEach((q, idx) => {
    if ((q.type || 'MCQ').toUpperCase() === 'MCQ' && Array.isArray(q.options) && q.options.length >= 2) {
      mcqIndices.push(idx);
    }
  });

  const balancedPositions = generateBalancedPositions(mcqIndices.length, 4, rng);

  return questions.map((q, qIdx) => {
    if ((q.type || 'MCQ').toUpperCase() !== 'MCQ' || !Array.isArray(q.options) || q.options.length < 2) {
      return q;
    }

    const mcqPosIndex = mcqIndices.indexOf(qIdx);
    const targetSlot = mcqPosIndex >= 0 ? balancedPositions[mcqPosIndex] % q.options.length : Math.floor(rng() * q.options.length);

    // 1. Resolve authoritative correct answer text
    let correctText = String(q.correct_answer ?? q.correctAnswer ?? '').trim();
    const rawIdx = parseInt(correctText, 10);
    if (!isNaN(rawIdx) && rawIdx >= 0 && rawIdx < q.options.length) {
      correctText = extractOptionText(q.options[rawIdx]);
    } else {
      const match = q.options.find(
        (opt: any) => extractOptionText(opt).toLowerCase() === correctText.toLowerCase()
      );
      if (match) {
        correctText = extractOptionText(match);
      }
    }

    // 2. Separate correct option from distractors
    const distractors: any[] = [];
    let correctOptObj: any = null;

    for (let i = 0; i < q.options.length; i++) {
      const opt = q.options[i];
      const text = extractOptionText(opt);
      if (text.toLowerCase() === correctText.toLowerCase() && correctOptObj === null) {
        correctOptObj = opt;
      } else {
        distractors.push(opt);
      }
    }

    if (!correctOptObj) {
      correctOptObj = correctText;
    }

    // 3. Shuffle distractors
    for (let i = distractors.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [distractors[i], distractors[j]] = [distractors[j], distractors[i]];
    }

    // 4. Place correct option at targetSlot, distractors in remaining slots
    const newOptions: any[] = [];
    let distIdx = 0;
    for (let i = 0; i < q.options.length; i++) {
      if (i === targetSlot) {
        if (typeof correctOptObj === 'object' && correctOptObj !== null) {
          newOptions.push({ ...correctOptObj, id: String.fromCharCode(65 + i) });
        } else {
          newOptions.push(correctText);
        }
      } else {
        const dist = distractors[distIdx++];
        if (typeof dist === 'object' && dist !== null) {
          newOptions.push({ ...dist, id: String.fromCharCode(65 + i) });
        } else {
          newOptions.push(extractOptionText(dist));
        }
      }
    }

    return {
      ...q,
      options: newOptions,
      correct_answer: correctText,
      correctAnswer: correctText,
      correct_answer_index: targetSlot,
      options_balanced: true,
    };
  });
}

// =========================================================================
// Distractor Quality Check
// =========================================================================

/**
 * Evaluates MCQ / MULTI_SELECT distractor quality:
 * - Minimum options
 * - Non-empty option texts
 * - Unique option texts (no duplicates)
 * - Unique option IDs
 * - Distractor does not match correct answer
 */
export function checkDistractorQuality(question: any): DistractorQualityResult {
  const issues: string[] = [];
  const options = question.options;

  if (!Array.isArray(options) || options.length < 2) {
    return {
      valid: false,
      issues: ['Options array must contain at least 2 distinct choices'],
    };
  }

  const seenTexts = new Map<string, number>();
  const seenIds = new Set<string>();
  const correctRaw = question.correct_answer ?? question.correctAnswer;
  const correctNormalized = typeof correctRaw === 'string' ? computeNormalizedStem(correctRaw) : '';

  for (let i = 0; i < options.length; i++) {
    const rawText = extractOptionText(options[i]);
    const id = extractOptionId(options[i], i);
    const normText = computeNormalizedStem(rawText);

    if (rawText.length === 0) {
      issues.push(`Option at index ${i} has empty text`);
      continue;
    }

    if (seenIds.has(id.toLowerCase())) {
      issues.push(`Duplicate option ID "${id}" at index ${i}`);
    }
    seenIds.add(id.toLowerCase());

    if (seenTexts.has(normText)) {
      issues.push(`Duplicate option text "${rawText}" at index ${i}`);
    } else {
      seenTexts.set(normText, i);
    }
  }

  // Check if any distractor is literally identical to the correct answer when it shouldn't be
  const qType = String(question.type || 'MCQ').toUpperCase();
  if (qType === 'MCQ' && correctNormalized) {
    let matchCount = 0;
    for (let i = 0; i < options.length; i++) {
      const optNorm = computeNormalizedStem(extractOptionText(options[i]));
      const optId = extractOptionId(options[i], i).toLowerCase();
      if (optNorm === correctNormalized || optId === String(correctRaw).toLowerCase().trim()) {
        matchCount++;
      }
    }
    if (matchCount === 0) {
      issues.push(`Authoritative correct answer "${correctRaw}" does not correspond to any option`);
    } else if (matchCount > 1) {
      issues.push(`Multiple options (${matchCount}) match the correct answer, creating ambiguity`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// =========================================================================
// Ambiguity Detection
// =========================================================================

/**
 * Deterministically detects question ambiguity:
 * - Conflicting options
 * - Impossibly broad or contradictory numerical tolerances
 * - Missing required units when stem mandates them
 * - Malformed boolean assertions
 * - Contradictory short-answer components
 */
export function checkQuestionAmbiguity(question: any): AmbiguityCheckResult {
  const reasons: string[] = [];
  let requires_review = false;

  const qType = String(question.type || 'MCQ').toUpperCase();
  const stem = String(question.question || question.stem || '');

  if (qType === 'MCQ') {
    const options = question.options || [];
    if (Array.isArray(options)) {
      const correctRaw = question.correct_answer ?? question.correctAnswer;
      const correctNorm = computeNormalizedStem(String(correctRaw));
      let matches = 0;
      for (let i = 0; i < options.length; i++) {
        const optNorm = computeNormalizedStem(extractOptionText(options[i]));
        const optId = extractOptionId(options[i], i).toLowerCase();
        if (optNorm === correctNorm || optId === String(correctRaw).toLowerCase().trim()) {
          matches++;
        }
      }
      if (matches > 1) {
        reasons.push('Multiple identical choices match the correct answer key');
      } else if (matches === 0 && options.length >= 2) {
        reasons.push('Correct answer is not represented in the available options');
      }
    }
  } else if (qType === 'NUMERICAL') {
    const tolerance: TolerancePolicy = question.tolerance || DEFAULT_TOLERANCE;
    const expectedVal = typeof question.correct_answer === 'number'
      ? question.correct_answer
      : parseFloat(String(question.correct_answer ?? ''));

    // Broad tolerance detection
    if (tolerance.mode === 'RELATIVE' && tolerance.value >= 0.5) {
      reasons.push(`Relative tolerance of ${Math.round(tolerance.value * 100)}% is excessively broad and allows contradictory answers`);
      requires_review = true;
    } else if (tolerance.mode === 'ABSOLUTE' && !isNaN(expectedVal) && expectedVal !== 0) {
      if (tolerance.value >= Math.abs(expectedVal) * 1.5) {
        reasons.push(`Absolute tolerance ${tolerance.value} exceeds 150% of expected value ${expectedVal}`);
        requires_review = true;
      }
    }

    // Missing unit detection when question explicitly asks for units
    const unitRequestRegex = /\b(?:in|calculate the|find the)\s+([a-zA-Z/%°Ω]+(?:\/[a-zA-Z0-9^]+)?)\b/i;
    const mentionsUnit = unitRequestRegex.test(stem) || /\b(meters|seconds|joules|watts|grams|kilograms|newtons|m\/s|km\/h)\b/i.test(stem);
    if (mentionsUnit && !question.expected_unit) {
      // Check if correct answer already embeds a unit
      const rawAns = String(question.correct_answer_raw ?? question.correct_answer ?? '');
      const hasUnitInRaw = /[a-zA-Z%°]/.test(rawAns);
      if (!hasUnitInRaw) {
        reasons.push('Question stem indicates specific measurement unit, but no expected_unit is defined');
        requires_review = true;
      }
    }
  } else if (qType === 'TRUE_FALSE') {
    const ans = String(question.correct_answer ?? question.correctAnswer ?? '').trim().toLowerCase();
    const validBooleans = ['true', 'false', 't', 'f', 'yes', 'no', '1', '0'];
    if (!validBooleans.includes(ans)) {
      reasons.push(`TRUE_FALSE answer "${ans}" is ambiguous or non-boolean`);
    }
  } else if (qType === 'SHORT_ANSWER') {
    const rawAns = String(question.correct_answer ?? question.correctAnswer ?? '').trim();
    if (!rawAns) {
      reasons.push('Canonical short answer is empty');
    }

    // Check contradictory required components
    const components: string[] = question.required_components || question.requiredComponents || [];
    if (Array.isArray(components) && components.length >= 2) {
      const lowerComps = components.map((c) => String(c).toLowerCase().trim());
      if (lowerComps.includes('positive') && lowerComps.includes('negative')) {
        reasons.push('Contradictory required components: "positive" and "negative"');
      }
      if (lowerComps.includes('increase') && lowerComps.includes('decrease')) {
        reasons.push('Contradictory required components: "increase" and "decrease"');
      }
    }
  }

  return {
    is_ambiguous: reasons.length > 0,
    requires_review: requires_review || (reasons.length > 0 && !reasons.some(r => r.includes('not represented') || r.includes('empty'))),
    reasons,
  };
}

// =========================================================================
// Question / Answer / Explanation Consistency Check
// =========================================================================

/**
 * Checks for internal contradictions between question stem, options, answer key,
 * and the generated explanation.
 */
export function checkQuestionConsistency(question: any): ConsistencyCheckResult {
  const inconsistencies: string[] = [];
  const qType = String(question.type || 'MCQ').toUpperCase();
  const explanation = String(question.explanation || '').trim();

  if (!explanation) {
    return { is_consistent: true, inconsistencies: [] };
  }

  if (qType === 'MCQ') {
    const options = question.options || [];
    const correctRaw = String(question.correct_answer ?? question.correctAnswer ?? '').trim();
    
    // Check if explanation explicitly names a different option letter
    // e.g. "The correct answer is B", "Option C is correct"
    const explOptionMatch = explanation.match(/\b(?:correct answer is|option|choice)\s+([A-D])\b/i);
    if (explOptionMatch && Array.isArray(options) && options.length >= 2) {
      const explLetter = explOptionMatch[1].toUpperCase();
      
      // Determine what letter corresponds to correctRaw
      let correctLetter = '';
      if (/^[A-D]$/i.test(correctRaw)) {
        correctLetter = correctRaw.toUpperCase();
      } else {
        // Look up index of correct option
        for (let i = 0; i < options.length; i++) {
          const optText = extractOptionText(options[i]).toLowerCase();
          const optId = extractOptionId(options[i], i).toUpperCase();
          if (optText === correctRaw.toLowerCase() || optId === correctRaw.toUpperCase()) {
            correctLetter = String.fromCharCode(65 + i);
            break;
          }
        }
      }

      if (correctLetter && explLetter !== correctLetter) {
        inconsistencies.push(
          `Explanation states option "${explLetter}" is correct, but answer key designates option "${correctLetter}"`
        );
      }
    }
  } else if (qType === 'TRUE_FALSE') {
    const ans = String(question.correct_answer ?? question.correctAnswer ?? '').trim().toLowerCase();
    const isTrue = ['true', 't', 'yes', '1'].includes(ans);
    const isFalse = ['false', 'f', 'no', '0'].includes(ans);

    const explLower = explanation.toLowerCase();
    if (isTrue && (/^(?:false[.,]|this statement is false|the statement is false)/i.test(explLower))) {
      inconsistencies.push('Explanation asserts statement is False, but authoritative answer key is True');
    } else if (isFalse && (/^(?:true[.,]|this statement is true|the statement is true)/i.test(explLower))) {
      inconsistencies.push('Explanation asserts statement is True, but authoritative answer key is False');
    }
  } else if (qType === 'NUMERICAL') {
    const expectedVal = typeof question.correct_answer === 'number'
      ? question.correct_answer
      : parseFloat(String(question.correct_answer ?? ''));

    if (!isNaN(expectedVal) && expectedVal !== 0) {
      // Look for statements like "final answer is -12", "result is 500"
      const numMatch = explanation.match(/\b(?:final answer is|result is|yields|equals)\s*([+-]?\d+(?:\.\d+)?)\b/i);
      if (numMatch) {
        const explNum = parseFloat(numMatch[1]);
        if (!isNaN(explNum) && Math.abs(explNum - expectedVal) / Math.abs(expectedVal) > 0.3) {
          inconsistencies.push(
            `Explanation mentions calculation result ${explNum}, which differs materially from authoritative answer ${expectedVal}`
          );
        }
      }
    }
  }

  return {
    is_consistent: inconsistencies.length === 0,
    inconsistencies,
  };
}

// =========================================================================
// Duplicate & Near-Duplicate Detection
// =========================================================================

/**
 * Compares question against a repository of existing questions / fingerprints.
 * - Exact SHA-256 fingerprint match -> REJECT
 * - Normalized stem match -> REJECT
 * - Jaccard word similarity >= threshold (default 0.85) -> REVIEW_REQUIRED
 */
export function detectNearDuplicate(
  question: any,
  existingQuestions: any[] = [],
  threshold = 0.85
): DuplicateCheckResult {
  const fp = computeQuestionFingerprint(question);
  const stem = question.question || question.stem || '';
  const normStem = computeNormalizedStem(stem);

  for (const existing of existingQuestions) {
    if (!existing) continue;

    // Check precomputed fingerprint
    const existFp = existing.fingerprint || computeQuestionFingerprint(existing);
    if (existFp === fp) {
      return {
        is_duplicate: true,
        is_near_duplicate: false,
        fingerprint: fp,
        similarity: 1.0,
        matched_question_id: existing.id || existing.question_id,
        action: 'REJECT',
      };
    }

    // Check normalized stem exact match
    const existStem = existing.question || existing.stem || '';
    const existNormStem = computeNormalizedStem(existStem);
    if (normStem && existNormStem && normStem === existNormStem) {
      return {
        is_duplicate: true,
        is_near_duplicate: false,
        fingerprint: fp,
        similarity: 1.0,
        matched_question_id: existing.id || existing.question_id,
        action: 'REJECT',
      };
    }

    // Check Jaccard near-duplicate
    const sim = calculateJaccardSimilarity(stem, existStem);
    if (sim >= threshold) {
      return {
        is_duplicate: false,
        is_near_duplicate: true,
        fingerprint: fp,
        similarity: sim,
        matched_question_id: existing.id || existing.question_id,
        action: 'REVIEW_REQUIRED',
      };
    }
  }

  return {
    is_duplicate: false,
    is_near_duplicate: false,
    fingerprint: fp,
    similarity: 0.0,
    action: 'ALLOW',
  };
}

// =========================================================================
// Source Grounding Verification
// =========================================================================

/**
 * Validates question provenance against Phase 3 canonical grounding contracts.
 * Rejects questions citing unavailable, deleted, or cross-tenant sources.
 */
export async function verifyQuestionGrounding(
  question: any,
  context?: QuestionValidationContext
): Promise<GroundingValidationResult> {
  const sourceId = question.source_id || question.sourceId;
  const chunkId = question.chunk_id || question.chunkId;
  const resourceId = question.resource_id || question.resourceId;

  // If question has no grounding provenance:
  if (!sourceId && !chunkId && !resourceId) {
    if (context?.require_grounding) {
      return {
        grounded: false,
        status: 'UNGROUNDED',
        reason: 'Question lacks source provenance but grounding is required',
      };
    }
    return {
      grounded: true,
      status: 'VERIFIED',
    };
  }

  // If evidence index is provided, verify chunk existence and tenant boundary
  if (context?.evidence_index) {
    const index = context.evidence_index;
    const lookupKey = chunkId || sourceId;
    let canonical = index.byChunkId?.get(lookupKey) || index.byEvidenceId?.get(lookupKey);

    if (!canonical) {
      return {
        grounded: false,
        status: 'UNGROUNDED',
        reason: `Evidence chunk "${lookupKey}" not found in retrieved course material`,
      };
    }

    // Tenant isolation verification
    const authUser = context.authenticated_user_id;
    const isOwner = authUser && canonical.user_id === authUser;
    const isSystemPublic =
      canonical.tenant_type === 'SYSTEM_PUBLIC' ||
      canonical.user_id === 'system_public' ||
      canonical.user_id === 'default_user';

    if (authUser && !isOwner && !isSystemPublic) {
      return {
        grounded: false,
        status: 'CROSS_TENANT_REJECTED',
        reason: `Cross-tenant evidence detected: chunk owned by "${canonical.user_id}", not context user "${authUser}"`,
      };
    }

    // Coordinate verification
    if (question.page_number !== undefined && question.page_number !== null && canonical.page_number !== undefined && canonical.page_number !== null) {
      if (Number(question.page_number) !== Number(canonical.page_number)) {
        return {
          grounded: false,
          status: 'UNGROUNDED',
          reason: `Coordinate mismatch: question declares page ${question.page_number}, but chunk is page ${canonical.page_number}`,
        };
      }
    }
  }

  // If resource checker provided, check existence and deleted state
  if (context?.resource_checker && resourceId) {
    const resRecord = await context.resource_checker(resourceId);
    if (!resRecord || !resRecord.exists || resRecord.isDeleted) {
      return {
        grounded: false,
        status: 'SOURCE_UNAVAILABLE',
        reason: `Underlying resource "${resourceId}" is deleted or unavailable`,
      };
    }

    const authUser = context.authenticated_user_id;
    const isOwner = authUser && resRecord.userId === authUser;
    const isPublic = resRecord.tenantType === 'SYSTEM_PUBLIC' || resRecord.userId === 'system_public';
    if (authUser && !isOwner && !isPublic) {
      return {
        grounded: false,
        status: 'CROSS_TENANT_REJECTED',
        reason: `Cross-tenant resource access rejected for "${resourceId}"`,
      };
    }
  }

  return {
    grounded: true,
    status: 'VERIFIED',
  };
}

// =========================================================================
// Comprehensive Hardened Question Validator
// =========================================================================

/**
 * Validates a candidate assessment question prior to student delivery.
 * Combines structural well-formedness, prompt leakage, distractor quality,
 * ambiguity, consistency, deduplication, and grounding.
 */
export async function validateHardenedQuestion(
  question: any,
  context?: QuestionValidationContext
): Promise<HardenedQuestionValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const issues: QuestionQualityIssue[] = [];

  if (!question || typeof question !== 'object') {
    return {
      status: 'INVALID',
      valid: false,
      errors: ['Question must be a valid JSON object'],
      warnings: [],
      issues: [{ code: 'MALFORMED_METADATA', message: 'Question must be a valid JSON object', severity: 'ERROR' }],
      fingerprint: '',
      ambiguity: { is_ambiguous: false, requires_review: false, reasons: [] },
      consistency: { is_consistent: true, inconsistencies: [] },
      distractor_quality: { valid: false, issues: [] },
    };
  }

  const stem = String(question.question || question.stem || '').trim();
  const qId = question.question_id || question.id || `q_${Date.now()}`;
  const fp = computeQuestionFingerprint(question);

  // 1. General Stem Validation
  if (!stem) {
    errors.push('Question stem cannot be empty');
    issues.push({ code: 'MISSING_STEM', message: 'Question stem cannot be empty', severity: 'ERROR', field: 'question' });
  } else if (stem.length < 8) {
    errors.push('Question stem too short (minimum 8 characters required)');
    issues.push({ code: 'STEM_TOO_SHORT', message: 'Question stem too short (minimum 8 characters)', severity: 'ERROR', field: 'question' });
  }

  // 2. Question Type Validation
  const rawType = String(question.type || 'MCQ').toUpperCase().trim();
  const validTypes: SupportedQuestionType[] = ['NUMERICAL', 'MCQ', 'SHORT_ANSWER', 'TRUE_FALSE', 'MULTI_SELECT'];
  if (!validTypes.includes(rawType as SupportedQuestionType)) {
    errors.push(`Unsupported question type: "${question.type}". Supported: ${validTypes.join(', ')}`);
    issues.push({ code: 'UNSUPPORTED_TYPE', message: `Unsupported question type "${question.type}"`, severity: 'ERROR', field: 'type' });
  }
  const qType = (validTypes.includes(rawType as SupportedQuestionType) ? rawType : 'MCQ') as SupportedQuestionType;

  // 3. Prompt Leakage & Script Injection
  const leakage = detectPromptLeakage(question);
  if (leakage.leaked) {
    errors.push(`System prompt leakage or script injection detected: ${leakage.matches.join(', ')}`);
    issues.push({ code: 'PROMPT_LEAKAGE', message: `Prompt leakage detected: ${leakage.matches.join(', ')}`, severity: 'ERROR' });
  }

  // 4. Answer Key Existence
  const ca = question.correct_answer ?? question.correctAnswer;
  if (
    ca === undefined ||
    ca === null ||
    (typeof ca === 'string' && ca.trim() === '') ||
    (Array.isArray(ca) && ca.length === 0)
  ) {
    errors.push('Question missing required correct_answer');
    issues.push({ code: 'MISSING_ANSWER_KEY', message: 'Question missing required correct_answer', severity: 'ERROR', field: 'correct_answer' });
  }

  // 5. Type-Specific Validation
  if (qType === 'NUMERICAL') {
    const correctVal = typeof ca === 'number'
      ? ca
      : parseFloat(String(ca ?? '').replace(/[^\d.\-]/g, ''));

    if (isNaN(correctVal) || !isFinite(correctVal)) {
      errors.push('NUMERICAL question has NaN or infinite correct_answer');
      issues.push({ code: 'NON_FINITE_NUMERICAL', message: 'NUMERICAL question has NaN or infinite correct_answer', severity: 'ERROR', field: 'correct_answer' });
    }

    // Expression evaluation safety
    const rawExpression = String(question.correct_answer_raw ?? ca ?? '');
    if (/[+*/^]/.test(rawExpression)) {
      const evalRes = safeEvaluateExpression(rawExpression);
      if (evalRes === null || !isFinite(evalRes)) {
        errors.push(`NUMERICAL answer expression "${rawExpression}" could not be safely evaluated`);
        issues.push({ code: 'MATHEMATICALLY_INVALID', message: 'Expression could not be safely evaluated', severity: 'ERROR', field: 'correct_answer_raw' });
      }
    }

    // Tolerance validation
    const tol: TolerancePolicy = question.tolerance || DEFAULT_TOLERANCE;
    if (tol.value < 0) {
      errors.push(`Negative tolerance value ${tol.value} is invalid`);
      issues.push({ code: 'INVALID_TOLERANCE', message: 'Negative tolerance is invalid', severity: 'ERROR', field: 'tolerance' });
    }

    // Delegate to verifyNumericalQuestion for comprehensive numerical contract
    const numericalQ: NumericalQuestion = {
      question_id: qId,
      type: 'NUMERICAL',
      topic: question.topic || 'General',
      difficulty: question.difficulty || 'medium',
      question: stem,
      correct_answer: isNaN(correctVal) ? 0 : correctVal,
      correct_answer_raw: String(rawExpression),
      expected_unit: question.expected_unit || null,
      tolerance: tol,
      verifiability: question.verifiability || 'PENDING',
      explanation: question.explanation || '',
    };
    const numVerif = verifyNumericalQuestion(numericalQ);
    if (!numVerif.verified) {
      errors.push(`Numerical verifier rejected: ${numVerif.rejection_reason}`);
      issues.push({ code: 'UNVERIFIABLE_NUMERICAL', message: numVerif.rejection_reason || 'Unverifiable numerical question', severity: 'ERROR' });
    }
  } else if (qType === 'MULTI_SELECT') {
    const options = question.options || [];
    let correctList: string[] = [];
    if (Array.isArray(ca)) {
      correctList = ca.map((item) => String(item).trim());
    } else if (typeof ca === 'string') {
      try {
        const parsed = JSON.parse(ca);
        if (Array.isArray(parsed)) {
          correctList = parsed.map((item) => String(item).trim());
        } else {
          correctList = ca.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
      } catch {
        correctList = ca.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    }

    if (correctList.length === 0) {
      errors.push('MULTI_SELECT correct_answer must contain at least 1 selection');
      issues.push({ code: 'MISSING_ANSWER_KEY', message: 'MULTI_SELECT correct_answer must contain at least 1 selection', severity: 'ERROR', field: 'correct_answer' });
    } else if (Array.isArray(options) && options.length >= 2) {
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
          issues.push({ code: 'CORRECT_OPTION_NOT_FOUND', message: `MULTI_SELECT correct option "${item}" does not exist in options`, severity: 'ERROR', field: 'correct_answer' });
        }
      }
    }
  } else if (qType === 'TRUE_FALSE') {
    const ans = String(ca ?? '').trim().toLowerCase();
    const validBooleans = ['true', 'false', 't', 'f', 'yes', 'no', '1', '0'];
    if (!validBooleans.includes(ans)) {
      errors.push(`TRUE_FALSE correct_answer "${ans}" is ambiguous or non-boolean`);
      issues.push({ code: 'MALFORMED_BOOLEAN', message: `Invalid boolean answer "${ans}"`, severity: 'ERROR', field: 'correct_answer' });
    }
  }

  // 6. Distractor Quality (MCQ & MULTI_SELECT)
  const distractorResult = checkDistractorQuality(question);
  if (!distractorResult.valid && (qType === 'MCQ' || qType === 'MULTI_SELECT')) {
    for (const dIssue of distractorResult.issues) {
      errors.push(dIssue);
      issues.push({ code: 'DISTRACTOR_EQUALS_CORRECT', message: dIssue, severity: 'ERROR', field: 'options' });
    }
  }

  // 6b. Semantic Topic Relevance, Tautology & Generic Boilerplate Checks
  const topicRelevanceResult = checkSemanticTopicRelevance(question, context);
  if (!topicRelevanceResult.is_relevant) {
    for (const trIssue of topicRelevanceResult.issues) {
      errors.push(trIssue);
      let issueCode: QualityIssueCode = 'GENERIC_FILLER_BOILERPLATE';
      if (trIssue.includes('Circular') || trIssue.includes('tautology')) {
        issueCode = 'CIRCULAR_DEFINITION';
      } else if (trIssue.includes('absurd') || trIssue.includes('guesswork')) {
        issueCode = 'TRIVIAL_ABSURD_DISTRACTOR';
      } else if (trIssue.includes('substance') || trIssue.includes('ratio')) {
        issueCode = 'TOPIC_RELEVANCE_FAILED';
      }
      issues.push({ code: issueCode, message: trIssue, severity: 'ERROR', field: 'question' });
    }
  }

  // 7. Ambiguity Checks
  const ambiguityResult = checkQuestionAmbiguity(question);
  if (ambiguityResult.is_ambiguous) {
    for (const ambReason of ambiguityResult.reasons) {
      if (ambiguityResult.requires_review) {
        warnings.push(`Ambiguity warning: ${ambReason}`);
        issues.push({ code: 'TOLERANCE_TOO_BROAD', message: ambReason, severity: 'WARNING' });
      } else {
        errors.push(`Ambiguity detected: ${ambReason}`);
        issues.push({ code: 'MULTIPLE_IDENTICAL_CORRECT', message: ambReason, severity: 'ERROR' });
      }
    }
  }

  // 8. Consistency Checks
  const consistencyResult = checkQuestionConsistency(question);
  if (!consistencyResult.is_consistent) {
    for (const inc of consistencyResult.inconsistencies) {
      errors.push(`Consistency error: ${inc}`);
      issues.push({ code: 'EXPLANATION_CONTRADICTS_ANSWER', message: inc, severity: 'ERROR', field: 'explanation' });
    }
  }

  // 9. Duplication & Fingerprint Checks
  let duplicateResult: DuplicateCheckResult | undefined;
  if (context?.existing_questions?.length || context?.existing_fingerprints?.length) {
    const existingList = [
      ...(context.existing_questions || []),
      ...(context.existing_fingerprints || []).map((f) => ({ fingerprint: f, question: '' })),
    ];
    duplicateResult = detectNearDuplicate(question, existingList);
    if (duplicateResult.is_duplicate) {
      errors.push(`Duplicate question detected (matched ID: ${duplicateResult.matched_question_id || 'existing'})`);
      issues.push({ code: 'DUPLICATE_QUESTION', message: 'Exact duplicate question already exists', severity: 'ERROR' });
    } else if (duplicateResult.is_near_duplicate) {
      warnings.push(`Near-duplicate detected (similarity: ${Math.round(duplicateResult.similarity * 100)}%)`);
      issues.push({ code: 'NEAR_DUPLICATE_QUESTION', message: `Near-duplicate detected (similarity ${Math.round(duplicateResult.similarity * 100)}%)`, severity: 'WARNING' });
    }
  }

  // 10. Source Grounding Verification
  let groundingResult: GroundingValidationResult | undefined;
  if (question.source_id || question.chunk_id || question.resource_id || context?.require_grounding) {
    groundingResult = await verifyQuestionGrounding(question, context);
    if (!groundingResult.grounded) {
      errors.push(`Grounding check failed (${groundingResult.status}): ${groundingResult.reason}`);
      issues.push({
        code: groundingResult.status === 'CROSS_TENANT_REJECTED'
          ? 'CROSS_TENANT_EVIDENCE'
          : groundingResult.status === 'SOURCE_UNAVAILABLE'
          ? 'SOURCE_UNAVAILABLE'
          : 'UNGROUNDED_EVIDENCE',
        message: groundingResult.reason || 'Ungrounded question',
        severity: 'ERROR',
      });
    }
  }

  // Determine Final Canonical Status
  let status: QuestionValidationStatus = 'VALID';
  if (errors.length > 0) {
    status = 'INVALID';
  } else if (warnings.length > 0 || ambiguityResult.requires_review || duplicateResult?.action === 'REVIEW_REQUIRED') {
    status = 'REVIEW_REQUIRED';
  }

  let sanitized_question: AuthoritativeQuestion | undefined;
  if (status === 'VALID' || status === 'REVIEW_REQUIRED') {
    sanitized_question = {
      question_id: qId,
      assessment_id: question.assessment_id || question.assessmentId,
      type: qType,
      topic: question.topic || 'General',
      subtopic: question.subtopic || null,
      difficulty: question.difficulty || 'medium',
      question: stem,
      correct_answer: ca,
      correct_answer_raw: String(question.correct_answer_raw ?? ca ?? ''),
      options: question.options,
      accepted_variants: question.accepted_variants || question.acceptedVariants,
      required_components: question.required_components || question.requiredComponents,
      expected_unit: question.expected_unit || question.expectedUnit,
      tolerance: question.tolerance || DEFAULT_TOLERANCE,
      verifiability: qType === 'NUMERICAL' ? 'VERIFIED' : question.verifiability || 'VERIFIED',
      source_id: question.source_id || question.sourceId,
      resource_id: question.resource_id || question.resourceId,
      chunk_id: question.chunk_id || question.chunkId,
      page_number: question.page_number ?? question.pageNumber,
      slide_number: question.slide_number ?? question.slideNumber,
      timestamp_start: question.timestamp_start ?? question.timestampStart,
      timestamp_end: question.timestamp_end ?? question.timestampEnd,
      source_type: question.source_type || question.sourceType,
      explanation: question.explanation || '',
      fingerprint: fp,
      normalized_question: computeNormalizedStem(stem),
    };
  }

  return {
    status,
    valid: status === 'VALID',
    errors,
    warnings,
    issues,
    fingerprint: fp,
    sanitized_question,
    ambiguity: ambiguityResult,
    consistency: consistencyResult,
    distractor_quality: distractorResult,
    topic_relevance: topicRelevanceResult,
    grounding: groundingResult,
    duplicate_check: duplicateResult,
  };
}

// =========================================================================
// Fail-Closed Batch Validation & Quarantine
// =========================================================================

/**
 * Validates a batch of candidate questions for an assessment.
 * Performs intra-batch deduplication, quarantines invalid items,
 * and ensures only thoroughly verified items reach students.
 */
export async function validateHardenedQuestionBatch(
  questions: any[],
  context?: QuestionValidationContext
): Promise<{
  valid_questions: any[];
  quarantined_questions: any[];
  results: HardenedQuestionValidationResult[];
}> {
  const valid_questions: any[] = [];
  const quarantined_questions: any[] = [];
  const results: HardenedQuestionValidationResult[] = [];
  const seenBatchFingerprints = new Set<string>();

  for (const q of questions) {
    const res = await validateHardenedQuestion(q, context);
    results.push(res);

    if (res.status === 'VALID') {
      // Intra-batch deduplication check
      if (seenBatchFingerprints.has(res.fingerprint)) {
        res.status = 'INVALID';
        res.valid = false;
        res.errors.push('Duplicate question within the same generated batch');
        res.issues.push({ code: 'DUPLICATE_QUESTION', message: 'Intra-batch duplicate', severity: 'ERROR' });
        quarantined_questions.push({ question: q, validation: res });
      } else {
        seenBatchFingerprints.add(res.fingerprint);
        valid_questions.push(res.sanitized_question || q);
      }
    } else {
      // Quarantined (INVALID or REVIEW_REQUIRED in strict delivery)
      quarantined_questions.push({ question: q, validation: res });
    }
  }

  const balanced_valid_questions = balanceAndRandomizeQuestionOptions(valid_questions, {
    seed: context?.seed,
  });

  return {
    valid_questions: balanced_valid_questions,
    quarantined_questions,
    results,
  };
}
