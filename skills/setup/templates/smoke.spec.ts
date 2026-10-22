import { test, expect } from '@playwright/test';

// Prova mínima de que o app sobe e responde. Os testes de aceite de cada PRD ficam ao lado.
test('o app abre', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status() ?? 0).toBeLessThan(500);
});
