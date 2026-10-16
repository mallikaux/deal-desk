// Runs twice a week (Mon + Thu): rotates Instagram tokens before they expire and pulls fresh stats
// for every connected account, so the desk and every kit link always show current numbers.
import { store } from "../lib/core.mjs";
import { refreshAccount } from "../lib/ig.mjs";

export default async () => {
  const s = store();
  const { blobs } = await s.list({ prefix: "acct/" });
  for (const b of blobs) {
    const handle = b.key.split("/")[1];
    try { await refreshAccount(handle); }
    catch (e) {
      const a = await s.get(b.key, { type: "json" });
      if (a) { a.lastError = e.message; a.lastErrorAt = Date.now(); await s.setJSON(b.key, a); }
    }
  }
  return new Response("ok");
};

// 01:30 UTC = 7:00 IST, Mondays and Thursdays
export const config = { schedule: "30 1 * * 1,4" };
