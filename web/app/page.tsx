import DashboardClient from "@/components/DashboardClient";
import { getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <DashboardClient initialSnapshot={getSnapshot()} />;
}
