/** Vorm van één migratie: een naam en de SQL-instructies die in volgorde draaien. */
export interface Migration {
  name: string;
  statements: readonly string[];
}
