/**
 * Bouwt de HTTP-server.
 *
 * Staat apart van `server.ts`, zodat tests dezelfde server gebruiken als het
 * echte proces: dezelfde routes, dezelfde CORS en dezelfde inhoudsparsing.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { App } from './app.js';
import { registerRoutes } from './routes.js';

export interface BuildServerOptions {
  /** `false` zet de logging uit, zoals in de tests. */
  logger?: boolean;
}

export async function buildServer(app: App, options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({
    logger: options.logger === false
      ? false
      : {
          level: app.config.server.logLevel,
          // Log niets dat op een geheim lijkt.
          redact: ['req.headers.authorization', 'req.headers.cookie'],
        },
  });

  /**
   * Een lege body is een lege body, geen fout.
   *
   * Acties als "bevestig dit product" hebben geen inhoud. Zonder deze
   * regel weigert Fastify elk POST zonder body zodra er `Content-Type:
   * application/json` op staat, en krijgt de gebruiker een 400 op een verzoek
   * dat volkomen terecht was.
   */
  server.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body, done) => {
      const text = typeof body === 'string' ? body.trim() : '';
      if (text.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'onleesbaar';
        const failure = Object.assign(new Error(`Ongeldige JSON: ${detail}`), { statusCode: 400 });
        done(failure, undefined);
      }
    },
  );

  await server.register(cors, { origin: app.config.server.corsOrigin });
  await registerRoutes(server, app);

  return server;
}
