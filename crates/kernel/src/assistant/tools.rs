//! The tools a person may use: the ones of the kernel and the ones of the plugins that are on in the tenant and that the
//! person may use. Every tool runs as the person (role, ACL, RLS): the assistant never has more rights.

use std::collections::HashSet;

use serde_json::{json, Value};

use mosaikit_mskp::{AssistantAction, FieldKind, ResourceDecl};

use super::ToolSpec;
use crate::{Caller, Error, Kernel, Result};

/// Longest result given back to the model, in characters.
pub const MAX_RESULT_CHARS: usize = 20_000;

#[derive(Debug, Clone)]
pub enum Target {
    Kernel,
    Plugin {
        plugin: String,
        command: String,
    },
    /// the generic CRUD of a resource of a plugin
    Resource {
        plugin: String,
        resource: String,
        action: AssistantAction,
    },
}

#[derive(Debug, Clone)]
pub struct Tool {
    pub spec: ToolSpec,
    pub target: Target,
}

/// `com.mosaikit.notes` → `notes`
pub fn short_name(plugin_id: &str) -> &str {
    plugin_id.rsplit('.').next().unwrap_or(plugin_id)
}

fn kernel_tool(name: &str, description: &str, schema: Value) -> Tool {
    Tool {
        spec: ToolSpec {
            name: format!("kernel__{name}"),
            description: description.to_string(),
            input_schema: schema,
            write: false,
        },
        target: Target::Kernel,
    }
}

fn no_args() -> Value {
    json!({ "type": "object", "properties": {} })
}

/// The tools of the kernel: reads only.
fn kernel_tools(c: &Caller) -> Vec<Tool> {
    let mut v = vec![
        kernel_tool("whoami", "Who is asking: name, role and tenant.", no_args()),
        kernel_tool(
            "list_plugins",
            "The apps (plugins) that are on in this tenant, with what each is for.",
            no_args(),
        ),
        kernel_tool(
            "search",
            "Full-text search over the items the person can see, in every app.",
            json!({ "type": "object", "properties": { "q": { "type": "string", "description": "words to look for" } },
                    "required": ["q"] }),
        ),
        kernel_tool(
            "quota_usage",
            "Storage and items used by the person and what is left in the tenant.",
            no_args(),
        ),
    ];
    if c.is_manager() {
        v.push(kernel_tool(
            "kpi_summary",
            "Key indicators of the tenant: people, items, space, activity and the KPIs of each app (Tenant Manager only).",
            no_args(),
        ));
    }
    v
}

/// Every tool the person may use now, with the name the model sees.
pub async fn registry(k: &Kernel, c: &Caller) -> Result<Vec<Tool>> {
    let mut tools = kernel_tools(c);
    let on: HashSet<String> = crate::plugins::tenants::on_in(k, c.tenant.tenant_id).await?;
    let mut seen: HashSet<String> = tools.iter().map(|t| t.spec.name.clone()).collect();
    let mut plugins = k.plugins.list();
    plugins.sort_by(|a, b| a.id.cmp(&b.id));
    for p in plugins {
        if !p.is_active() || p.manifest.assistant_tools.is_empty() || !on.contains(&p.id) {
            continue;
        }
        if !crate::access::effective(k, c, &p.id).await?.contains(crate::access::USE) {
            continue;
        }
        for t in &p.manifest.assistant_tools {
            let name = format!("{}__{}", short_name(&p.id), t.name);
            if !seen.insert(name.clone()) {
                continue;
            }
            let (target, schema) = match (&t.command, &t.resource, t.action) {
                (Some(command), _, _) => (
                    Target::Plugin { plugin: p.id.clone(), command: command.clone() },
                    t.input_schema.clone().unwrap_or_else(no_args),
                ),
                (None, Some(resource), Some(action)) => {
                    let Some(d) = p.manifest.resources.iter().find(|d| &d.name == resource) else { continue };
                    (
                        Target::Resource { plugin: p.id.clone(), resource: resource.clone(), action },
                        t.input_schema.clone().unwrap_or_else(|| resource_schema(d, action)),
                    )
                }
                _ => continue,
            };
            tools.push(Tool {
                spec: ToolSpec {
                    name,
                    description: t.description.clone(),
                    input_schema: schema,
                    write: t.is_write(),
                },
                target,
            });
        }
    }
    Ok(tools)
}

