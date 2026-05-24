const baseUrl = () => process.env.HERMES_API_URL!.replace(/\/$/, "");
const apiKey = () => process.env.HERMES_API_KEY!;

async function hermesFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Hermes API ${res.status}: ${text}`);
  }
  return res.json();
}

export type StartLoopInput = {
  repoFullName: string;
  githubToken: string;
  goals: string[];
  branch?: string;
};

export const hermes = {
  startLoop: (input: StartLoopInput) =>
    hermesFetch("/loops", { method: "POST", body: JSON.stringify(input) }),
  getLoop: (runId: string) => hermesFetch(`/loops/${runId}`),
};