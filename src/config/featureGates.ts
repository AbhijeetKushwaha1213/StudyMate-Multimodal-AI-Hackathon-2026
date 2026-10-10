/**
 * Ming — Feature Gate Configuration
 *
 * TEMPORARY HACKATHON FEATURE GATE: Exam Preparation Mode
 *
 * Objective:
 * College Mode is the primary, production-ready experience for the Multimodal AI
 * Hackathon 2026 demo and evaluation.
 *
 * Exam Preparation Mode is an existing, partially developed experience that must
 * be preserved in the codebase but temporarily made inaccessible to users until
 * the hackathon evaluation is complete.
 *
 * When Exam Mode is fully developed and ready for public release:
 * set IS_EXAM_MODE_GATED to false.
 */

export const IS_EXAM_MODE_GATED = true;

/**
 * Returns true if Exam Preparation Mode is currently enabled for users.
 */
export function isExamModeSupported(): boolean {
  return !IS_EXAM_MODE_GATED;
}

export const SUPPORTED_STUDY_MODES = ['college'] as const;
export type SupportedStudyMode = typeof SUPPORTED_STUDY_MODES[number];
