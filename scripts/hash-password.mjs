// Usage: npm run hash-password   (prompts)   or   node scripts/hash-password.mjs "my password"
import crypto from "node:crypto";
import readline from "node:readline";

function hash(password) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const key = crypto.scryptSync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

const arg = process.argv[2];
if (arg) {
  console.log(hash(arg));
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("Owner password (min 12 chars): ", (pw) => {
    rl.close();
    if (pw.length < 12) {
      console.error("Use at least 12 characters.");
      process.exit(1);
    }
    console.log(`\nOWNER_PASSWORD_HASH=${hash(pw)}`);
  });
}
