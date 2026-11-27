//! Language-model providers. One canonical message format (OpenAI-like: `user`, `assistant` with `tool_calls`, `tool`)
//! is converted for each provider. `fake` is deterministic, for tests and development.

use std::time::Duration;

use serde_json::{json, Value};

use super::settings::Resolved;
use super::{Completion, Message, ToolCall, ToolSpec};
use crate::{Error, Kernel, Result};

/// A local model on a CPU can take minutes for a long answer.
const TIMEOUT: Duration = Duration::from_secs(300);
const MAX_TOKENS: u32 = 4096;

/// Where the pieces of the answer go as they arrive (a streamed answer); `None`: the answer comes whole.
pub type Delta<'a> = Option<&'a (dyn Fn(&str) + Send + Sync)>;

pub async fn complete(
    k: &Kernel,
    cfg: &Resolved,
    system: &str,
    messages: &[Message],
    tools: &[ToolSpec],
    on_delta: Delta<'_>,
) -> Result<Completion> {
    match cfg.provider.as_str() {
        "anthropic" => anthropic(k, cfg, system, messages, tools, on_delta).await,
        "openai" | "openai_compatible" => openai(k, cfg, system, messages, tools, on_delta).await,
        "fake" if super::fake_allowed(k) => {
            let c = fake(messages);
            if let Some(d) = on_delta {
                // a word at a time, so the streaming of the page can be tried with no model
                for w in c.text.split_inclusive(' ') {
                    d(w);
                }
            }
            Ok(c)
        }
        p => Err(Error::bad(format!("unknown provider '{p}'"))),
    }
}

fn upstream(status: reqwest::StatusCode, body: &str) -> Error {
    let msg: String = body.chars().take(300).collect();
    Error::internal(format!("the language model answered {status}: {msg}")).with_code("assistant_upstream")
}

fn net(e: reqwest::Error) -> Error {
    if e.is_timeout() {
        return Error::internal("the language model did not answer in time (5 minutes): try a smaller model or a shorter question")
            .with_code("assistant_timeout");
    }
    Error::internal(format!("the language model is not reachable: {e}")).with_code("assistant_unreachable")
}

// ---------------------------------------------------------------- OpenAI and compatible

/// The text of a question with the text files attached to it, and a note for what the provider cannot read.
fn question_text(m: &Message, reads_pdf: bool) -> String {
    let mut s = m.content.clone();
    for a in &m.attachments {
        match a.kind.as_str() {
            "text" => s.push_str(&format!("\n\nAttached file «{}»:\n```\n{}\n```", a.name, a.data)),
            "pdf" if !reads_pdf => s.push_str(&format!(
                "\n\n[The PDF «{}» is attached, but this provider cannot read PDF files.]",
                a.name
            )),
            _ => {}
        }
    }
    s
}

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
            _ if m.attachments.iter().any(|a| a.kind == "image") => {
                let mut parts = vec![json!({ "type": "text", "text": question_text(m, false) })];
                for a in m.attachments.iter().filter(|a| a.kind == "image") {
                    parts.push(json!({ "type": "image_url", "image_url": { "url": format!("data:{};base64,{}", a.mime, a.data) } }));
                }
                out.push(json!({ "role": "user", "content": parts }));
            }
            _ => out.push(json!({ "role": "user", "content": question_text(m, false) })),
        }
    }
    out
}

async fn openai(
    k: &Kernel,
    cfg: &Resolved,
    system: &str,
    messages: &[Message],
    tools: &[ToolSpec],
    on_delta: Delta<'_>,
) -> Result<Completion> {
    let base = cfg.base_url.clone().unwrap_or_else(|| "https://api.openai.com/v1".into());
    let mut body = json!({ "model": cfg.model, "messages": openai_messages(system, messages) });
    if !tools.is_empty() {
        body["tools"] = tools
            .iter()
            .map(|t| {
                json!({ "type": "function",
                "function": { "name": t.name, "description": t.description, "parameters": t.input_schema } })
            })
            .collect();
    }
    if on_delta.is_some() {
        body["stream"] = json!(true);
        body["stream_options"] = json!({ "include_usage": true });
    }
    let mut req = k.http.post(format!("{base}/chat/completions")).timeout(TIMEOUT).json(&body);
    if let Some(key) = &cfg.key {
        req = req.bearer_auth(key);
    }
    let mut res = req.send().await.map_err(net)?;
    let status = res.status();
    if !status.is_success() {
        return Err(upstream(status, &res.text().await.map_err(net)?));
    }
    let Some(on) = on_delta else {
        return parse_openai(&res.text().await.map_err(net)?).map(|c| rescue_text_call(c, tools));
    };
    let mut acc = OpenAiStream::default();
    while let Some(chunk) = res.chunk().await.map_err(net)? {
        acc.feed(&String::from_utf8_lossy(&chunk), on);
    }
    Ok(rescue_text_call(acc.finish(), tools))
}

