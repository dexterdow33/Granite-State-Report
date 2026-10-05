// Integration with the partner newsroom's WordPress site (Granite State Report by default).
// Uses the standard WordPress REST API: /wp-json/wp/v2/posts.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

// WordPress returns rendered HTML for titles and excerpts. We store and show plain text only.
function plainText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function createPartner(config, fetchImpl = globalThis.fetch) {
  const { url, host } = config.partner;
  let cache = { at: 0, articles: [] };

  async function getJson(apiPath) {
    const res = await fetchImpl(`${url}/wp-json/wp/v2/${apiPath}`, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`partner API ${res.status}`);
    return res.json();
  }

  const toArticle = (p) => ({
    url: canonical(p.link),
    title: plainText(p.title && p.title.rendered),
    excerpt: plainText(p.excerpt && p.excerpt.rendered).slice(0, 280),
    date: p.date,
  });

  // Returns a normalized https URL on the partner's domain, or null.
  function canonical(raw) {
    let u;
    try { u = new URL(String(raw)); } catch { return null; }
    if (u.protocol !== 'https:' || u.hostname.replace(/^www\./, '') !== host) return null;
    const pathname = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
    return `https://${host}${pathname}`; // one form per story, with or without www
  }

  // Latest stories, cached for 15 minutes. Returns [] if the partner site is unreachable.
  async function latest() {
    if (Date.now() - cache.at < 15 * 60 * 1000) return cache.articles;
    try {
      const posts = await getJson('posts?per_page=6&_fields=link,title,excerpt,date');
      cache = { at: Date.now(), articles: posts.map(toArticle).filter((a) => a.url && a.title) };
    } catch (err) {
      console.warn(`[partner] could not load stories: ${err.message}`);
      cache = { at: Date.now() - 10 * 60 * 1000, articles: cache.articles }; // retry in 5 minutes
    }
    return cache.articles;
  }

  // Confirms a URL is a published partner story and returns its title, or null.
  async function lookup(rawUrl) {
    const target = canonical(rawUrl);
    if (!target) return null;
    const slug = new URL(target).pathname.split('/').filter(Boolean).pop();
    if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return null;
    try {
      const posts = await getJson(`posts?slug=${encodeURIComponent(slug)}&_fields=link,title,excerpt,date`);
      const match = posts.map(toArticle).find((a) => a.url === target);
      return match || null;
    } catch (err) {
      console.warn(`[partner] lookup failed: ${err.message}`);
      return null;
    }
  }

  return { canonical, latest, lookup };
}

module.exports = { createPartner, plainText };
