import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { getMaintenanceView } from "@/lib/auth/maintenance";
import { maintenanceMessage } from "@/lib/maintenance-message";
import MaintenanceScreen from "@/app/_components/MaintenanceScreen";

/**
 * The dedicated maintenance route.
 *
 * Requires sign-in, and anyone who ISN'T blocked (maintenance is off, or they
 * are IT) is sent straight into the app — so nobody can get stuck here by
 * bookmarking it.
 */
export default async function MaintenancePage() {
  const session = await getSession();
  if (!session) redirect("/auth/signin");

  const view = await getMaintenanceView();
  if (!view.blocked) redirect("/home");

  return <MaintenanceScreen message={maintenanceMessage(view.state.returnAt)} />;
}
