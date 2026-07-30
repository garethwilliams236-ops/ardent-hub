/**
 * Ardent Hub — access management API (Cloudflare Pages Function).
 *
 * Runs behind Cloudflare Access, so every request already carries a verified
 * identity in the `Cf-Access-Jwt-Assertion` header. The admin panel calls this
 * to list, add and remove per-tool users; under the hood it edits one
 * Cloudflare Access *group* per tool (the group each tool's policy allows).
 *
 * Environment (set in the Pages project — never hard-coded):
 *   CF_API_TOKEN    secret; token scoped to Account › Access: Apps and Policies,
 *                   and Access: Organizations, Identity Providers and Groups (Edit)
 *   CF_ACCOUNT_ID   the Cloudflare account id
 *   ADMIN_EMAILS    comma-separated admin addresses (full access + this panel)
 *
 * Group names must match the TOOLS map below (created once in Cloudflare Access).
 */

const API = "https://api.cloudflare.com/client/v4";

const TOOLS = [
  { key: "hydro", label: "Project Hydro", group: "Hydro Users", url: "https://hydro.ardentcf.com" },
  { key: "crm", label: "CRM", group: "CRM Users", url: "https://crm.ardentcf.com" },
  { key: "multiples", label: "Multiples", group: "Multiples Users", url: "https://multiples.ardentcf.com" },
  { key: "valuation-report", label: "Valuation Report", group: "Valuation Report Users", url: "https://valuation-report.ardentcf.com" },
];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

function callerEmail(request) {
  // Access injects a signed JWT; its payload carries the authenticated email.
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (jwt) {
    try {
      const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.email) return String(payload.email).toLowerCase();
    } catch (_) { /* fall through */ }
  }
  const hdr = request.headers.get("Cf-Access-Authenticated-User-Email");
  return hdr ? hdr.toLowerCase() : null;
}

function admins(env) {
  return (env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function cf(env, path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      authorization: `Bearer ${env.CF_API_TOKEN}`,
      "content-type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const msg = (body.errors && body.errors.map((e) => e.message).join("; ")) || res.statusText;
    throw new Error(`Cloudflare API ${res.status}: ${msg}`);
  }
  return body.result;
}

async function groupByName(env, name) {
  const groups = await cf(env, `/accounts/${env.CF_ACCOUNT_ID}/access/groups?per_page=100`);
  const g = (groups || []).find((x) => x.name === name);
  if (!g) throw new Error(`Access group not found: "${name}" — create it in Cloudflare Access first.`);
  return g;
}

const emailsOf = (group) =>
  (group.include || []).filter((r) => r.email && r.email.email).map((r) => r.email.email.toLowerCase());
const nonEmailIncludes = (group) => (group.include || []).filter((r) => !(r.email && r.email.email));

async function setEmails(env, group, emails) {
  const include = [...nonEmailIncludes(group), ...emails.map((e) => ({ email: { email: e } }))];
  return cf(env, `/accounts/${env.CF_ACCOUNT_ID}/access/groups/${group.id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: group.name,
      include,
      exclude: group.exclude || [],
      require: group.require || [],
    }),
  });
}

function toolBy(key) {
  const t = TOOLS.find((x) => x.key === key);
  if (!t) throw new Error(`Unknown tool: ${key}`);
  return t;
}

function requireAdmin(request, env) {
  const email = callerEmail(request);
  if (!email || !admins(env).includes(email)) {
    throw Object.assign(new Error("Admin access required."), { status: 403 });
  }
  return email;
}

async function membersForAll(env) {
  const out = [];
  for (const t of TOOLS) {
    const g = await groupByName(env, t.group);
    out.push({ ...t, members: emailsOf(g).sort() });
  }
  return out;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const email = callerEmail(request);
  const isAdmin = !!email && admins(env).includes(email);

  if (url.searchParams.get("q") === "whoami") {
    return json({ email, isAdmin, tools: TOOLS.map(({ key, label, url }) => ({ key, label, url })) });
  }
  try {
    requireAdmin(request, env);
    return json({ tools: await membersForAll(env) });
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    requireAdmin(request, env);
    const { tool, email } = await request.json();
    const addr = String(email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return json({ error: "Enter a valid email." }, 400);
    const g = await groupByName(env, toolBy(tool).group);
    const emails = emailsOf(g);
    if (!emails.includes(addr)) await setEmails(env, g, [...emails, addr]);
    const updated = await groupByName(env, toolBy(tool).group);
    return json({ tool, members: emailsOf(updated).sort() });
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const admin = requireAdmin(request, env);
    const { tool, email } = await request.json();
    const addr = String(email || "").trim().toLowerCase();
    if (admins(env).includes(addr)) return json({ error: "Seeded admins cannot be removed here." }, 400);
    if (addr === admin) return json({ error: "You cannot remove yourself." }, 400);
    const g = await groupByName(env, toolBy(tool).group);
    await setEmails(env, g, emailsOf(g).filter((e) => e !== addr));
    const updated = await groupByName(env, toolBy(tool).group);
    return json({ tool, members: emailsOf(updated).sort() });
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
}
