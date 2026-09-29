/**
 * Startgegevens.
 *
 * Er wordt bewust ALLEEN referentiedata ingeladen: de vier winkels en een
 * technische gebruikersaccount. GEEN prijzen, GEEN aanbiedingen, GEEN
 * producten — die komen uit de gekoppelde databronnen of uit eigen invoer.
 */

import { STORE_IDS, STORE_META, type StoreId } from '@boodschappen/core';
import type { Database_ } from './client.js';
import { stores, users } from './schema.js';
import { eq } from 'drizzle-orm';

const LOYALTY_CARD: Record<StoreId, string> = {
  lidl: 'Lidl Plus',
  albert_heijn: 'AH Bonuskaart',
  dirk: 'DirkPas',
  kruidvat: 'Kruidvat Membershipkaart',
};

const WEBSITE: Record<StoreId, string> = {
  lidl: 'https://www.lidl.nl',
  albert_heijn: 'https://www.ah.nl',
  dirk: 'https://www.dirk.nl',
  kruidvat: 'https://www.kruidvat.nl',
};

export function seedStores(db: Database_): void {
  for (const storeId of STORE_IDS) {
    const meta = STORE_META[storeId];
    const existing = db.select().from(stores).where(eq(stores.id, storeId)).get();
    if (existing) continue;
    db.insert(stores)
      .values({
        id: storeId,
        name: meta.name,
        shortName: meta.shortName,
        website: WEBSITE[storeId],
        adapter: storeId,
        currency: 'EUR',
        loyaltyCardName: LOYALTY_CARD[storeId],
        color: meta.color,
        displayOrder: meta.order,
        active: true,
      })
      .run();
  }
}

export function seedUser(db: Database_, id: string, displayName: string): void {
  const existing = db.select().from(users).where(eq(users.id, id)).get();
  if (existing) return;
  db.insert(users)
    .values({ id, displayName, locale: 'nl', timezone: 'Europe/Amsterdam', settings: {} })
    .run();
}
