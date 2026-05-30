import * as cheerio from "cheerio";

export interface CrawlOptions {
  /** How many levels of links to follow from the start URL. 0 = only the start page. Default: Infinity. */
  maxDepth?: number;
  /** Stop once this many unique links have been collected. Default: Infinity. */
  maxLinks?: number;
  /** Total crawl time budget in milliseconds. When elapsed, return what was found. Default: none. */
  timeout?: number;
}

interface QueueItem {
  url: string;
  depth: number;
}

/**
 * Fetch a page and return its HTML, or `null` if the response is not OK or not HTML.
 * Aborts if the remaining time budget (until `deadline`) runs out.
 */
async function fetchPage(url: string, deadline: number): Promise<string | null> {
  const controller = new AbortController();
  const remaining = deadline - Date.now();
  const timer = Number.isFinite(remaining)
    ? setTimeout(() => controller.abort(), Math.max(0, remaining))
    : undefined;

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Crawl a website starting from `startUrl` and return the unique links discovered.
 *
 * Only same-origin links are followed and recorded; links to other origins are ignored.
 *
 * @param startUrl The URL to start crawling from.
 * @param options Optional limits: `maxDepth`, `maxLinks`, and `timeout`.
 * @returns A flat array of unique links found across the crawled pages.
 */
export async function crawl(startUrl: string, options: CrawlOptions = {}): Promise<string[]> {
  let origin: string;
  try {
    origin = new URL(startUrl).origin;
  } catch {
    throw new Error(`Invalid start URL: ${startUrl}`);
  }

  const maxDepth = options.maxDepth ?? Infinity;
  const maxLinks = options.maxLinks ?? Infinity;
  const deadline = options.timeout !== undefined ? Date.now() + options.timeout : Infinity;

  const found = new Set<string>();
  const visited = new Set<string>();
  const queue: QueueItem[] = [{ url: startUrl, depth: 0 }];

  while (queue.length > 0 && Date.now() < deadline && found.size < maxLinks) {
    const item = queue.shift()!;
    if (visited.has(item.url)) {
      continue;
    }
    visited.add(item.url);

    const html = await fetchPage(item.url, deadline);
    if (html === null) {
      continue;
    }

    const $ = cheerio.load(html);
    for (const element of $("a")) {
      const href = element.attribs["href"];
      if (href === undefined) {
        continue;
      }

      let resolved: URL;
      try {
        resolved = new URL(href, item.url);
      } catch {
        continue;
      }

      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
        continue;
      }

      // Only same-origin links are recorded and crawled; external links are ignored.
      if (resolved.origin !== origin) {
        continue;
      }

      resolved.hash = "";
      const link = resolved.toString();

      if (found.size < maxLinks) {
        found.add(link);
      }

      if (item.depth < maxDepth && !visited.has(link)) {
        queue.push({ url: link, depth: item.depth + 1 });
      }
    }
  }

  return [...found];
}
