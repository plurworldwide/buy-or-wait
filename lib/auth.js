// Keeps the idealo login: reads/writes .env and swaps the saved refresh token for a short-lived access token.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const AUTH_BASE = "https://mcp.idealo.com";
export const SCOPE = "openid https://mcp.idealo.com/mcp/api.full-access";
const ENV_FILE = ".env";

export function readEnv() {
  const env = {};
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
  }
  return { ...env, ...pick(process.env) };
}

function pick(e) {
  const out = {};
  for (const k of ["IDEALO_CLIENT_ID", "IDEALO_REFRESH_TOKEN"]) if (e[k]) out[k] = e[k];
  return out;
}

export function saveEnv(values) {
  const merged = { ...readEnv(), ...values };
  writeFileSync(ENV_FILE, Object.entries(merged).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
}

let cached = null; // { token, expiresAt }

export async function getAccessToken() {
  if (cached && Date.now() < cached.expiresAt - 60000) return cached.token;
  const { IDEALO_CLIENT_ID, IDEALO_REFRESH_TOKEN } = readEnv();
  if (!IDEALO_CLIENT_ID || !IDEALO_REFRESH_TOKEN) {
    throw new Error('Not logged in to idealo. Run "npm run login" first.');
  }
  const res = await fetch(`${AUTH_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: IDEALO_REFRESH_TOKEN, client_id: IDEALO_CLIENT_ID }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`idealo login expired or invalid (${data.error || res.status}). Run "npm run login" again.`);
  }
  if (data.refresh_token && data.refresh_token !== IDEALO_REFRESH_TOKEN) {
    try { saveEnv({ IDEALO_REFRESH_TOKEN: data.refresh_token }); } catch { /* read-only on servers */ }
  }
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}
