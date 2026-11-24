import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

function loadEnvFromWorkspace(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env.local"),
    path.resolve(process.cwd(), "../../.env"),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

loadEnvFromWorkspace();

const databaseUrl = (process.env.DATABASE_URL || "").trim();
if (!databaseUrl || databaseUrl.includes("ep-example.us-east-2.aws.neon.tech")) {
  throw new Error(
    "\n[ZGuard DB] DATABASE_URL belum diisi dengan URL Neon Postgres asli di file .env.\n" +
      "- Untuk development lokal TANPA Neon, Anda TIDAK perlu menjalankan 'pnpm db:push' — ZGuard otomatis menyimpan data ke file lokal (.data/zguard-dev-store.json).\n" +
      "- Jika ingin memakai Neon Serverless Postgres, salin .env.example menjadi .env di root repo lalu isi DATABASE_URL=\"postgresql://...neon.tech/...?sslmode=require\".\n"
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
