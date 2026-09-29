/**
 * Start de API-server.
 *
 * Bij het opstarten: database openen en migreren, winkels klaarzetten en de
 * routes registreren. Er worden geen voorbeeldprijzen geladen.
 */

import { config as loadDotenv } from 'dotenv';
import { createApp } from './app.js';
import { buildServer } from './http-server.js';

// Eerst de `.env` inlezen, daarna pas de config bouwen. Variabelen die al in
// de omgeving staan winnen, zodat `SOURCE_LIDL_API_KEY=... npm start` werkt.
loadDotenv();

const app = createApp();
const server = await buildServer(app);

const shutdown = async (signal: string): Promise<void> => {
  server.log.info(`${signal} ontvangen, server wordt afgesloten`);
  await server.close();
  app.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await server.listen({ host: app.config.server.host, port: app.config.server.port });
  server.log.info(`API luistert op ${app.config.server.host}:${app.config.server.port}${app.config.server.apiPrefix}`);
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
