import { authConfigured } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/watch/movies";
  return (
    <main className="login" id="main">
      <div style={{ display: "grid", gap: 20, width: "min(380px, 100%)" }}>
        <h1>Watch Journal</h1>
        <p style={{ color: "var(--text-muted)" }}>Private. Only the owner can sign in.</p>
        {authConfigured() ? (
          <LoginForm next={safeNext} />
        ) : (
          <div className="notice warn">
            No owner password is set on the server. Run <code>npm run hash-password</code> and put the result in{" "}
            <code>OWNER_PASSWORD_HASH</code>, then restart.
          </div>
        )}
      </div>
    </main>
  );
}