/// What the plugins say about their domain, for the system prompt (only the plugins the person may use).
pub async fn plugin_prompts(k: &Kernel, c: &Caller) -> Result<Vec<(String, String)>> {
    let on = crate::plugins::tenants::on_in(k, c.tenant.tenant_id).await?;
    let mut out = Vec::new();
    let mut plugins = k.plugins.list();
    plugins.sort_by(|a, b| a.id.cmp(&b.id));
    for p in plugins {
        let Some(a) = &p.manifest.assistant else { continue };
        if a.prompt.trim().is_empty() || !p.is_active() || !on.contains(&p.id) {
            continue;
        }
        if crate::access::effective(k, c, &p.id).await?.contains(crate::access::USE) {
            out.push((p.manifest.name.clone(), a.prompt.trim().to_string()));
        }
    }
    Ok(out)
}

/// The schema of the arguments of a tool that works on a resource, from its fields.
pub fn resource_schema(d: &ResourceDecl, action: AssistantAction) -> Value {
    if action == AssistantAction::List {
        return json!({ "type": "object", "properties": {
            "q": { "type": "string", "description": "words to look for (optional)" },
            "limit": { "type": "integer", "description": "most items to return (default 20, at most 50)" } } });
    }
    let mut props = serde_json::Map::new();
    let mut required: Vec<Value> = Vec::new();
    if action == AssistantAction::Update {
        props.insert("id".into(), json!({ "type": "string", "description": "id of the item to change" }));
        required.push(json!("id"));
    }
    for f in d.fields.iter().filter(|f| !f.hidden) {
        let label = if f.label.is_empty() { f.key.clone() } else { f.label.clone() };
        let def = match f.kind {
            FieldKind::Text => json!({ "type": "string", "description": label }),
            FieldKind::Number => json!({ "type": "number", "description": label }),
            FieldKind::Bool => json!({ "type": "boolean", "description": label }),
            FieldKind::Date => json!({ "type": "string", "description": format!("{label} (YYYY-MM-DD)") }),
            FieldKind::Choice => json!({ "type": "string", "enum": f.options, "description": label }),
        };
        props.insert(f.key.clone(), def);
        if f.required && action == AssistantAction::Create {
            required.push(json!(f.key));
        }
    }
    json!({ "type": "object", "properties": props, "required": required })
}

/// Tools a small model (the OpenAI-compatible servers: Ollama, vLLM, LM Studio) is given at once: with fifty it invents names and
/// forgets the arguments.
pub const MAX_LOCAL_TOOLS: usize = 14;

fn stems(text: &str) -> std::collections::HashSet<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() >= 3)
        // the first three letters: «nota» finds «note», «crea» finds «create», in the language of the person or in English
        .map(|w| w.chars().take(3).collect())
        .collect()
}

/// The tools to offer for this chat: all of them when they are few; otherwise the ones of the kernel, the ones already used in the
/// chat, and the ones whose name or description share words with the last question (the first three letters count), best first.
/// The loop still runs any tool of the registry that the model names.
pub fn select(all: &[ToolSpec], last_question: &str, used: &[String], max: usize) -> Vec<ToolSpec> {
    if all.len() <= max {
        return all.to_vec();
    }
    let want = stems(last_question);
    let mut keep: Vec<usize> = (0..all.len())
        .filter(|&i| all[i].name.starts_with("kernel__") || used.contains(&all[i].name))
        .collect();
    let mut scored: Vec<(usize, usize)> = (0..all.len())
        .filter(|i| !keep.contains(i))
        .map(|i| {
            let have = stems(&format!(
                "{} {}",
                all[i].name.replace("__", " ").replace('_', " "),
                all[i].description
            ));
            (want.intersection(&have).count(), i)
        })
        .collect();
    // most shared words first; the same score keeps the order of the registry
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    for (score, i) in scored {
        if keep.len() >= max {
            break;
        }
        // with no word in common a tool is only a guess: reads come first, so the model can look before it writes
        if score > 0 || !all[i].write {
            keep.push(i);
        }
    }
    keep.sort_unstable();
    keep.into_iter().map(|i| all[i].clone()).collect()
}

