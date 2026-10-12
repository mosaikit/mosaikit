// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { PluginNames } from './names.js';

/** What to create. */
export interface PluginOptions {
  readonly names: PluginNames;
  /** Adds Java code, a database schema under row-level security and actions for assistants. */
  readonly backend: boolean;
  /** Version of the Mosaikit plugin API (`io.github.mosaikit:mosaikit-kernel-api`). */
  readonly mosaikitVersion: string;
  /** Author, for the licence headers. */
  readonly author: string;
}

/** The files of a new plugin, by path relative to its directory. */
export type PluginFiles = ReadonlyMap<string, string>;

const LICENSE = 'MPL-2.0';

/** Every file of a new plugin. */
export function pluginFiles(options: PluginOptions): PluginFiles {
  const files = new Map<string, string>();
  files.set('manifest.yaml', manifest(options));
  files.set('web/index.js', frontend(options));
  files.set('web/icon.svg', icon(options));
  files.set('README.md', readme(options));
  files.set(
    '.gitignore',
    'target/\nlib/\ndist/\nnode_modules/\n.mosaikit-bench/\ntest-results/\nplaywright-report/\n',
  );
  files.set('.github/workflows/ci.yml', workflow(options));
  files.set('package.json', packageJson(options));
  files.set('playwright.config.ts', playwrightConfig(options));
  files.set('tests/global-setup.ts', globalSetup(options));
  files.set(`tests/${options.names.slug}.spec.ts`, spec(options));
  files.set('pom.xml', pom(options));
  if (options.backend) {
    const path = `src/main/java/${options.names.javaPackage.replaceAll('.', '/')}`;
    files.set('db/V1__create_item.sql', migration(options));
    files.set(`${path}/Item.java`, entity(options));
    files.set(`${path}/Items.java`, repository(options));
    files.set(`${path}/ItemResource.java`, resource(options));
  }
  return files;
}

function header(options: PluginOptions, comment: string): string {
  const year = new Date().getFullYear();
  return `${comment} SPDX-FileCopyrightText: ${String(year)} ${options.author}\n${comment} SPDX-License-Identifier: ${LICENSE}\n`;
}

function manifest(options: PluginOptions): string {
  const { names, backend } = options;
  const lines = [
    header(options, '#').trimEnd(),
    `id: ${names.id}`,
    'version: 0.1.0',
    `name: ${names.name}`,
    `description: ${names.name}, a Mosaikit plugin.`,
    backend ? 'kind: [app, service]' : 'kind: [app]',
    "platform: '>=0.1 <1'",
  ];
  if (backend) {
    lines.push(
      'backend:',
      `  jar: lib/${names.slug}.jar`,
      `  api: ${names.slug}`,
      'database:',
      `  schema: ${names.schema}`,
    );
  }
  lines.push(
    'frontend:',
    '  entry: web/index.js',
    '  isolation: module',
    '  # What the frontend may do when the shell runs it isolated in an iframe.',
    '  bridge:',
    `    publishes: [${names.slug}.*]`,
    backend ? '    services: [api]' : '    services: [data]',
  );
  if (!backend) {
    lines.push(
      '# Collections of JSON documents that the kernel keeps for each organization (ADR-0031):',
      '# nothing to build or migrate, and the plugin is active as soon as it is installed.',
      'data:',
      '  collections: [items]',
    );
  }
  if (backend) {
    lines.push(
      '# Tools for assistants and MCP clients; write actions wait for the confirmation of the person.',
      'actions:',
      '  - name: list-items',
      '    title: List items',
      `    description: Lists the items of ${names.name} of the organization.`,
      '    risk: read',
      '    call: { method: GET, path: items }',
      '  - name: create-item',
      '    title: Create an item',
      `    description: Adds an item to ${names.name}.`,
      '    risk: write',
      '    input:',
      '      type: object',
      '      properties:',
      '        title: { type: string, minLength: 1, maxLength: 200 }',
      '      required: [title]',
      '      additionalProperties: false',
      '    call: { method: POST, path: items }',
    );
  }
  lines.push(
    'contributes:',
    '  # The app bar of the shell.',
    '  rail.app:',
    `    - id: ${names.slug}`,
    `      title: ${names.name}`,
    `      route: /app/${names.slug}`,
    `      element: ${names.element}`,
    '      icon: web/icon.svg',
  );
  return `${lines.join('\n')}\n`;
}

