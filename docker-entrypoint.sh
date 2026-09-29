#!/bin/sh
# Zet de rechten van het datavolume goed en start daarna de app als appuser.
#
# Waarom dit nodig is: een Railway-volume wordt bovenop /data gemount en hoort
# toe aan root. De app draait normaal als appuser, en zonder schrijfrecht kan
# SQLite het databasebestand niet openen — de container start dan en crasht
# meteen. We herstellen de rechten één keer bij het opstarten en droppen daarna
# alsnog naar een onbevoegde gebruiker.
set -e

if [ "$(id -u)" = "0" ] && [ -d /data ]; then
  chown -R appuser:appuser /data 2>/dev/null || true
fi

if [ "$(id -u)" = "0" ] \
  && id appuser >/dev/null 2>&1 \
  && command -v su >/dev/null 2>&1; then
  exec su -s /bin/sh appuser -c 'exec node apps/api/dist/server.js'
fi

# Geen su beschikbaar: dan draaien we als root door. Minder ideaal, maar een
# werkende app is beter dan een container die niet opkomt.
exec node apps/api/dist/server.js