import { redirect } from "next/navigation";

/**
 * DEPRECATED ROUTE / SAFE TO DELETE.
 *
 * The old per-section stub route is gone under the v2 design - rotations now
 * happen directly on the Input Screen (the next section's Rotate button), with
 * order enforcement. This handler just forwards any stale /input/<id> link
 * (bookmarks, history) back to the Input Screen so nothing 404s. You can
 * delete this whole [sectionId] folder whenever convenient.
 */
export default async function LegacySectionRedirect() {
  redirect("/input");
}
