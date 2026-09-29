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
 *    presses (one step each) have happened today: the Nth press lands on
 *    sequence[N mod length]. A fresh day (0 presses) starts at the first slot.
 *    Nothing is stored — it's always recomputed.
 *  - Adding / removing / deactivating a section, or changing its positions,
 *    reshapes the sequence immediately (always derived from the CURRENT set).
 *  - EVERY press advances: Standard (Input Screen), Override (a deliberate
 *    skip) and Manual (the Admin Center recording a rotation after the fact).
 *    All three are order-enforced at their entry point, so the count-based
 *    pointer below always matches what actually happened on the floor — there
 *    is no bypass anywhere.
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
 * Count ADVANCING presses today: distinct (section, timestamp) pairs across
 * ALL rotation rows — Standard, Override and Manual alike. Each is a real,
 * order-enforced step through the sequence. Because one press writes several
 * commodity rows sharing a single timestamp, we de-dupe so a press counts once.
 */
export function advancingPressCount(
  rows: { sectionId: string; rotatedAt: string | null; rotationType: string }[],
): number {
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.rotatedAt) continue;
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

/* ------------------------------------------------------------------------- */
/* Undo of the most recent press                                             */
/*                                                                           */
/* A "press" is every RotationHistory row sharing one (section, RotatedAt).   */
/* Because EVERY dashboard figure is derived from those rows — the order      */
/* pointer, section freshness, the day's totals and commodity goals — undoing */
/* a press is simply removing its rows: all derived state reverts on its own  */
/* and no read path has to know undo exists.                                  */
/*                                                                           */
/* These helpers are pure so the same rule decides what the button shows and  */
/* what the server will actually allow. The server ALWAYS re-checks with      */
/* isUndoable() before deleting anything — the countdown in the browser is    */
/* only a courtesy and is never trusted.                                      */
/* ------------------------------------------------------------------------- */

/** How long after a rotation it may still be undone. */
export const UNDO_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

/** The minimal shape the undo helpers need from a RotationHistory row. */
export type PressRow = {
  id: string;
  sectionId: string;
  quantity: number;
  rotationType: string;
  rotatedAt: string | null;
};

/** One identified press, and exactly which rows make it up. */
export type RotationPress = {
  sectionId: string;
  /** The press's own stored timestamp — the 2-minute window is measured from
   *  this, never from when a page was opened or refreshed. */
  rotatedAt: string;
  rotationType: string;
  /** The SharePoint item ids belonging to this press, and only this press. */
  rowIds: string[];
  totalQuantity: number;
};

/**
 * The most recent press of the day, or null when nothing has been recorded.
 *
 * Rows without a timestamp can't be placed in time and are ignored. If two
 * sections somehow share the exact same timestamp, one is chosen
 * deterministically so the same press is identified on every call.
 */
export function lastPress(rows: PressRow[]): RotationPress | null {
  let latest: string | null = null;
  for (const r of rows) {
    if (r.rotatedAt && (latest === null || r.rotatedAt > latest)) latest = r.rotatedAt;
  }
  if (latest === null) return null;

  const atSameTime = rows.filter((r) => r.rotatedAt === latest);
  const sectionId = [...atSameTime.map((r) => r.sectionId)].sort()[0];
  const press = atSameTime.filter((r) => r.sectionId === sectionId);
  if (press.length === 0) return null;

  return {
    sectionId,
    rotatedAt: latest,
    rotationType: press[0].rotationType,
    rowIds: press.map((r) => r.id),
    totalQuantity: press.reduce((sum, r) => sum + (r.quantity || 0), 0),
  };
}

/** The instant (ms since epoch) at which this press stops being undoable. */
export function undoExpiresAt(press: RotationPress): number {
  return Date.parse(press.rotatedAt) + UNDO_WINDOW_MS;
}

/**
 * Whether this press may still be undone. Measured from the press's own
 * stored timestamp, so refreshing the page or navigating away and back cannot
 * extend it.
 */
export function isUndoable(press: RotationPress, now: Date = new Date()): boolean {
  const at = Date.parse(press.rotatedAt);
  if (Number.isNaN(at)) return false;
  return now.getTime() < at + UNDO_WINDOW_MS;
}