function icon(options: PluginOptions): string {
  const letter = options.names.name.slice(0, 1).toUpperCase();
  const year = String(new Date().getFullYear());
  return `<!-- SPDX-FileCopyrightText: ${year} ${options.author} -->
<!-- SPDX-License-Identifier: ${LICENSE} -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <rect width="24" height="24" rx="6" fill="#3654c9"/>
  <text x="12" y="16.5" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="700" fill="#ffffff">${letter}</text>
</svg>
`;
}

function frontend(options: PluginOptions): string {
  const { names, backend } = options;
  const api = `/api/v1/p/${names.slug}/items`;
  const body = backend
    ? `
      async refresh() {
        const response = await context.fetch('${api}');
        if (!response.ok) {
          this.status.textContent = \`The items cannot be loaded (\${response.status}).\`;
          return;
        }
        const items = await response.json();
        this.list.replaceChildren(
          ...items.map((item) => {
            const li = document.createElement('li');
            li.textContent = item.title;
            return li;
          }),
        );
        this.status.textContent = items.length === 0 ? 'No items yet.' : \`\${items.length} items.\`;
      }

      async add(title) {
        const response = await context.fetch('${api}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        if (response.ok) {
          context.events.publish('${names.slug}.created', { title });
          await this.refresh();
        } else {
          this.status.textContent = \`The item cannot be saved (\${response.status}).\`;
        }
      }`
    : `
      async refresh() {
        try {
          const items = await context.data('items').list();
          this.list.replaceChildren(
            ...items.map((item) => {
              const li = document.createElement('li');
              li.textContent = item.data.title;
              return li;
            }),
          );
          this.status.textContent =
            items.length === 0 ? \`Hello \${context.user.displayName}, no items yet.\` : \`\${items.length} items.\`;
        } catch (error) {
          this.status.textContent = \`The items cannot be loaded: \${error.message}\`;
        }
      }

      async add(title) {
        try {
          await context.data('items').create({ title });
          context.events.publish('${names.slug}.created', { title });
          await this.refresh();
        } catch (error) {
          this.status.textContent = \`The item cannot be saved: \${error.message}\`;
        }
      }`;
  return `${header(options, '//')}
/**
 * Frontend of ${names.name}: a custom element, rendered by the shell for /app/${names.slug}.
 * Style it with the --mk-* tokens of the shell theme; talk to other plugins with context.events.
 */

/** @type {import('@mosaikit/sdk').MosaikitPlugin} */
const plugin = {
  activate(context) {
    if (customElements.get('${names.element}')) {
      return;
    }

    class App extends HTMLElement {
      connectedCallback() {
        const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        root.innerHTML = \`
          <style>
            section { background: var(--mk-surface); border: 1px solid var(--mk-line);
                      border-radius: var(--mk-radius); padding: 20px; max-width: 640px; }
            form { display: flex; gap: 8px; margin-bottom: 16px; }
            input { flex: 1; font: inherit; padding: 8px; border: 1px solid var(--mk-line);
                    border-radius: var(--mk-radius); background: var(--mk-bg); color: var(--mk-fg); }
            button { font: inherit; padding: 8px 12px; border-radius: var(--mk-radius);
                     border: 1px solid var(--mk-accent); background: var(--mk-accent); color: var(--mk-accent-fg); }
            .muted { color: var(--mk-muted); }
          </style>
          <section>
            <h1>${names.name}</h1>
            <form>
              <input name="title" maxlength="200" required aria-label="New item" />
              <button type="submit">Add</button>
            </form>
            <p role="status" aria-live="polite" class="muted"></p>
            <ul></ul>
          </section>\`;
        this.list = root.querySelector('ul');
        this.status = root.querySelector('[role=status]');
        const form = root.querySelector('form');
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const input = form.elements.namedItem('title');
          void this.add(input.value).then(() => {
            input.value = '';
          });
        });
        void this.refresh();
      }
${body}
    }

    customElements.define('${names.element}', App);
  },
};

export default plugin;
`;
}

