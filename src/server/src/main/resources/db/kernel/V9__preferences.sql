-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- The personal settings of a person (MK-027): theme, appearance, language and the apps hidden from
-- the app bar, as a JSON object that the kernel validates.

alter table user_account add column preferences jsonb not null default '{}';
