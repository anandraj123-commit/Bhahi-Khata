import { Suspense } from "react";
import { requireAdmin } from "../../../../lib/admin/server";
import { ReferralSettings } from "../../../../components/admin/forms/referral-settings";
import { Skeleton } from "../../../../components/admin/shared/ui";

async function Content() {
  await requireAdmin("referrals:manage");
  return <ReferralSettings />;
}

export default function Page() {
  return <Suspense fallback={<Skeleton />}><Content /></Suspense>;
}
