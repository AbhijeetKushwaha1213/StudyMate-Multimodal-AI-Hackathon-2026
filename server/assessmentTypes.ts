/**
 * Canonical Phase 4 — Assessment Data Contracts
 * 
 * Defines server-authoritative types for:
 * 1. NumericalQuestion: Generated numerical questions with verifiability metadata
 * 2. NumericalAnswer: Student answer submission with raw value preservation
 * 3. NumericalGradingResult: Deterministic grading output with tolerance and unit handling
 * 4. TolerancePolicy: Configurable tolerance bands for numerical answer verification
 * 5. UnitNormalization: Canonical unit equivalence mapping
 * 6. VerifiabilityStatus: Whether a generated question passes server-side independent verification
 *
 * ZERO-TRUST BOUNDARY:
 * - The LLM must NEVER sit in the critical grading path.
 * - All numerical grading is deterministic, server-authoritative.
 * - No eval(), Function(), or dynamic code execution.
 * - If a generated question cannot be independently verified → reject it.
 */

import type { SourceType, ExtractionMethod } from './ingestionTypes.ts';

// =========================================================================
// Tolerance Policies
// =========================================================================

/**
 * Tolerance mode for numerical answer verification.
 * - EXACT: Must match within floating-point epsilon (1e-9)
 * - RELATIVE: Within a percentage of the correct answer (default 3%)
 * - ABSOLUTE: Within a fixed absolute difference
 * - SIGNIFICANT_FIGURES: Correct to N significant figures
 */
export type ToleranceMode = 'EXACT' | 'RELATIVE' | 'ABSOLUTE' | 'SIGNIFICANT_FIGURES';

export interface TolerancePolicy {
  mode: ToleranceMode;
  /** For RELATIVE: fraction (e.g. 0.03 = 3%). For ABSOLUTE: max absolute diff. For SIG_FIGS: number of sig figs. */
  value: number;
  /** Secondary absolute floor to prevent zero-crossing issues with relative tolerance */
  absoluteFloor?: number;
}

/** Default tolerance: 3% relative with 0.01 absolute floor */
export const DEFAULT_TOLERANCE: TolerancePolicy = {
  mode: 'RELATIVE',
  value: 0.03,
  absoluteFloor: 0.01,
};

/** Partial-credit tolerance: 10% relative with 0.05 absolute floor */
export const PARTIAL_TOLERANCE: TolerancePolicy = {
  mode: 'RELATIVE',
  value: 0.10,
  absoluteFloor: 0.05,
};

// =========================================================================
// Unit Normalization
// =========================================================================

/**
 * Canonical unit equivalence groups. Each group maps variant spellings/symbols
 * to a canonical unit name. Used for pre-grading normalization.
 */
export interface UnitEquivalence {
  canonical: string;
  variants: string[];
}

