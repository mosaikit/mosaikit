//! Language-model providers. One canonical message format (OpenAI-like: `user`, `assistant` with `tool_calls`, `tool`)
//! is converted for each provider. `fake` is deterministic, for tests and development.

use std::time::Duration;

use serde_json::{json, Value};

use super::settings::Resolved;
use super::{Completion, Message, ToolCall, ToolSpec};
use crate::{Error, Kernel, Result};

const TIMEOUT: Duration = Duration::from_secs(120);
const MAX_TOKENS: u32 = 4096;

pub async fn complete(
    k: &Kernel,
    cfg: &Resolved,
    system: &str,
    messages: &[Message],
    tools: &[ToolSpec],
) -> Result<Completion> {
    match cfg.provider.as_str() {
        "anthropic" => anthropic(k, cfg, system, messages, tools).await,
        "openai" | "openai_compatible" => openai(k, cfg, system, messages, tools).await,
        "fake" if super::fake_allowed(k) => Ok(fake(messages)),
        p => Err(Error::bad(format!("unknown provider '{p}'"))),
    }
}

fn upstream(status: reqwest::StatusCode, body: &str) -> Error {
    let msg: String = body.chars().take(300).collect();
    Error::internal(format!("the language model answered {status}: {msg}")).with_code("assistant_upstream")
}

fn net(e: reqwest::Error) -> Error {
    Error::internal(format!("the language model is not reachable: {e}")).with_code("assistant_unreachable")
}

// ---------------------------------------------------------------- OpenAI and compatible

pub(crate) fn openai_messages(system: &str, messages: &[Message]) -> Vec<Value> {
    let mut out = vec![json!({ "role": "system", "content": system })];
    for m in messages {
        match m.role.as_str() {
            "assistant" => {
                let mut v = json!({ "role": "assistant", "content": m.content });
                if !m.tool_calls.is_empty() {
                    v["tool_calls"] = m
                        .tool_calls
                        .iter()
                        .map(|c| {
                            json!({ "id": c.id, "type": "function",
                                    "function": { "name": c.name, "arguments": c.arguments.to_string() } })
                        })
                        .collect();
                }
                out.push(v);
            }
            "tool" => out.push(json!({
                "role": "tool", "tool_call_id": m.tool_call_id.clone().unwrap_or_default(), "content": m.content })),
            _ => out.push(json!({ "role": "user", "content": m.content })),
        }
    }
    out
}

async fn openai(k: &Kernel, cfg: &Resolved, system: &str, messages: &[Message], tools: &[ToolSpec]) -> Result<Completion> {
    let base = cfg.base_url.clone().unwrap_or_else(|| "https://api.openai.com/v1".into());
    let mut body = json!({ "model": cfg.model, "messages": openai_messages(system, messages) });
    if !tools.is_empty() {
        body["tools"] = tools
            .iter()
            .map(|t| json!({ "type": "function",
                "function": { "name": t.name, "description": t.description, "parameters": t.input_schema } }))
            .collect();
    }
    let mut req = k.http.post(format!("{base}/chat/completions")).timeout(TIMEOUT).json(&body);
    if let Some(key) = &cfg.key {
        req = req.bearer_auth(key);
    }
    let res = req.send().await.map_err(net)?;
    let status = res.status();
    let text = res.text().await.map_err(net)?;
    if !status.is_success() {
        return Err(upstream(status, &text));
    }
    parse_openai(&text)
}

