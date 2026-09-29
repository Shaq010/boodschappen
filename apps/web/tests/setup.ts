/**
 * Testomgeving voor de frontend.
 *
 * De tests draaien in jsdom; `matchMedia` en `scrollTo` bestaan daar niet,
 * terwijl de app ze wel gebruikt. We zetten er dus een eenvoudige versie van.
 */

import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

// localStorage bestaat in jsdom wel, maar per testfile; expliciet leegmaken
// voorkomt dat een lijst uit een vorige test blijft hangen.
beforeEach(() => {
  window.localStorage.clear();
});

import { beforeEach } from 'vitest';