/// The name and the arguments of a call written as broken JSON: `{"name": "x", "parameters": {"}}` is the tool `x` with no arguments.
fn lenient_call(text: &str) -> Option<Value> {
    let after = |key: &str| -> Option<&str> {
        let i = text.find(&format!("\"{key}\""))? + key.len() + 2;
        Some(text[i..].trim_start().strip_prefix(':')?.trim_start())
    };
    let name = after("name")?.strip_prefix('"')?;
    let name = &name[..name.find('"')?];
    if name.is_empty() {
        return None;
    }
    // the arguments: the first object after the key that parses
    let params = ["parameters", "arguments"].iter().find_map(|k| {
        let rest = after(k)?;
        let start = rest.find('{')?;
        let body = &rest[start..];
        body.match_indices('}').find_map(|(end, _)| serde_json::from_str::<Value>(&body[..=end]).ok())
    });
    Some(json!({ "name": name, "parameters": params.unwrap_or_else(|| json!({})) }))
}

/// Small models behind an OpenAI-compatible server (Llama through Ollama, with many tools) often write the call as the text of the
/// answer, `{"type":"function","name":"whoami","parameters":{}}`, instead of using the tool-call field. An answer that is only such a
/// call, naming a tool we offered (exactly, or by the end of its name when that is unambiguous), is taken as the call it means.
pub(crate) fn rescue_text_call(mut c: Completion, tools: &[ToolSpec]) -> Completion {
    if !c.tool_calls.is_empty() {
        return c;
    }
    let text = c.text.trim();
    let text = text.strip_prefix("```json").or_else(|| text.strip_prefix("```")).unwrap_or(text);
    let text = text.strip_suffix("```").unwrap_or(text).trim();
    if !text.starts_with('{') {
        return c;
    }
    let v = match serde_json::from_str::<Value>(text) {
        Ok(v) => v,
        // a small model often breaks the JSON (a cut `{"}`): the name is still there, and the arguments when they can be read
        Err(_) => match lenient_call(text) {
            Some(v) => v,
            None => return c,
        },
    };
    let named = v["name"].as_str().or_else(|| v["function"]["name"].as_str());
    let Some(name) = named else { return c };
    let args = [&v["parameters"], &v["arguments"], &v["function"]["arguments"], &v["function"]["parameters"]]
        .into_iter()
        .find(|a| !a.is_null())
        .cloned()
        .unwrap_or_else(|| json!({}));
    let args = match args {
        Value::String(s) => serde_json::from_str(&s).unwrap_or_else(|_| json!({})),
        a => a,
    };
    let exact = tools.iter().find(|t| t.name == name);
    let by_end: Vec<&ToolSpec> = tools.iter().filter(|t| t.name.ends_with(&format!("__{name}"))).collect();
    let tool = match (exact, by_end.as_slice()) {
        (Some(t), _) => t,
        (None, [one]) => one,
        _ => return c,
    };
    c.tool_calls.push(ToolCall { id: "call-text-1".into(), name: tool.name.clone(), arguments: args });
    c.text.clear();
    c
}

/// The answer of an OpenAI-compatible server read as it arrives (`data: {...}` lines).
#[derive(Default)]
pub(crate) struct OpenAiStream {
    buf: String,
    text: String,
    /// id, name, arguments (a string that grows) by index
    calls: Vec<(String, String, String)>,
    tin: u64,
    tout: u64,
}

impl OpenAiStream {
    pub(crate) fn feed(&mut self, chunk: &str, on: &(dyn Fn(&str) + Send + Sync)) {
        self.buf.push_str(chunk);
        while let Some(i) = self.buf.find('\n') {
            let line: String = self.buf.drain(..=i).collect();
            self.line(line.trim(), on);
        }
    }

