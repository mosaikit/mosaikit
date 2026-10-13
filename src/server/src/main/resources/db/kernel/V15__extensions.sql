-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- ADR-0036: plugins are called extensions. The objects of the kernel that carried the old name take
-- the new one; the rows, the policies and the grants stay as they are.

alter table plugin_document rename to extension_document;
alter table extension_document rename column plugin_id to extension_id;
alter table extension_document rename constraint plugin_document_pkey to extension_document_pkey;
alter table extension_document rename constraint plugin_document_organization_fk to extension_document_organization_fk;
alter table extension_document rename constraint plugin_document_team_fk to extension_document_team_fk;
alter index plugin_document_collection_ix rename to extension_document_collection_ix;
alter index plugin_document_team_ix rename to extension_document_team_ix;
alter policy plugin_document_access on extension_document rename to extension_document_access;

alter table organization_app rename column plugin_id to extension_id;
alter table notification rename column plugin_id to extension_id;
