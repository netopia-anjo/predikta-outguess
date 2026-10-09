import { defineConfig } from 'vitest/config';
export default defineConfig({resolve:{alias:{'server-only':new URL('./tests/server-only.ts',import.meta.url).pathname}},test:{include:['tests/**/*.integration.test.ts'],fileParallelism:false,testTimeout:60_000,hookTimeout:60_000}});