/// Checks the arguments against the simple parts of the schema (an object, the required keys, the basic types).
/// The command of the plugin validates the rest.
pub fn check_args(schema: &Value, args: &Value) -> Result<()> {
    let Some(obj) = args.as_object() else {
        return Err(Error::bad("the arguments must be an object").with_code("assistant_bad_args"));
    };
    for r in schema["required"].as_array().into_iter().flatten().filter_map(|r| r.as_str()) {
        if !obj.contains_key(r) {
            return Err(Error::bad(format!("missing argument '{r}'")).with_code("assistant_bad_args"));
        }
    }
    for (key, def) in schema["properties"].as_object().into_iter().flatten() {
        let (Some(v), Some(t)) = (obj.get(key), def["type"].as_str()) else { continue };
        let ok = match t {
            "string" => v.is_string(),
            "integer" => v.is_i64() || v.is_u64(),
            "number" => v.is_number(),
            "boolean" => v.is_boolean(),
            "array" => v.is_array(),
            "object" => v.is_object(),
            _ => true,
        };
        if !ok {
            return Err(Error::bad(format!("argument '{key}' must be {t}")).with_code("assistant_bad_args"));
        }
    }
    Ok(())
}

pub fn clip(v: &Value) -> String {
    let s = v.to_string();
    if s.chars().count() <= MAX_RESULT_CHARS {
        return s;
    }
    let cut: String = s.chars().take(MAX_RESULT_CHARS).collect();
    format!("{cut}… [result cut at {MAX_RESULT_CHARS} characters]")
}

/// Runs a tool as the person. `write` tools are run only from here, after the person confirmed (or a token that may write).
pub async fn run(k: &Kernel, c: &Caller, lang: &str, tool: &Tool, args: Value) -> Result<Value> {
    check_args(&tool.spec.input_schema, &args)?;
    match &tool.target {
        Target::Plugin { plugin, command } => crate::crud::call(k, c, plugin, command, args).await,
        Target::Resource { plugin, resource, action } => {
            run_resource(k, c, plugin, resource, *action, args).await
        }
        Target::Kernel => run_kernel(k, c, lang, tool.spec.name.trim_start_matches("kernel__"), &args).await,
    }
}

async fn run_resource(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    resource: &str,
    action: AssistantAction,
    args: Value,
) -> Result<Value> {
    let mut obj = args.as_object().cloned().unwrap_or_default();
    match action {
        AssistantAction::List => {
            let q = obj.get("q").and_then(Value::as_str).map(str::to_string).filter(|q| !q.trim().is_empty());
            let limit = obj.get("limit").and_then(Value::as_u64).unwrap_or(20).clamp(1, 50) as usize;
            let r = crate::crud::list(k, c, plugin, resource, q.as_deref(), None).await?;
            let v = serde_json::to_value(r)?;
            let rows = v["rows"].as_array().cloned().unwrap_or_default();
            let total = rows.len();
            Ok(
                json!({ "total": total, "shown": total.min(limit), "rows": rows.into_iter().take(limit).collect::<Vec<_>>() }),
            )
        }
        AssistantAction::Create => crate::crud::create(k, c, plugin, resource, &obj, None).await,
        AssistantAction::Update => {
            let id = obj
                .remove("id")
                .and_then(|v| v.as_str().and_then(|s| s.parse::<uuid::Uuid>().ok()))
                .ok_or_else(|| {
                    Error::bad("'id' must be the id of an item").with_code("assistant_bad_args")
                })?;
            crate::crud::update(k, c, plugin, resource, id, &obj).await
        }
    }
}

