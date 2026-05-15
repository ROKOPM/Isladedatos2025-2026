/**
 * Global Governance Rules
 * Enforces strict scientific guardrails against visual overload and data misinterpretation.
 */

export const GOVERNANCE_RULES = {
  // Rendering Limits
  MAX_COMPARISON_PERIODS: 2,
  MAX_VISIBLE_SERIES: 6,
  
  // Temporal Limits
  MAX_INITIAL_DAYS: 15,
  MAX_ALLOWED_RANGE_DAYS: 90,
  DEFAULT_TIME_WINDOW: ['08:00', '20:00'] as [string, string],
  
  // Statistical Limits
  MIN_SAMPLE_SIZE: 5, // Minimum observations required for robust inference
  
  // Warnings
  WARNING_LOW_SAMPLE: "Muestra estadísticamente insuficiente para inferencia robusta.",
  WARNING_TOO_MANY_SERIES: "Demasiadas series activas. El exceso de información degrada la interpretabilidad.",
  WARNING_LARGE_RANGE: "Rango temporal extenso. El motor aplicará compresión adaptativa.",
  
  // Scientific Philosophy
  CAUSALITY_DISCLAIMER: "La evidencia es estrictamente correlacional y no implica causalidad."
}
