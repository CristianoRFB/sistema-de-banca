import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

/**
 * Browser evidence: REAL rendered React/Vite pages, but with clearly identified
 * synthetic API fixtures. Not proof of a deployed Worker or production data.
 */
const fixtures = {
  'banca-a': { id: 'tenant-a', slug: 'banca-a', name: 'Banca A',
    phone: '+55 11 99999-1111', address: 'Rua A, 1',
    title: 'Mangá Exclusivo A', color: '#b8ed57', itemId: 'item-a' },
  'banca-b': { id: 'tenant-b', slug: 'banca-b', name: 'Banca B',
    phone: '+55 11 99999-2222', address: 'Rua B, 2',
    title: 'Mangá Exclusivo B', color: '#83c9ff', itemId: 'item-b' },
};

async function mockApi(page) {
  await page.route('**/api/t/**', async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/').filter(Boolean);
    const slug = parts[2]; // /api/t/{slug}/public/{resource}
    const bank = fixtures[slug];
    if (!bank || parts[3] !== 'public') {
      await route.fulfill({ status: 404, contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'tenant_not_found', message: 'Tenant não encontrado.' } }) });
      return;
    }
    const resource = parts[4];
    const product = {
      id: 'product-' + bank.id,
      itemReparteId: bank.itemId,
      productId: 'book-' + bank.id,
      title: bank.title,
      volume: '01', type: 'MANGA', publisher: 'Editora Exemplo',
      price: 22.90, available: 2, publishedAt: '2026-10-01T12:00:00.000Z',
      reservationCutoffAt: null, plannedCollectionAt: null, status: 'AVAILABLE',
    };
    let data;
    if (resource === 'tenant') {
      data = { tenant: { id: bank.id, slug: bank.slug, name: bank.name,
        phone: bank.phone, address: bank.address, photoUrl: null, active: true,
        branding: { primaryColor: bank.color, accentColor: null,
          backgroundColor: null, textColor: null, logoUrl: null, tagline: null } } };
    } else if (resource === 'banca') {
      data = { profile: { name: bank.name, slug: bank.slug,
        phone: bank.phone, address: bank.address, photoUrl: null }, hours: [] };
    } else if (resource === 'catalog' && parts.length === 5) {
      data = { items: [product], page: { nextCursor: null, limit: 24, hasMore: false } };
    } else if (resource === 'catalog' && parts[5] === bank.itemId) {
      data = { item: product };
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'not_found', message: 'Recurso não encontrado.' } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ data }) });
  });
}

async function screenshot(page, name) {
  await mkdir('test-results/browser-screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/browser-screenshots/' + name + '.png', fullPage: true });
}

test.beforeEach(async ({ page }) => { await mockApi(page); });

test('desktop: real rendered UI switches A to B without retaining A data', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/banca-a');
  await expect(page.getByRole('link', { name: 'Banca A, início' })).toBeVisible();
  await expect(page.getByText('Mangá Exclusivo A').first()).toBeVisible();
  await screenshot(page, 'banca-a-desktop');

  // Use client-side navigation, not a full-page load: this catches state leaks.
  await page.evaluate(() => {
    window.history.pushState({}, '', '/banca-b');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('link', { name: 'Banca B, início' })).toBeVisible();
  await expect(page.getByText('Mangá Exclusivo B').first()).toBeVisible();
  await expect(page.getByText('Mangá Exclusivo A')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/5511999992222');
  await screenshot(page, 'banca-b-desktop');

  await page.goto('/banca-b/catalogo');
  await expect(page.getByText('ARQUIVO ABERTO · BANCA B')).toBeVisible();
  await expect(page.getByText('Mangá Exclusivo B').first()).toBeVisible();
  await expect(page.getByText(/ANA MARIA/i)).toHaveCount(0);
  await screenshot(page, 'banca-b-catalogo-desktop');

  await page.goto('/banca-b/localizacao');
  await expect(page.getByText('Rua B, 2').first()).toBeVisible();
  await expect(page.getByText('Rua A, 1')).toHaveCount(0);
  await screenshot(page, 'banca-b-localizacao-desktop');

  await page.goto('/banca-b/produto/item-b');
  await expect(page.getByRole('heading', { name: /Mangá Exclusivo B/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Perguntar à banca/ })).toHaveAttribute('href', /wa.me\/5511999992222/);
  await screenshot(page, 'banca-b-produto-desktop');
});

test('mobile: both real tenant frontends remain usable and distinguishable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/banca-a');
  await expect(page.getByRole('link', { name: 'Banca A, início' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navegação inferior' })).toBeVisible();
  await screenshot(page, 'banca-a-mobile');

  await page.goto('/banca-b');
  await expect(page.getByRole('link', { name: 'Banca B, início' })).toBeVisible();
  await screenshot(page, 'banca-b-mobile');

  await page.goto('/banca-b/catalogo');
  await expect(page.getByRole('textbox', { name: 'Buscar no catálogo' })).toBeVisible();
  await screenshot(page, 'banca-b-catalogo-mobile');
});

test('unknown tenant fails closed without showing Ana Maria or another tenant', async ({ page }) => {
  await page.goto('/tenant-desconhecido');
  await expect(page.getByRole('alert')).toContainText('Não foi possível abrir esta banca.');
  await expect(page.locator('.site-shell')).toHaveCount(0);
  await expect(page.getByText('Banca Ana Maria')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /WhatsApp/ })).toHaveCount(0);
  await screenshot(page, 'tenant-invalido-blocked');
});
