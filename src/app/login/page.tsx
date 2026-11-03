import { authConfigured, authProblem, MIN_PRODUCTION_PASSWORD } from "@/lib/auth";
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
            {authProblem() === "too_short" ? (
              <>
                The password in <code>OWNER_PASSWORD</code> is too short for a live site. Use at least {MIN_PRODUCTION_PASSWORD} characters, then redeploy.
              </>
            ) : process.env.NODE_ENV !== "production" ? (
              <>
                The server didn&apos;t find a password. Put <code>OWNER_PASSWORD=your-password</code> in a file called{" "}
                <code>.env.local</code> in the project folder, saved as plain UTF-8 text, then stop and restart <code>npm run dev</code>.
              </>
            ) : (
              <>
                The server didn&apos;t find a password. Add a variable called <code>OWNER_PASSWORD</code> (at least {MIN_PRODUCTION_PASSWORD} characters) in your
                host&apos;s settings (on Railway: your service → Variables), then redeploy.
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
