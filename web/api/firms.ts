import { getLive } from "./_live";

// provided by the Node runtime on Vercel
declare const process: { env: Record<string, string | undefined> };

/**
 * GET /api/firms: the last seven days of near-real-time detections for the study area.
 * Needs the FIRMS_MAP_KEY environment variable (set it in the Vercel project settings).
 */
export default async function handler(_req: any, res: any) {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) {
    res.status(503).json({ error: "not_configured" });
    return;
  }
  try {
    const data = await getLive(key);
    // let the CDN share one answer between visitors, which also protects the key's request quota
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: "upstream", message: e instanceof Error ? e.message : String(e) });
  }
}
