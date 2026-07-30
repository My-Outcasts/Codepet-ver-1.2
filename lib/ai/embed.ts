// Server-only embedding seam (holds VOYAGE_API_KEY). Provider-agnostic surface so the rest
// of P2 (retrieval, routes) never imports Voyage directly. Inert unless the feature is on:
// both a Voyage key and the SECOND_BRAIN_RECALL flag must be present.
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3';
const BATCH = 128;

export function isEmbedEnabled(): boolean {
  return !!process.env.VOYAGE_API_KEY && process.env.SECOND_BRAIN_RECALL === '1';
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY not set');
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const input = texts.slice(i, i + BATCH);
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input, model: MODEL }),
    });
    if (!res.ok) throw new Error(`voyage ${res.status}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    out.push(...json.data.map((d) => d.embedding));
  }
  return out;
}
