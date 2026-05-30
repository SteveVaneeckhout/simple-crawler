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
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
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
  it("returns deduped links from a single page (maxDepth 0 does not recurse)", async () => {
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

    expect(links).toEqual(["http://example.com/a", "http://other.com/x", "https://secure.com/"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows same-origin links up to maxDepth, recording but not crawling external links", async () => {
    const fetchMock = stubFetch({
      "http://example.com/": {
        html: `<a href="/a">a</a><a href="http://other.com/">external</a>`,
      },
      "http://example.com/a": {
        html: `<a href="/b">b</a>`,
      },
    });

    const links = await crawl("http://example.com/", { maxDepth: 1 });

    expect(links).toEqual(["http://example.com/a", "http://other.com/", "http://example.com/b"]);
    // Only same-origin pages are fetched; the external link is never requested.
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    expect(links).toEqual(["http://example.com/a", "http://example.com/"]);
    // "/" and "/a" are each fetched exactly once despite being referenced multiple times.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on an invalid start URL", async () => {
    await expect(crawl("not a url")).rejects.toThrow("Invalid start URL");
  });
});