pub(crate) fn parse_openai(text: &str) -> Result<Completion> {
    let v: Value = serde_json::from_str(text).map_err(|_| Error::internal("the language model sent an invalid answer"))?;
    let m = &v["choices"][0]["message"];
    let mut calls = Vec::new();
    for c in m["tool_calls"].as_array().into_iter().flatten() {
        let args = c["function"]["arguments"].as_str().unwrap_or("{}");
        calls.push(ToolCall {
            id: c["id"].as_str().unwrap_or_default().to_string(),
            name: c["function"]["name"].as_str().unwrap_or_default().to_string(),
            arguments: serde_json::from_str(args).unwrap_or_else(|_| json!({})),
        });
    }
    Ok(Completion {
        text: m["content"].as_str().unwrap_or_default().to_string(),
        tool_calls: calls,
        input_tokens: v["usage"]["prompt_tokens"].as_u64().unwrap_or(0),
        output_tokens: v["usage"]["completion_tokens"].as_u64().unwrap_or(0),
    })
}

// ---------------------------------------------------------------- Anthropic

pub(crate) fn anthropic_messages(messages: &[Message]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for m in messages {
        match m.role.as_str() {
            "assistant" => {
                let mut blocks: Vec<Value> = Vec::new();
                if !m.content.is_empty() {
                    blocks.push(json!({ "type": "text", "text": m.content }));
                }
                for c in &m.tool_calls {
                    blocks.push(json!({ "type": "tool_use", "id": c.id, "name": c.name, "input": c.arguments }));
                }
                out.push(json!({ "role": "assistant", "content": blocks }));
            }
            "tool" => {
                let block = json!({ "type": "tool_result",
                    "tool_use_id": m.tool_call_id.clone().unwrap_or_default(), "content": m.content });
                // the results of one turn go together in one user message
                match out.last_mut() {
                    Some(last)
                        if last["role"] == "user"
                            && last["content"].as_array().is_some_and(|a| a.iter().all(|b| b["type"] == "tool_result")) =>
                    {
                        last["content"].as_array_mut().expect("array").push(block);
                    }
                    _ => out.push(json!({ "role": "user", "content": [block] })),
                }
            }
            _ => out.push(json!({ "role": "user", "content": m.content })),
        }
    }
    out
}

async fn anthropic(k: &Kernel, cfg: &Resolved, system: &str, messages: &[Message], tools: &[ToolSpec]) -> Result<Completion> {
    let base = cfg.base_url.clone().unwrap_or_else(|| "https://api.anthropic.com".into());
    let mut body = json!({
        "model": cfg.model, "max_tokens": MAX_TOKENS, "system": system, "messages": anthropic_messages(messages) });
    if !tools.is_empty() {
        body["tools"] = tools
            .iter()
            .map(|t| json!({ "name": t.name, "description": t.description, "input_schema": t.input_schema }))
            .collect();
    }
    let mut req = k
        .http
        .post(format!("{base}/v1/messages"))
        .timeout(TIMEOUT)
        .header("anthropic-version", "2023-06-01")
        .json(&body);
    if let Some(key) = &cfg.key {
        req = req.header("x-api-key", key);
    }
    let res = req.send().await.map_err(net)?;
    let status = res.status();
    let text = res.text().await.map_err(net)?;
    if !status.is_success() {
        return Err(upstream(status, &text));
    }
    parse_anthropic(&text)
}

pub(crate) fn parse_anthropic(text: &str) -> Result<Completion> {
    let v: Value = serde_json::from_str(text).map_err(|_| Error::internal("the language model sent an invalid answer"))?;
    let mut out = String::new();
    let mut calls = Vec::new();
    for b in v["content"].as_array().into_iter().flatten() {
        match b["type"].as_str() {
            Some("text") => out.push_str(b["text"].as_str().unwrap_or_default()),
            Some("tool_use") => calls.push(ToolCall {
                id: b["id"].as_str().unwrap_or_default().to_string(),
                name: b["name"].as_str().unwrap_or_default().to_string(),
                arguments: b["input"].clone(),
            }),
            _ => {}
        }
    }
    Ok(Completion {
        text: out,
        tool_calls: calls,
        input_tokens: v["usage"]["input_tokens"].as_u64().unwrap_or(0),
        output_tokens: v["usage"]["output_tokens"].as_u64().unwrap_or(0),
    })
}

// ---------------------------------------------------------------- fake

