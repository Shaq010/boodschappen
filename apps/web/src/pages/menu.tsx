/**
 * Weekmenu.
 *
 * Per dag een gerecht; onderaan de benodigde ingrediënten. Ingrediënten die
 * je al in huis hebt, worden gemarkeerd in plaats van weggelaten — zo zie je
 * meteen wat je nog moet kopen.
 */

import { useState } from 'react';
import { CalendarPlus, Trash2 } from 'lucide-react';
import { api_, ApiError, type NeededItem } from '../lib/api.js';
import { useLoadable } from '../lib/hooks.js';
import { usePageTitle } from '../components/shell.js';
import { Button, Card, CardTitle, EmptyState, Notice, Spinner, StatusPill } from '../components/ui.js';
import { WEEKDAY_ORDER, dayLabel, formatDate, listSentence } from '../lib/format.js';

export function MenuPage() {
  usePageTitle('Weekmenu');
  const menu = useLoadable(() => api_.menu(), []);
  const [day, setDay] = useState(currentDay());
  const [name, setName] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const week = menu.data?.menu ?? null;
  const meals = week?.meals ?? [];

  async function add() {
    if (name.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api_.addMeal({
        day,
        name: name.trim(),
        ingredients: parseIngredientText(ingredients),
      });
      setName('');
      setIngredients('');
      menu.reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'Toevoegen mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Weekmenu</h1>
        <p className="mt-1 text-slate-600">
          {week ? (
            <>Week van {formatDate(week.weekStart)} · {meals.length} gerecht(en)</>
          ) : (
            'Plan je week en zie meteen wat je nodig hebt.'
          )}
        </p>
      </header>

      {menu.error ? <Notice kind="error" title="Menu laden mislukt">{menu.error}</Notice> : null}
      {menu.loading ? <Spinner label="Menu laden" /> : null}

      {week && week.notices.length > 0 ? (
        <Notice kind="info" title="Let op">
          <ul className="list-disc space-y-1 pl-4">
            {week.notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <Card>
        <CardTitle>Deze week</CardTitle>
        {meals.length === 0 && !menu.loading ? (
          <EmptyState title="Nog niets gepland">
            <p>Kies een dag, typ een gerecht en vul de ingrediënten in.</p>
          </EmptyState>
        ) : null}

        <ul className="space-y-3">
          {WEEKDAY_ORDER.map((weekday) => {
            const dayMeals = meals.filter((meal) => meal.day === weekday);
            return (
              <li key={weekday} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{dayLabel(weekday)}</p>
                {dayMeals.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500">Nog niets gepland.</p>
                ) : (
                  <ul className="mt-1.5 space-y-2">
                    {dayMeals.map((meal) => (
                      <li key={meal.id} className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">{meal.name}</p>
                          {meal.note ? <p className="text-sm text-slate-600">{meal.note}</p> : null}
                          {meal.ingredients.length > 0 ? (
                            <p className="mt-0.5 text-sm text-slate-500">
                              {listSentence(
                                meal.ingredients.map(
                                  (item) => `${item.name} (${item.amount} ${item.unit})`,
                                ),
                              )}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          aria-label={`${meal.name} verwijderen`}
                          onClick={async () => {
                            await api_.deleteMeal(meal.id);
                            menu.reload();
                          }}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardTitle>Gerecht toevoegen</CardTitle>
        {error ? (
          <div className="mb-2">
            <Notice kind="error" title="Toevoegen mislukt">
              {error}
            </Notice>
          </div>
        ) : null}

        <div className="space-y-3">
          <div>
            <label htmlFor="dag" className="mb-1 block text-sm font-medium text-slate-800">
              Dag
            </label>
            <select
              id="dag"
              value={day}
              onChange={(event) => setDay(event.target.value)}
              className="w-full rounded-lg border border-slate-300 p-2.5"
            >
              {WEEKDAY_ORDER.map((weekday) => (
                <option key={weekday} value={weekday}>
                  {dayLabel(weekday)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="gerecht" className="mb-1 block text-sm font-medium text-slate-800">
              Gerecht
            </label>
            <input
              id="gerecht"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Pasta met tomatensaus"
              className="w-full rounded-lg border border-slate-300 p-2.5"
            />
          </div>

          <div>
            <label htmlFor="ingrediënten" className="mb-1 block text-sm font-medium text-slate-800">
              Ingrediënten (optioneel)
            </label>
            <input
              id="ingrediënten"
              value={ingredients}
              onChange={(event) => setIngredients(event.target.value)}
              placeholder="pasta 500 g, tomatensaus 1 fles, ui 2 st"
              className="w-full rounded-lg border border-slate-300 p-2.5"
            />
            <p className="mt-1 text-xs text-slate-500">
              Scheid met komma&apos;s. Hoeveelheden mag je weglaten, dan wordt er 1 stuk aangenomen.
            </p>
          </div>

          <Button onClick={add} disabled={busy || name.trim().length === 0}>
            <CalendarPlus aria-hidden="true" className="h-4 w-4" />
            Toevoegen
          </Button>
        </div>
      </Card>

      {week ? (
        <Card>
          <CardTitle>Wat heb je nodig?</CardTitle>
          <NeededTable items={week.shopping} />
        </Card>
      ) : null}
    </div>
  );
}

function NeededTable({ items }: { items: NeededItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-600">Nog niets nodig voor deze week.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => (
        <li key={`${item.name}-${item.dimension}`} className="flex items-center justify-between gap-2 py-2">
          <div className="min-w-0">
            <p className="font-medium text-slate-900">{item.name}</p>
            <p className="text-sm text-slate-600">
              {item.amount} {item.unit}
              {item.inPantry ? ` · in voorraad: ${item.pantryAmount} ${item.unit}` : ''}
            </p>
          </div>
          {item.inPantry ? <StatusPill status="ok" label="Heb ik" /> : <StatusPill status="info" label="Moet ik kopen" />}
        </li>
      ))}
    </ul>
  );
}

/** Vandaag in het Nederlands, bijvoorbeeld "dinsdag". */
function currentDay(): string {
  const names: Record<number, string> = {
    0: 'zondag',
    1: 'maandag',
    2: 'dinsdag',
    3: 'woensdag',
    4: 'donderdag',
    5: 'vrijdag',
    6: 'zaterdag',
  };
  return names[new Date().getDay()] ?? 'maandag';
}

/** Eenvoudige ingredientenlijst uit losse tekst, bv. "pasta 500 g, ui 2 st". */
function parseIngredientText(
  text: string,
): Array<{ name: string; amount?: number; unit?: string }> {
  if (text.trim().length === 0) return [];
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const match = /^(.*?)\s+(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(part);
      if (!match) return { name: part };
      const [, name, amount, unit] = match;
      return {
        name: name!.trim(),
        amount: Number(amount!.replace(',', '.')),
        unit: unit!.trim() || undefined,
      };
    })
    .filter((item) => item.name.length > 0);
}
