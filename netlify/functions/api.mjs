// Deal desk API. One owner, one password; everything lives in Netlify Blobs.
import { env, store, json, clean, handleOf, makeSession, checkSession, checkPassword, sessionCookie,
  signState, readState, siteUrl, slug } from "../lib/core.mjs";
import { authUrl, exchangeCode, saveConnection, refreshAccount } from "../lib/ig.mjs";
import { readBrief, writeReply } from "../lib/ai.mjs";

const PROFILE_KEYS = ["name", "location", "email", "phone", "bio", "categories", "currency", "terms", "policies", "accent", "website"];
const RATE_KEYS = ["reel_collab", "reel", "story", "story_set", "static_post", "carousel", "ugc_video", "ugc_photo",
  "yt_dedicated", "yt_integrated", "yt_short", "event_coverage", "live"];

function cleanProfile(p, handle) {
  const o = { handle };
  for (const k of PROFILE_KEYS) o[k] = clean(p?.[k], k === "policies" || k === "bio" ? 1200 : 300);
  o.rates = {}; for (const k of RATE_KEYS) { const v = +p?.rates?.[k]; if (v > 0) o.rates[k] = Math.round(v); }
  o.intlRates = {}; for (const k of RATE_KEYS) { const v = +p?.intlRates?.[k]; if (v > 0) o.intlRates[k] = Math.round(v); }
  for (const k of ["usagePct", "exclusivityPct", "whitelistPct", "longTermPerVideo", "roundTo", "intlDivisor"]) { const v = +p?.[k]; o[k] = v >= 0 ? v : 0; }
  o.examples = (Array.isArray(p?.examples) ? p.examples : []).slice(0, 12)
    .map((e) => ({ brand: clean(e?.brand, 4000), reply: clean(e?.reply, 3000) })).filter((e) => e.reply);
  return o;
}

const publicStats = (s) => s && ({
  fetched: s.fetched, username: s.username, followers: s.followers, avgViews: s.avgViews, avgReach: s.avgReach,
  avgLikes: s.avgLikes, avgComments: s.avgComments, avgSaves: s.avgSaves, avgShares: s.avgShares, er: s.er,
  reach28: s.reach28, views28: s.views28, reelsCounted: s.reelsCounted, demo: s.demo, top: s.top,
});