async fn run_kernel(k: &Kernel, c: &Caller, lang: &str, name: &str, args: &Value) -> Result<Value> {
    match name {
        "whoami" => Ok(json!({
            "name": c.user.display_name, "username": c.user.username, "role": c.tenant.role.as_str(),
            "tenant": c.tenant.name, "tenant_slug": c.tenant.slug,
        })),
        "list_plugins" => {
            let on = crate::plugins::tenants::on_in(k, c.tenant.tenant_id).await?;
            let mut v: Vec<Value> = crate::plugins::active_views_in(k, lang)
                .into_iter()
                .filter(|p| on.contains(&p.id))
                .map(|p| json!({ "id": p.id, "name": p.name, "description": p.description }))
                .collect();
            v.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
            Ok(json!(v))
        }
        "search" => {
            let q = args["q"].as_str().unwrap_or_default();
            Ok(serde_json::to_value(crate::search::search(k, c, q, lang).await?)?)
        }
        "quota_usage" => Ok(serde_json::to_value(crate::quotas::mine(k, c).await?)?),
        "kpi_summary" => {
            c.require_manager()?;
            Ok(serde_json::to_value(crate::kpi::tenant(k, c).await?)?)
        }
        other => Err(Error::not_found(format!("unknown tool kernel__{other}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_names() {
        assert_eq!(short_name("com.mosaikit.notes"), "notes");
        assert_eq!(short_name("solo"), "solo");
    }

    #[test]
    fn args_are_checked_against_the_schema() {
        let s = json!({ "type": "object", "properties": { "q": { "type": "string" }, "n": { "type": "integer" } },
                        "required": ["q"] });
        assert!(check_args(&s, &json!({ "q": "a", "n": 2 })).is_ok());
        assert!(check_args(&s, &json!({ "n": 2 })).is_err());
        assert!(check_args(&s, &json!({ "q": 1 })).is_err());
        assert!(check_args(&s, &json!("x")).is_err());
    }

    #[test]
    fn a_small_model_gets_the_tools_of_the_question() {
        let spec = |n: &str, d: &str, w: bool| ToolSpec {
            name: n.into(),
            description: d.into(),
            input_schema: json!({}),
            write: w,
        };
        let mut all = vec![
            spec("kernel__whoami", "Who is asking", false),
            spec("kernel__search", "Full-text search", false),
        ];
        for p in ["notes", "tasks", "contacts", "polls", "forms", "maps", "meet", "snippets"] {
            all.push(spec(&format!("{p}__list_{p}"), &format!("Lists the {p}"), false));
            all.push(spec(&format!("{p}__create_{p}"), &format!("Creates an item of {p}"), true));
        }
        // few tools: all of them
        assert_eq!(select(&all, "x", &[], 100).len(), all.len());
        // «crea una nota» (Italian) finds the notes tools through «not» and «cre»
        let got = select(&all, "crea una nota con il verbale", &[], 6);
        let names: Vec<&str> = got.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"notes__create_notes") && names.contains(&"kernel__whoami"), "{names:?}");
        assert!(got.len() <= 6);
        // what the chat already used stays, and a write with no word in common is not a guess
        let got = select(&all, "tutto bene?", &["polls__create_polls".to_string()], 6);
        assert!(got.iter().any(|t| t.name == "polls__create_polls"));
        assert!(!got.iter().any(|t| t.write && t.name != "polls__create_polls"));
    }

    #[test]
    fn long_results_are_cut() {
        let v = json!("x".repeat(MAX_RESULT_CHARS + 50));
        assert!(clip(&v).contains("result cut"));
        assert!(!clip(&json!("short")).contains("cut"));
    }
}
