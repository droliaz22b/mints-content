# PocketBase Setup Guide

## 1. Install & Run PocketBase on Coolify

Deploy PocketBase using the Docker image: `ghcr.io/muchobien/pocketbase:latest`
- Map port 8090
- Mount a volume at `/pb/pb_data` for persistence
- Set env var: `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD`

After deploy, open `https://your-pb-domain.com/_/` to access the admin panel.

---

## 2. Create Collections

Go to **Collections** in the PocketBase admin panel and create the following:

---

### Collection: `users` (Auth type — already exists, just add fields)

Add these custom fields to the built-in `users` collection:
| Field     | Type   | Options                          | Required |
|-----------|--------|----------------------------------|----------|
| `name`    | Text   | —                                | Yes      |
| `role`    | Select | Values: `admin`, `editor`, `viewer` | Yes   |

---

### Collection: `recipes` (Base type)

| Field              | Type   | Options                                              | Required |
|--------------------|--------|------------------------------------------------------|----------|
| `sl_no`            | Number | Min: 1, Unique                                       | Yes      |
| `recipe_name`      | Text   | —                                                    | Yes      |
| `date`             | Date   | —                                                    | No       |
| `editor`           | Text   | —                                                    | No       |
| `category`         | Text   | —                                                    | No       |
| `tags`             | JSON   | —                                                    | No       |
| `instagram_format` | Text   | —                                                    | No       |
| `youtube_format`   | Text   | —                                                    | No       |
| `fb_editor`        | Text   | —                                                    | No       |
| `docs`             | Text   | —                                                    | No       |
| `thumbnails`       | Text   | —                                                    | No       |
| `website_draft`    | Text   | —                                                    | No       |
| `recipe_copy`      | Text   | Long text / Editor                                   | No       |
| `status`           | Select | Values: `Draft`,`Ready`,`Edited`,`Posted`,`Uploaded`,`Done` | Yes |
| `platforms`        | JSON   | —                                                    | No       |

**API Rules for `recipes`:**
- List/Search: `@request.auth.id != ""`
- View: `@request.auth.id != ""`
- Create: `@request.auth.id != ""`
- Update: `@request.auth.id != ""`
- Delete: `@request.auth.role = "admin"`

---

### Collection: `categories` (Base type)

| Field  | Type | Required |
|--------|------|----------|
| `name` | Text | Yes      |

**API Rules:** List/View = public. Create/Update/Delete = `@request.auth.role = "admin"`

---

### Collection: `tags` (Base type)

| Field   | Type | Required |
|---------|------|----------|
| `name`  | Text | Yes      |
| `color` | Text | No       |

**API Rules:** List/View = public. Create/Update/Delete = `@request.auth.role = "admin"`

---

## 3. Create the Admin User

In **Users** collection (not _superusers), create:
- Email: your admin email
- Password: your password
- name: Your Name
- role: `admin`

---

## 4. Configure CORS (if needed)

In PocketBase settings → Application, set the allowed origins to your frontend domain:
`https://your-frontend-domain.com`

---

## 5. Connect the Frontend

Set environment variable in your Coolify frontend deployment:
```
VITE_POCKETBASE_URL=https://your-pb-domain.com
```
