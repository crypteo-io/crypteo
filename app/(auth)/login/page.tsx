import { AuthCardSkeleton, AuthScreen } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/LoginForm";
import { isAdminHost } from "@/lib/admin-host";
import { headers } from "next/headers";
import { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Suspense } from "react";

export const metadata: Metadata = pageMetadata({
  title: "Log In",
  description:
    "Sign in to your Crypteo dashboard to manage your payments, view analytics, and configure your blockchain wallet settings securely.",
  path: "/login",
  index: false,
});

export default async function LoginPage() {
  const admin = isAdminHost((await headers()).get("host"));
  return (
    <AuthScreen homeLink={!admin}>
      <Suspense fallback={<AuthCardSkeleton />}>
        <LoginForm admin={admin} />
      </Suspense>
    </AuthScreen>
  );
}
