interface AuthErrorLike {
  message: string;
}

interface AuthSessionLike {
  expires_at?: number;
}

export interface RefreshableAuthApi {
  getSession: () => Promise<{
    data: { session: AuthSessionLike | null };
    error: AuthErrorLike | null;
  }>;
  refreshSession: () => Promise<{
    data: { session: AuthSessionLike | null };
    error: AuthErrorLike | null;
  }>;
}

export class SessionRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionRefreshError";
  }
}

export async function refreshSessionWhenExpiring(
  auth: RefreshableAuthApi,
  minimumValiditySeconds: number,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<boolean> {
  const current = await auth.getSession();
  if (current.error || !current.data.session) {
    throw new SessionRefreshError(
      current.error?.message ?? "Supabase session is unavailable.",
    );
  }

  const expiresAt = current.data.session.expires_at;
  if (
    typeof expiresAt === "number" &&
    expiresAt - nowSeconds >= minimumValiditySeconds
  ) {
    return false;
  }

  const refreshed = await auth.refreshSession();
  if (refreshed.error || !refreshed.data.session) {
    throw new SessionRefreshError(
      refreshed.error?.message ?? "Supabase session could not be refreshed.",
    );
  }
  return true;
}