export const UNIT_EQUIVALENCES: UnitEquivalence[] = [
  { canonical: 'kg', variants: ['kilogram', 'kilograms', 'kgs', 'kg.'] },
  { canonical: 'g', variants: ['gram', 'grams', 'gm', 'gms'] },
  { canonical: 'm', variants: ['meter', 'meters', 'metre', 'metres'] },
  { canonical: 'cm', variants: ['centimeter', 'centimeters', 'centimetre', 'centimetres'] },
  { canonical: 'mm', variants: ['millimeter', 'millimeters', 'millimetre', 'millimetres'] },
  { canonical: 'km', variants: ['kilometer', 'kilometers', 'kilometre', 'kilometres'] },
  { canonical: 's', variants: ['sec', 'secs', 'second', 'seconds'] },
  { canonical: 'ms', variants: ['millisecond', 'milliseconds', 'msec', 'msecs'] },
  { canonical: 'min', variants: ['minute', 'minutes', 'mins'] },
  { canonical: 'hr', variants: ['hour', 'hours', 'hrs', 'h'] },
  { canonical: 'J', variants: ['joule', 'joules'] },
  { canonical: 'kJ', variants: ['kilojoule', 'kilojoules'] },
  { canonical: 'W', variants: ['watt', 'watts'] },
  { canonical: 'kW', variants: ['kilowatt', 'kilowatts'] },
  { canonical: 'V', variants: ['volt', 'volts'] },
  { canonical: 'A', variants: ['amp', 'amps', 'ampere', 'amperes'] },
  { canonical: 'Ω', variants: ['ohm', 'ohms', 'omega'] },
  { canonical: 'Hz', variants: ['hertz'] },
  { canonical: 'N', variants: ['newton', 'newtons'] },
  { canonical: 'Pa', variants: ['pascal', 'pascals'] },
  { canonical: 'mol', variants: ['mole', 'moles'] },
  { canonical: 'L', variants: ['liter', 'liters', 'litre', 'litres'] },
  { canonical: 'mL', variants: ['milliliter', 'milliliters', 'millilitre', 'millilitres'] },
  { canonical: '%', variants: ['percent', 'percentage', 'pct'] },
  { canonical: '°C', variants: ['celsius', 'degrees celsius', 'deg c', '°c', 'degc'] },
  { canonical: '°F', variants: ['fahrenheit', 'degrees fahrenheit', 'deg f', '°f', 'degf'] },
  { canonical: 'K', variants: ['kelvin'] },
  { canonical: 'rad', variants: ['radian', 'radians'] },
  { canonical: '°', variants: ['degree', 'degrees', 'deg'] },
  { canonical: 'bit', variants: ['bits'] },
  { canonical: 'byte', variants: ['bytes', 'B'] },
  { canonical: 'KB', variants: ['kilobyte', 'kilobytes', 'kbyte'] },
  { canonical: 'MB', variants: ['megabyte', 'megabytes', 'mbyte'] },
  { canonical: 'GB', variants: ['gigabyte', 'gigabytes', 'gbyte'] },
];

// =========================================================================
// Verifiability Status
// =========================================================================

/**
 * Whether a generated numerical question has been independently verified
 * by the server-side verifier before being presented to a student.
 */
export type VerifiabilityStatus =
  | 'VERIFIED'         // Answer independently verified by server computation
  | 'SELF_CONSISTENT'  // Answer matches a restated/extracted value from source
  | 'REJECTED'         // Could not verify — question suppressed
  | 'PENDING';         // Not yet verified

// =========================================================================
// Numerical Question
// =========================================================================

export interface NumericalQuestion {
  question_id: string;
  assessment_id?: string;
  type: 'NUMERICAL';
  topic: string;
  subtopic?: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  
  // Source provenance (from Phase 2 ingestion)
  source_id?: string | null;
  chunk_id?: string | null;
  page_number?: number | null;
  slide_number?: number | null;
  timestamp_start?: number | null;
  timestamp_end?: number | null;
  
  // Question content
  question: string;
  correct_answer: number;
  correct_answer_raw: string;     // Original string form before parsing
  expected_unit?: string | null;  // Canonical unit (e.g. 'kg', 'm/s')
  
  // Verification metadata
  tolerance: TolerancePolicy;
  verifiability: VerifiabilityStatus;
  verification_method?: string;   // How it was verified (e.g. 'source_extraction', 'formula_recomputation')
  
  // Explanation and fingerprinting
  explanation: string;
  fingerprint?: string;
  normalized_question?: string;
}

// =========================================================================
// Numerical Answer Submission
// =========================================================================

export interface NumericalAnswerSubmission {
  question_id: string;
  raw_answer: string;       // Exact student input as typed
  parsed_value?: number;    // Server-parsed numeric value
  parsed_unit?: string;     // Server-parsed unit
}

// =========================================================================
// Numerical Grading Result
// =========================================================================

export type NumericalGradeClassification = 'correct' | 'partially_correct' | 'incorrect' | 'invalid_format';

export interface NumericalGradingResult {
  question_id: string;
  classification: NumericalGradeClassification;
  credit: number;  // 1.0, 0.5, 0.0
  