    fn line(&mut self, line: &str, on: &(dyn Fn(&str) + Send + Sync)) {
        let Some(data) = line.strip_prefix("data:") else { return };
        let Ok(v) = serde_json::from_str::<Value>(data.trim()) else { return };
        if let Some(n) = v["usage"]["prompt_tokens"].as_u64() {
            self.tin = n;
        }
        if let Some(n) = v["usage"]["completion_tokens"].as_u64() {
            self.tout = n;
        }
        let d = &v["choices"][0]["delta"];
        if let Some(t) = d["content"].as_str().filter(|t| !t.is_empty()) {
            self.text.push_str(t);
            on(t);
        }
        for c in d["tool_calls"].as_array().into_iter().flatten() {
            let i = c["index"].as_u64().unwrap_or(0) as usize;
            if self.calls.len() <= i {
                self.calls.resize(i + 1, (String::new(), String::new(), String::new()));
            }
            let slot = &mut self.calls[i];
            if let Some(id) = c["id"].as_str() {
                slot.0 = id.to_string();
            }
            if let Some(n) = c["function"]["name"].as_str() {
                slot.1.push_str(n);
            }
            if let Some(a) = c["function"]["arguments"].as_str() {
                slot.2.push_str(a);
            }
        }
    }

    pub(crate) fn finish(self) -> Completion {
        Completion {
            text: self.text,
            tool_calls: self
                .calls
                .into_iter()
                .enumerate()
                .map(|(i, (id, name, args))| ToolCall {
                    id: if id.is_empty() { format!("call-{i}") } else { id },
                    name,
                    arguments: serde_json::from_str(&args).unwrap_or_else(|_| json!({})),
                })
                .collect(),
            input_tokens: self.tin,
            output_tokens: self.tout,
        }
    }
}

pub(crate) fn parse_openai(text: &str) -> Result<Completion> {
    let v: Value = serde_json::from_str(text)
        .map_err(|_| Error::internal("the language model sent an invalid answer"))?;
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
                    blocks.push(
                        json!({ "type": "tool_use", "id": c.id, "name": c.name, "input": c.arguments }),
                    );
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
                            && last["content"]
                                .as_array()
                                .is_some_and(|a| a.iter().all(|b| b["type"] == "tool_result")) =>
                    {
                        last["content"].as_array_mut().expect("array").push(block);
                    }
                    _ => out.push(json!({ "role": "user", "content": [block] })),
                }
            }
            _ if m.attachments.iter().any(|a| matches!(a.kind.as_str(), "image" | "pdf")) => {
                let mut parts = vec![json!({ "type": "text", "text": question_text(m, true) })];
                for a in m.attachments.iter().filter(|a| matches!(a.kind.as_str(), "image" | "pdf")) {
                    let block = if a.kind == "image" { "image" } else { "document" };
                    parts.push(json!({ "type": block, "source": { "type": "base64", "media_type": a.mime, "data": a.data } }));
                }
                out.push(json!({ "role": "user", "content": parts }));
            }
            _ => out.push(json!({ "role": "user", "content": question_text(m, true) })),
        }
    }
    out
}

