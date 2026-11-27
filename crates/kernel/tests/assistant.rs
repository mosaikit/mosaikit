//! AI assistant and MCP server: settings, tools as the person, the loop with the fake provider, proposals for writes,
//! personal access tokens and the JSON-RPC of MCP. Run with `MOSAIKIT_TEST_BACKEND=sqlite` for SQLite.
//!
//! The plugin is hand-written WAT: `msk_call` answers `{"ok": <the message it received>}`, so a result shows the
//! command and the arguments that reached the logic.

use std::collections::BTreeMap;

use mosaikit_kernel::assistant::{self, mcp, settings::SettingsInput, tokens, ChatRequest, Message};
use mosaikit_kernel::testing::{start, test_key, TestKernel};
use mosaikit_kernel::{Caller, Kind};
use serde_json::{json, Value};

fn echo_wasm() -> Vec<u8> {
    wat::parse_str(
        r#"(module
  (memory (export "memory") 2)
  (data (i32.const 32768) "{\"ok\":")
  (global $bump (mut i32) (i32.const 65536))
  (func (export "msk_alloc") (param $len i32) (result i32)
    (local $p i32) (local.set $p (global.get $bump))
    (global.set $bump (i32.add (global.get $bump) (local.get $len))) (local.get $p))
  (func (export "msk_call") (param $ptr i32) (param $len i32) (result i64)
    (memory.copy (i32.const 32774) (local.get $ptr) (local.get $len))
    (i32.store8 (i32.add (i32.const 32774) (local.get $len)) (i32.const 125))
    (i64.or (i64.shl (i64.const 32768) (i64.const 32))
            (i64.extend_i32_u (i32.add (local.get $len) (i32.const 7)))))
)"#,
    )
    .unwrap()
}

const TOML: &str = r#"id = "com.test.assist"
name = "Assist"
version = "1.0.0"
[contribution]
icon = "x"
label = "Assist"
[requires]
mosaikit = ">=1.0"
[[resources]]
name = "items"
fields = [{ key = "title", kind = "text" }]

[[assistant_tools]]
name = "read"
description = "Reads things"
command = "read_things"
input_schema = { type = "object", properties = { q = { type = "string" } }, required = ["q"] }

[[assistant_tools]]
name = "make"
description = "Makes a thing"
command = "make_thing"
write = true

[[assistant_tools]]
name = "items_list"
description = "Lists items"
resource = "items"
action = "list"

[[assistant_tools]]
name = "items_add"
description = "Adds an item"
resource = "items"
action = "create"

[assistant]
prompt = "Things are made of wood."

[i18n.it]
name = "Assistente di prova"

[i18n.it.resources.items]
label = "Elementi"
fields = { title = "Titolo" }
"#;

struct World {
    t: TestKernel,
    anna: Caller,
    mgr: Caller,
    carl: Caller,
}

async fn world() -> World {
    let t = start().await;
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), TOML.as_bytes().to_vec());
    files.insert("logic.wasm".to_string(), echo_wasm());
    t.install_package(&mosaikit_mskp::pack(&files, Some(&test_key())).unwrap()).await.unwrap();
    let alfa = t.tenant("alfa").await;
    let anna = t.member(&alfa, "anna").await;
    let mgr = t.home(&alfa).await;
    let anna = t.home(&anna).await;
    let beta = t.tenant("beta").await;
    let carl = t.member(&beta, "carl").await;
    let carl = t.home(&carl).await;
    World { t, anna, mgr, carl }
}

fn fake(provider: &str) -> SettingsInput {
    SettingsInput {
        provider: provider.into(),
        base_url: None,
        model: "m".into(),
        api_key: None,
        enabled: true,
        allow_byok: false,
        hourly_limit: None,
        user_models: None,
    }
}

async fn configure(w: &World) {
    let admin = w.t.admin().await;
    assistant::settings::set_platform(&w.t, &admin, &fake("fake")).await.unwrap();
}

