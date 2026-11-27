// One-time idealo login. Run: npm run login
// Opens idealo's sign-in page in your browser; you sign in; the result is saved to .env.
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { exec } from "node:child_process";
import { AUTH_BASE, SCOPE, saveEnv } from "../lib/auth.js";

const PORT = 6274; // idealo only accepts this return address
const REDIRECT = `http://localhost:${PORT}/oauth/callback`;
const b64url = (buf) => buf.toString("base64url");

// 1. Register this app with idealo (free, no secret).
const reg = await fetch(`${AUTH_BASE}/oauth2/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ client_name: "buy-or-wait", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none", scope: SCOPE }),
}).then((r) => r.json());
if (!reg.client_id) {
  console.error("Could not register with idealo:", reg.error_description || reg);
  process.exit(1);
}

// 2. Build the sign-in link (PKCE keeps it safe without a secret).
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const state = b64url(randomBytes(16));
const authUrl = `${AUTH_BASE}/oauth2/authorize?` + new URLSearchParams({
  response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, scope: SCOPE,
  state, code_challenge: challenge, code_challenge_method: "S256",
});

// 3. Wait for idealo to send you back here after you sign in.
const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== "/oauth/callback") { res.writeHead(404).end(); return; }
  const finish = (msg, ok) => {
    res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html" }).end(`<h2>${msg}</h2><p>You can close this tab.</p>`);
    console.log(ok ? `\n✔ ${msg}` : `\n✖ ${msg}`);
    server.close();
    process.exitCode = ok ? 0 : 1;
  };
  if (url.searchParams.get("state") !== state) return finish("Login failed: state mismatch.", false);
  const code = url.searchParams.get("code");
  if (!code) return finish(`Login failed: ${url.searchParams.get("error_description") || url.searchParams.get("error")}`, false);

  const tok = await fetch(`${AUTH_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier }),
  }).then((r) => r.json());
  if (!tok.refresh_token) return finish(`Login failed: ${tok.error_description || tok.error || "no refresh token returned"}`, false);

  saveEnv({ IDEALO_CLIENT_ID: reg.client_id, IDEALO_REFRESH_TOKEN: tok.refresh_token });
  finish("Logged in to idealo. Saved to .env", true);
});

server.listen(PORT, () => {
  console.log("Opening idealo sign-in in your browser...");
  console.log("If nothing opens, copy this link into your browser:\n\n" + authUrl + "\n");
  exec(`start "" "${authUrl}"`);
});
