// Shared helpers: storage, auth, responses.
import { getStore } from "@netlify/blobs";

// Exact key first; then ignore case, so "Desk_Password" still counts as DESK_PASSWORD.
export const env = (k, d = "") => {
  try {
    const v = globalThis.Netlify?.env?.get(k) ?? process.env[k];
    if (v) return v;
    const all = { ...process.env, ...(globalThis.Netlify?.env?.toObject?.() || {}) };
    const kk = Object.keys(all).find((x) => x.toUpperCase() === k.toUpperCase());
    return (kk && all[kk]) || d;
  } catch { return process.env[k] || d; }
};
export const store = () => getStore({ name: "deal-desk", consistency: "strong" });

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

export const clean = (v, max = 500) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, max);
export const handleOf = (u) => String(u || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9._]/g, "").slice(0, 40);

/* ---------- session: a signed, expiring cookie. No user table needed: one owner, one password. ---------- */
const enc = new TextEncoder();
async function hmac(msg) {
  // SESSION_SECRET is optional; without it the key is derived from the password, so changing the password logs every device out.
  const key = await crypto.subtle.importKey("raw", enc.encode(env("SESSION_SECRET") || "deal-desk:" + env("DESK_PASSWORD")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const safeEq = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
};
export async function makeSession(days = 30) {
  const exp = Date.now() + days * 864e5;
  return `v1.${exp}.${await hmac("v1." + exp)}`;
}
export async function checkSession(req) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)desk=([^;]+)/);
  if (!m) return false;
  const [v, exp, sig] = decodeURIComponent(m[1]).split(".");
  if (v !== "v1" || !(+exp > Date.now())) return false;
  return safeEq(sig, await hmac("v1." + exp));
}
export async function checkPassword(pw) {
  const real = env("DESK_PASSWORD");
  if (!real) return false;
  // compare HMACs so timing doesn't leak the password length
  return safeEq(await hmac("pw:" + pw), await hmac("pw:" + real));
}
export const sessionCookie = (val, maxAge) =>
  `desk=${encodeURIComponent(val)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export async function signState(obj) {
  const body = btoa(JSON.stringify(obj)).replace(/=+$/, "");
  return body + "." + (await hmac("state:" + body));
}
export async function readState(s) {
  const [body, sig] = String(s || "").split(".");
  if (!body || !safeEq(sig || "", await hmac("state:" + body))) return null;
  try { const o = JSON.parse(atob(body)); return o.exp > Date.now() ? o : null; } catch { return null; }
}

export const siteUrl = (req) => {
  const u = env("SITE_URL") || env("URL");
  if (u) return u.replace(/\/$/, "");
  const x = new URL(req.url); return x.origin;
};

export const slug = (n = 10) => {
  const a = "abcdefghijkmnpqrstuvwxyz23456789"; const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, (x) => a[x % a.length]).join("");
};
