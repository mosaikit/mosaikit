-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- Every note belongs to an organization (MK-017). Notes written before have none and stay hidden.

alter table note add column organization_id uuid;
create index note_organization_ix on note (organization_id, created_at);
