import * as cheerio from "cheerio";
/**
 * File extensions that never point at an HTML page. Links whose path ends in one of
 * these are excluded from the results without making a request.
 */
const NON_HTML_EXTENSIONS = new Set([
    // media
    "mp4",
    "webm",
    "mov",
    "avi",
    "mkv",
    "mp3",
    "wav",
    "ogg",
    "flac",
    // images
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "ico",
    "bmp",
    "avif",
    // docs / archives
    "pdf",
    "zip",
    "gz",
    "tar",
    "rar",
    "7z",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    // assets / data
    "css",
    "js",
    "mjs",
    "json",
    "xml",
    "rss",
    "woff",
    "woff2",
    "ttf",
    "eot",
]);
/** True if the URL path ends in a known non-HTML file extension. */
function hasNonHtmlExtension(pathname) {
    const slash = pathname.lastIndexOf("/");
    const dot = pathname.lastIndexOf(".");
    if (dot <= slash + 1) {
        return false; // no dot in the last path segment, or a leading-dot "dotfile"
    }
    return NON_HTML_EXTENSIONS.has(pathname.slice(dot + 1).toLowerCase());
}
/**
 * Fetch a URL, aborting if the remaining time budget (until `deadline`) runs out.
 * Returns the `Response`, or `null` if the request throws or is aborted.
 */
async function fetchWithDeadline(url, init, deadline) {
    const controller = new AbortController();
    const remaining = deadline - Date.now();
    const timer = Number.isFinite(remaining)
        ? setTimeout(() => controller.abort(), Math.max(0, remaining))
        : undefined;
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    }
    catch {
        return null;
    }
    finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}
/**
 * Fetch a page and return its HTML, or `null` if the response is not OK or not HTML.
 * Aborts if the remaining time budget (until `deadline`) runs out.
 */
async function fetchPage(url, deadline) {
    const response = await fetchWithDeadline(url, {}, deadline);
    if (response === null || !response.ok) {
        return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
        return null;
    }
    return await response.text();
}
/**
 * Verify whether a discovered link points at a non-HTML resource via a HEAD request.
 *
 * Only returns `true` when we positively confirm the resource is not HTML (an OK
 * response carrying a non-`text/html` `Content-Type`). When we cannot confirm — the
 * request fails or is aborted, the status is not OK, or the header is missing — the
 * link is kept (`false`), so servers that reject HEAD or transient errors never drop a
 * valid page.
 */
async function isNonHtmlResource(url, deadline) {
    const response = await fetchWithDeadline(url, { method: "HEAD" }, deadline);
    if (response === null || !response.ok) {
        return false;
    }
    const contentType = response.headers.get("content-type");
    if (contentType === null) {
        return false;
    }
    return !contentType.includes("text/html");
}
/**
 * Crawl a website starting from `startUrl` and return the unique links discovered.
 *
 * Only same-origin links are followed and recorded; links to other origins are ignored.
 *
 * @param startUrl The URL to start crawling from.
 * @param options Optional limits: `maxDepth`, `maxLinks`, and `timeout`.
 * @returns A flat array of unique links found across the crawled pages, sorted alphabetically.
 */
export async function crawl(startUrl, options = {}) {
    let origin;
    try {
        origin = new URL(startUrl).origin;
    }
    catch {
        throw new Error(`Invalid start URL: ${startUrl}`);
    }
    const maxDepth = options.maxDepth ?? Infinity;
    const maxLinks = options.maxLinks ?? Infinity;
    const deadline = options.timeout !== undefined ? Date.now() + options.timeout : Infinity;
    const found = new Set();
    const visited = new Set();
    const htmlChecked = new Map();
    const queue = [{ url: startUrl, depth: 0 }];
    while (queue.length > 0 && Date.now() < deadline && found.size < maxLinks) {
        const item = queue.shift();
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
            // Once the link budget is full the outer loop will stop, so there is no point
            // verifying or enqueueing any further anchors on this page.
            if (found.size >= maxLinks) {
                break;
            }
            const href = element.attribs["href"];
            if (href === undefined) {
                continue;
            }
            let resolved;
            try {
                resolved = new URL(href, item.url);
            }
            catch {
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
            // Exclude links that don't point at an HTML page: first a cheap extension
            // check, then a cached HEAD content-type check for anything that survives it.
            if (hasNonHtmlExtension(resolved.pathname)) {
                continue;
            }
            let nonHtml = htmlChecked.get(link);
            if (nonHtml === undefined) {
                nonHtml = await isNonHtmlResource(link, deadline);
                htmlChecked.set(link, nonHtml);
            }
            if (nonHtml) {
                continue;
            }
            found.add(link);
            if (item.depth < maxDepth && !visited.has(link)) {
                queue.push({ url: link, depth: item.depth + 1 });
            }
        }
    }
    return [...found].sort();
}
