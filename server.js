const http = require("node:http");

const PORT = Number(process.env.PORT || 9986);
const BASE_URL = "https://supremevalues.com/mm2";
const CATEGORIES = [
  "godlies",
  "legendaries",
  "rares",
  "uncommons",
  "commons",
  "pets",
  "chromas",
  "vintages",
  "ancients",
];

function decodeHtml(text) {
  return text
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function htmlToLines(html) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<\/(?:tr|td|th|div|p|li|h[1-6])\s*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function detectProtection(text) {
  return /just a moment|performing security verification|verify you are human|checking your browser|cloudflare|captcha/i.test(text);
}

function parseCategory(lines, category) {
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^Value\s*[-:]\s*(.+)$/i);
    if (!match) continue;

    let name = "";
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
      const candidate = lines[j];
      if (
        candidate &&
        !/^(Tier|Special Tier|Range|Stability|Demand|Rarity|Origin|Class|Change in Value)\b/i.test(candidate) &&
        !/^(Inv\. Controls|Extra Features|Filter by Event|Sort by:)\b/i.test(candidate)
      ) {
        name = candidate;
        break;
      }
    }

    if (name) items.push({ name, value: match[1], category });
  }
  return items;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function checkCategory(category) {
  const url = `${BASE_URL}/${category}`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MM2ValuesTest/1.0)" },
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.text();
    const lines = htmlToLines(body);
    const protectedPage = detectProtection(body);
    const items = protectedPage ? [] : parseCategory(lines, category);

    return {
      category,
      status: response.status,
      contentType: response.headers.get("content-type") || "unknown",
      protectedPage,
      itemCount: items.length,
      items,
      preview: lines.slice(0, 6).join(" | ").slice(0, 400),
    };
  } catch (error) {
    return {
      category,
      status: 0,
      contentType: "",
      protectedPage: false,
      itemCount: 0,
      items: [],
      error: error.message || String(error),
      preview: "",
    };
  }
}

let resultCache = null;

async function getResults() {
  if (resultCache) return resultCache;
  resultCache = await Promise.all(CATEGORIES.map(checkCategory));
  return resultCache;
}

function render(results) {
  const items = results.flatMap(result => result.items);
  if (items.length) return items.map(item => `${item.name}:${item.value}`).join("\n");

  const errors = results.filter(result => result.error || result.protectedPage);
  if (errors.length) return "Не удалось получить цены: сайт вернул ошибку или страницу проверки безопасности.";
  return "Не удалось распознать цены на страницах сайта.";
}

const server = http.createServer(async (_req, res) => {
  try {
    const results = await getResults();
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(render(results));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(error.message || String(error));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Local test page: http://localhost:${PORT}`);
  console.log("Open it in your browser after this message.");
});
