/**
 * HTTP-client voor databronnen.
 *
 * Eigenschappen:
 *  - Alle gegevens blijven binnen dit proces: de sleutel wordt in de header
 *    gezet en komt nooit in een log of een response terecht.
 *  - Time-out, een aantal pogingen en een exponentiële wachttijd.
 *  - Fouten worden getypeerd (rate limit, netwerk, http) zodat de interface
 *    kan zeggen wat er aan de hand is.
 *  - `allowNetwork: false` blokkeert alle uitgaande verzoeken. Zo is de app
 *    volledig offline bruikbaar en is er geen risico op onbedoelde verzoeken.
 */

export type HttpErrorKind = 'netwerk' | 'timeout' | 'rate_limit' | 'http' | 'parse' | 'geblokkeerd' | 'onbekend';

export class SourceError extends Error {
  readonly kind: HttpErrorKind;
  readonly status: number | null;
  readonly retryable: boolean;
  /** Store-id waar het om ging, voor de statuspagina. */
  readonly storeId: string | null;
  /** Vriendelijke Nederlandse uitleg voor de gebruiker. */
  readonly userMessage: string;

  constructor(options: {
    kind: HttpErrorKind;
    message: string;
    status?: number | null;
    retryable?: boolean;
    storeId?: string | null;
    userMessage?: string;
  }) {
    super(options.message);
    this.name = 'SourceError';
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.storeId = options.storeId ?? null;
    this.userMessage = options.userMessage ?? defaultUserMessage(options.kind, options.status ?? null);
  }
}

function defaultUserMessage(kind: HttpErrorKind, status: number | null): string {
  switch (kind) {
    case 'rate_limit':
      return 'De winkel ontvangt momenteel te veel verzoeken. We proberen het later opnieuw.';
    case 'timeout':
      return 'De winkel reageerde niet op tijd. Probeer het over een minuut opnieuw.';
    case 'netwerk':
      return 'Geen verbinding met de bron. Controleer je internetverbinding.';
    case 'geblokkeerd':
      return 'Uitgaande verzoeken staan uit (ALLOW_NETWORK=false). Er worden geen live prijzen opgehaald.';
    case 'parse':
      return 'Het antwoord van de bron had een ander formaat dan verwacht. Controleer de broninstellingen.';
    case 'http':
      return status === 401 || status === 403
        ? 'De toegangssleutel is niet geldig of er ontbreekt een abonnement. Controleer de broninstellingen.'
        : `De bron gaf een fout terug (HTTP ${status ?? 'onbekend'}).`;
    default:
      return 'Onbekende fout bij het ophalen van gegevens.';
  }
}

export interface HttpClientOptions {
  allowNetwork: boolean;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  userAgent: string;
  /** Injecteerbaar voor tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  storeId?: string;
  /** Wordt samen met de store-id gelogd, nooit de headers. */
  label?: string;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Overschrijft de time-out voor dit verzoek. */
  timeoutMs?: number;
}

export class HttpClient {
  private readonly options: HttpClientOptions;

  constructor(options: HttpClientOptions) {
    this.options = options;
  }

  get allowNetwork(): boolean {
    return this.options.allowNetwork;
  }

  async getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  async request<T>(url: string, options: RequestOptions = {}): Promise<T> {
    if (!this.options.allowNetwork) {
      throw new SourceError({
        kind: 'geblokkeerd',
        message: `Uitgaande verzoeken staan uit. Geen verzoek gedaan naar ${options.label ?? url}.`,
        storeId: options.storeId ?? null,
      });
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs;
    const method = options.method ?? 'GET';
    const attempts = Math.max(1, this.options.maxRetries + 1);

    let lastError: SourceError | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(url, {
          method,
          signal: controller.signal,
          headers: {
            'User-Agent': this.options.userAgent,
            Accept: 'application/json',
            ...options.headers,
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });

        if (!response.ok) {
          const kind: HttpErrorKind = response.status === 429 ? 'rate_limit' : 'http';
          const retryable = response.status === 429 || response.status >= 500;
          // Let op: de body wordt bewust NIET gelezen; die zou de sleutel van
          // een foutmelding kunnen bevatten.
          lastError = new SourceError({
            kind,
            message: `HTTP ${response.status} ${response.statusText} voor ${options.label ?? url}`,
            status: response.status,
            retryable,
            storeId: options.storeId ?? null,
          });
          if (retryable && attempt < attempts) {
            await this.delay(attempt);
            continue;
          }
          throw lastError;
        }

        const text = await response.text();
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new SourceError({
            kind: 'parse',
            message: `Ongeldig JSON van ${options.label ?? url}`,
            storeId: options.storeId ?? null,
          });
        }
      } catch (error) {
        if (error instanceof SourceError) {
          if (!error.retryable || attempt >= attempts) throw error;
          lastError = error;
          await this.delay(attempt);
          continue;
        }
        const aborted = error instanceof Error && error.name === 'AbortError';
        const networkError = new SourceError({
          kind: aborted ? 'timeout' : 'netwerk',
          message: aborted ? `Time-out voor ${options.label ?? url}` : `Netwerkfout voor ${options.label ?? url}: ${String(error)}`,
          retryable: true,
          storeId: options.storeId ?? null,
        });
        lastError = networkError;
        if (attempt >= attempts) throw networkError;
        await this.delay(attempt);
      } finally {
        clearTimeout(timer);
      }
    }

    throw (
      lastError ??
      new SourceError({ kind: 'onbekend', message: `Onbekende fout voor ${options.label ?? url}` })
    );
  }

  private delay(attempt: number): Promise<void> {
    const sleep = this.options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    return sleep(this.options.retryDelayMs * 2 ** (attempt - 1));
  }
}
