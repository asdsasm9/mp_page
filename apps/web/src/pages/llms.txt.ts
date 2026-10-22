import type { APIRoute } from 'astro';
import { getCatalog } from '../lib/catalog';
import { readRawEnv, resolveEnv } from '../lib/env';
import { buildLlmsTxt } from '../lib/llms';

export const GET: APIRoute = async () => {
  const catalog = await getCatalog(resolveEnv(readRawEnv()));
  return new Response(buildLlmsTxt(catalog.categories), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
