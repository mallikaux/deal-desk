// Instagram API with Instagram Login (graph.instagram.com).
// Works for Creator and Business accounts. Tokens are long-lived (60 days) and are
// refreshed by the twice-weekly job, so a connection keeps working without logging in again.
import { env, store, handleOf } from "./core.mjs";

const V = () => env("IG_API_VERSION", "v23.0");
const G = (path) => `https://graph.instagram.com/${V()}/${path.replace(/^\//, "")}`;
const SCOPES = "instagram_business_basic,instagram_business_manage_insights";

export const authUrl = (redirect, state) =>
  "https://www.instagram.com/oauth/authorize?" + new URLSearchParams({
    enable_fb_login: "0", force_authentication: "1", client_id: env("IG_APP_ID"),
    redirect_uri: redirect, response_type: "code", scope: SCOPES, state,
  });

async function getJSON(url, init) {
  const r = await fetch(url, init);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = { raw: t.slice(0, 300) }; }
  if (!r.ok || d.error) {
    const msg = d.error?.message || d.error_message || d.raw || `HTTP ${r.status}`;
    const e = new Error(msg); e.status = r.status; e.data = d; throw e;
  }
  return d;
}

export async function exchangeCode(code, redirect) {
  const body = new URLSearchParams({
    client_id: env("IG_APP_ID"), client_secret: env("IG_APP_SECRET"),
    grant_type: "authorization_code", redirect_uri: redirect, code: code.replace(/#_$/, ""),
  });
  const short = await getJSON("https://api.instagram.com/oauth/access_token", { method: "POST", body });
  const tok = Array.isArray(short.data) ? short.data[0] : short;
  const long = await getJSON("https://graph.instagram.com/access_token?" + new URLSearchParams({
    grant_type: "ig_exchange_token", client_secret: env("IG_APP_SECRET"), access_token: tok.access_token,
  }));
  return { token: long.access_token, expires: Date.now() + (long.expires_in || 5184000) * 1000 };
}

export async function refreshToken(acc) {
  const d = await getJSON("https://graph.instagram.com/refresh_access_token?" + new URLSearchParams({
    grant_type: "ig_refresh_token", access_token: acc.token,
  }));
  return { ...acc, token: d.access_token, expires: Date.now() + (d.expires_in || 5184000) * 1000, refreshed: Date.now() };
}

const q = (o) => new URLSearchParams(o).toString();
const safe = async (p) => { try { return await p; } catch (e) { return { __error: e.message }; } };

async function imageData(url, maxBytes = 260000) {
  if (!url) return "";
  try {
    const r = await fetch(url); if (!r.ok) return "";
    const buf = new Uint8Array(await r.arrayBuffer()); if (buf.length > maxBytes) return "";
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `data:${r.headers.get("content-type") || "image/jpeg"};base64,${btoa(s)}`;
  } catch { return ""; }
}

function breakdown(res) {
  const rows = res?.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
  const total = rows.reduce((s, r) => s + (r.value || 0), 0) || 1;
  return rows.map((r) => ({ k: (r.dimension_values || []).join(" "), v: r.value || 0, pct: Math.round((r.value || 0) * 1000 / total) / 10 }))
    .sort((a, b) => b.v - a.v);
}

/* Pull everything the media kit needs and boil it down to a few honest averages. */
export async function fetchStats(acc) {
  const t = acc.token;
  const me = await getJSON(G("me") + "?" + q({
    fields: "user_id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count", access_token: t,
  }));
  const media = await getJSON(G("me/media") + "?" + q({
    fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",
    limit: "40", access_token: t,
  }));
  const items = media.data || [];
  const since = Date.now() - 120 * 864e5;
  const reels = items.filter((m) => m.media_product_type === "REELS" && new Date(m.timestamp).getTime() > since).slice(0, 15);

  await Promise.all(reels.map(async (m) => {
    let ins = await safe(getJSON(G(`${m.id}/insights`) + "?" + q({ metric: "views,reach,saved,shares", access_token: t })));
    if (ins.__error) ins = await safe(getJSON(G(`${m.id}/insights`) + "?" + q({ metric: "reach,saved,shares", access_token: t })));
    for (const d of ins.data || []) m[d.name] = d.values?.[0]?.value ?? d.total_value?.value ?? 0;
  }));

  const avg = (k, list = reels) => { const v = list.map((m) => +m[k] || 0).filter((x) => x > 0); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0; };
  const followers = me.followers_count || 0;
  const avgLikes = avg("like_count"), avgComments = avg("comments_count");
  const avgViews = avg("views"), avgReach = avg("reach"), avgSaves = avg("saved"), avgShares = avg("shares");
  const er = followers ? Math.round(((avgLikes + avgComments) / followers) * 1000) / 10 : 0;

  const now = Math.floor(Date.now() / 1000), d28 = now - 28 * 86400;
  const acct = await safe(getJSON(G("me/insights") + "?" + q({ metric: "reach,views", period: "day", metric_type: "total_value", since: d28, until: now, access_token: t })));
  const acctVal = (name) => (acct.data || []).find((d) => d.name === name)?.total_value?.value || 0;

  const demo = {};
  for (const b of ["age", "gender", "city", "country"]) {
    const r = await safe(getJSON(G("me/insights") + "?" + q({ metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown: b, access_token: t })));
    demo[b] = r.__error ? [] : breakdown(r).slice(0, b === "gender" ? 3 : 5);
  }

  const top = [...reels].sort((a, b) => (b.views || b.reach || 0) - (a.views || a.reach || 0)).slice(0, 6);
  const thumbs = [];
  for (const m of top.slice(0, 3)) thumbs.push(await imageData(m.thumbnail_url || m.media_url));

  return {
    fetched: Date.now(),
    username: me.username, name: me.name || "", bio: me.biography || "",
    followers, following: me.follows_count || 0, mediaCount: me.media_count || 0,
    reelsCounted: reels.length,
    avgViews, avgReach, avgLikes, avgComments, avgSaves, avgShares, er,
    reach28: acctVal("reach"), views28: acctVal("views"),
    demo,
    top: top.map((m, i) => ({
      permalink: m.permalink, caption: (m.caption || "").slice(0, 140), ts: m.timestamp,
      views: m.views || 0, reach: m.reach || 0, likes: m.like_count || 0, comments: m.comments_count || 0, thumb: i < 3 ? !!thumbs[i] : false,
    })),
    _images: { avatar: await imageData(me.profile_picture_url), thumbs },
  };
}

/* Refresh one account: rotate the token if it's getting old, then pull stats. */
export async function refreshAccount(handle) {
  const s = store();
  let acc = await s.get(`acct/${handle}`, { type: "json" });
  if (!acc) throw new Error("Account not connected");
  if (acc.expires - Date.now() < 30 * 864e5) {
    try { acc = await refreshToken(acc); await s.setJSON(`acct/${handle}`, acc); } catch (e) { acc.refreshError = e.message; }
  }
  const st = await fetchStats(acc);
  const { _images, ...stats } = st;
  await s.setJSON(`stats/${handle}`, stats);
  await s.setJSON(`img/${handle}`, _images);
  acc.lastRefresh = Date.now(); acc.lastError = "";
  await s.setJSON(`acct/${handle}`, acc);
  return stats;
}

export async function saveConnection(tok) {
  const me = await getJSON(G("me") + "?" + q({ fields: "user_id,username", access_token: tok.token }));
  const handle = handleOf(me.username);
  await store().setJSON(`acct/${handle}`, { handle, userId: me.user_id, token: tok.token, expires: tok.expires, connected: Date.now() });
  return handle;
}
