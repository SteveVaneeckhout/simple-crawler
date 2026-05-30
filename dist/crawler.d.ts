export interface CrawlOptions {
    /** How many levels of links to follow from the start URL. 0 = only the start page. Default: Infinity. */
    maxDepth?: number;
    /** Stop once this many unique links have been collected. Default: Infinity. */
    maxLinks?: number;
    /** Total crawl time budget in milliseconds. When elapsed, return what was found. Default: none. */
    timeout?: number;
}
/**
 * Crawl a website starting from `startUrl` and return the unique links discovered.
 *
 * Only same-origin pages are followed; external links are recorded but not crawled.
 *
 * @param startUrl The URL to start crawling from.
 * @param options Optional limits: `maxDepth`, `maxLinks`, and `timeout`.
 * @returns A flat array of unique links found across the crawled pages.
 */
export declare function crawl(startUrl: string, options?: CrawlOptions): Promise<string[]>;
