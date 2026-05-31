import { afterEach, describe, expect, it, vi } from "vitest";
import { crawl } from "../src/crawler.js";

interface ResponseOptions {
  ok?: boolean;
  /** `undefined` => default "text/html"; pass `null` to simulate a missing header. */
  contentType?: string | null;
}

function makeResponse(body: string, options: ResponseOptions = {}): Response {
  const ok = options.ok ?? true;
  const contentType = options.contentType === undefined ? "text/html" : options.contentType;
  return {
    ok,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null),
    },
    text: async () => body,
  } as unknown as Response;
}

interface PageSpec {
  html?: string;
  ok?: boolean;
  contentType?: string | null;
  throws?: boolean;
}

function stubFetch(pages: Record<string, PageSpec>) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const page = pages[url];
    if (page === undefined) {
      return makeResponse("", { ok: false });
    }
    if (page.throws === true) {
      throw new Error("network error");
    }
    return makeResponse(page.html ?? "", { ok: page.ok, contentType: page.contentType });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("crawl", () => {
  it("returns deduped same-origin links from a single page (maxDepth 0 does not recurse)", async () => {
    const fetchMock = stubFetch({
      "http://example.com/": {
        html: `
          <a href="/a">a</a>
          <a href="/a">a again</a>
          <a href="http://other.com/x">external http</a>
          <a href="https://secure.com/">external https</a>
          <a>no href</a>
        `,
      },
    });

    const links = await crawl("http://example.com/", { maxDepth: 0 });

    // External links (other.com, secure.com) are ignored; only same-origin links are returned.
    expect(links).toEqual(["http://example.com/a"]);
    // One GET for the start page plus one HEAD to verify "/a" is HTML.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("follows same-origin links up to maxDepth, ignoring external links", async () => {
    const fetchMock = stubFetch({
      "http://example.com/": {
        html: `<a href="/a">a</a><a href="http://other.com/">external</a>`,
      },
      "http://example.com/a": {
        html: `<a href="/b">b</a>`,
      },
    });

    const links = await crawl("http://example.com/", { maxDepth: 1 });

    // The external link is neither recorded nor requested.
    expect(links).toEqual(["http://example.com/a", "http://example.com/b"]);
    // GET "/" + HEAD "/a", then GET "/a" + HEAD "/b": two pages crawled, two links verified.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).not.toHaveBeenCalledWith("http://other.com/", expect.anything());
  });

  it("stops once maxLinks unique links have been collected", async () => {
    const fetchMock = stubFetch({
      "http://example.com/": {
        html: `<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a>`,
      },
    });

    const links = await crawl("http://example.com/", { maxDepth: 5, maxLinks: 2 });

    expect(links).toEqual(["http://example.com/a", "http://example.com/b"]);
    // GET the start page, then a HEAD to verify each of "/a" and "/b"; "/c" is never
    // reached because the link budget is full.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns immediately when the timeout budget is already spent", async () => {
    const fetchMock = stubFetch({
      "http://example.com/": { html: `<a href="/a">a</a>` },
    });

    const links = await crawl("http://example.com/", { timeout: 0 });

    expect(links).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts a fetch that exceeds the timeout budget", async () => {
    const fetchMock = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const links = await crawl("http://example.com/", { timeout: 25 });

    expect(links).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips pages that respond with a non-OK status", async () => {
    stubFetch({
      "http://example.com/": { ok: false, html: `<a href="/a">a</a>` },
    });

    const links = await crawl("http://example.com/");

    expect(links).toEqual([]);
  });

  it("skips non-HTML responses", async () => {
    stubFetch({
      "http://example.com/": {
        contentType: "application/json",
        html: `<a href="/a">a</a>`,
      },
    });

    const links = await crawl("http://example.com/");

    expect(links).toEqual([]);
  });

  it("treats a missing content-type as non-HTML", async () => {
    stubFetch({
      "http://example.com/": {
        contentType: null,
        html: `<a href="/a">a</a>`,
      },
    });

    const links = await crawl("http://example.com/");

    expect(links).toEqual([]);
  });

  it("skips a page when the fetch throws", async () => {
    stubFetch({
      "http://example.com/": { throws: true },
    });

    const links = await crawl("http://example.com/");

    expect(links).toEqual([]);
  });

  it("skips malformed hrefs and non-http(s) schemes", async () => {
    stubFetch({
      "http://example.com/": {
        html: `
          <a href="http://">malformed</a>
          <a href="mailto:someone@example.com">mail</a>
          <a href="/ok">ok</a>
        `,
      },
    });

    const links = await crawl("http://example.com/", { maxDepth: 0 });

    expect(links).toEqual(["http://example.com/ok"]);
  });

  it("excludes links to non-HTML extensions without requesting them", async () => {
    const fetchMock = stubFetch({
      "http://example.com/": {
        html: `
          <a href="/media/x.mp4?mode=pad&rnd=132761738675370000">video</a>
          <a href="/styles/app.css">stylesheet</a>
          <a href="/docs/report.PDF">report</a>
          <a href="/page">real page</a>
        `,
      },
    });

    const links = await crawl("http://example.com/", { maxDepth: 0 });

    // The media/asset links are dropped by the extension filter; only the page remains.
    expect(links).toEqual(["http://example.com/page"]);
    // The extension filter runs before any network call, so the .mp4 is never requested.
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://example.com/media/x.mp4?mode=pad&rnd=132761738675370000",
      expect.anything(),
    );
  });

  it("excludes an extensionless link whose content-type is not HTML", async () => {
    stubFetch({
      "http://example.com/": {
        html: `<a href="/video">video</a><a href="/page">page</a>`,
      },
      // No file extension, so it survives the extension filter and is verified by HEAD.
      "http://example.com/video": { contentType: "video/mp4" },
    });

    const links = await crawl("http://example.com/", { maxDepth: 0 });

    expect(links).toEqual(["http://example.com/page"]);
  });

  it("keeps links that cannot be confirmed as non-HTML", async () => {
    stubFetch({
      "http://example.com/": {
        html: `
          <a href="/missing-ct">no content-type header</a>
          <a href="/throws">head request fails</a>
          <a href="/not-stubbed">non-OK response</a>
        `,
      },
      // HEAD responds 200 but without a content-type header.
      "http://example.com/missing-ct": { contentType: null },
      // HEAD request throws (e.g. network error).
      "http://example.com/throws": { throws: true },
      // "/not-stubbed" is absent, so the stub answers with a non-OK response.
    });

    const links = await crawl("http://example.com/", { maxDepth: 0 });

    // None could be positively confirmed as non-HTML, so all are kept.
    expect(links).toEqual([
      "http://example.com/missing-ct",
      "http://example.com/not-stubbed",
      "http://example.com/throws",
    ]);
  });

  it("verifies a link found on multiple pages only once (cached HEAD check)", async () => {
    const fetchMock = stubFetch({
      "http://example.com/": {
        html: `<a href="/p1">p1</a><a href="/p2">p2</a>`,
      },
      "http://example.com/p1": { html: `<a href="/shared">shared</a>` },
      "http://example.com/p2": { html: `<a href="/shared">shared</a>` },
      "http://example.com/shared": { html: `` },
    });

    const links = await crawl("http://example.com/", { maxDepth: 5 });

    expect(links).toEqual([
      "http://example.com/p1",
      "http://example.com/p2",
      "http://example.com/shared",
    ]);
    // Despite being linked from both /p1 and /p2, "/shared" is HEAD-verified exactly once.
    const sharedHeadCalls = fetchMock.mock.calls.filter(
      ([url, init]) => url === "http://example.com/shared" && init?.method === "HEAD",
    );
    expect(sharedHeadCalls).toHaveLength(1);
  });

  it("strips hash fragments and dedupes the result", async () => {
    stubFetch({
      "http://example.com/": {
        html: `
          <a href="/a#one">one</a>
          <a href="/a#two">two</a>
          <a href="/a">plain</a>
        `,
      },
    });

    const links = await crawl("http://example.com/", { maxDepth: 0 });

    expect(links).toEqual(["http://example.com/a"]);
  });

  it("does not re-enqueue pages that have already been visited", async () => {
    const fetchMock = stubFetch({
      "http://example.com/": {
        html: `<a href="/a">a</a><a href="/a">a again</a>`,
      },
      "http://example.com/a": {
        // Links back to the already-visited start page.
        html: `<a href="/">home</a>`,
      },
    });

    const links = await crawl("http://example.com/", { maxDepth: 5 });

    expect(links).toEqual(["http://example.com/", "http://example.com/a"]);
    // "/" and "/a" are each GET exactly once despite being referenced multiple times,
    // and each is HEAD-verified exactly once (the verification result is cached).
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("throws on an invalid start URL", async () => {
    await expect(crawl("not a url")).rejects.toThrow("Invalid start URL");
  });
});
