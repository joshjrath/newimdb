import { afterEach, describe, expect, it } from "vitest";
import { authProblem, checkOwnerPassword } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

const env = process.env as Record<string, string | undefined>;
const saved = { ...env };
afterEach(() => {
  for (const k of ["NODE_ENV", "OWNER_PASSWORD", "OWNER_PASSWORD_HASH"]) env[k] = saved[k];
});

describe("owner password", () => {
  it("accepts a plain OWNER_PASSWORD in production (e.g. Railway variables)", async () => {
    env.NODE_ENV = "production";
    delete env.OWNER_PASSWORD_HASH;
    env.OWNER_PASSWORD = "a long enough password";
    expect(authProblem()).toBeNull();
    expect(await checkOwnerPassword("a long enough password")).toBe(true);
    expect(await checkOwnerPassword("wrong")).toBe(false);
  });
  it("rejects a short plain password in production, with a reason", async () => {
    env.NODE_ENV = "production";
    delete env.OWNER_PASSWORD_HASH;
    env.OWNER_PASSWORD = "short";
    expect(authProblem()).toBe("too_short");
    expect(await checkOwnerPassword("short")).toBe(false);
  });
  it("prefers the hash when both are set", async () => {
    env.NODE_ENV = "production";
    env.OWNER_PASSWORD_HASH = await hashPassword("the hashed one");
    env.OWNER_PASSWORD = "the plain one here";
    expect(await checkOwnerPassword("the hashed one")).toBe(true);
    expect(await checkOwnerPassword("the plain one here")).toBe(false);
  });
  it("reports a missing password", () => {
    delete env.OWNER_PASSWORD_HASH;
    delete env.OWNER_PASSWORD;
    expect(authProblem()).toBe("missing");
  });
});