  // Values
  student_value: number | null;
  correct_value: number;
  absolute_error: number | null;
  relative_error: number | null;
  
  // Unit handling
  student_unit: string | null;
  expected_unit: string | null;
  unit_match: boolean;
  
  // Tolerance
  tolerance_applied: TolerancePolicy;
  within_tolerance: boolean;
  within_partial_tolerance: boolean;
  
  // Sign error detection
  is_sign_error: boolean;
  is_magnitude_error: boolean;
  is_order_of_magnitude_error: boolean;
  
  // Feedback
  feedback: string;
  error_category?: 'SIGN_ERROR' | 'ROUNDING_ERROR' | 'ORDER_OF_MAGNITUDE' | 'UNIT_MISMATCH' | 'FORMULA_ERROR' | 'PARSE_ERROR' | 'NONE';
}

// =========================================================================
// Safe Expression Evaluation Types
// =========================================================================

/**
 * Parsed numeric expression token for the safe evaluator.
 * Only supports: numbers, +, -, *, /, ^, (, ), unary minus.
 * NO function calls, NO variable lookups, NO dynamic code.
 */
export type TokenType =
  | 'NUMBER'
  | 'PLUS'
  | 'MINUS'
  | 'MULTIPLY'
  | 'DIVIDE'
  | 'POWER'
  | 'LPAREN'
  | 'RPAREN'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: number | null;
}

// =========================================================================
// Canonical Phase 4 — Step 2: Universal Assessment & Misconception Types
// =========================================================================

/**
 * Question types supported across Ming's assessment pipeline.
 */
export type SupportedQuestionType =
  | 'NUMERICAL'
  | 'MCQ'
  | 'SHORT_ANSWER'
  | 'TRUE_FALSE'
  | 'MULTI_SELECT';

/**
 * Deterministic error and misconception categories.
 * Assigned ONLY when deterministically supported by evidence or question metadata.
 * If uncertain, defaults to 'UNDETERMINED'.
 */
export type MisconceptionCategory =
  | 'SIGN_ERROR'                   // Wrong sign (+ instead of -)
  | 'ROUNDING_ERROR'               // Precision / rounding discrepancy
  | 'ORDER_OF_MAGNITUDE'           // Factor of 10/100/1000 off
  | 'UNIT_MISMATCH'                // Value correct or near-correct, unit incorrect
  | 'FORMULA_ERROR'                // Determinable wrong arithmetic/formula branch
  | 'PARSE_ERROR'                  // Malformed / unparseable student input
  | 'WRONG_OPTION'                 // Chose an incorrect MCQ distractor without specific metadata
  | 'INVALID_OPTION'               // Chose an option ID or text not in the question's option universe
  | 'MISSING_REQUIRED_COMPONENT'   // Omitted a required token, keyword, or multi-select option
  | 'EXTRA_COMPONENT'              // Included an extraneous/incorrect option or contradictory token
  | 'CONCEPTUAL_MISMATCH'          // Confused distinct domain concepts
  | 'INCOMPLETE_ANSWER'            // Empty or near-empty submission
  | 'UNVERIFIABLE'                 // Semantic answer cannot be reliably verified
  | 'NO_MISCONCEPTION'             // Correct answer
  | 'UNDETERMINED';                // Cannot definitively ascertain cause of error

/**
 * Distractor pedagogical metadata optionally attached to MCQ options.
 */
export interface DistractorMetadata {
  optionText: string;
  misconceptionCategory?: MisconceptionCategory;
  misconceptionLabel?: string;
  rationale?: string;
}

/**
 * Structured option definition for MCQ / MULTI_SELECT.
 */
export interface QuestionOptionItem {
  id?: string;
  text: string;
  distractorMetadata?: DistractorMetadata;
}

/**
 * Server-authoritative assessment question model.
 * Contains ground truth; client payloads are never allowed to override these fields.
 */
