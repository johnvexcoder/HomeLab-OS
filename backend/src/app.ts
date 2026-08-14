import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createRouter, type ApiContext } from './routes';
import { createAuthRouter } from './auth/routes';
import { createAdminRouter } from './admin/routes';
import { securityHeaders } from './security/headers';
import { mutationGuard } from './security/middleware';
import { config } from './config';

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
  app.use(cors({ origin: config.corsOrigin.split(','), credentials: true }));
  app.use(express.json({ limit: '256kb' }));

  // Global mutation guard: CSRF + read-only/emergency/safe modes.
  app.use('/api', mutationGuard);

  app.get('/api/ping', (_req, res) => res.json({ pong: true, ts: Date.now() }));

  app.use('/api/auth', createAuthRouter());
  app.use('/api/admin', createAdminRouter());
  app.use('/api', createRouter(ctx));

  // SPA-ish friendly 404 for unknown API routes.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}
