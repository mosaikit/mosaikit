# Actions for assistants

An action is a call to the backend API of the extension that an assistant may make on behalf of the
signed-in person (ADR-0017). The kernel checks the arguments against `input`, puts the arguments
named in `path` there, and sends the others as the query (`GET`, `DELETE`) or the JSON body. The
call carries the credentials of the person and the organization of the request, so the usual
`@RolesAllowed` checks and `CurrentOrganization` apply: an action never needs code of its own.
Choose the risk honestly: `read` for calls without effects, `write` for changes of data, `execute`
for processes, messages or anything that leaves the installation. Describe the action for a person
who has to confirm it, not for the assistant only.
