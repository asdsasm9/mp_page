import type { APIRoute } from 'astro';
import { getCatalog } from '../lib/catalog';
import { readRawEnv, resolveEnv } from '../lib/env';
import { buildSitemap } from '../lib/sitemap';

export const GET: APIRoute = async () => {
  const env = resolveEnv(readRawEnv());
  const catalog = await getCatalog(env);
  return new Response(buildSitemap(catalog.categories, env.imgBaseUrl), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
