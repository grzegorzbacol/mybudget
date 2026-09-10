import { AppShell } from "@/components/AppShell";

/** No force-dynamic: the shell does not read cookies. Middleware gates auth; /api/* loads data. */

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
