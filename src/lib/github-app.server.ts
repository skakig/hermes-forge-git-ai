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
  // Strip PEM armor + any whitespace, convert base64url → base64,
  // drop any stray non-base64 characters, then pad to a multiple of 4.
  let clean = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "")
    // base64url → base64
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    // strip any remaining non-base64 characters (e.g. stray quotes)
    .replace(/[^A-Za-z0-9+/=]/g, "")
    // remove any '=' that aren't at the end, then re-pad below
    .replace(/=+/g, "");
  const pad = clean.length % 4;
  if (pad === 2) clean += "==";
  else if (pad === 3) clean += "=";
  else if (pad === 1) {
    throw new Error(
      "invalid_private_key: GITHUB_APP_PRIVATE_KEY base64 body has an impossible length (mod 4 === 1). The secret is truncated — re-paste the full .pem contents.",
    );
  }
  let binary: string;
  try {
    binary = atob(clean);
  } catch (e) {
    throw new Error(
      `invalid_private_key: base64 decode failed (${e instanceof Error ? e.message : String(e)}). The secret is likely truncated. Re-paste the full .pem contents.`,
    );
  }
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
  const rawSecret = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!rawSecret) throw new Error("missing_private_key: GITHUB_APP_PRIVATE_KEY not set");
  // Normalize common paste variants:
  //  - JSON-escaped newlines ("\\n")
  //  - Surrounding quotes
  //  - CRLF line endings
  let pem = rawSecret.trim();
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) {
    pem = pem.slice(1, -1);
  }
  pem = pem.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  if (!/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(pem)) {
    throw new Error(
      "invalid_private_key: GITHUB_APP_PRIVATE_KEY does not contain a PEM header. Paste the full contents of the .pem file downloaded from GitHub.",
    );
  }
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

// -------------------------------------------------------------------------
// GitHub REST helpers for the Hermes agent (branches, files, PRs).
// All calls authenticate with a fresh installation token.
// -------------------------------------------------------------------------

const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "hermes-forge",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function gh<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      ...GH_HEADERS,
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`gh_${res.status}: ${init.method ?? "GET"} ${path} :: ${body.slice(0, 400)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type RepoTreeEntry = { path: string; type: "blob" | "tree"; size?: number; sha: string };

export async function getBranchHeadSha(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const res = await gh<{ commit: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
  );
  return res.commit.sha;
}

export async function listRepoTree(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ sha: string; tree: RepoTreeEntry[]; truncated: boolean }> {
  const headSha = await getBranchHeadSha(token, owner, repo, branch);
  const res = await gh<{ sha: string; tree: RepoTreeEntry[]; truncated: boolean }>(
    token,
    `/repos/${owner}/${repo}/git/trees/${headSha}?recursive=1`,
  );
  return res;
}

export async function getFileContents(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<{ content: string; sha: string } | null> {
  try {
    const res = await gh<{ content: string; encoding: string; sha: string; type: string }>(
      token,
      `/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
    );
    if (res.type !== "file") return null;
    const decoded = atob(res.content.replace(/\n/g, ""));
    // utf8 decode
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    return { content: new TextDecoder().decode(bytes), sha: res.sha };
  } catch (e) {
    if (e instanceof Error && /gh_404/.test(e.message)) return null;
    throw e;
  }
}

export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  newBranch: string,
  fromSha: string,
): Promise<void> {
  await gh(token, `/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
  });
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function putFile(
  token: string,
  owner: string,
  repo: string,
  args: { path: string; content: string; branch: string; message: string; sha?: string },
): Promise<{ commit: { sha: string; html_url: string } }> {
  return gh(token, `/repos/${owner}/${repo}/contents/${args.path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    body: JSON.stringify({
      message: args.message,
      content: utf8ToBase64(args.content),
      branch: args.branch,
      ...(args.sha ? { sha: args.sha } : {}),
    }),
  });
}

