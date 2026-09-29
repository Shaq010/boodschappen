import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // De database-tests draaien op een in-memory SQLite-database.
    pool: 'forks',
    // De eerste test laadt de native SQLite-binding en drizzle; op een
    // gemounte schijfsysteem kost dat enkele seconden. Dat is een eenmalige
    // laadtijd, geen trage test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
