// Tiny static server for apps/web/dist that applies the Cloudflare-style `_headers` file, so design-check sees the
// real CSP. Unknown paths answer 404 with dist/404.html. Localhost only.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Parse a `_headers` file into rules: [{ pattern, set: [[name, value]], unset: [name] }].
 * A rule starts with an unindented line (the path pattern); indented lines are `Name: value` or `! Name` (detach).
 */
export function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      cur = { pattern: raw.trim(), set: [], unset: [] };
      rules.push(cur);
      continue;
    }
    if (!cur) continue;
    const line = raw.trim();
    if (line.startsWith('!')) {
      cur.unset.push(line.slice(1).trim().toLowerCase());
      continue;
    }
    const i = line.indexOf(':');
    if (i > 0) cur.set.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return rules;
}

function matches(pattern, path) {
  const re = new RegExp(
    `^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`,
  );
  return re.test(path);
}

/** Headers for a URL path: later rules extend earlier ones; `! Name` removes what earlier rules set. */
export function headersFor(rules, path) {
  const out = new Map();
  for (const rule of rules) {
    if (!matches(rule.pattern, path)) continue;
    for (const name of rule.unset) out.delete(name);
    for (const [name, value] of rule.set) {
      const key = name.toLowerCase();
      out.set(key, out.has(key) ? `${out.get(key)}, ${value}` : value);
    }
  }
  return Object.fromEntries(out);
}

/** Map a URL path to a file inside root, or null (outside root, missing). */
export function resolveFile(root, urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const full = normalize(join(root, p));
  if (full !== root && !full.startsWith(root + sep)) return null;
  const candidates = p.endsWith('/') ? [join(full, 'index.html')] : [full, join(full, 'index.html')];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

export function createDistServer(distDir) {
  const root = resolve(distDir);
  const headersPath = join(root, '_headers');
  const rules = existsSync(headersPath) ? parseHeaders(readFileSync(headersPath, 'utf8')) : [];
  return createServer((req, res) => {
    const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname;
    const file = resolveFile(root, urlPath);
    const status = file ? 200 : 404;
    const body = file ?? join(root, '404.html');
    const headers = headersFor(rules, urlPath);
    if (!existsSync(body)) {
      res.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(status, { ...headers, 'content-type': TYPES[extname(body).toLowerCase()] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(body));
  });
}

/** Listen on 127.0.0.1; port 0 picks a free one. Resolves { server, port, origin }. */
export function listen(server, port = 0) {
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      ok({ server, port: actual, origin: `http://127.0.0.1:${actual}` });
    });
  });
}
