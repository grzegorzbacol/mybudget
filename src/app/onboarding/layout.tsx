import { Suspense } from "react";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Ładowanie...</div>}>{children}</Suspense>;
}
