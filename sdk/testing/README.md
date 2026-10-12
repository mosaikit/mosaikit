# @mosaikit/testing

The test bench of Mosaikit plugins (MK-050, ADR-0035): a real Mosaikit installation with your
plugin, on an embedded PostgreSQL, with an organization and two people who confirmed their
address. Nothing to install but Java 25 and Node.js 24. The plugins written by
`create-mosaikit-plugin` use it already.

## Try a plugin: `mosaikit-bench`

```bash
npx mosaikit-bench                      # the plugin of the current directory (its manifest.yaml)
npx mosaikit-bench . ../todo            # more plugins: directories or packages (.zip)
npx mosaikit-bench --port 8080 --work .mosaikit-bench
```

It prints the address, the administrator and the people, and runs until Ctrl+C. A plugin
directory is linked into the installation and watched: a changed frontend shows at once in the open
page; Java code (`lib/`) and migrations are read at the next start. A package is signed with the
key of the bench and installed.

## Test a plugin with Playwright

`tests/global-setup.ts` starts the bench before the tests and stops it after them:

```ts
import { Bench, packagesIn } from '@mosaikit/testing';

export default async function globalSetup(): Promise<() => Promise<void>> {
  const bench = await Bench.start({
    work: '.mosaikit-bench',
    plugins: packagesIn('target'), // what mvn package built; a directory works too
    settings: { 'mosaikit.plugins.unverified-frontends': 'module' },
  });
  bench.publish(); // the tests read the bench from the environment
  return () => bench.stop();
}
```

The tests use the helpers of `@mosaikit/testing/playwright`:

```ts
import { expect, test } from '@playwright/test';
import { api, member, openApp, signIn } from '@mosaikit/testing/playwright';

test('a person of the organization opens the app', async ({ page }) => {
  await signIn(page, member());
  await openApp(page, 'Traffic');
  await expect(page.getByRole('heading', { name: 'Traffic' })).toBeVisible();
  expect((await api(member(1), '/api/v1/p/traffic/items')).status).toBe(200);
});
```

| Helper | What it does |
|---|---|
| `bench()` | the bench: `baseUrl`, `admin`, `organization`, `people`, `settings` |
| `member(i)` | the person `i` of the organization (the first by default) |
| `signIn(page, person)` | signs in on the page of the shell, in English or Italian |
| `apps(page)`, `openApp(page, name)` | the app bar, and an app opened from it |
| `api(person, path, init?, organization?)` | the API of the kernel as a person: `{ status, body }` |
| `restart(settings?)` | restarts the installation, with other settings; needs `controlPort` |
| `unique(prefix)` | a title that no other run used |

## Options of `Bench.start`

| Option | Default | Meaning |
|---|---|---|
| `work` | (required) | where the bench keeps the installation, the database, the mails and the log |
| `plugins` | none | installed before the first start: packages (signed by the bench) or plugin directories |
| `catalog` | none | offered by a signed catalog of the installation, to install from the Plugins page |
| `installation` | see below | the installation to copy |
| `port` | a free port | the port of the kernel |
| `admin`, `organization`, `people` | `admin`, `example`, two people | who the bench creates; people register and confirm their address by mail |
| `settings` | none | settings of the installation, added to those of the bench |
| `database` | an embedded PostgreSQL | `{ url, username, password }` of a database to use instead |
| `controlPort` | none | a port on which the Playwright workers ask for `restart` |
| `beforeStart` | none | called with the directory of the installation before its first start |

The bench also has `restart(settings?)`, `stop()`, `signing` (to sign packages and catalogs with
its key), and `info`. Mails go to a fake mail server, readable with `mails(directory)` and
`confirmationLink(directory, address)`.

## Which installation

The installation of the version of this package, downloaded once into `~/.cache/mosaikit`
(`MOSAIKIT_CACHE` changes it): for a snapshot of `main` from the pre-release `snapshot` of
mosaikit/mosaikit, for a release from its GitHub release. `MOSAIKIT_INSTALLATION` chooses another
one, such as `target/dist/mosaikit` of a build of Mosaikit, to test a plugin against a change of
the kernel. `MOSAIKIT_BENCH_DEBUG=1` prints how long each phase of a start takes.

A start takes about 15 seconds, and about 25 when a plugin brings Java code, which the launcher
builds into the kernel at the first start.
