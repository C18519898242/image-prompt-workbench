import { AppShell } from "./AppShell";

/**
 * 兼容旧入口：登录后主界面已统一为 AppShell。
 */
export function WelcomeView({ token }: { token: string }) {
  return <AppShell token={token} />;
}
