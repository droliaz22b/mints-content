/// <reference path="../pb_data/types.d.ts" />

// ─────────────────────────────────────────────────────────────────────────────
// Server-side OpenAI proxy for CreatorCMS.
//
// The shared OpenAI key is stored in the locked `app_secrets` collection (no
// client read access). These routes inject it server-side so the key is never
// sent to the browser. All authenticated users can call /api/ai/chat; only
// admins can view status or set the key.
//
// Deploy: place this file in the PocketBase container at /pb/pb_hooks/ai.pb.js
// and restart PocketBase. Targets PocketBase v0.23+.
// ─────────────────────────────────────────────────────────────────────────────

// Reads the stored key server-side (bypasses API rules — runs as the app).
function loadOpenAiKey() {
  try {
    const rec = $app.findFirstRecordByFilter("app_secrets", "id != ''")
    return rec ? rec.getString("openai_key") : ""
  } catch (_) {
    return ""
  }
}

// Parse a $http.send response body across PocketBase minor versions.
function parseBody(res) {
  const raw = res.body !== undefined && res.body !== null ? res.body : res.raw
  try {
    return JSON.parse(raw)
  } catch (_) {
    return { error: { message: "Upstream returned non-JSON response." } }
  }
}

// POST /api/ai/chat — proxy to OpenAI chat completions (any logged-in user).
routerAdd(
  "POST",
  "/api/ai/chat",
  (e) => {
    const key = loadOpenAiKey()
    if (!key) {
      return e.json(400, {
        message: "OpenAI key not configured. Ask an admin to set it in Settings.",
      })
    }

    const payload = e.requestInfo().body

    const res = $http.send({
      url: "https://api.openai.com/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify(payload),
      timeout: 120,
    })

    return e.json(res.statusCode, parseBody(res))
  },
  $apis.requireAuth()
)

// GET /api/ai/config — is a key configured? (admin only)
routerAdd(
  "GET",
  "/api/ai/config",
  (e) => {
    if (!e.auth || e.auth.getString("role") !== "admin") {
      return e.json(403, { message: "Admin only." })
    }
    return e.json(200, { configured: !!loadOpenAiKey() })
  },
  $apis.requireAuth()
)

// POST /api/ai/config — set / rotate the key (admin only).
routerAdd(
  "POST",
  "/api/ai/config",
  (e) => {
    if (!e.auth || e.auth.getString("role") !== "admin") {
      return e.json(403, { message: "Admin only." })
    }

    const data = new DynamicModel({ openai_key: "" })
    e.bindBody(data)

    const collection = $app.findCollectionByNameOrId("app_secrets")
    let rec
    try {
      rec = $app.findFirstRecordByFilter("app_secrets", "id != ''")
    } catch (_) {
      rec = new Record(collection)
    }

    rec.set("openai_key", (data.openai_key || "").trim())
    $app.save(rec)

    return e.json(200, { configured: !!rec.getString("openai_key") })
  },
  $apis.requireAuth()
)
