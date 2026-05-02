/**
 * Effort classification for a clip request.
 *
 * Set by staff during review or production planning.
 * Used to influence queue priority, due date estimation, and capacity planning.
 *
 * Business rules:
 * - Simple:   Minimal editing — basic cuts, captions, one template.
 * - Standard: Normal editing — transitions, text overlays, basic effects.
 * - Complex:  Heavy editing — advanced effects, multi-source composition, custom motion.
 *
 * TODO: PostgreSQL — store as TEXT with CHECK constraint on allowed values.
 *   Map to `effort_class` column on `clip_requests` table.
 */
export enum EffortClass {
  Simple = "simple",
  Standard = "standard",
  Complex = "complex",
}

/** Human-readable labels for effort classes. */
export const EFFORT_CLASS_LABELS: Record<EffortClass, string> = {
  [EffortClass.Simple]: "Simple",
  [EffortClass.Standard]: "Standard",
  [EffortClass.Complex]: "Complex",
};

/** Estimated business days to complete per effort class.
 *  Used for system due-date estimation alongside queue depth.
 *  Staff may override at confirmation time.
 */
export const EFFORT_CLASS_DAYS: Record<EffortClass, number> = {
  [EffortClass.Simple]: 1,
  [EffortClass.Standard]: 2,
  [EffortClass.Complex]: 3,
};
