import { execSync } from "node:child_process";
try {
  const out = execSync("pnpm exec vitest run extensions/eventbridge/src/backoff.test.ts", {
    encoding: "utf8",
    cwd: "M:\\Workspaces\\external-sw-dev\\openclaw",
  });
  console.log(out);
} catch (e) {
  console.log(e.stdout || "");
  console.error(e.stderr || "");
  process.exit(e.status);
}
