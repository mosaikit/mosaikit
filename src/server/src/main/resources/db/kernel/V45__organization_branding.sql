-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-074: the branding of an organization, set by its administrators: a display name, an accent
-- color and the theme tokens they changed, and its images (logos, icon, favicon). The content of the
-- images is in the store of the installation, recorded as files of the kernel (stored_file, extension
-- 'kernel'): they count to the storage quota of the organization, and their content is queued for
-- removal with the organization (V36). Under row-level security like the other data of organizations:
-- a request sees and writes only the branding of its organization; before sign-in, a request without
-- organization reads it as the kernel does.

create table organization_branding (
    organization_id uuid          primary key default current_organization(),
    -- What the shell shows instead of the name of the product, or null for that name.
    display_name    varchar(100),
    -- The brand color of the light scheme, #rrggbb, or null for the one of the theme.
    accent          varchar(7),
    -- The tokens of the theme changed, as JSON: {"light": {"surface": "#ffffff"}, "dark": {...}}.
    tokens          varchar(4000) not null default '{}',
    updated_at      timestamptz   not null,
    constraint organization_branding_accent_ck check (accent is null or accent ~ '^#[0-9a-f]{6}$'),
    constraint organization_branding_organization_fk foreign key (organization_id) references organization (id) on delete cascade
);

create table organization_brand_image (
    -- The file of the kernel that holds the content.
    file_id         uuid          primary key,
    organization_id uuid          not null default current_organization(),
    kind            varchar(16)   not null,
    content_type    varchar(64)   not null,
    size            bigint        not null,
    -- The SHA-256 of the content: the entity tag, and the version in the address of the image.
    checksum        varchar(64)   not null,
    updated_at      timestamptz   not null,
    constraint organization_brand_image_uk unique (organization_id, kind),
    constraint organization_brand_image_kind_ck check (kind in ('logo', 'logo-dark', 'icon', 'favicon')),
    constraint organization_brand_image_file_fk foreign key (file_id) references stored_file (id) on delete cascade,
    constraint organization_brand_image_organization_fk foreign key (organization_id) references organization (id) on delete cascade
);

alter table organization_branding enable row level security;
create policy organization_branding_organization on organization_branding
    using (organization_id = current_organization())
    with check (organization_id = current_organization());

alter table organization_brand_image enable row level security;
create policy organization_brand_image_organization on organization_brand_image
    using (organization_id = current_organization())
    with check (organization_id = current_organization());