export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  args: { title: string; head: string; base: string; body: string; draft?: boolean },
): Promise<{ number: number; html_url: string; node_id: string; draft: boolean }> {
  return gh(token, `/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: args.title,
      head: args.head,
      base: args.base,
      body: args.body,
      draft: args.draft ?? false,
    }),
  });
}

export async function addPRComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  await gh(token, `/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function markPRReadyForReview(token: string, prNodeId: string): Promise<void> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...GH_HEADERS,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }`,
      variables: { id: prNodeId },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`gh_graphql_${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(`gh_graphql: ${json.errors.map((e) => e.message).join("; ")}`);
}

// -------------------------------------------------------------------------
// CI checks
// -------------------------------------------------------------------------

export type CheckRunDTO = {
  id: number;
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | neutral | cancelled | timed_out | action_required | skipped
  html_url: string | null;
  output_title: string | null;
  output_summary: string | null;
};

export type StatusDTO = {
  context: string;
  state: string; // success | failure | pending | error
  description: string | null;
  target_url: string | null;
};

export async function getPRHeadSha(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string> {
  const pr = await gh<{ head: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/pulls/${prNumber}`,
  );
  return pr.head.sha;
}

export async function listPRChecks(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ runs: CheckRunDTO[]; statuses: StatusDTO[]; headSha: string }> {
  const headSha = await getPRHeadSha(token, owner, repo, prNumber);
  const [checkRes, statusRes] = await Promise.all([
    gh<{
      check_runs: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        html_url: string | null;
        output?: { title: string | null; summary: string | null };
      }>;
    }>(token, `/repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100`),
    gh<{
      statuses: Array<{
        context: string;
        state: string;
        description: string | null;
        target_url: string | null;
      }>;
    }>(token, `/repos/${owner}/${repo}/commits/${headSha}/status`),
  ]);
  const runs: CheckRunDTO[] = (checkRes.check_runs ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    html_url: r.html_url,
    output_title: r.output?.title ?? null,
    output_summary: r.output?.summary ?? null,
  }));
  const statuses: StatusDTO[] = statusRes.statuses ?? [];
  return { runs, statuses, headSha };
}

// -------------------------------------------------------------------------
// Failure log extraction. For each failing check, try to produce a string
// of real error output the AI can reason about — not just "Deploy failed."
// -------------------------------------------------------------------------

const MAX_LOG_CHARS = 6000; // tail-biased: errors live at the end of build logs

function tail(s: string, n = MAX_LOG_CHARS): string {
  if (!s) return "";
  const trimmed = s.replace(/\u001b\[[0-9;]*m/g, ""); // strip ANSI colors
  return trimmed.length <= n ? trimmed : "…[truncated]…\n" + trimmed.slice(-n);
}

export type FailureLog = {
  name: string;
  kind: "check_run" | "status";
  url: string | null;
  log: string;
};

async function fetchCheckRunOutputText(
  token: string,
  owner: string,
  repo: string,
  id: number,
): Promise<string> {
  try {
    const r = await gh<{ output?: { title?: string | null; summary?: string | null; text?: string | null } }>(
      token,
      `/repos/${owner}/${repo}/check-runs/${id}`,
    );
    const parts = [r.output?.title, r.output?.summary, r.output?.text].filter(Boolean) as string[];
    let body = parts.join("\n\n");
    try {
      const ann = await gh<Array<{ path?: string; start_line?: number; message?: string; annotation_level?: string }>>(
        token,
        `/repos/${owner}/${repo}/check-runs/${id}/annotations?per_page=30`,
      );
      if (ann?.length) {
        body += "\n\nAnnotations:\n" + ann
          .map((a) => `- [${a.annotation_level ?? "info"}] ${a.path ?? ""}:${a.start_line ?? "?"} — ${a.message ?? ""}`)
          .join("\n");
      }
    } catch {
      /* non-fatal */
    }
    return body;
  } catch (e) {
    return `(could not fetch check-run detail: ${e instanceof Error ? e.message : String(e)})`;
  }
}

async function fetchNetlifyDeployLog(targetUrl: string): Promise<string> {
  // Netlify's deploy log page is rendered client-side, but the public
  // "deploy-log" page contains a JSON blob with the build log. We do a
  // best-effort scrape: fetch the page, look for the most-recent "Build
  // failed" / error lines. If unavailable, fall back to the URL.
  try {
    const res = await fetch(targetUrl, {
      headers: { "User-Agent": "hermes-forge/1.0 (+https://hermes-forge-git-ai.lovable.app)" },
    });
    if (!res.ok) return `(netlify page returned ${res.status})`;
    const html = await res.text();
    // Crude: look for any pre-rendered log lines that mention error / failed / exited.
    const lines = html
      .split(/\r?\n/)
      .filter((l) => /error|failed|exit code|cannot find|module not found|enoent|✘|✖/i.test(l))
      .slice(-40)
      .map((l) => l.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);
    if (lines.length) return lines.join("\n");
    return `(no log lines extracted from ${targetUrl})`;
  } catch (e) {
    return `(netlify fetch failed: ${e instanceof Error ? e.message : String(e)})`;
  }
}

export async function collectFailureLogs(
  token: string,
  owner: string,
  repo: string,
  failing: Array<{
    name: string;
    state: string;
    url: string | null;
    summary: string | null;
    kind: "check_run" | "status";
    check_run_id?: number;
  }>,
): Promise<FailureLog[]> {
  const out: FailureLog[] = [];
  // Cap concurrency lightly to be polite to GitHub/Netlify.
  for (const f of failing.slice(0, 8)) {
    let log = "";
    if (f.kind === "check_run" && f.check_run_id) {
      log = await fetchCheckRunOutputText(token, owner, repo, f.check_run_id);
    } else if (f.kind === "status" && f.url && /netlify\.com\/.+\/deploys\//i.test(f.url)) {
      log = await fetchNetlifyDeployLog(f.url);
    } else if (f.summary) {
      log = f.summary;
    }
    out.push({ name: f.name, kind: f.kind, url: f.url, log: tail(log) });
  }
  return out;
}