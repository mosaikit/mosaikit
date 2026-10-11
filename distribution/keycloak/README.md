# Keycloak realm of an organization

Each organization that signs in through Keycloak has its own realm
([MK-012](../../docs/requirements/MK-012.yaml),
[ADR-0011](../../docs/adr/0011-federated-identity-per-organization.md)). The realm has the
`mosaikit` client of the kernel UI (authorization code with PKCE) and the `organization-admin`
role, as in the template
[`realm-template.json`](../../src/server/src/main/resources/dev/mosaikit/kernel/core/identity/realm-template.json).

## Automatically (recommended)

Give the kernel a service account of the `master` realm with the `admin` role, and it creates
the realm when an organization is created with `federation` ([MK-018](../../docs/requirements/MK-018.yaml)):

| Setting | Environment variable |
|---|---|
| `mosaikit.identity.keycloak-url` | `MOSAIKIT_IDENTITY_KEYCLOAK_URL`: public URL of Keycloak |
| `mosaikit.identity.keycloak-internal-url` | `MOSAIKIT_IDENTITY_KEYCLOAK_INTERNAL_URL`: only when the kernel reaches Keycloak by another name |
| `mosaikit.identity.admin.client-id` | `MOSAIKIT_IDENTITY_ADMIN_CLIENT_ID` |
| `mosaikit.identity.admin.client-secret` | `MOSAIKIT_IDENTITY_ADMIN_CLIENT_SECRET` |

```json
POST /api/v1/organizations
{
  "slug": "acme",
  "name": "Acme",
  "federation": {
    "emailDomains": ["acme.com"],
    "administrator": { "email": "ada@acme.com", "firstName": "Ada", "lastName": "Lovelace" }
  }
}
```

The realm is named after the slug; the first manager gets a temporary password, returned once in
`initialAdministrator`. The Docker Compose distribution sets all of this up.

## By hand

Import a copy of the template in the Keycloak console (*Manage realms → Create realm → Resource
file*) after replacing `REPLACE-WITH-REALM`, `REPLACE-WITH-ORGANIZATION-NAME` and
`REPLACE-WITH-HOST`, then tell Mosaikit the realm and the email domains:

```bash
curl -u admin -X PUT https://mosaikit.example.org/api/v1/organizations/acme/identity \
  -H 'Content-Type: application/json' \
  -d '{"realm": "acme", "emailDomains": ["acme.com"]}'
```