/** The CI of the plugin: the reusable workflow of the Mosaikit organization (ADR-0024). */
function workflow(options: PluginOptions): string {
  const version = options.mosaikitVersion;
  return `${header(options, '#')}#
# Builds and tests the plugin, installs it into the Mosaikit kernel, and on a tag vX.Y.Z (equal to
# the version of manifest.yaml) publishes the package in a GitHub release.
name: Plugin

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
  workflow_dispatch:

permissions:
  contents: write

jobs:
  plugin:
    uses: mosaikit/.github/.github/workflows/plugin.yml@main
    with:
      mosaikit-version: '${version}'
      kernel-images: '["v${version}"]'
      # To sign releases: the public key in signing/<name>.pub.pem, the private key in the secret
      # PLUGIN_SIGNING_KEY (PackageSigningTool keygen <directory> <name>).
      # signing-key-name: <name>
    secrets: inherit
`;
}

/** Where the snapshots of Mosaikit are published (ADR-0035). */
const SNAPSHOTS = 'https://github.com/mosaikit/mosaikit/releases/download/snapshot';

/**
 * The dependency on @mosaikit/testing of a Mosaikit version: a snapshot of main comes from the
 * pre-release "snapshot" (the latest one for a build of the repository), a release from npm.
 */
export function testingDependency(version: string): string {
  if (version.endsWith('-SNAPSHOT')) {
    // A build of the repository: the latest snapshot of main.
    return `${SNAPSHOTS}/mosaikit-testing-latest.tgz`;
  }
  return version.includes('-dev.') ? `${SNAPSHOTS}/mosaikit-testing-${version}.tgz` : version;
}

