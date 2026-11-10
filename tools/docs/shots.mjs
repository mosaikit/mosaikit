// The screenshots of the user manuals: drives a fresh desktop release (data folder empty, default sign-in
// admin / mosaikit and user / mosaikit), makes some sample data and writes docs/presentation/screens/*.png.
// node shots.mjs [--server http://127.0.0.1:48590/] [--out <folder>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const base = opt('server', 'http://127.0.0.1:48590/');
const out = path.resolve(opt('out', path.join(here, '..', '..', 'docs', 'presentation', 'screens')));
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.DOCS_BROWSER || undefined });
const T = '#/t/locale';
let failed = 0;

async function session(user, adminPage) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(base + (adminPage ? '#/admin' : ''));
  await p.waitForTimeout(1200);
  await p.getByLabel('Username').fill(user);
  await p.getByLabel('Password').fill('mosaikit');
  await p.getByRole('button', { name: /sign in/i }).click();
  await p.waitForTimeout(2500);
  return p;
}

const step = async (label, fn) => {
  try {
    await fn();
  } catch (e) {
    failed += 1;
    console.error(`FAILED ${label}: ${String(e.message).split('\n')[0]}`);
  }
};
const shot = async (p, name, wait = 1200) => {
  await p.waitForTimeout(wait);
  await p.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(name);
};
const go = async (p, hash) => {
  await p.goto(base + hash);
  await p.waitForTimeout(500);
};

// ---- the sign-in page, before anyone is in
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(base);
  await shot(p, 'user-signin', 1500);
  await ctx.close();
}

// ---- the Tenant Manager of the tenant: sample data, then the pages
{
  const p = await session('user', false);
  await step('users', async () => {
    for (const [u, n, e] of [
      ['anna', 'Anna Rossi', 'anna.rossi@example.com'],
      ['marco', 'Marco Bianchi', 'marco.bianchi@example.com'],
      ['giulia', 'Giulia Verdi', 'giulia.verdi@example.com'],
    ]) {
      await go(p, `${T}/manage`);
      await p.getByRole('button', { name: 'New user' }).click();
      await p.locator('#f-username').fill(u);
      await p.locator('#f-display_name').fill(n);
      await p.locator('#f-email').fill(e);
      await p.locator('#f-password').fill('Mosaikit-demo-2026');
      if (u === 'giulia') await shot(p, 'manager-new-user', 600);
      await p.getByRole('button', { name: 'Create user' }).click();
      await p.waitForTimeout(900);
    }
  });
  await step('groups', async () => {
    for (const g of ['Marketing', 'Field team']) {
      await go(p, `${T}/manage/groups`);
      await p.getByRole('button', { name: 'New group' }).first().click();
      await p.locator('#f-name').fill(g);
      await p.getByRole('button', { name: 'Create group' }).click();
      await p.waitForTimeout(900);
    }
  });
  await step('notes', async () => {
    await go(p, `${T}/p/com.mosaikit.notes`);
    await p.waitForTimeout(1800);
    const f = p.frames().find((x) => x !== p.mainFrame());
    for (const [t, b] of [
      ['Welcome to Mosaikit', 'Everything you need to work together: share, comment and keep track of what changes.'],
      ['Meeting notes, Monday', 'Agree the plan for the quarter. Owners: Anna and Marco. Review on Friday.'],
      ['Ideas for the website', 'A page for each product, a short video, customer stories.'],
      ['Shopping list', 'Coffee, paper, markers, sticky notes.'],
    ]) {
      await f.getByRole('button', { name: /New note/ }).first().click();
      await f.locator('#f-title').fill(t);
      await f.locator('#f-body').fill(b);
      await f.getByRole('button', { name: 'Save' }).click();
      await p.waitForTimeout(900);
    }
    await shot(p, 'user-notes', 1000);
    await f.getByText('Welcome to Mosaikit').first().click();
    await p.waitForTimeout(700);
    await f.getByRole('button', { name: /Share/ }).first().click();
    await shot(p, 'user-share', 900);
  });
  await step('home', async () => {
    await go(p, `${T}`);
    await shot(p, 'user-home', 1500);
  });
  await step('search', async () => {
    await go(p, `${T}`);
    await p.keyboard.press('Control+k');
    await p.keyboard.type('meeting', { delay: 40 });
    await shot(p, 'user-search', 1200);
    await p.keyboard.press('Escape');
  });
  await step('bell', async () => {
    await go(p, `${T}`);
    await p.getByRole('button', { name: /Notifications/ }).first().click();
    await shot(p, 'user-notifications', 800);
    await p.keyboard.press('Escape');
  });
  for (const [name, hash] of [
    ['user-account', '/account/appearance'],
    ['user-trash', '/trash'],
    ['manager-people', '/manage'],
    ['manager-groups', '/manage/groups'],
    ['manager-profiles', '/manage/profiles'],
    ['manager-plugins', '/plugins'],
    ['manager-shares', '/shares'],
    ['manager-usage', '/usage'],
    ['manager-log', '/log'],
    ['manager-settings', '/settings'],
    ['manager-overview', '/overview'],
  ]) {
    await step(name, async () => {
      await go(p, `${T}${hash}`);
      await shot(p, name, 1500);
    });
  }
  await p.context().close();
}

// ---- the Administrator
{
  const p = await session('admin', true);
  for (const [name, hash] of [
    ['admin-overview', '#/admin'],
    ['admin-tenants', '#/admin/tenants'],
    ['admin-people', '#/admin/people'],
    ['admin-plugins', '#/admin/plugins'],
    ['admin-system', '#/admin/system'],
    ['admin-quotas', '#/admin/system/quotas'],
    ['admin-monitoring', '#/admin/system/monitoring'],
    ['admin-backup', '#/admin/system/backup'],
    ['admin-log', '#/admin/system/log'],
  ]) {
    await step(name, async () => {
      await go(p, hash);
      await shot(p, name, 1500);
    });
  }
  await p.context().close();
}

await browser.close();
if (failed) {
  console.error(`${failed} step(s) failed`);
  process.exit(1);
}
