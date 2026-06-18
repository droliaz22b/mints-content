/// <reference path="../pb_data/types.d.ts" />

// ─────────────────────────────────────────────────────────────────────────────
// Server-side OpenAI proxy for CreatorCMS.
//
// The shared OpenAI key is stored in the locked `app_secrets` collection (no
// client read access). These routes inject it server-side so the key is never
// sent to the browser. All authenticated users can call /api/ai/chat; only
// admins can view status or set the key.
//
// NOTE: PocketBase JSVM runs each route handler in an isolated sandbox that
// CANNOT access top-level helper functions in this file. All logic must be
// inlined inside each handler. Deploy at /app/pb_hooks/ai.pb.js (v0.23+).
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/ai/chat — proxy to OpenAI chat completions (any logged-in user).
routerAdd("POST", "/api/ai/chat", (e) => {
  try {
    let key = ""
    try {
      const rec = $app.findFirstRecordByFilter("app_secrets", "id != ''")
      key = rec ? rec.get("openai_key") : ""
    } catch (_) {}

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
    return e.json(500, { message: "AI proxy error: " + String(err) })
  }
}, $apis.requireAuth())

// GET /api/ai/config — is a key configured? (admin only)
routerAdd("GET", "/api/ai/config", (e) => {
  try {
    let admin = false
    try { admin = !!e.auth && e.auth.get("role") === "admin" } catch (_) {}
    if (!admin) return e.json(403, { message: "Admin only." })

    let key = ""
    try {
      const rec = $app.findFirstRecordByFilter("app_secrets", "id != ''")
      key = rec ? rec.get("openai_key") : ""
    } catch (_) {}

    return e.json(200, { configured: !!key })
  } catch (err) {
    return e.json(500, { message: "config error: " + String(err) })
  }
}, $apis.requireAuth())

// POST /api/ai/config — set / rotate the key (admin only).
routerAdd("POST", "/api/ai/config", (e) => {
  try {
    let admin = false
    try { admin = !!e.auth && e.auth.get("role") === "admin" } catch (_) {}
    if (!admin) return e.json(403, { message: "Admin only." })

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
