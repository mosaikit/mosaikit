-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- The apps of the app bar of an organization (MK-030), as its administrators set them: shown or not,
-- position, pinned, for which roles. An app without a row is shown to everyone, in the order of
-- the plugins.

create table organization_app (
    id              uuid         primary key,
    organization_id uuid         not null,
    plugin_id       varchar(100) not null,
    app_id          varchar(64)  not null,
    enabled         boolean      not null,
    position        integer      not null,
    pinned          boolean      not null,
    roles           varchar(255) not null,
    constraint organization_app_uk unique (organization_id, plugin_id, app_id),
    constraint organization_app_organization_fk foreign key (organization_id) references organization (id) on delete cascade
);
