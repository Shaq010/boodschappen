/**
 * Voorraadkast ("pantry") en "vandaag nodig".
 *
 * De voorraadkast bevat wat je al in huis hebt. Daarmee kan de app:
 *  - producten uit de boodschappenlijst halen die je al hebt;
 *  - aangeven wat je vandaag nodig hebt om het weekmenu te maken;
 *  - dubbele regels uit het menu samenvoegen, met een zichtbare waarschuwing
 *    als de eenheden niet met elkaar te vergelijken zijn.
 */

import {
  type Quantity,
  type UnitDimension,
  WEEKDAYS,
  type Weekday,
  currentWeekday,
  isWeekday,
  makeQuantity,
  mergeIngredients,
  normalizeName,
  startOfIsoWeek,
  todayIso,
} from '@boodschappen/core';
import { type Database_ } from '../db/client.js';
import { ingredients, meals, pantryItems, weeklyMenus } from '../db/schema.js';
import { asc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

export interface PantryRow {
  id: string;
  name: string;
  normalizedName: string;
  dimension: UnitDimension;
  amount: number;
  unit: string;
}

export interface PantryNeedRow {
  name: string;
  amount: number;
  unit: string;
  dimension: UnitDimension;
  inPantry: boolean;
  pantryAmount: number | null;
  /** True als je dit nog moet kopen. */
  toBuy: boolean;
}

export interface MealRow {
  id: string;
  day: Weekday;
  name: string;
  note: string | null;
  ingredients: PantryNeedRow[];
}

export interface WeekMenuRow {
  id: string;
  weekStart: string;
  title: string | null;
  meals: MealRow[];
  /** Alles wat je deze week nodig hebt, over alle dagen heen. */
  shopping: PantryNeedRow[];
  /** Producten die in meerdere gerechten voorkomen en samengevoegd zijn. */
  combined: Array<{ name: string; fromDays: Weekday[] }>;
  /** Meldingen, bv. eenheden die niet vergelijkbaar zijn. */
  notices: string[];
}

export class PantryService {
  constructor(private readonly db: Database_) {}

  list(userId: string | null): PantryRow[] {
    const rows =
      userId === null
        ? this.db.select().from(pantryItems).all()
        : this.db.select().from(pantryItems).where(eq(pantryItems.userId, userId)).all();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      normalizedName: row.normalizedName,
      dimension: row.dimension as UnitDimension,
      amount: row.amount,
      unit: row.unit,
    }));
  }

  add(userId: string | null, input: { name: string; quantity?: Quantity; productId?: string | null }): PantryRow {
    const quantity = input.quantity ?? makeQuantity(1, 'st');
    const normalized = normalizeName(input.name);

    // Is het product al bekend? Dan telen we de hoeveelheid op.
    const existing = this.db
      .select()
      .from(pantryItems)
      .where(eq(pantryItems.normalizedName, normalized))
      .get();

    if (existing) {
      const sameDimension = existing.dimension === quantity.dimension;
      const amount = sameDimension ? existing.amount + quantity.amount : existing.amount;
      this.db.update(pantryItems).set({ amount }).where(eq(pantryItems.id, existing.id)).run();
      return this.get(existing.id)!;
    }

    const id = randomUUID();
    this.db
      .insert(pantryItems)
      .values({
        id,
        userId,
        productId: input.productId ?? null,
        name: input.name.trim(),
        normalizedName: normalized,
        dimension: quantity.dimension,
        amount: quantity.amount,
        unit: quantity.unit,
      })
      .run();
    return this.get(id)!;
  }

  get(id: string): PantryRow | null {
    const row = this.db.select().from(pantryItems).where(eq(pantryItems.id, id)).get();
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      normalizedName: row.normalizedName,
      dimension: row.dimension as UnitDimension,
      amount: row.amount,
      unit: row.unit,
    };
  }

  update(id: string, patch: { name?: string; amount?: number; unit?: string }): PantryRow | null {
    const current = this.get(id);
    if (!current) return null;
    this.db
      .update(pantryItems)
      .set({
        name: patch.name ?? current.name,
        amount: patch.amount ?? current.amount,
        unit: patch.unit ?? current.unit,
      })
      .where(eq(pantryItems.id, id))
      .run();
    return this.get(id);
  }

  /** Verwijdert of trekt af, zodat je voorraad niet negatief wordt. */
  remove(id: string, quantity?: Quantity): PantryRow | null {
    const current = this.get(id);
    if (!current) return null;
    if (!quantity) {
      this.db.delete(pantryItems).where(eq(pantryItems.id, id)).run();
      return null;
    }
    const amount = current.amount - quantity.amount;
    if (amount <= 0) {
      this.db.delete(pantryItems).where(eq(pantryItems.id, id)).run();
      return null;
    }
    this.db.update(pantryItems).set({ amount }).where(eq(pantryItems.id, id)).run();
    return this.get(id);
  }

  clear(userId: string | null): number {
    const before = this.list(userId).length;
    if (userId === null) this.db.delete(pantryItems).run();
    else this.db.delete(pantryItems).where(eq(pantryItems.userId, userId)).run();
    return before;
  }
}

