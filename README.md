# Ardent Hub

The single home page for Ardent's tools at **ardentcf.com**, protected by
Cloudflare Access. Authorised users sign in once (email one-time code) and reach
every tool they're permitted to use. The admin panel lets an administrator add
and remove per-tool users from within the portal.

- `index.html` — landing page (tiles linking to each tool).
- `admin.html` — admin panel (`/admin`); visible only to administrators.
- `functions/api/access.js` — Cloudflare Pages Function. Reads the caller's
  Access identity and adds/removes users by editing each tool's Cloudflare
  Access **group** via the Cloudflare API.

## Hosting

Cloudflare Pages (Git-connected). No build step — it's static HTML plus a Pages
Function. **Build command:** *(none)*. **Output directory:** `/` (root).

## Environment (set in the Pages project → Settings → Variables & Secrets)

| Name | Type | Value |
|---|---|---|
| `CF_ACCOUNT_ID` | Variable | your Cloudflare account id |
| `ADMIN_EMAILS` | Variable | `gwilliams@ardentadvisors.com,garethwilliams236@gmail.com` |
| `CF_API_TOKEN` | **Secret** | API token, scoped to Account › *Access: Apps and Policies* (Edit) and *Access: Organizations, Identity Providers and Groups* (Edit) |

The token is created and held by you in Cloudflare; the code only reads it from
the environment.

## Cloudflare Access setup (one-time)

1. Zero Trust → Settings → Authentication: add the **One-time PIN** login method.
2. Access → Access Groups: create one group per tool, seeded with the admin emails:
   `Hydro Users`, `CRM Users`, `Multiples Users`, `Valuation Report Users`
   (names must match `functions/api/access.js`).
3. Access → Applications: add a self-hosted app for each host
   (`ardentcf.com`, `hydro.ardentcf.com`, `crm.ardentcf.com`,
   `multiples.ardentcf.com`, `valuation-report.ardentcf.com`) with an Allow
   policy referencing that host's group (plus the admins).
4. The apex app protects the hub; `/admin` is additionally gated in code to
   `ADMIN_EMAILS`.
