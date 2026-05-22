import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default to node; popup.test.ts opts into jsdom via a per-file
    // `// @vitest-environment jsdom` docblock.
    environment: 'node',
  },
});
