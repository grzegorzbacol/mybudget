import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_GET_USER_BUDGET_MS,
  authGateForRequest,
  hasSupabaseAuthCookie,
  raceTimeout,
  shouldRefreshSessionForPath,
} from "@/lib/auth-gate";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";
import { safeInternalPath } from "@/lib/paths";

const publicRoutes = ["/login", "/register", "/auth/callback", "/api/setup"];

function redirectTo(request: NextRequest, pathname: string, next?: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (next) url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const started = Date.now();
  let supabaseResponse = NextResponse.next({ request });
  const { pathname } = request.nextUrl;
  const isPublic = publicRoutes.some((r) => pathname.startsWith(r));

  if (!isSupabaseConfigured()) {
    if (!isPublic && pathname !== "/") {
      return redirectTo(
        request,
        "/login",
        safeInternalPath(`${pathname}${request.nextUrl.search}`)
      );
    }
    return supabaseResponse;
  }

  const hasAuthCookie = hasSupabaseAuthCookie(request.cookies.getAll());
  const gate = authGateForRequest({ pathname, hasAuthCookie, isPublic });

  // Protected HTML used to await supabase.auth.getUser() (Edge → Kong/GoTrue).
  // Live: that call is ~11–13s on cold /budget while /api/* (matcher-excluded) is ~0.6s.
  // Cookie presence is enough to serve the static app shell; APIs still call getUser().
  if (gate === "redirect-login") {
    const response = redirectTo(
      request,
      "/login",
      safeInternalPath(`${pathname}${request.nextUrl.search}`)
    );
    response.headers.set("Server-Timing", `mw;desc="anon";dur=${Date.now() - started}`);
    return response;
  }

  if (gate === "redirect-budget" && shouldRefreshSessionForPath(pathname)) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });
    const result = await raceTimeout(supabase.auth.getUser(), AUTH_GET_USER_BUDGET_MS);
    const user = result?.data.user;
    if (user) {
      const response = redirectTo(request, "/budget");
      response.headers.set("Server-Timing", `mw;desc="login-refresh";dur=${Date.now() - started}`);
      return response;
    }
    supabaseResponse.headers.set(
      "Server-Timing",
      `mw;desc="login-stale";dur=${Date.now() - started}`
    );
    return supabaseResponse;
  }

  supabaseResponse.headers.set(
    "Server-Timing",
    `mw;desc="${hasAuthCookie ? "cookie" : "public"}";dur=${Date.now() - started}`
  );
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|workbox|api/).*)",
  ],
};