/** The scripts of the plugin: the bench of @mosaikit/testing to try it and to test it. */
function packageJson(options: PluginOptions): string {
  const manifest = {
    name: options.names.slug,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: options.backend ? 'mvn package && mosaikit-bench' : 'mosaikit-bench',
      test: 'playwright test',
    },
    devDependencies: {
      '@mosaikit/testing': testingDependency(options.mosaikitVersion),
      '@playwright/test': '^1.63.0',
    },
    // The PostgreSQL of the bench links its binaries when it is installed.
    allowScripts: Object.fromEntries(
      ['windows-x64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'].map((platform) => [
        `@embedded-postgres/${platform}`,
        true,
      ]),
    ),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function playwrightConfig(options: PluginOptions): string {
  return `${header(options, '//')}import { defineConfig, devices } from '@playwright/test';

/** Tests of the plugin on a Mosaikit installation started by the bench (tests/global-setup.ts). */
export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  workers: 1,
  timeout: 60_000,
  use: { trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
});
`;
}

function globalSetup(options: PluginOptions): string {
  const plugins = options.backend
    ? `const plugins = packagesIn('target');
  if (plugins.length === 0) {
    throw new Error('Build the plugin first: mvn package');
  }`
    : 'const plugins = [process.cwd()];';
  return `${header(options, '//')}import { Bench, packagesIn } from '@mosaikit/testing';

/**
 * Starts Mosaikit with this plugin on an embedded PostgreSQL, with an organization and two people,
 * and stops it after the tests. The installation is downloaded once (MOSAIKIT_INSTALLATION
 * chooses another one).
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  ${plugins}
  const bench = await Bench.start({
    work: '.mosaikit-bench/test',
    plugins,
    // The plugin is not signed in the tests: its frontend runs like a verified one.
    settings: { 'mosaikit.plugins.unverified-frontends': 'module' },
  });
  bench.publish();
  return () => bench.stop();
}
`;
}

function spec(options: PluginOptions): string {
  const { names } = options;
  return `${header(options, '//')}import { expect, test } from '@playwright/test';
import { member, openApp, signIn, unique } from '@mosaikit/testing/playwright';

test('a person of the organization adds an item to ${names.name}', async ({ page }) => {
  await signIn(page, member());
  await openApp(page, '${names.name}');
  await expect(page.getByRole('heading', { name: '${names.name}' })).toBeVisible();
  const title = unique('Check the lights');
  await page.getByLabel('New item').fill(title);
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible();
});
`;
}

function readme(options: PluginOptions): string {
  const { names, backend } = options;
  const build = backend
    ? `## Build

\`\`\`bash
mvn package        # needs JDK 25 and Maven; writes lib/${names.slug}.jar and target/${names.slug}-0.1.0.zip
\`\`\`

The Java code compiles against \`io.github.mosaikit:mosaikit-kernel-api\` and the Quarkus extensions of
the kernel, with scope \`provided\`: the package contains only your classes. Every table of
\`db/\` holds data of organizations under row-level security; keep it that way.
`
    : `## Build

Nothing to build: the plugin is a manifest and an ES module, and its items are documents that the
kernel keeps for each organization (\`context.data('items')\`). Package it:

\`\`\`bash
mvn package        # needs JDK 25 and Maven; writes target/${names.slug}-0.1.0.zip
\`\`\`
`;
  return `# ${names.name}

A Mosaikit plugin created with \`create-mosaikit-plugin\`.

| Path | Content |
|---|---|
| \`manifest.yaml\` | What the plugin is and brings: identity, frontend, contributions${backend ? ', backend, schema and actions' : ''} |
| \`web/index.js\` | The app, a custom element that the shell renders at \`/app/${names.slug}\` |
${backend ? `| \`src/\` | Entity, repository and REST resource under \`/api/v1/p/${names.slug}\` |\n| \`db/\` | Flyway migrations of the schema \`${names.schema}\`, run by the kernel at start |\n` : ''}
${build}
## Try it

\`\`\`bash
npm install
npm run dev        # Mosaikit with this plugin; Ctrl+C stops it
\`\`\`

The bench of \`@mosaikit/testing\` downloads the installation once, starts it on an embedded
PostgreSQL with an organization and two people, and prints the address and how to sign in. A
changed frontend shows at once in the open page${backend ? '; Java code and migrations need a new `npm run dev`' : ''}.
**${names.name}** is in the app bar, with the icon of \`web/icon.svg\`.

## Test

\`\`\`bash
npx playwright install chromium   # once
npm test
\`\`\`

\`tests/\` holds Playwright tests that run on the bench: only this plugin, on a real installation.

## Release

\`.github/workflows/ci.yml\` builds and checks the plugin on GitHub at every push. A tag \`vX.Y.Z\`,
equal to the version of \`manifest.yaml\`, publishes the package in a GitHub release, signed when
\`signing-key-name\` is set.

To publish it elsewhere, sign the zip (\`PackageSigningTool sign\`) and give your public key to
the administrators, or add it to a catalog of their marketplace. See the plugin development guide
of Mosaikit.
`;
}

/**
 * The POM of the plugin, on io.github.mosaikit:mosaikit-plugin-parent (MK-051), which builds the
 * JAR in lib/ and the package, and runs the tests of the plugin in mvn verify.
 */
