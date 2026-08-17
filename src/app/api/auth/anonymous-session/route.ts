import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const ANONYMOUS_PROVIDER_GUIDANCE =
  "请确认 Supabase Dashboard → Authentication → Providers → Anonymous 已启用";

export async function POST() {
  const supabase = await createClient();
  const currentUser = await supabase.auth.getUser();

  if (currentUser.data.user) {
    return NextResponse.json({
      userId: currentUser.data.user.id,
      created: false,
    });
  }

  const anonymousUser = await supabase.auth.signInAnonymously();
  if (anonymousUser.error || !anonymousUser.data.user) {
    const detail =
      anonymousUser.error?.message ??
      currentUser.error?.message ??
      "Supabase 未返回匿名用户";
    return NextResponse.json(
      {
        code: "ANONYMOUS_SIGN_IN_FAILED",
        message: `匿名登录失败：${detail}。${ANONYMOUS_PROVIDER_GUIDANCE}`,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    userId: anonymousUser.data.user.id,
    created: true,
  });
}
