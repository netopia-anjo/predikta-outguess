import { defineConfig,devices } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',fullyParallel:false,workers:1,timeout:60_000,
  use:{baseURL:process.env.E2E_BASE_URL||'http://localhost:3100',trace:'retain-on-failure',actionTimeout:10_000},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
  webServer:process.env.E2E_BASE_URL?undefined:{command:'npm run dev',url:'http://localhost:3100/api/health',reuseExistingServer:!process.env.CI,timeout:120_000}
});