async fn anthropic(
    k: &Kernel,
    cfg: &Resolved,
    system: &str,
    messages: &[Message],
    tools: &[ToolSpec],
    on_delta: Delta<'_>,
) -> Result<Completion> {
    let base = cfg.base_url.clone().unwrap_or_else(|| "https://api.anthropic.com".into());
    let mut body = json!({
        "model": cfg.model, "max_tokens": MAX_TOKENS, "system": system, "messages": anthropic_messages(messages) });
    if !tools.is_empty() {
        body["tools"] = tools
            .iter()
            .map(|t| json!({ "name": t.name, "description": t.description, "input_schema": t.input_schema }))
            .collect();
    }
    if on_delta.is_some() {
        body["stream"] = json!(true);
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
    let mut res = req.send().await.map_err(net)?;
    let status = res.status();
    if !status.is_success() {
        return Err(upstream(status, &res.text().await.map_err(net)?));
    }
    let Some(on) = on_delta else {
        return parse_anthropic(&res.text().await.map_err(net)?);
    };
    let mut acc = AnthropicStream::default();
    while let Some(chunk) = res.chunk().await.map_err(net)? {
        acc.feed(&String::from_utf8_lossy(&chunk), on);
    }
    Ok(acc.finish())
}

/// The answer of Anthropic read as it arrives (server-sent events: the JSON of every `data:` line names its type).
#[derive(Default)]
pub(crate) struct AnthropicStream {
    buf: String,
    text: String,
    /// id, name, input (a JSON string that grows), in the order of the blocks
    calls: Vec<(String, String, String)>,
    tin: u64,
    tout: u64,
}

impl AnthropicStream {
    pub(crate) fn feed(&mut self, chunk: &str, on: &(dyn Fn(&str) + Send + Sync)) {
        self.buf.push_str(chunk);
        while let Some(i) = self.buf.find('\n') {
            let line: String = self.buf.drain(..=i).collect();
            self.line(line.trim(), on);
        }
    }

    fn line(&mut self, line: &str, on: &(dyn Fn(&str) + Send + Sync)) {
        let Some(data) = line.strip_prefix("data:") else { return };
        let Ok(v) = serde_json::from_str::<Value>(data.trim()) else { return };
        match v["type"].as_str() {
            Some("message_start") => self.tin = v["message"]["usage"]["input_tokens"].as_u64().unwrap_or(0),
            Some("message_delta") => self.tout = v["usage"]["output_tokens"].as_u64().unwrap_or(self.tout),
            Some("content_block_start") if v["content_block"]["type"] == "tool_use" => self.calls.push((
                v["content_block"]["id"].as_str().unwrap_or_default().to_string(),
                v["content_block"]["name"].as_str().unwrap_or_default().to_string(),
                String::new(),
            )),
            Some("content_block_delta") => match v["delta"]["type"].as_str() {
                Some("text_delta") => {
                    if let Some(t) = v["delta"]["text"].as_str() {
                        self.text.push_str(t);
                        on(t);
                    }
                }
                Some("input_json_delta") => {
                    if let (Some(p), Some(last)) =
                        (v["delta"]["partial_json"].as_str(), self.calls.last_mut())
                    {
                        last.2.push_str(p);
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }

    pub(crate) fn finish(self) -> Completion {
        Completion {
            text: self.text,
            tool_calls: self
                .calls
                .into_iter()
                .map(|(id, name, input)| ToolCall {
                    id,
                    name,
                    arguments: if input.trim().is_empty() {
                        json!({})
                    } else {
                        serde_json::from_str(&input).unwrap_or_else(|_| json!({}))
                    },
                })
                .collect(),
            input_tokens: self.tin,
            output_tokens: self.tout,
        }
    }
}

pub(crate) fn parse_anthropic(text: &str) -> Result<Completion> {
    let v: Value = serde_json::from_str(text)
        .map_err(|_| Error::internal("the language model sent an invalid answer"))?;
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
            let attached = if m.attachments.is_empty() {
                String::new()
            } else {
                format!(
                    " [{} file(s): {}]",
                    m.attachments.len(),
                    m.attachments.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ")
                )
            };
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
                done(format!("fake: {t}{attached}"))
            }
        }
        None => done("fake: (nothing)".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, content: &str) -> Message {
        Message {
            attachments: vec![],
            role: role.into(),
            content: content.into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
        }
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

    fn attached(kind: &str, mime: &str, name: &str, data: &str) -> super::super::Attachment {
        super::super::Attachment {
            name: name.into(),
            kind: kind.into(),
            mime: mime.into(),
            data: data.into(),
        }
    }

    #[test]
    fn files_reach_each_provider_the_way_it_reads_them() {
        let mut q = msg("user", "what is in these?");
        q.attachments = vec![
            attached("image", "image/png", "a.png", "QUJD"),
            attached("text", "text/csv", "t.csv", "a,b\n1,2"),
            attached("pdf", "application/pdf", "r.pdf", "UERG"),
        ];
        // OpenAI: the image as a data address, the text file inside the question, the PDF as a note
        let o = openai_messages("sys", std::slice::from_ref(&q));
        let parts = o[1]["content"].as_array().unwrap();
        assert_eq!(parts[1]["image_url"]["url"], "data:image/png;base64,QUJD");
        let text = parts[0]["text"].as_str().unwrap();
        assert!(
            text.contains("Attached file «t.csv»")
                && text.contains("a,b")
                && text.contains("cannot read PDF")
        );
        // Anthropic: an image block and a document block, and the text file inside the question
        let a = anthropic_messages(std::slice::from_ref(&q));
        let parts = a[0]["content"].as_array().unwrap();
        assert_eq!(
            (parts[1]["type"].as_str(), parts[1]["source"]["media_type"].as_str()),
            (Some("image"), Some("image/png"))
        );
        assert_eq!(
            (parts[2]["type"].as_str(), parts[2]["source"]["data"].as_str()),
            (Some("document"), Some("UERG"))
        );
        assert!(parts[0]["text"].as_str().unwrap().contains("Attached file «t.csv»"));
        assert!(!parts[0]["text"].as_str().unwrap().contains("cannot read PDF"));
        // only text files: a plain question
        let mut only = msg("user", "read");
        only.attachments = vec![attached("text", "text/plain", "n.txt", "hello")];
        assert!(openai_messages("s", &[only])[1]["content"].as_str().unwrap().contains("hello"));
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
    fn an_openai_stream_is_put_together_from_pieces() {
        let shown = std::sync::Mutex::new(String::new());
        let on = |t: &str| shown.lock().unwrap().push_str(t);
        let mut s = OpenAiStream::default();
        // a line split in two chunks, text, then a tool call whose arguments arrive in parts, then the usage
        s.feed("data: {\"choices\":[{\"delta\":{\"content\":\"Hel", &on);
        s.feed("lo\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\" you\"}}]}\n", &on);
        s.feed("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"n\",\"arguments\":\"{\\\"a\\\"\"}}]}}]}\n", &on);
        s.feed("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\":3}\"}}]}}]}\n", &on);
        s.feed(
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":9}}\ndata: [DONE]\n",
            &on,
        );
        let c = s.finish();
        assert_eq!(*shown.lock().unwrap(), "Hello you");
        assert_eq!(c.text, "Hello you");
        assert_eq!((c.tool_calls[0].id.as_str(), c.tool_calls[0].name.as_str()), ("c1", "n"));
        assert_eq!(c.tool_calls[0].arguments["a"], 3);
        assert_eq!((c.input_tokens, c.output_tokens), (7, 9));
    }

    #[test]
    fn an_anthropic_stream_is_put_together_from_events() {
        let shown = std::sync::Mutex::new(String::new());
        let on = |t: &str| shown.lock().unwrap().push_str(t);
        let mut s = AnthropicStream::default();
        let lines = [
            "event: message_start",
            "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":11}}}",
            "data: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"text\"}}",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}",
            "data: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"x\"}}",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"b\\\":\"}}",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"2}\"}}",
            "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":5}}",
        ];
        for l in lines {
            s.feed(&format!("{l}\n"), &on);
        }
        let c = s.finish();
        assert_eq!(*shown.lock().unwrap(), "Hi");
        assert_eq!(c.tool_calls[0].arguments["b"], 2);
        assert_eq!((c.input_tokens, c.output_tokens), (11, 5));
    }

    #[test]
    fn a_call_written_as_text_is_taken_as_a_call() {
        let spec = |n: &str| ToolSpec {
            name: n.into(),
            description: String::new(),
            input_schema: json!({}),
            write: false,
        };
        let tools = [spec("kernel__whoami"), spec("notes__list_notes"), spec("tasks__list_notes")];
        let said = |t: &str| Completion { text: t.into(), ..Completion::default() };
        // by the end of the name, when it is only one tool
        let c = rescue_text_call(said(r#"{"type":"function","name":"whoami","parameters":{}}"#), &tools);
        assert_eq!((c.tool_calls[0].name.as_str(), c.text.as_str()), ("kernel__whoami", ""));
        // exact, with the arguments as an object or a string, and in a fenced block
        let c = rescue_text_call(
            said("```json\n{\"name\":\"notes__list_notes\",\"arguments\":\"{\\\"q\\\":\\\"x\\\"}\"}\n```"),
            &tools,
        );
        assert_eq!(
            (c.tool_calls[0].name.as_str(), c.tool_calls[0].arguments["q"].as_str()),
            ("notes__list_notes", Some("x"))
        );
        // broken JSON: the name is enough
        let c = rescue_text_call(said(r#"{"name": "kernel__whoami", "parameters": {"}}"#), &tools);
        assert_eq!((c.tool_calls[0].name.as_str(), c.text.as_str()), ("kernel__whoami", ""));
        let c =
            rescue_text_call(said(r#"{"name": "notes__list_notes", "parameters": {"q": "x"}, oops"#), &tools);
        assert_eq!(c.tool_calls[0].arguments["q"], "x");
        // ambiguous, unknown, ordinary text, and a real call are left alone
        assert!(rescue_text_call(said(r#"{"name":"list_notes","parameters":{}}"#), &tools)
            .tool_calls
            .is_empty());
        assert!(rescue_text_call(said(r#"{"name":"nope","parameters":{}}"#), &tools).tool_calls.is_empty());
        let c = rescue_text_call(said("You are the manager."), &tools);
        assert!(c.tool_calls.is_empty() && c.text == "You are the manager.");
        let mut real = said("");
        real.tool_calls.push(ToolCall { id: "1".into(), name: "x".into(), arguments: json!({}) });
        assert_eq!(rescue_text_call(real, &tools).tool_calls[0].id, "1");
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
