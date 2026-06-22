// SERVER-ONLY. Entrypoint. Loads .env from the repo root, builds the app, listens.
// UNBUNDLED: tsx in dev (npm run dev), tsc -> node dist/index.js in prod (npm run build && npm start).
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// load the repo-root .env (the funded sponsor/attestor key lives there, gitignored).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", ".."); // dist|src -> server -> repo
dotenvConfig({ path: path.join(repoRoot, ".env") });

const { buildApp } = await import("./app.js");
const { PORT, HOST, sponsorAddress } = await import("./aura/config.js").then(async (cfg) => ({
  PORT: cfg.PORT,
  HOST: cfg.HOST,
  sponsorAddress: (await import("./aura/wallet.js")).sponsorAddress,
}));

const app = await buildApp({ logger: true });

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`AURA v2 backend up on http://${HOST}:${PORT} - sponsor/attestor ${sponsorAddress()}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
