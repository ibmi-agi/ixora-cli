const GHCR_TOKEN_URL = "https://ghcr.io/token";
const GHCR_TAGS_URL = "https://ghcr.io/v2";
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

export async function fetchImageTags(image: string): Promise<string[]> {
  const tokenRes = await fetch(
    `${GHCR_TOKEN_URL}?scope=repository:${image}:pull`,
  );
  if (!tokenRes.ok) {
    throw new Error(`Failed to get registry token: ${tokenRes.status}`);
  }
  const { token } = (await tokenRes.json()) as { token: string };

  const tagsRes = await fetch(`${GHCR_TAGS_URL}/${image}/tags/list`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!tagsRes.ok) {
    throw new Error(`Failed to fetch tags: ${tagsRes.status}`);
  }
  const { tags } = (await tagsRes.json()) as { tags: string[] };

  return tags
    .filter((t) => RELEASE_TAG.test(t))
    .sort((a, b) => compareSemver(b, a));
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function normalizeVersion(version: string): string {
  const v = version.trim();
  return v.startsWith("v") ? v : `v${v}`;
}
