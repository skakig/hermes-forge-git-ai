// Server-only helpers for GitHub App authentication.
// Uses Web Crypto so it runs in the Cloudflare Worker SSR runtime.

function base64urlEncode(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const clean = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(clean);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf.buffer;
}

// PKCS#1 (RSA PRIVATE KEY) → PKCS#8 wrapping so Web Crypto can import it.
function pkcs1ToPkcs8(pkcs1: ArrayBuffer): ArrayBuffer {
  const prefix = new Uint8Array([
    0x30, 0x82, 0x00, 0x00, // SEQUENCE, len placeholder (2 bytes)
    0x02, 0x01, 0x00,       // version 0
    0x30, 0x0d,             // AlgorithmIdentifier SEQUENCE, 13 bytes
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,             // NULL params
    0x04, 0x82, 0x00, 0x00, // OCTET STRING, len placeholder (2 bytes)
  ]);
  const keyBytes = new Uint8Array(pkcs1);
  const total = prefix.length + keyBytes.length;
  const out = new Uint8Array(total);
  out.set(prefix, 0);
  out.set(keyBytes, prefix.length);
  const innerLen = keyBytes.length;
  out[24] = (innerLen >> 8) & 0xff;
  out[25] = innerLen & 0xff;
  const outerLen = total - 4;
  out[2] = (outerLen >> 8) & 0xff;
  out[3] = outerLen & 0xff;
  return out.buffer;
}

async function importAppPrivateKey(): Promise<CryptoKey> {
  const pem = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!pem) throw new Error("missing_private_key: GITHUB_APP_PRIVATE_KEY not set");
  const raw = pemToArrayBuffer(pem);
  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(pem);
  const der = isPkcs1 ? pkcs1ToPkcs8(raw) : raw;
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signAppJWT(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new Error("missing_app_id: GITHUB_APP_ID not set");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
  const head = base64urlEncode(JSON.stringify(header));
  const body = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${head}.${body}`;
  const key = await importAppPrivateKey();
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64urlEncode(sig)}`;
}

const tokenCache = new Map<number, { token: string; expiresAt: number }>();

export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const jwt = await signAppJWT();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "hermes-forge",
      },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`installation_token_failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { token: string; expires_at: string };
  const expiresAt = new Date(json.expires_at).getTime();
  tokenCache.set(installationId, { token: json.token, expiresAt });
  return json.token;
}

export type InstallationRepoDTO = {
  id: number;
  name: string;
  full_name: string;
  owner: string;
  private: boolean;
  default_branch: string;
  stargazers_count: number;
  open_issues_count: number;
  updated_at: string | null;
};

export type AppInstallationDTO = {
  installation_id: number;
  account_login: string;
  account_type: string;
  target_type: string;
  app_slug: string;
  repository_selection: string;
};

// Lists every installation of the App across all accounts.
// Uses the App JWT (not an installation token).
export async function listAllAppInstallations(): Promise<AppInstallationDTO[]> {
  const jwt = await signAppJWT();
  const out: AppInstallationDTO[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://api.github.com/app/installations?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "hermes-forge",
        },
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`list_installations_failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as Array<{
      id: number;
      account: { login: string; type: string };
      target_type: string;
      app_slug: string;
      repository_selection: string;
    }>;
    for (const i of json) {
      out.push({
        installation_id: i.id,
        account_login: i.account?.login ?? "unknown",
        account_type: i.account?.type ?? "User",
        target_type: i.target_type,
        app_slug: i.app_slug,
        repository_selection: i.repository_selection,
      });
    }
    if (json.length < 100) break;
    page++;
    if (page > 10) break;
  }
  return out;
}

export async function fetchInstallationRepos(
  installationId: number,
): Promise<InstallationRepoDTO[]> {
  const token = await getInstallationToken(installationId);
  const repos: InstallationRepoDTO[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "hermes-forge",
        },
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`installation_repos_failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as {
      repositories: Array<{
        id: number;
        name: string;
        full_name: string;
        owner: { login: string };
        private: boolean;
        default_branch: string;
        stargazers_count: number;
        open_issues_count: number;
        updated_at: string | null;
      }>;
    };
    for (const r of json.repositories) {
      repos.push({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        owner: r.owner.login,
        private: r.private,
        default_branch: r.default_branch,
        stargazers_count: r.stargazers_count,
        open_issues_count: r.open_issues_count,
        updated_at: r.updated_at,
      });
    }
    if (json.repositories.length < 100) break;
    page++;
    if (page > 10) break;
  }
  return repos;
}