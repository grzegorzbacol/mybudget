/** Cookie-first auth for Edge middleware — do not block HTML on GoTrue getUser(). */

export const AUTH_GET_USER_BUDGET_MS = 400;

const AUTH_TOKEN_COOKIE = /^sb-.*-auth-token(?:\.\d+)?$/;

export type AuthGateDecision = "allow" | "redirect-login" | "redirect-budget";

export function isPublicAuthPath(pathname: string, publicPrefixes: string[]): boolean {
  return publicPrefixes.some((prefix) => pathname.startsWith(prefix));
}

export function hasSupabaseAuthCookie(cookies: Array<{ name: string }>): boolean {
  return cookies.some((cookie) => AUTH_TOKEN_COOKIE.test(cookie.name));
}

/**
 * Gate page navigations from cookies only.
 * Network getUser() belongs on API routes (Node) or a short login-page refresh.
 */
export function authGateForRequest(input: {
  pathname: string;
  hasAuthCookie: boolean;
  isPublic: boolean;
}): AuthGateDecision {
  const { pathname, hasAuthCookie, isPublic } = input;

  if (!hasAuthCookie && !isPublic && pathname !== "/") {
    return "redirect-login";
  }

  if (hasAuthCookie && (pathname === "/login" || pathname === "/register")) {
    return "redirect-budget";
  }

  return "allow";
}

export function shouldRefreshSessionForPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/register";
}

export async function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value) => value, () => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
