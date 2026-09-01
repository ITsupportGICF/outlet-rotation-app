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
 *  - Active sections rotate strictly in ascending DisplayOrder:
 *    A -> B -> C -> D -> A -> ...
 *  - A fresh day (no rotations yet) always starts at the FIRST active section.
 *  - Adding/removing/deactivating a section reshapes the cycle immediately,
 *    because "what's next" is always derived from the CURRENT active set.
 *  - Applies to every rotation, Standard or Manual - there is no bypass.
 */

/** The minimal shape this module needs from a section. */
export type RotationSection = {
  id: string;
  displayOrder: number;
  isActive: boolean;
};

/** Active sections in cycle order (ascending DisplayOrder, id as tie-break). */
export function rotationCycle<T extends RotationSection>(sections: T[]): T[] {
  return sections
    .filter((s) => s.isActive)
    .slice()
    .sort(
      (a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id),
    );
}

/**
 * The id of the section that must be rotated next.
 *
 * @param sections            all of the outlet's sections (active + inactive)
 * @param lastRotatedSectionId id of the section rotated most recently today,
 *                             or null if none yet
 * @returns the next section's id, or null if there are no active sections
 */
export function getNextSectionId(
  sections: RotationSection[],
  lastRotatedSectionId: string | null,
): string | null {
  const cycle = rotationCycle(sections);
  if (cycle.length === 0) return null;

  // Fresh day, or nothing rotated yet -> start at the first active section.
  if (!lastRotatedSectionId) return cycle[0].id;

  const lastIndex = cycle.findIndex((s) => s.id === lastRotatedSectionId);

  // The last-rotated section is no longer in the active cycle (it was removed
  // or deactivated mid-cycle) -> fall back to the first active section.
  if (lastIndex === -1) return cycle[0].id;

  // Otherwise advance one step, wrapping around at the end.
  return cycle[(lastIndex + 1) % cycle.length].id;
}

/** Whether a specific section is the one allowed to rotate right now. */
export function isSectionRotatable(
  sections: RotationSection[],
  lastRotatedSectionId: string | null,
  candidateSectionId: string,
): boolean {
  return (
    getNextSectionId(sections, lastRotatedSectionId) === candidateSectionId
  );
}
