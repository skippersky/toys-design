interface AuthErrorLike {
  message: string;
}

interface AuthUserLike {
  id: string;
}

export interface AnonymousAuthApi {
  getSession: () => Promise<{
    data: { session: { user: AuthUserLike } | null };
    error: AuthErrorLike | null;
  }>;
  signInAnonymously: () => Promise<{
    data: { user: AuthUserLike | null };
    error: AuthErrorLike | null;
  }>;
}

export interface AnonymousSessionResult {
  userId: string;
  created: boolean;
}

export class AnonymousSessionError extends Error {
  constructor(
    readonly reason: "session" | "anonymous-sign-in",
    message: string,
  ) {
    super(message);
    this.name = "AnonymousSessionError";
  }
}

const ANONYMOUS_PROVIDER_GUIDANCE =
  "请确认 Supabase Dashboard → Authentication → Providers → Anonymous 已启用";

export async function ensureAnonymousSession(
  auth: AnonymousAuthApi,
): Promise<AnonymousSessionResult> {
  const sessionResult = await auth.getSession();
  if (sessionResult.error) {
    throw new AnonymousSessionError(
      "session",
      `无法读取 Supabase 登录状态：${sessionResult.error.message}`,
    );
  }

  const existingUserId = sessionResult.data.session?.user.id;
  if (existingUserId) {
    return { userId: existingUserId, created: false };
  }

  const anonymousResult = await auth.signInAnonymously();
  if (anonymousResult.error || !anonymousResult.data.user) {
    const detail = anonymousResult.error?.message ?? "Supabase 未返回匿名用户";
    throw new AnonymousSessionError(
      "anonymous-sign-in",
      `匿名登录失败：${detail}。${ANONYMOUS_PROVIDER_GUIDANCE}`,
    );
  }

  return { userId: anonymousResult.data.user.id, created: true };
}
