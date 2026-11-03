import { authConfigured } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/watch/movies";
  return (
    <main className="login" id="main">
      <div className="stack login-box">
        <h1>Watch Journal</h1>
        <p className="muted">Private. Only the owner can sign in.</p>
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
