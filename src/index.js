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

function authorize(env, request) {
  const expected = String(env.ADAPTER_TOKEN || "");
  if (!expected) {
    return { ok: false, status: 500, payload: { detail: "Server misconfigured: ADAPTER_TOKEN is missing" } };
  }

  const provided = request.headers.get("X-Adapter-Token") || "";
  if (provided !== expected) {
    return { ok: false, status: 401, payload: { detail: "Unauthorized" } };
  }

  return { ok: true };
}

async function readAssetJson(env, request, path) {
  const assetUrl = new URL(path, request.url);
  const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  try {
    return { ok: true, payload: await response.json() };
  } catch {
    return { ok: false, status: 500 };
  }
}

function normalizeRunBody(body) {
  const topic = String(body?.topic || "").trim().toLowerCase();
  const lang = String(body?.lang || "").trim().toLowerCase();
  const mode = String(body?.mode || "").trim().toLowerCase() || "pseudocode";
  const requestId = String(body?.request_id || "").trim() || DEFAULT_REQUEST_ID;
  const apiVersion = String(body?.api_version || "").trim() || "v1";

  return { apiVersion, requestId, topic, lang, mode };
}

function normalizeResultPayload(assetPayload) {
  if (assetPayload && typeof assetPayload === "object" && "result" in assetPayload) {
    return assetPayload.result;
  }
  return assetPayload;
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
    const auth = authorize(env, request);
    if (!auth.ok) {
      return jsonResponse(request, auth.payload, auth.status);
    }
  }

  if (url.pathname === "/v1/topics" && request.method === "GET") {
    const topics = await readAssetJson(env, request, "/tutor-data/topics.json");
    if (!topics.ok) {
      return jsonResponse(request, { detail: "Not found" }, 404);
    }

    return jsonResponse(request, topics.payload, 200);
  }

  if (url.pathname === "/v1/run" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(request, { detail: "Invalid JSON" }, 400);
    }

    const run = normalizeRunBody(body);
    if (!run.topic || !run.lang) {
      return jsonResponse(request, { detail: "Missing required fields: topic, lang" }, 400);
    }

    const assetPath = `/tutor-data/run/${run.topic}.${run.lang}.${run.mode}.json`;
    const asset = await readAssetJson(env, request, assetPath);
    if (!asset.ok) {
      return jsonResponse(request, { detail: "Not found" }, 404);
    }

    return jsonResponse(
      request,
      {
        api_version: run.apiVersion,
        request_id: run.requestId,
        topic: run.topic,
        lang: run.lang,
        result: normalizeResultPayload(asset.payload),
      },
      200,
    );
  }

  return jsonResponse(request, { detail: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
