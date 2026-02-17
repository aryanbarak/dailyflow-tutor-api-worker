const ALLOWED_ORIGIN = "https://barakzai.cloud";
const DEFAULT_REQUEST_ID = "00000000-0000-0000-0000-000000000000";

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowOrigin = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "X-Adapter-Token, Content-Type",
    Vary: "Origin",
  };
}

function jsonResponse(request, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
    },
  });
}

async function readJsonAsset(env, request, assetPath) {
  const assetUrl = new URL(assetPath, request.url);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
  if (!assetResponse.ok) {
    return { ok: false, status: assetResponse.status };
  }

  try {
    return { ok: true, payload: await assetResponse.json() };
  } catch {
    return { ok: false, status: 500 };
  }
}

function isAuthorized(env, request) {
  const expectedToken = env.ADAPTER_TOKEN;
  if (!expectedToken || !expectedToken.trim()) {
    return { ok: false, status: 500, detail: "Server misconfigured: ADAPTER_TOKEN is missing" };
  }

  const providedToken = request.headers.get("X-Adapter-Token") || "";
  if (providedToken !== expectedToken) {
    return { ok: false, status: 401, detail: "Unauthorized" };
  }

  return { ok: true };
}

function normalizeRunResult(assetPayload) {
  if (assetPayload && typeof assetPayload === "object" && "result" in assetPayload) {
    return assetPayload.result;
  }
  return assetPayload;
}

function normalizeBodyRunRequest(body) {
  const topic = String(body?.topic || "").trim().toLowerCase();
  const lang = String(body?.lang || "").trim().toLowerCase();
  const modeRaw = String(body?.mode || "").trim().toLowerCase();
  const mode = modeRaw || "pseudocode";
  const requestId = String(body?.request_id || "").trim() || DEFAULT_REQUEST_ID;

  return { topic, lang, mode, requestId };
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS" && (url.pathname === "/v1/topics" || url.pathname === "/v1/run")) {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (url.pathname === "/v1/health" && request.method === "GET") {
    return jsonResponse(request, { ok: true, service: "dailyflow-tutor-api" }, 200);
  }

  if (url.pathname.startsWith("/v1/")) {
    const auth = isAuthorized(env, request);
    if (!auth.ok) {
      return jsonResponse(request, { detail: auth.detail }, auth.status);
    }
  }

  if (url.pathname === "/v1/topics" && request.method === "GET") {
    const topicsAsset = await readJsonAsset(env, request, "/tutor-data/topics.json");
    if (!topicsAsset.ok) {
      return jsonResponse(request, { detail: "Not found" }, 404);
    }
    return jsonResponse(request, topicsAsset.payload, 200);
  }

  if (url.pathname === "/v1/run" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(request, { detail: "Invalid JSON" }, 400);
    }

    const normalized = normalizeBodyRunRequest(body);
    if (!normalized.topic || !normalized.lang) {
      return jsonResponse(request, { detail: "Missing required fields: topic, lang" }, 400);
    }

    const assetPath = `/tutor-data/run/${normalized.topic}.${normalized.lang}.${normalized.mode}.json`;
    const runAsset = await readJsonAsset(env, request, assetPath);
    if (!runAsset.ok) {
      return jsonResponse(request, { detail: "Not found" }, 404);
    }

    const responsePayload = {
      api_version: "v1",
      request_id: normalized.requestId,
      topic: normalized.topic,
      lang: normalized.lang,
      result: normalizeRunResult(runAsset.payload),
    };

    return jsonResponse(request, responsePayload, 200);
  }

  return jsonResponse(request, { detail: "Not found" }, 404);
}
