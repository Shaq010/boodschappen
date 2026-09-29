/**
 * Voorraadkast.
 *
 * Wat je al in huis hebt. De app trekt dit eraf bij de weekmenu-ingrediënten
 * en bij de bulkimport, zodat je niet dubbel koopt.
 */

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api_, ApiError } from '../lib/api.js';
import { useLoadable } from '../lib/hooks.js';
import { usePageTitle } from '../components/shell.js';
import { Button, Card, CardTitle, EmptyState, Notice, Spinner, StatRow } from '../components/ui.js';
import { formatNumber } from '../lib/format.js';

export function PantryPage() {
  usePageTitle('Voorraad');
  const pantry = useLoadable(() => api_.pantry(), []);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState('st');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items = pantry.data?.items ?? [];
  const total = items.reduce((sum, item) => sum + item.amount, 0);

  async function add() {
    if (name.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api_.addPantry({
        name: name.trim(),
        amount: Number(amount.replace(',', '.')),
        unit: unit.trim() || 'st',
      });
      setName('');
      setAmount('1');
      pantry.reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage ? cause.userMessage : 'Toevoegen mislukt.' : 'Toevoegen mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Voorraad</h1>
        <p className="mt-1 text-slate-600">
          Wat heb je al in huis? De app houdt dit bij in je weekmenu en je boodschappenlijst.
        </p>
      </header>

      {pantry.error ? <Notice kind="error" title="Voorraad laden mislukt">{pantry.error}</Notice> : null}

      <Card>
        <StatRow
          items={[
            { label: 'Producten', value: String(items.length) },
            { label: 'Stuks totaal', value: formatNumber(total) },
          ]}
        />
      </Card>

      <Card>
        <CardTitle>Toevoegen</CardTitle>
        {error ? (
          <div className="mb-2">
            <Notice kind="error" title="Toevoegen mislukt">
              {error}
            </Notice>
          </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
          className="grid gap-3 sm:grid-cols-[1fr_6rem_6rem_auto] sm:items-end"
        >
          <div>
            <label htmlFor="product" className="mb-1 block text-sm font-medium text-slate-800">
              Product
            </label>
            <input
              id="product"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="melk"
              className="w-full rounded-lg border border-slate-300 p-2.5"
            />
          </div>

          <div>
            <label htmlFor="hoeveelheid" className="mb-1 block text-sm font-medium text-slate-800">
              Aantal
            </label>
            <input
              id="hoeveelheid"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-300 p-2.5"
            />
          </div>

          <div>
            <label htmlFor="eenheid" className="mb-1 block text-sm font-medium text-slate-800">
              Eenheid
            </label>
            <input
              id="eenheid"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              placeholder="st, l, g"
              className="w-full rounded-lg border border-slate-300 p-2.5"
            />
          </div>

          <Button type="submit" disabled={busy || name.trim().length === 0}>
            Toevoegen
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>In voorraad</CardTitle>
        {pantry.loading ? <Spinner label="Voorraad laden" /> : null}
        {!pantry.loading && items.length === 0 ? (
          <EmptyState title="Alles leeg">
            <p>Voeg toe wat je in huis hebt, dan wordt je weekmenu automatisch slimmer.</p>
          </EmptyState>
        ) : null}

        {items.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="font-medium text-slate-900">{item.name}</p>
                  <p className="text-sm text-slate-600">
                    {formatNumber(item.amount)} {item.unit}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`${item.name} uit voorraad halen`}
                  onClick={async () => {
                    await api_.removePantry(item.id);
                    pantry.reload();
                  }}
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