fn user(text: &str) -> Message {
    Message {
        attachments: vec![],
        role: "user".into(),
        content: text.into(),
        tool_calls: vec![],
        tool_call_id: None,
    }
}

fn ask(text: &str) -> ChatRequest {
    ChatRequest { messages: vec![user(text)], context: None, model: None }
}

fn code(e: &mosaikit_kernel::Error) -> String {
    e.code().to_string()
}

#[tokio::test]
async fn nothing_is_available_until_the_administrator_configures_a_provider() {
    let w = world().await;
    assert!(!assistant::status(&w.t, &w.anna).await.unwrap().available);
    let e = assistant::chat(&w.t, &w.anna, "en", ask("hi")).await.unwrap_err();
    assert_eq!(code(&e), "assistant_off");
    configure(&w).await;
    let s = assistant::status(&w.t, &w.anna).await.unwrap();
    assert!(s.available && s.provider.as_deref() == Some("fake") && s.source == Some("platform"));
    // a person who is not the Administrator cannot set the platform provider
    let e = assistant::settings::platform_view(&w.t, &w.anna.user).await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden);
}

#[tokio::test]
async fn tools_are_the_kernel_ones_plus_the_declared_ones_of_the_plugins() {
    let w = world().await;
    let anna: Vec<String> =
        assistant::list_tools(&w.t, &w.anna, "en").await.unwrap().into_iter().map(|t| t.name).collect();
    assert!(anna.contains(&"kernel__whoami".to_string()) && anna.contains(&"assist__read".to_string()));
    assert!(anna.contains(&"assist__make".to_string()));
    // the KPIs of the tenant are for the Manager
    assert!(!anna.contains(&"kernel__kpi_summary".to_string()));
    let mgr: Vec<String> =
        assistant::list_tools(&w.t, &w.mgr, "en").await.unwrap().into_iter().map(|t| t.name).collect();
    assert!(mgr.contains(&"kernel__kpi_summary".to_string()));
    let make = assistant::list_tools(&w.t, &w.anna, "en")
        .await
        .unwrap()
        .into_iter()
        .find(|t| t.name == "assist__make")
        .unwrap();
    assert!(make.write);
}

#[tokio::test]
async fn a_read_tool_runs_in_the_loop_as_the_person() {
    let w = world().await;
    configure(&w).await;
    let r = assistant::chat(&w.t, &w.anna, "en", ask(r#"tool:assist__read {"q":"wood"}"#)).await.unwrap();
    assert!(r.proposals.is_empty());
    let roles: Vec<&str> = r.messages.iter().map(|m| m.role.as_str()).collect();
    assert_eq!(roles, ["assistant", "tool", "assistant"]);
    assert_eq!(r.messages[0].tool_calls[0].name, "assist__read");
    // the command and the arguments reached the logic, in the context of the person
    assert!(r.messages[1].content.contains("read_things") && r.messages[1].content.contains("wood"));
    assert!(r.messages[2].content.starts_with("Tool result:"));
    // the audit keeps the tool and the names of the arguments, not their values
    let ev: Vec<Value> =
        mosaikit_db::query_scalar("select detail from core.events where action = 'assistant.tool'")
            .fetch_all(&w.t.db)
            .await
            .unwrap();
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0]["tool"], "assist__read");
    assert!(!ev[0].to_string().contains("wood"));
}

