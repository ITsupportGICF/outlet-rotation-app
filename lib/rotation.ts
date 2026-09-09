/**
 * lib/rotation.ts
 *
 * The rotation-order rule, as PURE functions with no I/O and no "server-only"
 * import - deliberately so the exact same code can run server-side (to
 * validate a submitted rotation and to render the disabled state) and, if a
 * client component ever needs it, in the browser too. One implementation used
 * everywhere is what guarantees the UI's "what's next" and the backend's
 * accept/reject can never drift apart.
 *
 * The rule (confirmed with S):
 *  - Each active section has ONE OR MORE positions. The rotation SEQUENCE is
 *    every (section, position) pair across active sections, sorted ascending by
 *    position (section id as a stable tie-break). A section may therefore appear
 *    MORE THAN ONCE, e.g. A=1,3 · B=2 · C=4  ->  A, B, A, C.
 *  - The sequence loops continuously through the day (…A, B, A, C, A, B, A, C…).
 *  - Where the store is in the sequence is derived from how many ADVANCING
 *    presses (Standard + Override, one step each) have happened today: the Nth
 *    press lands on sequence[N mod length]. A fresh day (0 presses) starts at
 *    the first slot. Nothing is stored — it's always recomputed.
 *  - Adding / removing / deactivating a section, or changing its positions,
 *    reshapes the sequence immediately (always derived from the CURRENT set).
 *  - Applies to every Standard/Override rotation - there is no bypass. (Manual
 *    adjustments are out-of-band and never advance the sequence.)
 */

/** The minimal shape this module needs from a section. */
export type RotationSection = {
  id: string;
  /** One or more 1-based positions this section occupies in the sequence. */
  orderPositions: number[];
  isActive: boolean;
};

/**
 * The play order of active-section ids, WITH REPEATS, ascending by position
 * (section id breaks ties). E.g. A=[1,3] B=[2] C=[4] -> [A, B, A, C].
 */
export function rotationSequence<T extends RotationSection>(
  sections: T[],
): string[] {
  const slots: { pos: number; id: string }[] = [];
  for (const s of sections) {
    if (!s.isActive) continue;
    for (const pos of s.orderPositions) {
      if (Number.isFinite(pos)) slots.push({ pos, id: s.id });
    }
  }
  slots.sort((a, b) => a.pos - b.pos || a.id.localeCompare(b.id));
  return slots.map((slot) => slot.id);
}

/**
 * Count ADVANCING presses today: distinct (section, timestamp) pairs among
 * Standard + Override rows. Manual rows are excluded, and because one Standard
 * press writes several commodity rows sharing a single timestamp, we de-dupe so
 * a press counts once.
 */
export function advancingPressCount(
  rows: { sectionId: string; rotatedAt: string | null; rotationType: string }[],
): number {
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.rotationType === "Manual" || !r.rotatedAt) continue;
    seen.add(`${r.sectionId}@${r.rotatedAt}`);
  }
  return seen.size;
}

/**
 * The id of the section that must be rotated next.
 *
 * @param sections       all of the outlet's sections (active + inactive)
 * @param advancingCount how many advancing presses (Standard + Override) have
 *                       happened today
 * @returns the next section's id, or null if there are no active positions
 */
export function getNextSectionId(
  sections: RotationSection[],
  advancingCount: number,
): string | null {
  const seq = rotationSequence(sections);
  if (seq.length === 0) return null;
  const n = Math.max(0, Math.floor(advancingCount));
  return seq[n % seq.length];
}

/** Whether a specific section is the one allowed to rotate right now. */
export function isSectionRotatable(
  sections: RotationSection[],
  advancingCount: number,
  candidateSectionId: string,
): boolean {
  return getNextSectionId(sections, advancingCount) === candidateSectionId;
}
