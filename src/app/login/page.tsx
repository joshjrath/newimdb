import { authConfigured } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/watch/movies";
  return (
    <main className="login" id="main">
      <div className="stack login-box">
        <div className="mark">
          Specular<small>Watch · private</small>
        </div>
        <p className="muted">Only the owner can sign in.</p>
        {authConfigured() ? (
          <LoginForm next={safeNext} />
        ) : (
          <div className="notice warn">
            {process.env.NODE_ENV !== "production" ? (
              <>
                The server didn&apos;t find a password. Put <code>OWNER_PASSWORD=your-password</code> in a file called{" "}
                <code>.env.local</code> in the project folder, saved as plain UTF-8 text, then stop and restart <code>npm run dev</code>.
              </>
            ) : (
              <>
                The server didn&apos;t find a password. A production build ignores <code>OWNER_PASSWORD</code>: run{" "}
                <code>npm run hash-password</code>, put the line it prints in your environment, then restart.
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
