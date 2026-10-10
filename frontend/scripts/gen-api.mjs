// Generates lib/api-schema.d.ts from the backend OpenAPI document.
import { spawnSync } from "node:child_process";

const base = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";
const r = spawnSync("npx", ["openapi-typescript", `${base}/openapi.json`, "-o", "lib/api-schema.d.ts"], {
  stdio: "inherit",
  shell: true,
});
process.exit(r.status ?? 1);
