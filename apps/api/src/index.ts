const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

export async function handleRequest(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/health') {
    if (request.method === 'GET') return json({ ok: true }, 200);
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET' });
  }
  return json({ error: 'NOT_FOUND' }, 404);
}

export default { fetch: handleRequest };
