//! MCP server (Model Context Protocol, Streamable HTTP, JSON answers): the tools of the assistant for outside clients such as
//! Claude Desktop. Every call runs as the person of the token; a write tool needs a token that may write.

use serde_json::{json, Value};

use crate::{Caller, Kernel};

pub const PROTOCOL_VERSION: &str = "2025-03-26";

fn rpc_ok(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_err(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Answers one JSON-RPC message. `None` is for a notification (the HTTP answer is `202`, no body).
pub async fn handle(k: &Kernel, c: &Caller, lang: &str, allow_write: bool, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg["method"].as_str().unwrap_or_default();
    let Some(id) = id else {
        // a notification (`notifications/initialized`, …) or a message that is not a request
        return None;
    };
    Some(match method {
        "initialize" => rpc_ok(
            &id,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "mosaikit", "version": crate::KERNEL_VERSION },
                "instructions": format!(
                    "Tools of the Mosaikit tenant '{}' that run with the rights of {}. {}",
                    c.tenant.name,
                    c.user.display_name,
                    if allow_write { "This token may change data." } else { "This token is read-only." }
                ),
            }),
        ),
        "ping" => rpc_ok(&id, json!({})),
        "tools/list" => match super::list_tools(k, c, lang).await {
            Ok(tools) => {
                let list: Vec<Value> = tools
                    .iter()
                    .map(|t| {
                        json!({
                            "name": t.name,
                            "description": t.description,
                            "inputSchema": t.input_schema,
                            "annotations": { "readOnlyHint": !t.write, "destructiveHint": t.write, "openWorldHint": false },
                        })
                    })
                    .collect();
                rpc_ok(&id, json!({ "tools": list }))
            }
            Err(e) => rpc_err(&id, -32603, &e.to_string()),
        },
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or_default();
            let args = msg["params"].get("arguments").cloned().unwrap_or_else(|| json!({}));
            if name.is_empty() {
                return Some(rpc_err(&id, -32602, "name is required"));
            }
            // a failed tool is a result with `isError`, not a protocol error: the model can read it and go on
            match super::invoke(k, c, lang, name, args, allow_write, "mcp").await {
                Ok(v) => rpc_ok(
                    &id,
                    json!({ "content": [{ "type": "text", "text": super::tools::clip(&v) }], "isError": false }),
                ),
                Err(e) => rpc_ok(
                    &id,
                    json!({ "content": [{ "type": "text", "text": e.to_string() }], "isError": true }),
                ),
            }
        }
        other => rpc_err(&id, -32601, &format!("method not found: {other}")),
    })
}
