import type { APIRoute } from 'astro';
import { readRawEnv, resolveEnv } from '../lib/env';
import { buildRobots } from '../lib/sitemap';

export const GET: APIRoute = () =>
  new Response(buildRobots(resolveEnv(readRawEnv()).production), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