export class MenuService {
  constructor(private readonly db: Database_) {}

  /** Start (of haal op) het menu voor de week waarin `isoDate` valt. */
  week(userId: string | null, isoDate: string = todayIso()): WeekMenuRow {
    const weekStart = startOfIsoWeek(isoDate);
    const existing = this.db.select().from(weeklyMenus).where(eq(weeklyMenus.weekStart, weekStart)).get();

    const menu =
      existing ??
      (() => {
        const id = randomUUID();
        this.db.insert(weeklyMenus).values({ id, userId, weekStart }).run();
        return this.db.select().from(weeklyMenus).where(eq(weeklyMenus.id, id)).get()!;
      })();

    return this.build(menu.id, menu.weekStart);
  }

  private build(menuId: string, weekStart: string): WeekMenuRow {
    const menu = this.db.select().from(weeklyMenus).where(eq(weeklyMenus.id, menuId)).get();
    const pantry = this.pantryMap();

    const mealRows = this.db
      .select()
      .from(meals)
      .where(eq(meals.menuId, menuId))
      .orderBy(asc(meals.sortOrder))
      .all();

    const built: MealRow[] = mealRows.map((meal) => {
      const rows = this.db
        .select()
        .from(ingredients)
        .where(eq(ingredients.mealId, meal.id))
        .orderBy(asc(ingredients.sortOrder))
        .all();

      const need: PantryNeedRow[] = rows.map((row) => {
        const key = row.normalizedName;
        const have = pantry.get(key) ?? null;
        return {
          name: row.name,
          amount: row.amount,
          unit: row.unit,
          dimension: row.dimension as UnitDimension,
          inPantry: have !== null,
          pantryAmount: have,
          toBuy: have === null || have < row.amount,
        };
      });

      return {
        id: meal.id,
        day: (meal.day as Weekday),
        name: meal.name,
        note: meal.note,
        ingredients: need,
      };
    });

    // Alles samenvoegen over de hele week heen, met de kernlogica uit de
    // kern: gelijke producten worden opgeteld en tegenstrijdigheden blijven
    // zichtbaar in plaats van stil te worden weggepoetst.
    const all: Array<{ id: string; name: string; quantity: Quantity; day: Weekday; inPantry: boolean }> = [];
    for (const meal of built) {
      const rows = this.db.select().from(ingredients).where(eq(ingredients.mealId, meal.id)).all();
      for (const row of rows) {
        all.push({
          id: row.id,
          name: row.name,
          quantity: makeQuantity(row.amount, row.unit),
          day: meal.day,
          inPantry: row.inPantry,
        });
      }
    }

    const merge = mergeIngredients(
      all.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        inPantry: item.inPantry,
      })),
    );

    const shopping: PantryNeedRow[] = merge.merged.map((item) => {
      const have = pantry.get(normalizeName(item.name)) ?? null;
      const amount = item.quantity.amount;
      return {
        name: item.name,
        amount,
        unit: item.quantity.unit,
        dimension: item.quantity.dimension,
        inPantry: have !== null,
        pantryAmount: have,
        toBuy: have === null || have < amount,
      };
    });

    // Welke producten komen in meer dan één gerecht voor?
    const daysByName = new Map<string, { name: string; days: Weekday[] }>();
    for (const item of all) {
      const key = normalizeName(item.name);
      const entry = daysByName.get(key) ?? { name: item.name, days: [] };
      if (!entry.days.includes(item.day)) entry.days.push(item.day);
      daysByName.set(key, entry);
    }

    const combined = [...daysByName.values()]
      .filter((entry) => entry.days.length > 1)
      .map((entry) => ({ name: entry.name, fromDays: entry.days }));

    return {
      id: menuId,
      weekStart: menu?.weekStart ?? weekStart,
      title: menu?.title ?? null,
      meals: built,
      shopping,
      combined,
      notices: merge.conflicts.map((conflict) => conflict.message),
    };
  }

  private pantryMap(): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of this.db.select().from(pantryItems).all()) map.set(row.normalizedName, row.amount);
    return map;
  }

  addMeal(
    userId: string | null,
    input: { day: string; name: string; note?: string | null; ingredients?: Array<{ name: string; quantity?: Quantity; inPantry?: boolean; onlyIfMissing?: boolean }> },
  ): WeekMenuRow {
    if (!isWeekday(input.day)) {
      throw new Error(`Ongeldige dag: ${input.day}. Gebruik een van ${WEEKDAYS.join(', ')}.`);
    }
    const weekStart = startOfIsoWeek(todayIso());
    let menu = this.db.select().from(weeklyMenus).where(eq(weeklyMenus.weekStart, weekStart)).get();
    if (!menu) {
      const id = randomUUID();
      this.db.insert(weeklyMenus).values({ id, userId, weekStart }).run();
      menu = this.db.select().from(weeklyMenus).where(eq(weeklyMenus.id, id)).get()!;
    }

    const mealId = randomUUID();
    const order =
      (this.db.select({ n: sql<number>`coalesce(max(${meals.sortOrder}), 0)` }).from(meals).where(eq(meals.menuId, menu.id)).get()?.n ?? 0) + 1;

    this.db
      .insert(meals)
      .values({ id: mealId, menuId: menu.id, day: input.day as Weekday, name: input.name, note: input.note ?? null, sortOrder: order })
      .run();

    (input.ingredients ?? []).forEach((ingredient, index) => {
      const quantity = ingredient.quantity ?? makeQuantity(1, 'st');
      this.db
        .insert(ingredients)
        .values({
          id: randomUUID(),
          mealId,
          name: ingredient.name.trim(),
          normalizedName: normalizeName(ingredient.name),
          dimension: quantity.dimension,
          amount: quantity.amount,
          unit: quantity.unit,
          inPantry: ingredient.inPantry ?? false,
          onlyIfMissing: ingredient.onlyIfMissing ?? false,
          sortOrder: index,
        })
        .run();
    });

    return this.build(menu.id, menu.weekStart);
  }

  deleteMeal(mealId: string): void {
    this.db.delete(meals).where(eq(meals.id, mealId)).run();
  }

  /** Wat heb je vandaag nodig om het menu van vandaag te maken? */
  todayNeeded(userId: string | null, now: Date = new Date()): { day: Weekday; needed: PantryNeedRow[] } {
    const day = currentWeekday(now);
    const week = this.week(userId, todayIso(now));
    const meal = week.meals.find((m) => m.day === day);
    return { day, needed: meal ? meal.ingredients : [] };
  }

  /** Zet voorraadregels af op de boodschappenlijst. */
  listIdsFor(userId: string | null): string[] {
    const rows =
      userId === null
        ? this.db.select({ id: weeklyMenus.id }).from(weeklyMenus).all()
        : this.db.select({ id: weeklyMenus.id }).from(weeklyMenus).where(eq(weeklyMenus.userId, userId)).all();
    return rows.map((row) => row.id);
  }
}

export { WEEKDAYS };
