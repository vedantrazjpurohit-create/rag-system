export type WebSource = { title: string; snippet: string; provider: string };

export type WebResult = {
  snippets: string[];
  sources: WebSource[];
  provider: string;
  error?: string;
};

const UA =
  process.env.WEB_SEARCH_USER_AGENT ||
  "RAGVED/1.0 (study; https://github.com/vedant-rajpurohit/rag-system)";

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+|www\.\S+/gi, "").replace(/\s+/g, " ").trim();
}

async function wikipedia(query: string, maxResults: number): Promise<WebResult> {
  const sources: WebSource[] = [];
  const snippets: string[] = [];
  try {
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.trim().replace(/ /g, "_"))}`;
    const summaryRes = await fetch(summaryUrl, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (summaryRes.ok) {
      const data = (await summaryRes.json()) as {
        title?: string;
        extract?: string;
        type?: string;
      };
      const extract = stripUrls(data.extract || "");
      if (extract && data.type !== "disambiguation") {
        const title = data.title || query;
        snippets.push(`${title}: ${extract}`);
        sources.push({ title, snippet: extract, provider: "wikipedia" });
      }
    }

    if (snippets.length < maxResults) {
      const searchUrl =
        `https://en.wikipedia.org/w/api.php?action=query&generator=search` +
        `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${maxResults}` +
        `&prop=extracts&exintro=1&explaintext=1&exchars=600&format=json`;
      const searchRes = await fetch(searchUrl, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      });
      if (searchRes.ok) {
        const data = (await searchRes.json()) as {
          query?: { pages?: Record<string, { title?: string; extract?: string; index?: number }> };
        };
        const pages = Object.values(data.query?.pages || {}).sort(
          (a, b) => (a.index || 999) - (b.index || 999),
        );
        const seen = new Set(sources.map((s) => s.title.toLowerCase()));
        for (const page of pages) {
          const title = (page.title || "").trim();
          const extract = stripUrls(page.extract || "");
          if (!title || !extract || seen.has(title.toLowerCase())) continue;
          seen.add(title.toLowerCase());
          snippets.push(`${title}: ${extract}`);
          sources.push({ title, snippet: extract, provider: "wikipedia" });
          if (snippets.length >= maxResults) break;
        }
      }
    }
  } catch (err) {
    return {
      snippets,
      sources,
      provider: snippets.length ? "wikipedia" : "none",
      error: err instanceof Error ? err.message : "wikipedia_failed",
    };
  }
  if (!snippets.length) return { snippets: [], sources: [], provider: "none", error: "wikipedia_empty" };
  return { snippets, sources, provider: "wikipedia" };
}

async function duckduckgo(query: string, maxResults: number): Promise<WebResult> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { snippets: [], sources: [], provider: "none", error: "duckduckgo_failed" };
    const data = (await res.json()) as {
      AbstractText?: string;
      Heading?: string;
      RelatedTopics?: { Text?: string; Topics?: unknown }[];
    };
    const snippets: string[] = [];
    const sources: WebSource[] = [];
    const abstract = stripUrls(data.AbstractText || "");
    const heading = data.Heading || query;
    if (abstract) {
      snippets.push(`${heading}: ${abstract}`);
      sources.push({ title: heading, snippet: abstract, provider: "duckduckgo" });
    }
    for (const topic of data.RelatedTopics || []) {
      if (snippets.length >= maxResults) break;
      if (!topic || "Topics" in topic || !topic.Text) continue;
      const text = stripUrls(topic.Text);
      if (!text) continue;
      snippets.push(text);
      sources.push({
        title: text.split(" - ")[0].slice(0, 80),
        snippet: text,
        provider: "duckduckgo",
      });
    }
    if (!snippets.length) return { snippets: [], sources: [], provider: "none", error: "duckduckgo_empty" };
    return { snippets, sources, provider: "duckduckgo" };
  } catch (err) {
    return {
      snippets: [],
      sources: [],
      provider: "none",
      error: err instanceof Error ? err.message : "duckduckgo_failed",
    };
  }
}

export async function fetchWeb(query: string, maxResults = 5): Promise<WebResult> {
  if (process.env.WEB_SEARCH_ENABLED === "false" || process.env.WEB_SEARCH_ENABLED === "0") {
    return { snippets: [], sources: [], provider: "none", error: "web_search_disabled" };
  }
  const q = query.trim();
  if (!q) return { snippets: [], sources: [], provider: "none", error: "empty_query" };

  const wiki = await wikipedia(q, maxResults);
  if (wiki.snippets.length) return wiki;
  const ddg = await duckduckgo(q, maxResults);
  if (ddg.snippets.length) return ddg;
  return {
    snippets: [],
    sources: [],
    provider: "none",
    error: [wiki.error, ddg.error].filter(Boolean).join("; ") || "no_results",
  };
}

export function templateWebParagraph(query: string, result: WebResult): string {
  if (!result.snippets.length) {
    return (
      `No live web background was found for “${query}”. ` +
      "Try a broader term (e.g. “force physics”)."
    );
  }
  const primary = result.snippets[0].includes(": ")
    ? result.snippets[0].split(": ").slice(1).join(": ")
    : result.snippets[0];
  const extras = result.snippets.slice(1, 3).map((s) => (s.includes(": ") ? s.split(": ").slice(1).join(": ") : s));
  let joined = [primary, ...extras].join(" ");
  if (joined.length > 1200) joined = `${joined.slice(0, 1200).replace(/\s+\S*$/, "")}…`;
  const labels = result.sources.slice(0, 3).map((s) => `${s.title} (${s.provider})`);
  if (labels.length) joined += `\n\nSources: ${labels.join(", ")}.`;
  return joined;
}
