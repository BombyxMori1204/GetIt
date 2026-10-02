// Диагностика: как каждый сайт отдаёт цену с ЭТОГО компьютера / IP.
// Для каждой ссылки пробуем два способа:
//   1) fetch  — обычный HTTP-запрос (быстро, дёшево);
//   2) playwright — настоящий браузер (медленно, но надёжнее).
// В обоих случаях ищем цену в JSON-LD (schema.org) и в Open Graph мета-тегах.
//
// Запуск (из папки apps/server):
//   npx tsx src/scripts/probe.ts probe-urls.txt
//
// Формат probe-urls.txt: одна ссылка на товар в строке, строки с # игнорируются.

import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'data', 'probe');
const TIMEOUT_MS = 30_000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface Extracted {
  title: string | null;
  price: number;
  currency: string | null;
  source: 'jsonld' | 'og';
}

interface ProbeRow {
  site: string;
  method: 'fetch' | 'playwright';
  status: number | string;
  kb: number;
  ms: number;
  price: number | null;
  currency: string | null;
  source: string | null;
  hints: string;
}

// ---------- Извлечение цены из HTML ----------

// "12 990", "12990.50", "12990,50" -> число
function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const n = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function typeIncludes(type: unknown, name: string): boolean {
  return Array.isArray(type) ? type.includes(name) : type === name;
}

// offers бывает объектом или массивом; у AggregateOffer цена лежит в lowPrice
function pickOffer(offers: unknown): { price: number; currency: string | null } | null {
  const list = Array.isArray(offers) ? offers : [offers];
  for (const o of list) {
    if (o && typeof o === 'object') {
      const rec = o as Record<string, unknown>;
      const price = parsePrice(rec.price ?? rec.lowPrice);
      if (price !== null) {
        const currency = typeof rec.priceCurrency === 'string' ? rec.priceCurrency : null;
        return { price, currency };
      }
    }
  }
  return null;
}

// Рекурсивный обход: JSON-LD может быть массивом или вложенным в @graph
function findProduct(node: unknown): Extracted | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProduct(item);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (typeIncludes(obj['@type'], 'Product')) {
      const offer = pickOffer(obj.offers);
      if (offer) {
        const title = typeof obj.name === 'string' ? obj.name : null;
        return { title, ...offer, source: 'jsonld' };
      }
    }
    for (const value of Object.values(obj)) {
      const found = findProduct(value);
      if (found) return found;
    }
  }
  return null;
}

function metaContent(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

function extract(html: string): Extracted | null {
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(ldRe)) {
    try {
      const found = findProduct(JSON.parse(m[1]));
      if (found) return found;
    } catch {
      // битый JSON-LD просто пропускаем
    }
  }
  const ogPrice = parsePrice(
    metaContent(html, 'product:price:amount') ?? metaContent(html, 'og:price:amount'),
  );
  if (ogPrice !== null) {
    return {
      title: metaContent(html, 'og:title'),
      price: ogPrice,
      currency: metaContent(html, 'product:price:currency') ?? metaContent(html, 'og:price:currency'),
      source: 'og',
    };
  }
  return null;
}

// Подсказки, что страница — заглушка защиты. Это не вердикт, а повод посмотреть сохранённый HTML.
const HINTS: Array<[string, RegExp]> = [
  ['qrator', /qrator/i],
  ['captcha', /captcha|капча/i],
  ['access-denied', /access denied|доступ ограничен|forbidden/i],
  ['js-required', /enable javascript|включите javascript/i],
];

function detectHints(html: string): string {
  return HINTS.filter(([, re]) => re.test(html))
    .map(([name]) => name)
    .join(',');
}

// ---------- Два способа загрузки страницы ----------

interface Loaded {
  status: number | string;
  html: string;
  ms: number;
}

async function loadWithFetch(url: string): Promise<Loaded> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'ru-RU,ru;q=0.9',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const html = await res.text();
    return { status: res.status, html, ms: Date.now() - t0 };
    } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cause =
      e instanceof Error && e.cause instanceof Error
        ? ` (${(e.cause as NodeJS.ErrnoException).code ?? e.cause.message})`
        : '';
    return { status: `ERR: ${msg}${cause}`, html: '', ms: Date.now() - t0 };
  }
}

async function loadWithBrowser(
  context: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newContext']>>,
  url: string,
): Promise<Loaded> {
  const t0 = Date.now();
  const page = await context.newPage();
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await page.waitForTimeout(Number(process.env.PROBE_WAIT_MS ?? 4000));
    const html = await page.content();
    return { status: res?.status() ?? 'no-response', html, ms: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: `ERR: ${msg.split('\n')[0]}`, html: '', ms: Date.now() - t0 };
  } finally {
    await page.close();
  }
}

// ---------- Основной цикл ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Случайная пауза 3-6 секунд, чтобы не нагружать сайты
function politePause(): Promise<void> {
  return sleep(3000 + Math.random() * 3000);
}

function makeRow(
  site: string,
  method: ProbeRow['method'],
  loaded: Loaded,
  found: Extracted | null,
): ProbeRow {
  return {
    site,
    method,
    status: loaded.status,
    kb: Math.round(loaded.html.length / 1024),
    ms: loaded.ms,
    price: found?.price ?? null,
    currency: found?.currency ?? null,
    source: found?.source ?? null,
    hints: detectHints(loaded.html),
  };
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('Использование: npx tsx src/scripts/probe.ts probe-urls.txt');
    process.exit(1);
  }

  const urls = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  mkdirSync(OUT_DIR, { recursive: true });

  const cdpUrl = process.env.PROBE_CDP; // например http://127.0.0.1:9222
  const useRealChrome = process.env.PROBE_CHROME === '1';

  const browser = cdpUrl
  ? await chromium.connectOverCDP(cdpUrl)
  : await chromium.launch({
    headless: !useRealChrome,
    ...(useRealChrome ? { channel: 'chrome' as const } : {}),
  });

  // В режиме CDP берём уже существующий контекст вашего Chrome (с вашими куками)
  const context = cdpUrl
  ? (browser.contexts()[0] ?? (await browser.newContext()))
  : await browser.newContext({
    locale: 'ru-RU',
    ...(useRealChrome ? {} : { userAgent: UA }),
    });

  const rows: ProbeRow[] = [];

  for (const [i, url] of urls.entries()) {
    const site = new URL(url).hostname.replace(/^www\./, '');
    console.log(`[${i + 1}/${urls.length}] ${url}`);

    if (!cdpUrl) {
        const viaFetch = await loadWithFetch(url);
        writeFileSync(join(OUT_DIR, `${site}-${i}-fetch.html`), viaFetch.html);
        rows.push(makeRow(site, 'fetch', viaFetch, extract(viaFetch.html)));
        await politePause();
    }

    const viaBrowser = await loadWithBrowser(context, url);
    writeFileSync(join(OUT_DIR, `${site}-${i}-playwright.html`), viaBrowser.html);
    rows.push(makeRow(site, 'playwright', viaBrowser, extract(viaBrowser.html)));
    await politePause();
  }

  await browser.close();

  console.table(rows);
  writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(rows, null, 2));
  console.log(`HTML-снимки и results.json сохранены в ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});