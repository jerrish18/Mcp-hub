import express, { type Request, type Response, type Router } from 'express';

export interface StudyWebImage {
  title: string;
  imageUrl: string;
  pageUrl: string;
  source: string;
  caption?: string;
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableImageUrl(url: string): boolean {
  if (!url.startsWith('https://')) return false;
  const lower = url.toLowerCase();
  if (lower.endsWith('.ogv') || lower.endsWith('.webm') || lower.endsWith('.mp4') || lower.endsWith('.pdf')) {
    return false;
  }
  return true;
}

function isLikelyDecorativeIcon(title: string, url: string): boolean {
  const combined = `${title} ${url}`.toLowerCase();
  return (
    combined.includes('commons-logo') ||
    combined.includes('wiki_letter') ||
    combined.includes('ambox_') ||
    combined.includes('question_book') ||
    combined.includes('flag_of_') ||
    combined.includes('edit-clear') ||
    combined.includes('crystal_clear')
  );
}

export async function searchEducationalWebImages(
  query: string,
  limit = 4,
  fetchFn: typeof fetch = fetch
): Promise<StudyWebImage[]> {
  const cleanQuery = query.trim().slice(0, 120);
  if (!cleanQuery) return [];

  const cappedLimit = Math.max(1, Math.min(8, limit));
  const results: StudyWebImage[] = [];
  const seenUrls = new Set<string>();

  const headers = {
    Accept: 'application/json',
    'User-Agent': 'MCP-Hub-Study-Reader/1.0 (https://github.com/modelcontextprotocol)',
  };

  // 1. Primary lookup: Wikipedia pageimages (high-relevance educational photos & diagrams)
  try {
    const wikiUrl =
      `https://en.wikipedia.org/w/api.php?action=query&generator=search` +
      `&gsrsearch=${encodeURIComponent(cleanQuery)}&gsrlimit=${cappedLimit + 3}` +
      `&prop=pageimages|info|extracts&piprop=thumbnail|name&pithumbsize=960` +
      `&inprop=url&exintro=1&explaintext=1&exsentences=1&format=json&origin=*`;

    const res = await fetchFn(wikiUrl, {
      headers,
      signal: AbortSignal.timeout(4000),
    });

    if (res.ok) {
      const json = (await res.json()) as {
        query?: {
          pages?: Record<
            string,
            {
              index?: number;
              title?: string;
              fullurl?: string;
              extract?: string;
              thumbnail?: { source?: string };
            }
          >;
        };
      };

      const pages = Object.values(json.query?.pages ?? {}).sort(
        (a, b) => (a.index ?? 999) - (b.index ?? 999)
      );

      for (const page of pages) {
        const imageUrl = page.thumbnail?.source ?? '';
        const title = page.title?.trim() ?? '';
        if (!imageUrl || !isUsableImageUrl(imageUrl)) continue;
        if (isLikelyDecorativeIcon(title, imageUrl)) continue;
        if (seenUrls.has(imageUrl)) continue;

        seenUrls.add(imageUrl);
        results.push({
          title: title || cleanQuery,
          imageUrl,
          pageUrl: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
          source: 'Wikipedia',
          caption: page.extract ? stripHtml(page.extract).slice(0, 140) : undefined,
        });
        if (results.length >= cappedLimit) return results;
      }
    }
  } catch {
    // Fall through to Wikimedia Commons lookup
  }

  // 2. Secondary lookup: Wikimedia Commons File namespace (diagrams, schematics, historical photos)
  if (results.length < cappedLimit) {
    try {
      const commonsUrl =
        `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
        `&gsrnamespace=6&gsrsearch=${encodeURIComponent(cleanQuery)}&gsrlimit=${cappedLimit + 5}` +
        `&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=960&format=json&origin=*`;

      const res = await fetchFn(commonsUrl, {
        headers,
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        const json = (await res.json()) as {
          query?: {
            pages?: Record<
              string,
              {
                index?: number;
                title?: string;
                imageinfo?: Array<{
                  url?: string;
                  thumburl?: string;
                  descriptionurl?: string;
                  mime?: string;
                  extmetadata?: {
                    ObjectName?: { value?: string };
                    ImageDescription?: { value?: string };
                  };
                }>;
              }
            >;
          };
        };

        const pages = Object.values(json.query?.pages ?? {}).sort(
          (a, b) => (a.index ?? 999) - (b.index ?? 999)
        );

        for (const page of pages) {
          const info = page.imageinfo?.[0];
          const imageUrl = info?.thumburl || info?.url || '';
          const mime = info?.mime ?? '';
          if (!imageUrl || !isUsableImageUrl(imageUrl)) continue;
          if (!mime.startsWith('image/')) continue;

          const rawTitle =
            info?.extmetadata?.ObjectName?.value ||
            (page.title ?? '').replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
          const cleanTitle = stripHtml(rawTitle).slice(0, 90) || cleanQuery;
          if (isLikelyDecorativeIcon(cleanTitle, imageUrl)) continue;
          if (seenUrls.has(imageUrl)) continue;

          const desc = info?.extmetadata?.ImageDescription?.value
            ? stripHtml(info.extmetadata.ImageDescription.value).slice(0, 140)
            : undefined;

          seenUrls.add(imageUrl);
          results.push({
            title: cleanTitle,
            imageUrl,
            pageUrl: info?.descriptionurl || imageUrl,
            source: 'Wikimedia Commons',
            caption: desc || undefined,
          });
          if (results.length >= cappedLimit) break;
        }
      }
    } catch {
      // Return any images collected so far
    }
  }

  return results;
}

export function createStudyImagesRouter(fetchFn: typeof fetch = fetch): Router {
  const router = express.Router();

  router.get('/study-images', async (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').trim();
    const limitParam = Number(req.query.limit ?? 3);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(6, limitParam)) : 3;

    if (!q) {
      res.status(400).json({ error: 'Query parameter "q" is required.', images: [] });
      return;
    }

    const images = await searchEducationalWebImages(q, limit, fetchFn);
    res.json({ query: q, images });
  });

  return router;
}
