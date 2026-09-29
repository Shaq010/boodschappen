/**
 * Navigatie.
 *
 * Mobiel: een vaste balk onderaan, want de duim bereikt de onderkant van het
 * scherm. Vanaf `md` (tablet en groter) wordt het een zijbalk. Zo hoeft de
 * gebruiker nooit te scrollen om ergens anders heen te gaan.
 */

import { NavLink } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { ListChecks, CalendarDays, PiggyBank, Scale, Package, Settings, Home } from 'lucide-react';

const LINKS = [
  { to: '/', label: 'Dashboard', icon: Home, end: true },
  { to: '/lijst', label: 'Lijst', icon: ListChecks },
  { to: '/menu', label: 'Weekmenu', icon: CalendarDays },
  { to: '/aanbiedingen', label: 'Aanbiedingen', icon: PiggyBank },
  { to: '/prijzen', label: 'Prijzen', icon: Scale },
  { to: '/voorraad', label: 'Voorraad', icon: Package },
  { to: '/instellingen', label: 'Instellingen', icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-full">
      <a
        href="#inhoud"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Direct naar de inhoud
      </a>

      {/* Zijbalk vanaf md; daarboven een uitklapbare balk bovenaan. */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-semibold text-slate-900">Boodschappen</span>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobiel-menu"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium"
          >
            {menuOpen ? 'Sluiten' : 'Menu'}
          </button>
        </div>
        {menuOpen ? (
          <nav id="mobiel-menu" className="border-t border-slate-200 bg-white">
            <ul className="py-2">
              {LINKS.map((link) => (
                <li key={link.to}>
                  <NavItem {...link} onNavigate={() => setMenuOpen(false)} />
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>

      <div className="md:flex">
        <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block">
          <div className="sticky top-0 flex h-full flex-col p-4">
            <p className="px-3 pb-4 text-lg font-semibold text-slate-900">Boodschappen</p>
            <nav aria-label="Hoofdmenu">
              <ul className="space-y-1">
                {LINKS.map((link) => (
                  <li key={link.to}>
                    <NavItem {...link} />
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </aside>

        <main id="inhoud" className="min-w-0 flex-1 pb-20 md:pb-8">
          <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 md:py-8">{children}</div>
          {/* Bronvermelding. Het gratis plan van PrijsProfeet schrijft een
              zichtbare verwijzing naar de bron voor; zonder die zou het gebruik
              buiten hun voorwaarden vallen. */}
          <footer className="mx-auto w-full max-w-4xl px-4 pb-8 text-[11px] leading-relaxed text-slate-400 sm:px-6">
            <p>
              Prijzen en aanbiedingen via{' '}
              <a
                href="https://www.prijsprofeet.nl/api"
                target="_blank"
                rel="noreferrer noopener"
                className="underline hover:text-slate-600"
              >
                PrijsProfeet
              </a>
              . Indicatief en exclusief btw: controleer de prijs in de winkel.
            </p>
          </footer>
        </main>
      </div>

      {/* Onderste navigatiebalk voor mobiel: altijd binnen duwerbereik. */}
      <nav
        aria-label="Snelle navigatie"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-4">
          {LINKS.slice(0, 4).map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                end={'end' in link ? link.end : false}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium ${
                    isActive ? 'text-brand-700' : 'text-slate-600'
                  }`
                }
              >
                <link.icon aria-hidden="true" className="h-5 w-5" />
                <span>{link.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-100'
        }`
      }
    >
      <Icon aria-hidden="true" className="h-4.5 w-4.5" />
      {label}
    </NavLink>
  );
}

/**
 * Zet de pagina-titel en de scrollpositie terug bij navigeren. Voorkomt dat je
 * op de volgende pagina halverwege de tekst begint.
 */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Boodschappen`;
    window.scrollTo({ top: 0 });
  }, [title]);
}
