# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Boodschappen-app — API
#
# Netlify kan de API niet draaien: SQLite is een bestand en een database die
# per verzoek weggooit is geen database. Daarom draait de backend op Railway
# in een container, met het databasebestand op een vaste plek zodat het
# overleeft als de container opnieuw start.
#
# Twee fases: de bouwfase compileert TypeScript, de runtimefase begint met
# alleen productiedeps en een kale slanke Node. De app zelf draait als een
# gewone Node-server, geen root.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Eerst de vergrendelde afhankelijkheden; alleen de package.json-bestanden,
# zodat de imagecache pas ongeldig wordt bij een wijziging aan de lockfile.
COPY package.json package-lock.json ./
# De gedeelde compiler-instellingen; de workspace-configs breiden dit bestand uit.
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci

# Broncode wordt pas daarna gekopieerd, zodat een wijziging niet opnieuw
# alles hoeft te installeren.
COPY packages/core packages/core
RUN npm run build -w @boodschappen/core

COPY apps/api apps/api
RUN npm run build -w @boodschappen/api

# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    DATABASE_FILE=/data/boodschappen.db

# Het databasebestand hoort buiten de image, in het Railway-volume. Dat volume
# maak je aan in de Railway-interface (Service → Volumes, mount /data) — de
# Dockerfile kan hier geen volume declareren: Railway wijst die regel af.
# Zonder volume is SQLite weg na elke deploy. De app maakt de map zelf aan
# (db/client.ts); /data hieronder bestaat alvast zodat appuser erin kan
# schrijven zolang het Railway-volume nog niet is aangekoppeld.

WORKDIR /app

# Installeer opnieuw met alleen productiedeps: de buildfase heeft dev-tools
# (TypeScript, vitest) die de runtime niet nodig heeft en alleen maar zwaar is.
# better-sqlite3 is een native module; Node 22 op linux-x64 heeft een
# voorgecompileerd binary. Mocht die download falen, bouw dan de runtimefase
# op met build-essential en python3 erbij en --build-from-source.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci --omit=dev

# De gebouwde uitvoer uit de buildfase, op de plek waar de workspace-symlinks
# hem verwachten.
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist

# Niet als root draaien. De bestanden hieronder zijn leesbaar voor iedereen,
# en het datavolume is eigendom van de gebruiker zodat SQLite erin kan
# schrijven.
RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && mkdir -p /data \
    && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 4000

# Healthcheck zonder curl (niet in de slanke image): een node-fetch naar de
# eigen health-route. Schrijft niets weg, dus veilig.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]