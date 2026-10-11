// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { expect, test } from '@playwright/test';
import { ADMIN, ANNA, MARIO, ORGANIZATION, type Person } from '../support/env.js';
import { otherOrganizationPerson } from '../support/people.js';
import { api } from '../support/shell.js';

const TEAMS = '/api/v1/teams';
// The collection of the sample To do, which 09-data installs.
const ITEMS = '/api/v1/data/dev.mosaikit.sample.todo/items';

interface Team {
  readonly id: string;
  readonly name: string;
  readonly role: string | null;
  readonly members: { email: string; role: string }[] | null;
}

async function createTeam(name: string, visibility: 'public' | 'private'): Promise<Team> {
  const { status, body } = await api(MARIO, TEAMS, {
    method: 'POST',
    body: JSON.stringify({ name, description: `Il team ${name}`, visibility }),
  });
  expect(status).toBe(201);
  return body as Team;
}

async function add(team: Team, person: Person, role: string): Promise<number> {
  const response = await api(MARIO, `${TEAMS}/${team.id}/members/${person.user}`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
  return response.status;
}

test.describe('MK-032 Teams with roles and guests', () => {
  const created: Team[] = [];

  test.afterAll(async () => {
    for (const team of created) {
      await api(MARIO, `${TEAMS}/${team.id}`, { method: 'DELETE' });
    }
  });

  test('32.1 an owner creates a team, adds members and a guest, and the audit has it all', async () => {
    const guest = await otherOrganizationPerson();
    const team = await createTeam(`Lavori pubblici ${Date.now().toString(36)}`, 'private');
    created.push(team);
    expect(team.role).toBe('owner');

    expect(await add(team, ANNA, 'member')).toBe(200);
    expect(await add(team, guest, 'guest')).toBe(200);
    expect(await add(team, ANNA, 'owner')).toBe(200);
    // A member of the organization is not a guest, and a guest is not a member.
    expect(await add(team, ANNA, 'guest')).toBe(400);
    expect(await add(team, guest, 'member')).toBe(400);

    const detail = (await api(ANNA, `${TEAMS}/${team.id}`)).body as Team;
    expect(detail.members?.map((member) => [member.email, member.role]).sort()).toEqual(
      [
        [MARIO.user, 'owner'],
        [ANNA.user, 'owner'],
        [guest.user, 'guest'],
      ].sort(),
    );

    const organization = (await api(ADMIN, `/api/v1/organizations/${ORGANIZATION.slug}`)).body as {
      id: string;
    };
    const events = (await api(ADMIN, `/api/v1/audit-events?organization=${organization.id}`))
      .body as { action: string; subject: string }[];
    const ofTeam = events.filter((event) => event.subject === team.id).map((event) => event.action);
    expect(ofTeam).toContain('team.created');
    expect(ofTeam.filter((action) => action === 'team.member.put')).toHaveLength(3);
  });

  test('32.2 a guest sees only their teams and none of the other data of the organization', async () => {
    const guest = await otherOrganizationPerson();
    const theirs = await createTeam(`Protezione civile ${Date.now().toString(36)}`, 'private');
    const open = await createTeam(`Biblioteca ${Date.now().toString(36)}`, 'public');
    created.push(theirs, open);
    expect(await add(theirs, guest, 'guest')).toBe(200);
    // Something of the whole organization, which the guest must not see.
    const reserved = await api(MARIO, ITEMS, { method: 'POST', body: '{"title":"Riservato"}' });
    expect(reserved.status).toBe(201);
    const reservedId = (reserved.body as { id: string }).id;

    const teams = (await api(guest, TEAMS)).body as Team[];
    // Only the teams where they are a guest (this one and those of the tests before), not the public one.
    expect(teams.map((team) => team.name)).toContain(theirs.name);
    expect(teams.map((team) => team.name)).not.toContain(open.name);
    expect(teams.every((team) => team.role === 'guest')).toBe(true);
    expect((await api(guest, ITEMS)).body).toEqual([]);
    expect((await api(guest, ITEMS, { method: 'POST', body: '{"title":"x"}' })).status).toBe(403);
    // Nor the assistant or the administration (nor the backends of plugins: GuestAccessFilter).
    expect((await api(guest, `/api/v1/organizations/${ORGANIZATION.slug}/apps`)).status).toBe(403);
    expect((await api(guest, '/api/v1/ai/tools')).status).toBe(403);
    expect((await api(guest, `${TEAMS}/${open.id}`)).status).toBe(404);

    // The members of the organization see the public teams and join them.
    expect(((await api(ANNA, TEAMS)).body as Team[]).map((team) => team.name)).toContain(open.name);
    const joined = await api(ANNA, `${TEAMS}/${open.id}/members/${ANNA.user}`, {
      method: 'PUT',
      body: JSON.stringify({ role: 'member' }),
    });
    expect((joined.body as Team).role).toBe('member');
    await api(MARIO, `${ITEMS}/${reservedId}`, { method: 'DELETE' });
  });

  test('32.3 a document shared with a team is readable by its members and by no one else', async () => {
    const guest = await otherOrganizationPerson();
    const team = await createTeam(`Giunta ${Date.now().toString(36)}`, 'private');
    created.push(team);
    expect(await add(team, guest, 'guest')).toBe(200);
    const ofTeam = `${ITEMS}?team=${team.id}`;

    const written = await api(guest, ofTeam, {
      method: 'POST',
      body: JSON.stringify({ title: 'Ordine del giorno' }),
    });
    expect(written.status).toBe(201);
    const document = written.body as { id: string; team: string };
    expect(document.team).toBe(team.id);

    const read = (await api(MARIO, ofTeam)).body as { data: { title: string } }[];
    expect(read.map((item) => item.data.title)).toEqual(['Ordine del giorno']);
    // Anna is in the organization, not in the team.
    expect((await api(ANNA, `${ITEMS}/${document.id}`)).status).toBe(404);
    expect((await api(ANNA, ofTeam)).status).toBe(404);
    const ofOrganization = (await api(ANNA, ITEMS)).body as { id: string }[];
    expect(ofOrganization.map((item) => item.id)).not.toContain(document.id);
  });
});
