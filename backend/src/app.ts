import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createRouter, type ApiContext } from './routes';
import { createAuthRouter } from './auth/routes';
import { createAdminRouter } from './admin/routes';
import { createAgentRouter } from './routes/agent';
import { securityHeaders } from './security/headers';
import { mutationGuard } from './security/middleware';
import { config } from './config';
import crypto from 'node:crypto';
import { hit } from './security/rateLimit';

/** Minimal cookie parser (avoids a runtime dependency for two cookies). */
function cookieParser(req: Request, _res: Response, next: NextFunction): void {
  const cookies: Record<string, string> = {};
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
  }
  req.cookies = cookies;
  next();
}

export function createApp(ctx: ApiContext): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(cookieParser);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = req.header('x-request-id')?.slice(0, 128) || crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const startedAt = Date.now();
    res.on('finish', () => {
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        service: 'homelab-backend',
        requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      }));
    });
    next();
  });
  app.use(cors({ origin: config.corsOrigin.split(','), credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health' || req.path === '/ping') return next();
    const limit = hit(`api:${req.ip ?? 'unknown'}`, 1_200);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      res.status(429).json({ error: 'too_many_requests' });
      return;
    }
    next();
  });

  // Global mutation guard: CSRF + read-only/emergency/safe modes.
  app.use('/api', mutationGuard);

  app.get('/api/ping', (_req, res) => res.json({ pong: true, ts: Date.now() }));

  app.use('/api/auth', createAuthRouter());
  app.use('/api/admin', createAdminRouter());
  app.use('/api/agent', createAgentRouter());
  app.use('/api', createRouter(ctx));

  // SPA-ish friendly 404 for unknown API routes.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Global error handler — prevents socket hang up from uncaught errors
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[express] Unhandled error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', requestId: res.getHeader('X-Request-Id') });
    }
  });

  return app;
}
