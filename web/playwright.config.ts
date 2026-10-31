import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:18080', headless: true },
  webServer: {
    command: 'go run ./cmd/yandock --listen 127.0.0.1:18080 --program sh',
    cwd: '..',
    // A public, test-only fixture; never use this credential in a deployment.
    // Mirror launchd's locale-neutral environment for cwd encoding regressions.
    env: {
      YANDOCK_TOKEN: 'test-only-yandock-credential-00000000',
      LC_ALL: 'C',
    },
    url: 'http://127.0.0.1:18080',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