export interface AuthoritativeQuestion {
  question_id: string;
  assessment_id?: string;
  type: SupportedQuestionType;
  topic: string;
  subtopic?: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  
  // Authoritative Answer Data (Server-Only)
  correct_answer: any;
  correct_answer_raw?: string;
  options?: Array<string | QuestionOptionItem>;
  accepted_variants?: string[];      // For SHORT_ANSWER: acceptable variant strings
  required_components?: string[];    // For SHORT_ANSWER / MULTI_SELECT: required tokens/items
  
  // Numerical fields
  expected_unit?: string | null;
  tolerance?: TolerancePolicy;
  verifiability?: VerifiabilityStatus;
  
  // Provenance & Source coordinates
  source_id?: string | null;
  resource_id?: string | null;
  chunk_id?: string | null;
  page_number?: number | null;
  slide_number?: number | null;
  timestamp_start?: number | null;
  timestamp_end?: number | null;
  source_type?: string;
  
  // Explanations & Balancing
  explanation?: string;
  fingerprint?: string;
  normalized_question?: string;
  options_balanced?: boolean;
  correct_answer_index?: number;
}

/**
 * Student answer submission contract.
 * Contains ONLY student-provided inputs. No answer keys, tolerances, or scores.
 */
export interface AnswerSubmissionPayload {
  question_id: string;
  raw_answer: any; // string, number, string[], or boolean
}

/**
 * Complete deterministic grading output for any supported question type.
 */
export interface UniversalGradingResult {
  question_id: string;
  question_type: SupportedQuestionType;
  classification: 'correct' | 'partially_correct' | 'incorrect' | 'invalid_format' | 'unverifiable';
  credit: number; // Strictly bounded [0.0, 1.0]
  is_correct: boolean;
  is_partial: boolean;
  
  // Error & Misconception
  error_category: MisconceptionCategory;
  misconception_description?: string;
  
  // Explanatory feedback (purely pedagogical, cannot alter grade)
  feedback: string;
  explanation: string;
  
  // Provenance & Grounding
  source_citation?: string;
  citation_label?: string;
  location?: {
    source_id?: string | null;
    resource_id?: string | null;
    chunk_id?: string | null;
    page_number?: number | null;
    slide_number?: number | null;
    timestamp_start?: number | null;
    timestamp_end?: number | null;
    source_type?: string;
  };
  grounded_citation?: any;
  
  // Zero-trust raw echo
  raw_student_answer: any;
  normalized_student_answer?: any;
}

/**
 * Validation result for assessment question integrity prior to delivery.
 */
export interface QuestionValidationResult {
  valid: boolean;
  errors: string[];
  sanitized_question?: AuthoritativeQuestion;
}

/**
 * Student-facing sanitized result (excludes internal keys, prompts, or tenant secrets).
 */
export interface StudentFacingResult {
  question_id: string;
  question_type: SupportedQuestionType;
  classification: 'correct' | 'partially_correct' | 'incorrect' | 'invalid_format' | 'unverifiable';
  credit: number;
  is_correct: boolean;
  is_partial: boolean;
  error_category: MisconceptionCategory;
  feedback: string;
  explanation: string;
  citation_label?: string;
  location?: UniversalGradingResult['location'];
}

// =========================================================================
// Canonical Phase 4 — Step 3: Hardened Question Quality & Ambiguity Contracts
// =========================================================================

/**
 * Three-state canonical validation verdict:
 * - VALID: Passes all structural, type, ambiguity, grounding, and consistency checks.
 * - INVALID: Hard error (missing stem, contradictory answer key, prompt leakage, etc.) -> quarantined.
 * - REVIEW_REQUIRED: Question has soft ambiguity, near-duplicate, or low-confidence issue needing review.
 */
export type QuestionValidationStatus = 'VALID' | 'INVALID' | 'REVIEW_REQUIRED';

