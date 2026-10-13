-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-036: chats, one to one and of small groups, as groups of the organization of kind 'chat':
-- private, seen only by their people, not among the teams. Their messages are documents shared
-- with the chat, under the row-level security of V12.

alter table team add column kind varchar(16) not null default 'team';
alter table team add constraint team_kind_ck check (kind in ('team', 'chat'));

-- Chats have no unique name: two chats of different people can have the same, or none.
drop index team_name_uk;
create unique index team_name_uk on team (organization_id, lower(name)) where parent_id is null and kind = 'team';
create index team_chat_ix on team (organization_id) where kind = 'chat';
