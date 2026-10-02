import { createServer } from 'node:http';
import { Router } from './lib/router.js';
import { HttpError, applyCors, send, securityHeaders } from './lib/http.js';
import { userFromRequest } from './lib/auth.js';
import { getDb } from './db.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPostRoutes } from './routes/posts.js';
import { registerMediaRoutes, serveUpload } from './routes/media.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { config } from './config.js';

export function createApp() {
  getDb();
  const router = new Router();
  router.get('/api/health', ({ res }) => send(res, 200, { ok: true, time: new Date().toISOString() }));
  registerAuthRoutes(router);
  registerPostRoutes(router);
  registerMediaRoutes(router);
  registerSettingsRoutes(router);

  return createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, 'http://localhost');
    res.on('finish', () => {
      if (!config.isProd || res.statusCode >= 500) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    });
    securityHeaders(res);
    applyCors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    try {
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/uploads/')) {
        if (!serveUpload(req, res, url.pathname)) send(res, 404, { error: 'File not found.' });
        return;
      }

      const match = router.match(req.method, url.pathname);
      if (!match) return send(res, 404, { error: 'Not found.' });
      if (match.methodNotAllowed) return send(res, 405, { error: 'Method not allowed.' });

      const ctx = { req, res, params: match.params, query: url.searchParams, user: userFromRequest(req) };
      if (url.pathname.startsWith('/api/admin') || url.pathname.startsWith('/api/auth')) {
        res.setHeader('Cache-Control', 'no-store');
      }
      for (const handler of match.route.handlers) {
        await handler(ctx);
        if (res.writableEnded) break;
      }
    } catch (err) {
      if (err instanceof HttpError) {
        if (!res.headersSent) send(res, err.status, { error: err.message, details: err.details });
      } else {
        console.error(err);
        if (!res.headersSent) send(res, 500, { error: 'Something went wrong on the server. Try again in a moment.' });
      }
    }
  });
}
