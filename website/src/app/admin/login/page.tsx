import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAdminSession } from "../../../lib/admin/server";
import { LoginForm } from "../../../components/admin/forms/login-form";
import { Skeleton } from "../../../components/admin/shared/ui";
async function Login() {
  const session = await getAdminSession();
  if (session)
    redirect(
      session.permissions.includes("dashboard:read")
        ? "/admin"
        : "/admin/shops",
    );
  return <LoginForm />;
}
export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Login />
    </Suspense>
  );
}