/// Deterministic: a user message `tool:<name> <json arguments>` asks for that tool call; the result of a tool is
/// reported back; anything else is echoed. No network.
pub(crate) fn fake(messages: &[Message]) -> Completion {
    let last = messages.last();
    let text_of = |m: &Message| m.content.trim().to_string();
    let done = |text: String| Completion { text, tool_calls: Vec::new(), input_tokens: 1, output_tokens: 1 };
    match last {
        Some(m) if m.role == "tool" => {
            let c: String = m.content.chars().take(500).collect();
            done(format!("Tool result: {c}"))
        }
        Some(m) => {
            let t = text_of(m);
            if let Some(rest) = t.strip_prefix("tool:") {
                let (name, args) = rest.split_once(' ').unwrap_or((rest, "{}"));
                let arguments = serde_json::from_str(args).unwrap_or_else(|_| json!({}));
                Completion {
                    text: String::new(),
                    tool_calls: vec![ToolCall {
                        id: format!("fake-{}", messages.len()),
                        name: name.to_string(),
                        arguments,
                    }],
                    input_tokens: 1,
                    output_tokens: 1,
                }
            } else {
                done(format!("fake: {t}"))
            }
        }
        None => done("fake: (nothing)".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, content: &str) -> Message {
        Message { role: role.into(), content: content.into(), tool_calls: Vec::new(), tool_call_id: None }
    }

    #[test]
    fn anthropic_groups_tool_results_in_one_user_message() {
        let mut a = msg("assistant", "");
        a.tool_calls = vec![
            ToolCall { id: "1".into(), name: "x".into(), arguments: json!({}) },
            ToolCall { id: "2".into(), name: "y".into(), arguments: json!({}) },
        ];
        let mut t1 = msg("tool", "r1");
        t1.tool_call_id = Some("1".into());
        let mut t2 = msg("tool", "r2");
        t2.tool_call_id = Some("2".into());
        let out = anthropic_messages(&[msg("user", "hi"), a, t1, t2]);
        assert_eq!(out.len(), 3);
        assert_eq!(out[1]["content"][0]["type"], "tool_use");
        assert_eq!(out[2]["content"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn openai_arguments_are_a_string() {
        let mut a = msg("assistant", "");
        a.tool_calls = vec![ToolCall { id: "1".into(), name: "x".into(), arguments: json!({"q": 1}) }];
        let out = openai_messages("sys", &[a]);
        assert_eq!(out[0]["role"], "system");
        assert_eq!(out[1]["tool_calls"][0]["function"]["arguments"], "{\"q\":1}");
    }

    #[test]
    fn parses_both_answers() {
        let o = parse_openai(
            r#"{"choices":[{"message":{"content":"","tool_calls":[{"id":"c1","function":{"name":"n","arguments":"{\"a\":2}"}}]}}],"usage":{"prompt_tokens":3,"completion_tokens":4}}"#,
        )
        .unwrap();
        assert_eq!(o.tool_calls[0].arguments["a"], 2);
        assert_eq!((o.input_tokens, o.output_tokens), (3, 4));
        let a = parse_anthropic(
            r#"{"content":[{"type":"text","text":"hi"},{"type":"tool_use","id":"t","name":"n","input":{"b":1}}],"usage":{"input_tokens":5,"output_tokens":6}}"#,
        )
        .unwrap();
        assert_eq!(a.text, "hi");
        assert_eq!(a.tool_calls[0].arguments["b"], 1);
    }

    #[test]
    fn fake_asks_for_a_tool_then_reports_it() {
        let c = fake(&[msg("user", "tool:kernel__whoami {}")]);
        assert_eq!(c.tool_calls[0].name, "kernel__whoami");
        let c = fake(&[msg("tool", "{\"ok\":true}")]);
        assert!(c.text.starts_with("Tool result:"));
        assert_eq!(fake(&[msg("user", "hello")]).text, "fake: hello");
    }
}
