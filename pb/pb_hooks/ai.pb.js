/// <reference path="../pb_data/types.d.ts" />

// ─────────────────────────────────────────────────────────────────────────────
// Server-side OpenAI proxy for CreatorCMS.
//
// The shared OpenAI key is stored in the locked `app_secrets` collection (no
// client read access). These routes inject it server-side so the key is never
// sent to the browser. All authenticated users can call /api/ai/chat; only
// admins can view status or set the key.
//
// Deploy: place this file in the PocketBase hooks dir (/app/pb_hooks/ai.pb.js)
// and it auto-reloads. Targets PocketBase v0.23+.
// ─────────────────────────────────────────────────────────────────────────────

function loadOpenAiKey() {
  try {
    const rec = $app.findFirstRecordByFilter("app_secrets", "id != ''")
    return rec ? rec.get("openai_key") : ""
  } catch (_) {
    return ""
  }
}

function isAdmin(e) {
  try {
    return !!e.auth && e.auth.get("role") === "admin"
  } catch (_) {
    return false
  }
}

// POST /api/ai/chat — proxy to OpenAI chat completions (any logged-in user).
routerAdd("POST", "/api/ai/chat", (e) => {
  try {
    const key = loadOpenAiKey()
    if (!key) {
      return e.json(400, { message: "OpenAI key not configured. Ask an admin to set it in Settings." })
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

    let parsed
    try {
      parsed = JSON.parse(res.body)
    } catch (_) {
      try {
        parsed = JSON.parse(res.raw)
      } catch (_2) {
        parsed = { error: { message: "Upstream returned a non-JSON response." } }
      }
    }

    return e.json(res.statusCode, parsed)
  } catch (err) {
    try { $app.logger().error("ai/chat failed: " + String(err)) } catch (_) {}
    return e.json(500, { message: "AI proxy error: " + String(err) })
  }
}, $apis.requireAuth())

// GET /api/ai/config — is a key configured? (admin only)
routerAdd("GET", "/api/ai/config", (e) => {
  try {
    if (!isAdmin(e)) return e.json(403, { message: "Admin only." })
    return e.json(200, { configured: !!loadOpenAiKey() })
  } catch (err) {
    return e.json(500, { message: "config error: " + String(err) })
  }
}, $apis.requireAuth())

// POST /api/ai/config — set / rotate the key (admin only).
routerAdd("POST", "/api/ai/config", (e) => {
  try {
    if (!isAdmin(e)) return e.json(403, { message: "Admin only." })

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

    return e.json(200, { configured: !!rec.get("openai_key") })
  } catch (err) {
    return e.json(500, { message: "save error: " + String(err) })
  }
}, $apis.requireAuth())
