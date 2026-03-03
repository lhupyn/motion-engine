/**
 * Shared utilities for MotionEngine and FaceMirror.
 *
 * @module utils
 */

/** Prefix used for empathic mood entries in animMoods */
export const EMPATHIC_PREFIX = '_empathic_';

/** Morph keys to skip when extracting mood baselines */
export const SKIP_KEYS = new Set(['gesture', 'headMove']);

/**
 * Extract a static baseline from a motion's `vs` morph targets.
 *
 * For multi-frame arrays, picks the peak value (second element in a 3-frame
 * ramp-up/hold/ramp-down pattern, or first element for single-value arrays).
 * Skips gesture/headMove keys and non-finite values (range arrays, etc.).
 *
 * @param {object} vs - Motion `vs` object mapping morph keys to value arrays
 * @returns {object} Baseline map of morph key → numeric value
 */
export function extractBaseline(vs) {
  const baseline = {};
  if (!vs) return baseline;

  for (const [key, val] of Object.entries(vs)) {
    if (SKIP_KEYS.has(key)) continue;
    const arr = Array.isArray(val) ? val : [val];
    const picked = arr.length >= 2 ? arr[1] : arr[0];
    if (typeof picked === 'number' && isFinite(picked)) {
      baseline[key] = picked;
    }
  }

  return baseline;
}
