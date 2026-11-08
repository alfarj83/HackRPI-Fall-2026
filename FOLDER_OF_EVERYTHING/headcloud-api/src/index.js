/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const MODEL = "gemini-3.8-flash";

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const DAY_MS = 24 * 60 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    }
  });
}

function isValidDay(day) {
  if (!day || typeof day !== "object") return false;

  if (
    typeof day.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day.date)
  ) {
    return false;
  }

  const validDuration = value =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= DAY_MS;

  return (
    validDuration(day.screenMs) &&
    validDuration(day.awayMs) &&
    Number.isInteger(day.breaks) &&
    day.breaks >= 0 &&
    day.breaks <= 500
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Basic health check; doesn't call Gemini.
    if (request.method === "GET" &&
        url.pathname === "/health") {
      return json({ status: "ok" });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (url.pathname !== "/summary") {
      return json({ error: "Not found" }, 404);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const length = Number(
      request.headers.get("content-length") || 0
    );

    if (length > 10_000) {
      return json({ error: "Request too large" }, 413);
    }

    let body;

    try {
      const raw = await request.text();

      if (raw.length > 10_000) {
        return json({ error: "Request too large" }, 413);
      }

      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    // Only aggregated stats; no webcam images.
    const daily = body?.daily;

    if (
      !Array.isArray(daily) ||
      daily.length !== 7 ||
      !daily.every(isValidDay) ||
      new Set(daily.map(d => d.date)).size !== 7
    ) {
      return json({
        error: "Expected seven valid daily records"
      }, 400);
    }

    if (!env.GEMINI_API_KEY) {
      return json({
        error: "Gemini key not configured"
      }, 500);
    }

    // Global prototype safety limit.
    const { success } =
      await env.SUMMARY_LIMITER.limit({
        key: "head-in-the-clouds-all-summaries"
      });

    if (!success) {
      return json({
        error: "Too many summary requests. Try later."
      }, 429);
    }

    const totals = daily.reduce(
      (total, day) => {
        total.screenMs += day.screenMs;
        total.awayMs += day.awayMs;
        total.breaks += day.breaks;
        return total;
      },
      { screenMs: 0, awayMs: 0, breaks: 0 }
    );

    const minutes = ms =>
      Math.round(ms / 60000 * 10) / 10;

    const report = daily.map(day => ({
      date: day.date,
      screenMinutes: minutes(day.screenMs),
      awayMinutes: minutes(day.awayMs),
      completedBreaks: day.breaks
    }));

    const prompt = `
You are Head in the Clouds, a helpful screen-wellness assistant.

Analyze these approximate webcam-based screen
tracking statistics for seven calendar days.

DAILY DATA:
${JSON.stringify(report)}

WEEKLY TOTALS:
- Screen-viewing minutes: ${minutes(totals.screenMs)}
- Looking-away minutes: ${minutes(totals.awayMs)}
- Completed continuous 20-second breaks: ${totals.breaks}

Write a friendly report under 180 words:
1. Summarize the weekly usage.
2. Compare completed breaks with screen time.
3. Mention meaningful differences between days.
4. Suggest two or three realistic improvements.

Rules:
- Do not invent data.
- Zero may mean the tracker was not active.
- Screen-viewing time is not total computer uptime.
- Don't make medical diagnoses.
- Don't suggest that all away time counts as breaks.
- Use clear, short paragraphs and plain text.
`;

    let upstream;

    try {
      upstream = await fetch(GEMINI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{ text: prompt }]
          }]
        })
      });
    } catch {
      return json({
        error: "Could not reach Gemini"
      }, 502);
    }

    if (!upstream.ok) {
      console.error(
        "Gemini request failed:",
        upstream.status
      );

      return json({
        error: upstream.status === 429
          ? "Gemini usage limit reached"
          : "Gemini service error"
      }, upstream.status === 429 ? 429 : 502);
    }

    const result = await upstream.json();

    const summary =
      result.candidates?.[0]?.content?.parts
        ?.filter(part => typeof part.text === "string")
        .map(part => part.text)
        .join("\n")
        .trim();

    if (!summary) {
      return json({
        error: "Gemini returned no summary"
      }, 502);
    }

    return json({
      summary,
      totals,
      model: MODEL
    });
  }
};

