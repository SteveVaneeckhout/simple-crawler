# simple-crawler

Finds webpages by crawling a website. Give it a URL and it returns the unique links it discovers, with optional limits on crawl depth, number of links, and total time.

- Same-origin crawling: only links on the start URL's origin are followed and returned. Links to other origins are ignored.
- Returns a flat, de-duplicated `string[]` of absolute URLs.
- No HTTP-client dependency — uses the platform's native `fetch`.
- Written in TypeScript, ships with type definitions, ESM-only.

## Requirements

- Node.js **>= 24.15.0** (relies on global `fetch` / `AbortController`)
- ES module project (`"type": "module"` or `import` syntax)

## Installation

```bash
npm install simple-crawler
```

## Usage

```ts
import { crawl } from "simple-crawler";

const links = await crawl("https://example.com/", {
  maxDepth: 2,
  maxLinks: 500,
  timeout: 30_000,
});

console.log(links);
// [
//   "https://example.com/about",
//   "https://example.com/contact",
//   ...
// ]
```

With no options it crawls the whole same-origin site with no limits:

```ts
const links = await crawl("https://example.com/");
```

## API

### `crawl(startUrl, options?)`

```ts
function crawl(startUrl: string, options?: CrawlOptions): Promise<string[]>;
```

Crawls `startUrl` and resolves to an array of unique, absolute links found across the
crawled pages. Throws if `startUrl` is not a valid URL.

#### `CrawlOptions`

| Option     | Type     | Default    | Description                                                                                      |
| ---------- | -------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `maxDepth` | `number` | `Infinity` | How many levels of links to follow from the start URL. `0` only reads the start page.            |
| `maxLinks` | `number` | `Infinity` | Stop once this many unique links have been collected.                                            |
| `timeout`  | `number` | _none_     | Total crawl time budget in milliseconds. When it elapses, whatever was found so far is returned. |

## Behavior & notes

- **Scope.** Only links on the same origin (scheme + host + port) as `startUrl` are
  followed and included in the result. Links to other origins are ignored entirely.
- **Depth.** Depth `0` is the start page. `maxDepth: 1` follows links found on the start
  page but not links found on those pages, and so on.
- **Return value.** The start page's own URL is not included; only links discovered in
  page HTML are. Hash fragments (`#section`) are stripped, query strings are kept.
- **Skipped links.** Non-`http(s)` schemes (`mailto:`, `tel:`, `javascript:`, …) and
  malformed hrefs are ignored.
- **Resilience.** A page that fails to fetch, returns a non-OK status, or isn't HTML is
  skipped — one bad page never aborts the crawl.
- **Crawl order.** Breadth-first and sequential (deterministic), so the returned order
  reflects the order links were discovered.

### Bot protection

Sites behind a JavaScript bot challenge (e.g. Cloudflare "Just a moment…") return a
`403` challenge page instead of real HTML, so they yield no links. A `fetch`-based
crawler cannot solve these challenges. If you control the site, the reliable fix is a
WAF **Skip** rule that exempts your crawler by IP or by a secret request header.

## Development

```bash
npm run typecheck   # type-check with tsc
npm test            # run the test suite (vitest)
npm run test:coverage
npm run fmt         # format with oxfmt
npm run build       # emit dist/
```

## License

[MIT](./LICENSE) © Steve Vaneeckhout
