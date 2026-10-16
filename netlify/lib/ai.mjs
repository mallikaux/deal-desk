// Gemini (free tier) for two jobs: reading a brand's message, and writing the reply.
// Prices are never invented by the model: the desk computes them from your rate card
// and hands the exact numbers to the writer.
import { env } from "./core.mjs";

const MODELS = () => [env("GEMINI_MODEL"), "gemini-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash"].filter(Boolean);

async function gemini(system, user, schema) {
  const key = env("GEMINI_API_KEY");
  if (!key) { const e = new Error("No Gemini key set"); e.code = "nokey"; throw e; }
  let last;
  for (const model of [...new Set(MODELS())]) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.35, responseMimeType: "application/json", ...(schema ? { responseSchema: schema } : {}) },
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      const txt = d.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      try { return { model, out: JSON.parse(txt) }; } catch { last = new Error("AI returned something unreadable"); continue; }
    }
    last = new Error(d.error?.message || `Gemini HTTP ${r.status}`); last.status = r.status;
    if (r.status === 429) { last.code = "limit"; break; }      // free-tier limit: don't burn other models
    if (r.status !== 404 && r.status !== 400) break;           // 404/400 → try the next model name
  }
  throw last;
}

const TYPES = ["reel_collab", "reel", "story", "story_set", "static_post", "carousel", "ugc_video", "ugc_photo",
  "yt_dedicated", "yt_integrated", "yt_short", "event_coverage", "live", "other"];

const READ_SCHEMA = {
  type: "OBJECT",
  properties: {
    brand: { type: "STRING" }, agency: { type: "STRING" }, contact: { type: "STRING" },
    summary: { type: "STRING" },
    deliverables: { type: "ARRAY", items: { type: "OBJECT", properties: {
      type: { type: "STRING", enum: TYPES }, qty: { type: "INTEGER" }, label: { type: "STRING" }, platform: { type: "STRING" }, notes: { type: "STRING" },
    }, required: ["type", "qty", "label"] } },
    usage_months: { type: "NUMBER" }, usage_platforms: { type: "STRING" },
    exclusivity_months: { type: "NUMBER" }, whitelisting: { type: "BOOLEAN" },
    offer_type: { type: "STRING", enum: ["paid", "barter", "barter_plus_small_budget", "affiliate_or_credits", "unclear"] },
    budget_inr: { type: "NUMBER" }, budget_usd: { type: "NUMBER" }, international: { type: "BOOLEAN" }, long_term: { type: "BOOLEAN" }, long_term_note: { type: "STRING" },
    asks_rates: { type: "BOOLEAN" }, asks_media_kit: { type: "BOOLEAN" }, asks_location: { type: "BOOLEAN" },
    asks_availability: { type: "BOOLEAN" }, asks_demographics: { type: "BOOLEAN" },
    timeline: { type: "STRING" }, payment_terms: { type: "STRING" },
    perks: { type: "STRING" }, red_flags: { type: "ARRAY", items: { type: "STRING" } },
    is_confirmation: { type: "BOOLEAN" },
  },
  required: ["deliverables", "offer_type", "summary"],
};

export async function readBrief(message, ctx) {
  const system = `You read brand and agency collaboration messages sent to an Indian content creator and extract exactly what they are asking for.
Rules:
- Deliverable types: ${TYPES.join(", ")}. "Collab reel"/"collab post"/"paid partnership reel" → reel_collab. "Non-collab reel" or just "reel" → reel. "Reshare story" or a single story → story (qty 1). "Multiple stories"/"story coverage" → story_set. Dedicated YouTube video → yt_dedicated; integrated/mention in a video → yt_integrated.
- Ad rights / media rights / paid usage / boosting → usage_months (number; 0 if not asked; 12 for "perpetual").
- Never invent numbers that are not in the message. Use 0 or empty strings when something isn't stated.
- budget_inr: rupees, only if the message names a budget in rupees. budget_usd: dollars, only if it names a budget in USD/$.
- international: true if the brand or agency is based outside India, targets a non-Indian audience, or writes amounts in USD/EUR/GBP.
- offer_type: barter if they offer only product/experience; affiliate_or_credits if they offer credits, plans, codes or commission instead of a fee.
- red_flags: short notes the creator should notice (e.g. "barter only", "very low budget for ad rights", "TikTok isn't available in India", "45-day payment terms", "product non-returnable").
- is_confirmation: true if this is an onboarding/confirmation email for an already agreed deal.
- summary: one plain sentence of what they want.
The creator: ${ctx.handle}, based in ${ctx.location || "India"}.`;
  return gemini(system, "Brand message:\n\"\"\"\n" + message + "\n\"\"\"", READ_SCHEMA);
}

export async function writeReply(message, ctx, quote) {
  const examples = (ctx.examples || []).slice(0, 6).map((e, i) =>
    `Example ${i + 1}\nBrand wrote:\n${e.brand}\nCreator replied:\n${e.reply}`).join("\n\n---\n\n");
  const system = `You write replies to brand collaboration messages for ${ctx.name || "the creator"} (${ctx.handle}), based in ${ctx.location || "India"}.
Match her voice, length and structure from the examples exactly: warm, short, confident, no fluff, no corporate phrases, at most one emoji like she uses. Use *asterisks* around the price the way she does.
Hard rules:
- Use ONLY the prices given in QUOTE. Never invent, round or discount further.
- Answer every question the brand asked (location, availability, rates, media kit, demographics) using FACTS.
- If the offer is barter or credits/commission only, politely say she works on paid collaborations and give the paid quote. Mention extras like commission only as a welcome add-on.
- If a long-term rate is given, offer it the way she does in the examples.
- If the brand asked for a media kit, include the literal placeholder [media kit link] on its own line.
- Don't add sign-offs she doesn't use. Return JSON {"reply": "...", "short": "a 2–3 line version for DMs"}.
POLICIES: ${ctx.policies || "Prefers paid collaborations; declines barter."}
PAYMENT TERMS SHE PREFERS: ${ctx.terms || ""}

${examples ? "HER PAST REPLIES THAT WORKED:\n\n" + examples : ""}`;
  const user = `BRAND MESSAGE:\n"""\n${message}\n"""\n\nWHAT THEY ASKED (parsed): ${JSON.stringify(quote.read || {})}\n\nQUOTE: ${JSON.stringify({ lines: quote.lines, extras: quote.adds || [] })}\nTOTAL: ${quote.totalText}\n${quote.longTerm ? "LONG-TERM RATE: " + quote.longTerm + "\n" : ""}FACTS: ${JSON.stringify(ctx.facts || {})}`;
  return gemini(system, user, { type: "OBJECT", properties: { reply: { type: "STRING" }, short: { type: "STRING" } }, required: ["reply"] });
}