function pom(options: PluginOptions): string {
  const { names, backend } = options;
  const provided = [
    ['io.quarkus', 'quarkus-rest-jackson'],
    ['io.quarkus', 'quarkus-hibernate-orm'],
    ['io.quarkus', 'quarkus-hibernate-validator'],
    ['io.quarkus', 'quarkus-security'],
    ['jakarta.data', 'jakarta.data-api'],
  ]
    .map(
      ([group, artifact]) => `        <dependency>
            <groupId>${String(group)}</groupId>
            <artifactId>${String(artifact)}</artifactId>
            <scope>provided</scope>
        </dependency>`,
    )
    .join('\n');
  const dependencies = backend
    ? `
    <!-- Everything is provided by the kernel at runtime: the JAR in lib/ holds only these classes. -->
    <dependencies>
        <dependency>
            <groupId>io.github.mosaikit</groupId>
            <artifactId>mosaikit-kernel-api</artifactId>
        </dependency>
${provided}
    </dependencies>
`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
${header(options, ' ').trimEnd()}
-->
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <!-- mvn package: target/${names.slug}-0.1.0.zip; mvn verify: also the tests of tests/ on the bench. -->
    <parent>
        <groupId>io.github.mosaikit</groupId>
        <artifactId>mosaikit-plugin-parent</artifactId>
        <version>${options.mosaikitVersion}</version>
        <relativePath/>
    </parent>
    <groupId>${names.id.slice(0, names.id.lastIndexOf('.'))}</groupId>
    <artifactId>${names.slug}</artifactId>
    <version>0.1.0</version>${backend ? '' : '\n    <packaging>pom</packaging>'}
    <name>${names.name}</name>
${dependencies}</project>
`;
}

function migration(options: PluginOptions): string {
  return `${header(options, '--')}--
-- Schema ${options.names.schema}, owned by the plugin and migrated by the kernel at start. Each row
-- belongs to an organization, and row-level security shows each request only its own.

create table item (
    id              uuid primary key,
    organization_id uuid         not null default mk_kernel.current_organization(),
    title           varchar(200) not null,
    created_at      timestamptz  not null
);

alter table item enable row level security;

create policy item_organization on item
    using (organization_id = mk_kernel.current_organization())
    with check (organization_id = mk_kernel.current_organization());
`;
}

function entity(options: PluginOptions): string {
  const { names } = options;
  return `${header(options, '//')}package ${names.javaPackage};

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** An item of an organization, in the schema of the plugin. */
@Entity
@Table(name = "item", schema = "${names.schema}")
public class Item {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** Required by JPA. */
    protected Item() {}

    public Item(UUID organizationId, String title, Instant createdAt) {
        this.id = UUID.randomUUID();
        this.organizationId = Objects.requireNonNull(organizationId, "organizationId");
        this.title = Objects.requireNonNull(title, "title");
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public UUID getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
`;
}

function repository(options: PluginOptions): string {
  return `${header(options, '//')}package ${options.names.javaPackage};

import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.util.List;

/** Items; row-level security keeps each organization to its own. */
@Repository
public interface Items {

    @Query("from Item i order by i.createdAt, i.id")
    List<Item> all();

    @Insert
    void insert(Item item);
}
`;
}

function resource(options: PluginOptions): string {
  const { names } = options;
  return `${header(options, '//')}package ${names.javaPackage};

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import io.quarkus.security.Authenticated;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** The API of the plugin, under /api/v1/p/${names.slug}, for the organization of the request. */
@Path("/api/v1/p/${names.slug}/items")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
public class ItemResource {

    /** Request to create an item. */
    public record NewItem(@NotBlank @Size(max = 200) String title) {}

    /** An item as returned by the API. */
    public record ItemView(UUID id, String title, Instant createdAt) {

        static ItemView of(Item item) {
            return new ItemView(item.getId(), item.getTitle(), item.getCreatedAt());
        }
    }

    private final Items items;
    private final CurrentOrganization organization;

    public ItemResource(Items items, CurrentOrganization organization) {
        this.items = items;
        this.organization = organization;
    }

    @GET
    @Transactional
    public List<ItemView> list() {
        return items.all().stream().map(ItemView::of).toList();
    }

    @POST
    @Transactional
    public Response create(@Valid @NotNull NewItem request) {
        Item item = new Item(organization.require(), request.title().strip(), Instant.now());
        items.insert(item);
        return Response.status(Response.Status.CREATED).entity(ItemView.of(item)).build();
    }
}
`;
}
