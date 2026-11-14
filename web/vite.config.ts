import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { getFeed, isFeed } from "./api/_live";

/**
 * Serves /api/firms during `npm run dev` with the same code the Vercel function uses, so the
 * Live view works locally. The key is read from FIRMS_MAP_KEY in the environment or in an
 * untracked .env.local file, and never reaches the browser.
 */
function liveApi(key: string | undefined): Plugin {
  return {
    name: "ignis-live-api",
    configureServer(server) {
      server.middlewares.use("/api/firms", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (!key) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "not_configured" }));
          return;
        }
        const sector = new URL(req.url ?? "/", "http://x").searchParams.get("sector") ?? "sea";
        if (!isFeed(sector)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "unknown_sector" }));
          return;
        }
        try {
          res.end(JSON.stringify(await getFeed(key, sector)));
        } catch (e) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: "upstream", message: e instanceof Error ? e.message : String(e) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), liveApi(env.FIRMS_MAP_KEY || process.env.FIRMS_MAP_KEY)],
    build: { chunkSizeWarningLimit: 900 },
  };
});