export type QualityIssueCode =
  | 'MISSING_STEM'
  | 'STEM_TOO_SHORT'
  | 'UNSUPPORTED_TYPE'
  | 'MISSING_ANSWER_KEY'
  | 'TYPE_ANSWER_MISMATCH'
  | 'PROMPT_LEAKAGE'
  | 'INSUFFICIENT_OPTIONS'
  | 'DUPLICATE_OPTION_ID'
  | 'DUPLICATE_OPTION_TEXT'
  | 'EMPTY_OPTION_TEXT'
  | 'CORRECT_OPTION_NOT_FOUND'
  | 'MULTIPLE_IDENTICAL_CORRECT'
  | 'DISTRACTOR_EQUALS_CORRECT'
  | 'EMPTY_DISTRACTOR'
  | 'MALFORMED_BOOLEAN'
  | 'NON_FINITE_NUMERICAL'
  | 'INVALID_TOLERANCE'
  | 'TOLERANCE_TOO_BROAD'
  | 'MATHEMATICALLY_INVALID'
  | 'EMPTY_SHORT_ANSWER'
  | 'CONTRADICTORY_COMPONENTS'
  | 'EXPLANATION_CONTRADICTS_ANSWER'
  | 'NUMERICAL_EXPLANATION_MISMATCH'
  | 'UNGROUNDED_EVIDENCE'
  | 'CROSS_TENANT_EVIDENCE'
  | 'SOURCE_UNAVAILABLE'
  | 'COORDINATE_MISMATCH'
  | 'DUPLICATE_QUESTION'
  | 'NEAR_DUPLICATE_QUESTION'
  | 'UNVERIFIABLE_NUMERICAL'
  | 'MALFORMED_METADATA'
  | 'CIRCULAR_DEFINITION'
  | 'GENERIC_FILLER_BOILERPLATE'
  | 'TRIVIAL_ABSURD_DISTRACTOR'
  | 'TOPIC_RELEVANCE_FAILED';

export interface QuestionQualityIssue {
  code: QualityIssueCode | string;
  message: string;
  severity: 'ERROR' | 'WARNING';
  field?: string;
}

export interface AmbiguityCheckResult {
  is_ambiguous: boolean;
  requires_review: boolean;
  reasons: string[];
}

export interface ConsistencyCheckResult {
  is_consistent: boolean;
  inconsistencies: string[];
}

export interface DistractorQualityResult {
  valid: boolean;
  issues: string[];
}

export interface TopicRelevanceCheckResult {
  is_relevant: boolean;
  issues: string[];
  substantive_ratio: number;
  detected_boilerplate?: string[];
}

export interface GroundingValidationResult {
  grounded: boolean;
  status: 'VERIFIED' | 'UNGROUNDED' | 'SOURCE_UNAVAILABLE' | 'CROSS_TENANT_REJECTED';
  reason?: string;
  citation?: any;
}

export interface DuplicateCheckResult {
  is_duplicate: boolean;
  is_near_duplicate: boolean;
  fingerprint: string;
  similarity: number;
  matched_question_id?: string;
  action: 'ALLOW' | 'REJECT' | 'REVIEW_REQUIRED';
}

export interface HardenedQuestionValidationResult {
  status: QuestionValidationStatus;
  valid: boolean; // true ONLY if status === 'VALID'
  errors: string[];
  warnings: string[];
  issues: QuestionQualityIssue[];
  fingerprint: string;
  sanitized_question?: AuthoritativeQuestion;
  ambiguity: AmbiguityCheckResult;
  consistency: ConsistencyCheckResult;
  distractor_quality: DistractorQualityResult;
  topic_relevance?: TopicRelevanceCheckResult;
  grounding?: GroundingValidationResult;
  duplicate_check?: DuplicateCheckResult;
}

export interface QuestionValidationContext {
  authenticated_user_id?: string;
  require_grounding?: boolean;
  existing_questions?: any[];
  existing_fingerprints?: string[];
  evidence_index?: any;
  resource_checker?: (resourceId: string) => Promise<{ exists: boolean; isDeleted: boolean; userId: string; tenantType?: string } | null>;
  subject?: string;
  topic?: string;
  subtopic?: string;
  seed?: number | string;
}


