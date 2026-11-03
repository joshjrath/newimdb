// Usage: npm run hash-password   (prompts)   or   node scripts/hash-password.ts "my password"
import readline from "node:readline/promises";
import { hashPassword } from "../src/lib/password.ts";

const arg = process.argv[2];
if (arg) {
  console.log(await hashPassword(arg));
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const pw = await rl.question("Owner password (min 12 chars): ");
  rl.close();
  if (pw.length < 12) {
    console.error("Use at least 12 characters.");
    process.exit(1);
  }
  console.log(`\nOWNER_PASSWORD_HASH=${await hashPassword(pw)}`);
}