#[tokio::test]
async fn bad_arguments_and_unknown_tools_come_back_as_errors_for_the_model() {
    let w = world().await;
    configure(&w).await;
    let r = assistant::chat(&w.t, &w.anna, "en", ask(r#"tool:assist__read {}"#)).await.unwrap();
    assert!(r.messages[1].content.contains("missing argument"));
    let r = assistant::chat(&w.t, &w.anna, "en", ask("tool:nope {}")).await.unwrap();
    assert!(r.messages[1].content.contains("unknown tool"));
}

#[tokio::test]
async fn a_write_tool_is_proposed_and_runs_only_when_confirmed() {
    let w = world().await;
    configure(&w).await;
    let r = assistant::chat(&w.t, &w.anna, "en", ask(r#"tool:assist__make {"title":"a"}"#)).await.unwrap();
    assert_eq!(r.proposals.len(), 1);
    assert_eq!(r.proposals[0].tool, "assist__make");
    // nothing ran: the assistant message is there, no tool result
    assert_eq!(r.messages.iter().filter(|m| m.role == "tool").count(), 0);
    let run: i64 =
        mosaikit_db::query_scalar("select count(*) from core.events where action = 'assistant.tool'")
            .fetch_one(&w.t.db)
            .await
            .unwrap();
    assert_eq!(run, 0);
    // the person confirms: the tool runs
    let out = assistant::invoke(&w.t, &w.anna, "en", "assist__make", json!({"title": "a"}), true, "confirm")
        .await
        .unwrap();
    assert!(out.to_string().contains("make_thing"));
    // a token that may not write is refused
    let e =
        assistant::invoke(&w.t, &w.anna, "en", "assist__make", json!({}), false, "mcp").await.unwrap_err();
    assert_eq!(code(&e), "assistant_read_only");
}

#[tokio::test]
async fn an_unanswered_proposal_is_closed_when_the_chat_goes_on() {
    let w = world().await;
    configure(&w).await;
    let first = assistant::chat(&w.t, &w.anna, "en", ask(r#"tool:assist__make {}"#)).await.unwrap();
    let mut messages = vec![user(r#"tool:assist__make {}"#)];
    messages.extend(first.messages);
    messages.push(user("never mind"));
    let r = assistant::chat(&w.t, &w.anna, "en", ChatRequest { messages, context: None, model: None })
        .await
        .unwrap();
    assert_eq!(r.messages.last().unwrap().content, "fake: never mind");
}

#[tokio::test]
async fn the_hourly_limit_stops_the_loop() {
    let w = world().await;
    let admin = w.t.admin().await;
    let mut s = fake("fake");
    s.hourly_limit = Some(1);
    assistant::settings::set_platform(&w.t, &admin, &s).await.unwrap();
    assistant::chat(&w.t, &w.anna, "en", ask("one")).await.unwrap();
    let e = assistant::chat(&w.t, &w.anna, "en", ask("two")).await.unwrap_err();
    assert_eq!((e.kind, code(&e).as_str()), (Kind::TooMany, "assistant_rate_limited"));
}

#[tokio::test]
async fn a_bad_chat_is_refused() {
    let w = world().await;
    configure(&w).await;
    for messages in [
        vec![],
        vec![Message {
            attachments: vec![],
            role: "system".into(),
            content: "x".into(),
            tool_calls: vec![],
            tool_call_id: None,
        }],
        vec![
            user("a"),
            Message {
                attachments: vec![],
                role: "assistant".into(),
                content: "b".into(),
                tool_calls: vec![],
                tool_call_id: None,
            },
        ],
    ] {
        let e = assistant::chat(&w.t, &w.anna, "en", ChatRequest { messages, context: None, model: None })
            .await
            .unwrap_err();
        assert_eq!(code(&e), "assistant_bad_chat");
    }
}

#[tokio::test]
async fn the_key_is_sealed_and_a_manager_brings_one_only_when_the_administrator_allows() {
    let w = world().await;
    let admin = w.t.admin().await;
    let mut s = fake("anthropic");
    s.api_key = Some("sk-platform-secret".into());
    let v = assistant::settings::set_platform(&w.t, &admin, &s).await.unwrap();
    assert!(v.has_key);
    assert!(!serde_json::to_string(&v).unwrap().contains("secret"));
    let stored: Vec<u8> = mosaikit_db::query_scalar("select secret from core.assistant_settings")
        .fetch_one(&w.t.db)
        .await
        .unwrap();
    assert!(!String::from_utf8_lossy(&stored).contains("sk-platform"));
    // not allowed yet
    let mut mine = fake("anthropic");
    mine.api_key = Some("sk-tenant".into());
    let e = assistant::settings::set_tenant(&w.t, &w.mgr, &mine).await.unwrap_err();
    assert_eq!(code(&e), "byok_not_allowed");
    // a User is never the one who sets it
    assert_eq!(assistant::settings::tenant_view(&w.t, &w.anna).await.unwrap_err().kind, Kind::Forbidden);
    s.api_key = None;
    s.allow_byok = true;
    assistant::settings::set_platform(&w.t, &admin, &s).await.unwrap();
    // a custom address is for the Administrator
    let mut custom = mine.clone();
    custom.base_url = Some("http://localhost:11434".into());
    assert_eq!(
        code(&assistant::settings::set_tenant(&w.t, &w.mgr, &custom).await.unwrap_err()),
        "base_url_admin_only"
    );
    assistant::settings::set_tenant(&w.t, &w.mgr, &mine).await.unwrap();
    let alfa = assistant::settings::resolve(&w.t, w.mgr.tenant.tenant_id).await.unwrap().unwrap();
    assert_eq!((alfa.source, alfa.key.as_deref()), ("tenant", Some("sk-tenant")));
    // another tenant keeps the platform key; the one the platform key did not change
    let beta = assistant::settings::resolve(&w.t, w.carl.tenant.tenant_id).await.unwrap().unwrap();
    assert_eq!((beta.source, beta.key.as_deref()), ("platform", Some("sk-platform-secret")));
    // the Manager removes theirs: the platform key applies again
    assistant::settings::clear_tenant(&w.t, &w.mgr).await.unwrap();
    assert_eq!(
        assistant::settings::resolve(&w.t, w.mgr.tenant.tenant_id).await.unwrap().unwrap().source,
        "platform"
    );
    // the provider names are checked
    let e = assistant::settings::set_platform(&w.t, &admin, &fake("nope")).await.unwrap_err();
    assert_eq!(e.kind, Kind::BadRequest);
    let e = assistant::settings::set_platform(&w.t, &admin, &fake("openai_compatible")).await.unwrap_err();
    assert!(e.to_string().contains("base_url"));
}

#[tokio::test]
async fn tokens_belong_to_one_person_and_one_tenant_and_can_be_revoked() {
    let w = world().await;
    let t = tokens::create(&w.t, &w.anna, "desktop", false, Some(30)).await.unwrap();
    assert!(t.token.starts_with("mska_") && !t.info.allow_write);
    // the list never shows the token
    let list = tokens::list(&w.t, &w.anna).await.unwrap();
    assert_eq!(list.len(), 1);
    assert!(!serde_json::to_string(&list).unwrap().contains(&t.token));
    // someone else sees none and cannot revoke it
    assert!(tokens::list(&w.t, &w.carl).await.unwrap().is_empty());
    assert_eq!(tokens::revoke(&w.t, &w.carl, t.info.id).await.unwrap_err().kind, Kind::NotFound);
    let (c, write, _) = tokens::authenticate(&w.t, &t.token).await.unwrap();
    assert_eq!(
        (c.user.user_id, c.tenant.tenant_id, write),
        (w.anna.user.user_id, w.anna.tenant.tenant_id, false)
    );
    assert!(!c.user.is_system_admin);
    assert_eq!(tokens::authenticate(&w.t, "mska_nope").await.unwrap_err().kind, Kind::Unauthorized);
    assert_eq!(tokens::authenticate(&w.t, "not-a-token").await.unwrap_err().kind, Kind::Unauthorized);
    tokens::revoke(&w.t, &w.anna, t.info.id).await.unwrap();
    assert_eq!(tokens::authenticate(&w.t, &t.token).await.unwrap_err().kind, Kind::Unauthorized);
}

#[tokio::test]
async fn mcp_lists_and_calls_tools_and_keeps_a_read_only_token_from_writing() {
    let w = world().await;
    let rpc = |method: &str, params: Value| json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let init = mcp::handle(&w.t, &w.anna, "en", false, &rpc("initialize", json!({}))).await.unwrap();
    assert_eq!(init["result"]["protocolVersion"], mcp::PROTOCOL_VERSION);
    assert!(init["result"]["instructions"].as_str().unwrap().contains("read-only"));
    // a notification has no answer
    assert!(mcp::handle(
        &w.t,
        &w.anna,
        "en",
        false,
        &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })
    )
    .await
    .is_none());
    let list = mcp::handle(&w.t, &w.anna, "en", false, &rpc("tools/list", json!({}))).await.unwrap();
    let tools = list["result"]["tools"].as_array().unwrap();
    let make = tools.iter().find(|t| t["name"] == "assist__make").unwrap();
    assert_eq!(make["annotations"]["readOnlyHint"], false);
    let read = tools.iter().find(|t| t["name"] == "assist__read").unwrap();
    assert_eq!(read["annotations"]["readOnlyHint"], true);
    assert_eq!(read["inputSchema"]["required"][0], "q");
    // a read call
    let call = |name: &str, args: Value| rpc("tools/call", json!({ "name": name, "arguments": args }));
    let r = mcp::handle(&w.t, &w.anna, "en", false, &call("assist__read", json!({"q": "x"}))).await.unwrap();
    assert_eq!(r["result"]["isError"], false);
    assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("read_things"));
    // a write call with a read-only token is an error result the model can read
    let r = mcp::handle(&w.t, &w.anna, "en", false, &call("assist__make", json!({}))).await.unwrap();
    assert_eq!(r["result"]["isError"], true);
    assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("read-only"));
    // with a token that may write it runs
    let r = mcp::handle(&w.t, &w.anna, "en", true, &call("assist__make", json!({}))).await.unwrap();
    assert_eq!(r["result"]["isError"], false);
    // unknown method and unknown tool
    let r = mcp::handle(&w.t, &w.anna, "en", false, &rpc("nope", json!({}))).await.unwrap();
    assert_eq!(r["error"]["code"], -32601);
    let r = mcp::handle(&w.t, &w.anna, "en", false, &call("nope", json!({}))).await.unwrap();
    assert_eq!(r["result"]["isError"], true);
}

#[tokio::test]
async fn a_tool_on_a_resource_needs_no_code_and_runs_as_the_person() {
    let w = world().await;
    let tools = assistant::list_tools(&w.t, &w.anna, "en").await.unwrap();
    let add = tools.iter().find(|t| t.name == "assist__items_add").unwrap();
    // create always writes, and the schema comes from the fields of the resource
    assert!(add.write);
    assert_eq!(add.input_schema["properties"]["title"]["type"], "string");
    let list = tools.iter().find(|t| t.name == "assist__items_list").unwrap();
    assert!(!list.write);
    // a read-only caller cannot add; the person who confirmed can
    let e =
        assistant::invoke(&w.t, &w.anna, "en", "assist__items_add", json!({"title": "wood"}), false, "mcp")
            .await
            .unwrap_err();
    assert_eq!(code(&e), "assistant_read_only");
    let made = assistant::invoke(
        &w.t,
        &w.anna,
        "en",
        "assist__items_add",
        json!({"title": "wood"}),
        true,
        "confirm",
    )
    .await
    .unwrap();
    assert_eq!(made["values"]["title"], "wood");
    let seen =
        assistant::invoke(&w.t, &w.anna, "en", "assist__items_list", json!({"q": "wood"}), false, "mcp")
            .await
            .unwrap();
    assert_eq!(seen["total"], 1);
    assert_eq!(seen["rows"][0]["values"]["title"], "wood");
    // another tenant sees nothing of it
    let other =
        assistant::invoke(&w.t, &w.carl, "en", "assist__items_list", json!({}), false, "mcp").await.unwrap();
    assert_eq!(other["total"], 0);
    // a bad id is an error for the model, not a crash
    let tools_update =
        assistant::invoke(&w.t, &w.anna, "en", "assist__items_add", json!({"title": 5}), true, "confirm")
            .await
            .unwrap_err();
    assert_eq!(code(&tools_update), "assistant_bad_args");
}

/// A real model: Ollama on this machine (`cargo test -p mosaikit-kernel --test assistant -- --ignored`). The model must
/// support tool calling (e.g. `llama3.1`); name it in `MOSAIKIT_TEST_OLLAMA_MODEL`.
#[tokio::test]
#[ignore = "needs Ollama on localhost:11434"]
async fn a_real_local_model_answers_and_calls_a_tool() {
    let w = world().await;
    let admin = w.t.admin().await;
    let model = std::env::var("MOSAIKIT_TEST_OLLAMA_MODEL").unwrap_or_else(|_| "llama3.1".into());
    let mut s = fake("openai_compatible");
    s.model = model;
    s.base_url = Some("http://localhost:11434/v1".into());
    assistant::settings::set_platform(&w.t, &admin, &s).await.unwrap();
    let r = assistant::chat(&w.t, &w.mgr, "en", ask("Who am I and in which tenant? Use your tools."))
        .await
        .unwrap();
    let used: Vec<&str> =
        r.messages.iter().flat_map(|m| m.tool_calls.iter().map(|c| c.name.as_str())).collect();
    println!("tools used: {used:?}\nanswer: {}", r.messages.last().unwrap().content);
    assert!(used.contains(&"kernel__whoami"), "the model did not call the tool: {used:?}");
    assert!(r.messages.last().unwrap().content.to_lowercase().contains("alfa"));
}

#[tokio::test]
async fn a_manager_chooses_any_model_and_people_the_ones_the_administrator_allowed() {
    let w = world().await;
    let admin = w.t.admin().await;
    let mut s = fake("fake");
    s.user_models = Some(vec!["fake-large".into()]);
    let v = assistant::settings::set_platform(&w.t, &admin, &s).await.unwrap();
    assert_eq!(v.user_models, ["fake-large"]);
    // the Administrator reads what the provider offers
    let all: Vec<String> =
        assistant::platform_models(&w.t, &admin).await.unwrap().into_iter().map(|m| m.id).collect();
    assert_eq!(all, ["fake-small", "fake-large"]);
    assert_eq!(assistant::platform_models(&w.t, &w.mgr.user).await.unwrap_err().kind, Kind::Forbidden);

    let ids = |c: assistant::models::Choices| c.models.into_iter().map(|m| m.id).collect::<Vec<_>>();
    // a Manager: every model of the provider, and the default; a person: the default and the allowed ones
    let m = assistant::model_choices(&w.t, &w.mgr).await.unwrap();
    assert!(m.all && m.default == "m");
    assert_eq!(ids(m), ["m", "fake-small", "fake-large"]);
    let u = assistant::model_choices(&w.t, &w.anna).await.unwrap();
    assert!(!u.all);
    assert_eq!(ids(u), ["m", "fake-large"]);

    let with = |model: Option<&str>| ChatRequest {
        messages: vec![user("hi")],
        context: None,
        model: model.map(str::to_string),
    };
    // a person: the default and the allowed model work, another one is refused
    assert!(assistant::chat(&w.t, &w.anna, "en", with(Some("fake-large"))).await.is_ok());
    assert!(assistant::chat(&w.t, &w.anna, "en", with(Some("m"))).await.is_ok());
    let e = assistant::chat(&w.t, &w.anna, "en", with(Some("fake-small"))).await.unwrap_err();
    assert_eq!((e.kind, code(&e).as_str()), (Kind::Forbidden, "assistant_model_not_allowed"));
    // a Manager may use any, and the audit says which
    assert!(assistant::chat(&w.t, &w.mgr, "en", with(Some("fake-small"))).await.is_ok());
    let used: Vec<Value> = mosaikit_db::query_scalar(
        "select detail from core.events where action = 'assistant.chat' order by id",
    )
    .fetch_all(&w.t.db)
    .await
    .unwrap();
    assert_eq!(used.last().unwrap()["model"], "fake-small");
    // the list the Administrator keeps can be changed and cleared; absent keeps it
    s.user_models = None;
    assert_eq!(
        assistant::settings::set_platform(&w.t, &admin, &s).await.unwrap().user_models,
        ["fake-large"]
    );
    s.user_models = Some(vec![]);
    assert!(assistant::settings::set_platform(&w.t, &admin, &s).await.unwrap().user_models.is_empty());
}

fn file(kind: &str, mime: &str, name: &str, data: &str) -> mosaikit_kernel::assistant::Attachment {
    mosaikit_kernel::assistant::Attachment {
        name: name.into(),
        kind: kind.into(),
        mime: mime.into(),
        data: data.into(),
    }
}

#[tokio::test]
async fn files_are_checked_and_only_the_last_question_carries_them() {
    let w = world().await;
    configure(&w).await;
    let with = |files: Vec<mosaikit_kernel::assistant::Attachment>| {
        let mut m = user("look");
        m.attachments = files;
        ChatRequest { messages: vec![m], context: None, model: None }
    };
    // an accepted file reaches the model
    let ok = assistant::chat(&w.t, &w.anna, "en", with(vec![file("text", "text/plain", "n.txt", "hello")]))
        .await
        .unwrap();
    assert!(ok.messages[0].content.contains("[1 file(s): n.txt]"), "{}", ok.messages[0].content);
    let bad = |files: Vec<_>| async { assistant::chat(&w.t, &w.anna, "en", with(files)).await.unwrap_err() };
    // a type that is not accepted, a wrong kind, an empty file, too many, too large, a bad base64
    for files in [
        vec![file("text", "application/x-msdownload", "a.exe", "MZ")],
        vec![file("video", "video/mp4", "a.mp4", "QUJD")],
        vec![file("text", "text/plain", "e.txt", "")],
        vec![file("image", "image/svg+xml", "a.svg", "QUJD")],
        (0..5).map(|i| file("text", "text/plain", &format!("{i}.txt"), "x")).collect(),
        vec![file("text", "text/plain", "big.txt", &"x".repeat(300 << 10))],
        vec![file("image", "image/png", "a.png", "not base64!!")],
        vec![file("text", "text/plain", "bad\nname", "x")],
    ] {
        assert_eq!(code(&bad(files).await), "assistant_bad_attachment");
    }
    // the files of an earlier question are told as a note and are not sent again
    let mut first = user("see this");
    first.attachments = vec![file("text", "text/plain", "old.txt", "secret")];
    let r = assistant::chat(
        &w.t,
        &w.anna,
        "en",
        ChatRequest { messages: vec![first, user("and now?")], context: None, model: None },
    )
    .await
    .unwrap();
    assert_eq!(r.messages[0].content, "fake: and now?", "the last question has no files");
}

#[tokio::test]
async fn the_page_gets_the_names_of_the_tools_in_the_language_of_the_person() {
    let w = world().await;
    let add =
        |tools: Vec<assistant::ToolSpec>| tools.into_iter().find(|t| t.name == "assist__items_add").unwrap();
    let en = add(assistant::list_tools(&w.t, &w.anna, "en").await.unwrap());
    assert_eq!((en.app.as_str(), en.subject.as_str(), en.verb.as_str()), ("Assist", "items", "create"));
    assert_eq!(en.fields[0].label, "title");
    let it = add(assistant::list_tools(&w.t, &w.anna, "it").await.unwrap());
    assert_eq!(
        (it.app.as_str(), it.subject.as_str(), it.verb.as_str()),
        ("Assistente di prova", "Elementi", "create")
    );
    assert_eq!((it.fields[0].key.as_str(), it.fields[0].label.as_str()), ("title", "Titolo"));
    // what the model reads does not change with the language
    assert_eq!(en.description, it.description);
    assert_eq!(en.input_schema, it.input_schema);
    // a command tool has no resource to name
    let read = assistant::list_tools(&w.t, &w.anna, "it")
        .await
        .unwrap()
        .into_iter()
        .find(|t| t.name == "assist__read")
        .unwrap();
    assert_eq!((read.subject.as_str(), read.verb.as_str(), read.fields.len()), ("", "", 0));
}