async function state(s) {
  const [acc, prof, deals] = await Promise.all([
    s.list({ prefix: "acct/" }), s.list({ prefix: "profile/" }), s.list({ prefix: "deal/" })]);
  const handles = new Set([...acc.blobs, ...prof.blobs].map((b) => b.key.split("/")[1]));
  const accounts = [];
  for (const h of handles) {
    const [a, st, p] = await Promise.all([s.get(`acct/${h}`, { type: "json" }), s.get(`stats/${h}`, { type: "json" }), s.get(`profile/${h}`, { type: "json" })]);
    accounts.push({ handle: h, connected: !!a, expires: a?.expires || 0, lastRefresh: a?.lastRefresh || 0, lastError: a?.lastError || "",
      stats: st || null, profile: p || cleanProfile({}, h) });
  }
  accounts.sort((x, y) => (x.handle > y.handle ? 1 : -1));
  const list = (await Promise.all(deals.blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean)
    .sort((a, b) => b.updated - a.updated).slice(0, 40)
    .map((d) => ({ id: d.id, handle: d.handle, brand: d.read?.brand || "", summary: d.read?.summary || "", total: d.quote?.total || 0, currency: d.quote?.currency || "INR",
      updated: d.updated, slug: d.slug, status: d.status || "draft" }));
  return { accounts, deals: list, config: { ai: !!env("GEMINI_API_KEY"), ig: !!(env("IG_APP_ID") && env("IG_APP_SECRET")) } };
}

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [r0, r1, r2] = parts;
  const s = store();
  const body = async () => { try { return await req.json(); } catch { return {}; } };

  /* ---------- public ---------- */
  if (r0 === "login" && req.method === "POST") {
    const b = await body();
    if (!(await checkPassword(String(b.password || "")))) {
      await new Promise((r) => setTimeout(r, 600));
      return json({ error: env("DESK_PASSWORD") ? "That password isn't right." : "DESK_PASSWORD isn't set in Netlify yet." }, 401);
    }
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(await makeSession(), 30 * 86400) });
  }
  if (r0 === "logout") return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });

  if (r0 === "kit" && r1 && req.method === "GET") {
    const k = await s.get(`kit/${clean(r1, 40)}`, { type: "json" });
    if (!k) return json({ error: "Not found" }, 404);
    const [st, p] = await Promise.all([s.get(`stats/${k.handle}`, { type: "json" }), s.get(`profile/${k.handle}`, { type: "json" })]);
    const prof = p || {};
    return json({ ...k, stats: publicStats(st), profile: { handle: k.handle, name: prof.name, location: prof.location, email: prof.email,
      phone: k.showPhone ? prof.phone : "", bio: prof.bio, categories: prof.categories, accent: prof.accent, website: prof.website } },
      200, { "cache-control": "public, max-age=60" });
  }
  if (r0 === "img" && r1) {
    const im = await s.get(`img/${handleOf(r1)}`, { type: "json" });
    const src = r2 === "avatar" ? im?.avatar : im?.thumbs?.[+String(r2 || "").replace(/\D/g, "")];
    if (!src) return new Response("", { status: 404 });
    const [, mime, b64] = src.match(/^data:([^;]+);base64,(.*)$/) || [];
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Response(bin, { headers: { "content-type": mime, "cache-control": "public, max-age=3600" } });
  }

  if (r0 === "ig" && r1 === "callback") {
    const st = await readState(url.searchParams.get("state"));
    const back = (q) => Response.redirect(siteUrl(req) + "/?" + q, 302);
    if (!st) return back("igerror=" + encodeURIComponent("That connection link expired. Try again."));
    if (url.searchParams.get("error")) return back("igerror=" + encodeURIComponent(url.searchParams.get("error_description") || "Instagram said no."));
    try {
      const tok = await exchangeCode(url.searchParams.get("code") || "", siteUrl(req) + "/api/ig/callback");
      const handle = await saveConnection(tok);
      try { await refreshAccount(handle); } catch (e) { /* stats can be retried from the desk */ }
      return back("connected=" + handle);
    } catch (e) { return back("igerror=" + encodeURIComponent(e.message)); }
  }

  /* ---------- everything below needs the password ---------- */
  if (!(await checkSession(req))) return json({ error: "locked" }, 401);

  if (r0 === "state") return json(await state(s));

  if (r0 === "profile" && r1 && req.method === "PUT") {
    const h = handleOf(r1); const p = cleanProfile(await body(), h);
    await s.setJSON(`profile/${h}`, p); return json({ ok: true, profile: p });
  }

  if (r0 === "ig" && r1 === "start") {
    if (!env("IG_APP_ID")) return json({ error: "IG_APP_ID isn't set in Netlify yet." }, 400);
    const state = await signState({ exp: Date.now() + 15 * 60e3, n: slug(8) });
    return Response.redirect(authUrl(siteUrl(req) + "/api/ig/callback", state), 302);
  }
  if (r0 === "refresh" && r1 && req.method === "POST") {
    try { return json({ ok: true, stats: await refreshAccount(handleOf(r1)) }); }
    catch (e) {
      const a = await s.get(`acct/${handleOf(r1)}`, { type: "json" });
      if (a) { a.lastError = e.message; await s.setJSON(`acct/${a.handle}`, a); }
      return json({ error: e.message }, 502);
    }
  }
  if (r0 === "account" && r1 && req.method === "DELETE") {
    const h = handleOf(r1); await Promise.all([s.delete(`acct/${h}`), s.delete(`stats/${h}`), s.delete(`img/${h}`)]);
    return json({ ok: true });
  }

  if (r0 === "read" && req.method === "POST") {
    const b = await body(); const h = handleOf(b.handle);
    const p = (await s.get(`profile/${h}`, { type: "json" })) || {};
    try { const r = await readBrief(clean(b.message, 8000), { handle: "@" + h, location: p.location }); return json({ read: r.out, model: r.model }); }
    catch (e) { return json({ fallback: true, error: e.message, code: e.code || "" }); }
  }
  if (r0 === "reply" && req.method === "POST") {
    const b = await body(); const h = handleOf(b.handle);
    const [p, st] = await Promise.all([s.get(`profile/${h}`, { type: "json" }), s.get(`stats/${h}`, { type: "json" })]);
    const prof = p || {};
    const facts = { location: prof.location, availability: clean(b.availability, 200) || "available over the next 1–2 months",
      followers: st?.followers, avgReelViews: st?.avgViews, engagementRate: st?.er ? st.er + "%" : undefined,
      topAudience: st?.demo ? { age: st.demo.age?.[0]?.k, cities: (st.demo.city || []).slice(0, 3).map((c) => c.k).join(", ") } : undefined };
    try {
      const r = await writeReply(clean(b.message, 8000), { name: prof.name, handle: "@" + h, location: prof.location, terms: prof.terms,
        policies: prof.policies, examples: prof.examples, facts }, b.quote || {});
      return json({ reply: r.out.reply || "", short: r.out.short || "", model: r.model });
    } catch (e) { return json({ fallback: true, error: e.message, code: e.code || "" }); }
  }

  if (r0 === "deal") {
    if (req.method === "GET" && r1) return json((await s.get(`deal/${clean(r1, 40)}`, { type: "json" })) || { error: "Not found" });
    if (req.method === "DELETE" && r1) {
      const d = await s.get(`deal/${clean(r1, 40)}`, { type: "json" });
      if (d?.slug) await s.delete(`kit/${d.slug}`);
      await s.delete(`deal/${clean(r1, 40)}`); return json({ ok: true });
    }
    if (req.method === "POST") {
      const b = await body(); const h = handleOf(b.handle);
      const id = clean(b.id, 40) || slug(12);
      const old = (await s.get(`deal/${id}`, { type: "json" })) || {};
      const d = { id, handle: h, created: old.created || Date.now(), updated: Date.now(), status: clean(b.status, 20) || old.status || "draft",
        message: clean(b.message, 8000), read: b.read || {}, quote: b.quote || {}, reply: clean(b.reply, 6000), slug: old.slug || slug(10) };
      await s.setJSON(`deal/${id}`, d);
      const kit = { slug: d.slug, handle: h, created: d.created, updated: d.updated, brand: clean(d.read?.brand, 120),
        proposal: b.kit?.proposal !== false ? { lines: d.quote.lines || [], adds: d.quote.adds || [], total: d.quote.total || 0,
          currency: d.quote.currency || "INR", longTerm: d.quote.longTerm || "", timeline: clean(b.kit?.timeline, 200),
          validity: clean(b.kit?.validity, 60), terms: clean(b.kit?.terms, 300), note: clean(b.kit?.note, 600) } : null,
        showPhone: !!b.kit?.showPhone, focus: clean(b.kit?.focus, 120) };
      await s.setJSON(`kit/${d.slug}`, kit);
      return json({ ok: true, id, slug: d.slug, url: siteUrl(req) + "/k/" + d.slug });
    }
  }
  return json({ error: "Not found" }, 404);
};

export const config = { path: "/api/*" };
