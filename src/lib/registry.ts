const GHCR_TOKEN_URL = "https://ghcr.io/token";
const GHCR_TAGS_URL = "https://ghcr.io/v2";
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

// Cap a single tags/list page. GHCR's default is small enough that the
// release tag list overflows quickly (v0.0.17 was the first version to
// fall off the first page) — explicitly request a large page so the
// upgrade picker stays in sync with the registry without paginating.
const TAGS_PAGE_SIZE = 500;

export async function fetchImageTags(image: string): Promise<string[]> {
  const tokenRes = await fetch(
    `${GHCR_TOKEN_URL}?scope=repository:${image}:pull`,
  );
  if (!tokenRes.ok) {
    throw new Error(`Failed to get registry token: ${tokenRes.status}`);
  }
  const { token } = (await tokenRes.json()) as { token: string };

  // Walk pagination links so we never miss a release because the registry
  // happens to be one page over the default. GHCR returns RFC 5988 Link
  // headers like `<...?n=N&last=X>; rel="next"` — follow each until exhausted.
  let url: string | null =
    `${GHCR_TAGS_URL}/${image}/tags/list?n=${TAGS_PAGE_SIZE}`;
  const all: string[] = [];
  while (url) {
    const tagsRes: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!tagsRes.ok) {
      throw new Error(`Failed to fetch tags: ${tagsRes.status}`);
    }
    const { tags } = (await tagsRes.json()) as { tags?: string[] };
    if (Array.isArray(tags)) all.push(...tags);
    url = nextPageUrl(tagsRes.headers.get("link"));
  }

  return all
    .filter((t) => RELEASE_TAG.test(t))
    .sort((a, b) => compareSemver(b, a));
}

/**
 * Parse the RFC 5988 `Link: <...>; rel="next"` header GHCR returns when a
 * `tags/list` response is paginated. Returns the absolute URL of the next
 * page, or null when there is none.
 */
function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (match) {
      const raw = match[1];
      return raw.startsWith("http") ? raw : `${GHCR_TAGS_URL.replace(/\/v2$/, "")}${raw}`;
    }
  }
  return null;
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
