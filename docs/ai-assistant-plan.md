# AI assistant and MCP server: plan

An assistant that lets a person ask, in a prompt, for analysis, KPIs, configuration help and the creation of
resources managed by plugins. The same tools are offered to external clients (for example Claude Desktop)
through an MCP server.

## Decisions

| # | Decision |
|---|---|
| 1 | **Kernel** owns the agent loop, the tool registry, the providers, the confirmations, the audit, the limits and the MCP server. These are security functions and must see every plugin. |
| 2 | **Plugin `ai-assistant`** (`mosaikit-plugins/ai-assistant`) owns the chat UI and the saved chats (create, rename, resume, delete). Chats are items of the platform, private to the person by default. |
| 3 | **Keys**: the system Administrator sets the platform provider, key, base URL, model and limits. A Manager may bring a key of their own for the tenant only when the Administrator turns `allow_byok` on; the tenant key wins. A custom base URL is an Administrator choice only. Keys are sealed with `SecretBox` and never reach a UI. |
| 4 | **Tools** are declared by plugins in `plugin.toml` (`[[assistant_tools]]`) and point to an existing command. The kernel adds its own read tools (KPIs, plugins, quotas). |
| 5 | **Identity**: every tool call runs as the person (role, ACL, RLS, tenant). The assistant never has more rights than the person. |
| 6 | **Writes need a confirmation**: a tool with `write = true` is not run by the loop; the loop stops and returns a proposal. The person approves in the UI, then the UI calls the tool. |
| 7 | **MCP**: Streamable HTTP, one endpoint per tenant, `POST /api/t/{t}/mcp`. Auth is a personal access token (PAT) of one person and one tenant, read-only unless the person turns writes on for that token. |
| 8 | **Providers**: Anthropic, OpenAI-compatible (OpenAI, Azure, Mistral, Groq, OpenRouter, Ollama, vLLM, LM Studio) and a deterministic `fake` provider for tests (dev profile and tests only). |
| 9 | **Activation**: an icon in the navbar opens a side panel with the `ai-assistant` page; the icon is shown only when the assistant is configured for the tenant and the plugin is on. |
| 10 | Chat text is data, never instruction: plugin content may carry injected text, hence rule 6. |

## Phases

Each phase ends with its checks and a commit.

**P1. Manifest.** `[[assistant_tools]]` (name, description, command, input_schema, write; the texts are for the model, English, not translated) and `[assistant] prompt`
in `crates/mskp`; limits (16 tools, name pattern, schema is a JSON object); docs in `docs/devkit/manifest.md`.

**P2. Kernel core.** Migrations (Postgres and SQLite) for `assistant_settings` and `api_tokens`. Module
`kernel::assistant`: settings (platform and tenant, sealed key), `LlmProvider` trait with the three adapters, tool registry
(built-in plus plugin tools filtered by the person's access), agent loop with proposals, hourly request limit, audit
events. Unit tests with the fake provider.

**P3. REST API.** `GET /api/t/{t}/assistant/status`, `POST .../assistant/chat`, `POST .../assistant/tools/{name}`,
`GET|PUT /api/admin/assistant`, `GET|PUT /api/t/{t}/manage/assistant`, `GET|POST|DELETE .../assistant/tokens`.

**P4. MCP server.** `initialize`, `ping`, `tools/list`, `tools/call` over JSON-RPC; Bearer PAT extractor that skips CSRF;
`readOnlyHint` / `destructiveHint` annotations; write tools refused for a read-only token.

**P5. Plugin `ai-assistant` and shell.** Chat page (history list, new, rename, delete, tool steps, proposals with Approve
and Reject), settings page for Administrator and Manager, token page; navbar icon and side panel in the shell.

**P6. Tools of official plugins.** Declared for `notes` (search, create) and `bookmarks` (search, create) as the
reference; every other plugin follows the same pattern.

**P7. Docs, tests, card.** `docs/architecture.md` section, manual checks `AIA-01..`, Playwright twin, `CARD.md`,
site card, `tests/results`.

## Tests

- Rust: manifest parsing, settings sealing, tool registry visibility, loop with the fake provider (read tool, write
  proposal, error, limit), MCP JSON-RPC, PAT scopes, tenant isolation.
- Playwright: panel opens, chat with the fake provider, proposal approve/reject, chat saved and deleted.
- Manual: a real model through Ollama; MCP from Claude Desktop with a PAT (`mcp-remote` bridge when the client
  accepts only stdio servers).

## Out of scope for now

Streaming of tokens (the loop answers when done, with the steps it took), OAuth for MCP (PAT only), a per-tenant
token budget (an hourly request limit only).
