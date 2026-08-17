import { AlertTriangle } from "lucide-react";

interface SupabaseConfigurationErrorProps {
  componentName?: string;
}

export function SupabaseConfigurationError({
  componentName = "supabase-configuration-error",
}: SupabaseConfigurationErrorProps) {
  return (
    <main
      className="grid min-h-dvh place-items-center bg-background px-6 text-foreground"
      data-component={componentName}
      data-state="configuration-error"
    >
      <section
        className="w-full max-w-xl rounded-md border border-red-500/30 bg-zinc-950 p-6 shadow-2xl"
        role="alert"
      >
        <AlertTriangle className="mb-4 size-8 text-red-400" aria-hidden="true" />
        <h1 className="text-lg font-semibold">Supabase 配置缺失</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-300">
          缺少 Supabase 环境变量，请复制 .env.local.example 为 .env.local
          并填入真实凭据后重启开发服务器
        </p>
      </section>
    </main>
  );
}
