//! The models a provider offers, and which of them a person may choose. A Tenant Manager may use every model of the provider; the
//! other people choose among the default and the ones the Administrator (or the tenant, with its own key) allowed.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use super::settings::Resolved;
use crate::{Caller, Error, Kernel, Result};

/// How long a list of models is kept: a provider changes its models rarely, and the page asks at every open.
const KEEP: Duration = Duration::from_secs(300);
const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
}

type Cache = Mutex<HashMap<String, (Instant, Vec<ModelInfo>)>>;

fn cache() -> &'static Cache {
    static CACHE: std::sync::OnceLock<Cache> = std::sync::OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// A key for the cache that does not keep the API key itself: the provider, the address and a hash of the key.
fn cache_key(cfg: &Resolved) -> String {
    let key = cfg.key.as_deref().unwrap_or_default();
    format!(
        "{}|{}|{}",
        cfg.provider,
        cfg.base_url.as_deref().unwrap_or_default(),
        hex::encode(crate::util::sha256(key.as_bytes()))
    )
}

/// Ids that are not for chatting (embeddings, speech, images, moderation): the OpenAI list has them all.
fn is_chat_model(id: &str) -> bool {
    const NOT: [&str; 11] = [
        "embedding",
        "whisper",
        "tts",
        "dall-e",
        "moderation",
        "davinci",
        "babbage",
        "realtime",
        "transcribe",
        "image",
        "audio",
    ];
    let id = id.to_lowercase();
    !NOT.iter().any(|n| id.contains(n))
}

pub(crate) fn parse_openai(text: &str, filter: bool) -> Vec<ModelInfo> {
    let v: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    let mut out: Vec<ModelInfo> = v["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["id"].as_str())
        .filter(|id| !filter || is_chat_model(id))
        .map(|id| ModelInfo { id: id.to_string(), label: id.to_string() })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out.dedup_by(|a, b| a.id == b.id);
    out
}

pub(crate) fn parse_anthropic(text: &str) -> Vec<ModelInfo> {
    let v: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    v["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m["id"].as_str()?;
            let label = m["display_name"].as_str().filter(|l| !l.is_empty()).unwrap_or(id);
            Some(ModelInfo { id: id.to_string(), label: label.to_string() })
        })
        .collect()
}

/// Asks the provider for its models.
pub async fn list(k: &Kernel, cfg: &Resolved) -> Result<Vec<ModelInfo>> {
    let ck = cache_key(cfg);
    if let Some((at, v)) = cache().lock().expect("models cache").get(&ck) {
        if at.elapsed() < KEEP {
            return Ok(v.clone());
        }
    }
    let list = match cfg.provider.as_str() {
        "fake" if super::fake_allowed(k) => ["fake-small", "fake-large"]
            .iter()
            .map(|m| ModelInfo { id: m.to_string(), label: m.to_string() })
            .collect(),
        "anthropic" => {
            let base = cfg.base_url.clone().unwrap_or_else(|| "https://api.anthropic.com".into());
            let mut req = k
                .http
                .get(format!("{base}/v1/models?limit=100"))
                .timeout(TIMEOUT)
                .header("anthropic-version", "2023-06-01");
            if let Some(key) = &cfg.key {
                req = req.header("x-api-key", key);
            }
            parse_anthropic(&fetch(req).await?)
        }
        "openai" | "openai_compatible" => {
            let base = cfg.base_url.clone().unwrap_or_else(|| "https://api.openai.com/v1".into());
            let mut req = k.http.get(format!("{base}/models")).timeout(TIMEOUT);
            if let Some(key) = &cfg.key {
                req = req.bearer_auth(key);
            }
            // only the OpenAI list holds things that are not for chatting; a local server lists what it has
            parse_openai(&fetch(req).await?, cfg.provider == "openai")
        }
        p => return Err(Error::bad(format!("unknown provider '{p}'"))),
    };
    cache().lock().expect("models cache").insert(ck, (Instant::now(), list.clone()));
    Ok(list)
}

async fn fetch(req: reqwest::RequestBuilder) -> Result<String> {
    let res = req.send().await.map_err(|e| {
        Error::internal(format!("the provider is not reachable: {e}")).with_code("assistant_unreachable")
    })?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        let m: String = body.chars().take(200).collect();
        return Err(
            Error::internal(format!("the provider answered {status}: {m}")).with_code("assistant_upstream")
        );
    }
    Ok(body)
}

/// What a person sees in the chooser.
#[derive(Debug, Serialize)]
pub struct Choices {
    pub default: String,
    pub models: Vec<ModelInfo>,
    /// the person may use every model of the provider (a Tenant Manager)
    pub all: bool,
}

fn info(id: &str, known: &[ModelInfo]) -> ModelInfo {
    known
        .iter()
        .find(|m| m.id == id)
        .cloned()
        .unwrap_or(ModelInfo { id: id.to_string(), label: id.to_string() })
}

/// The models `c` may choose: all of the provider for a Tenant Manager, the default and the allowed ones for the others. When the
/// provider cannot be asked, the person still has the default and the allowed ones.
pub async fn choices(k: &Kernel, c: &Caller, cfg: &Resolved) -> Choices {
    let live = list(k, cfg).await.ok();
    let known = live.clone().unwrap_or_default();
    let models = if c.is_manager() && live.is_some() {
        let mut v = known.clone();
        if !v.iter().any(|m| m.id == cfg.model) {
            v.insert(0, info(&cfg.model, &known));
        }
        v
    } else {
        let mut v = vec![info(&cfg.model, &known)];
        for id in &cfg.user_models {
            if !v.iter().any(|m| &m.id == id) {
                v.push(info(id, &known));
            }
        }
        v
    };
    Choices { default: cfg.model.clone(), models, all: c.is_manager() }
}

/// The model of a chat: what the person asked for, if they may. An unknown model of the provider is the provider's to refuse.
pub fn pick(c: &Caller, cfg: &Resolved, asked: Option<&str>) -> Result<String> {
    let Some(m) = asked.map(str::trim).filter(|m| !m.is_empty() && *m != cfg.model) else {
        return Ok(cfg.model.clone());
    };
    if m.len() > 200 || m.chars().any(char::is_control) {
        return Err(Error::bad("model: 1 to 200 characters"));
    }
    if c.is_manager() || cfg.user_models.iter().any(|u| u == m) {
        return Ok(m.to_string());
    }
    Err(Error::forbidden("this model is not one you may choose").with_code("assistant_model_not_allowed"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_lists_of_the_providers_are_read() {
        let o = parse_openai(
            r#"{"data":[{"id":"gpt-4.1"},{"id":"text-embedding-3-small"},{"id":"whisper-1"},{"id":"gpt-4.1"},{"id":"o4-mini"}]}"#,
            true,
        );
        assert_eq!(o.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["gpt-4.1", "o4-mini"]);
        // a local server lists what it has: nothing is filtered
        assert_eq!(
            parse_openai(r#"{"data":[{"id":"nomic-embed-text"},{"id":"llama3.1:latest"}]}"#, false).len(),
            2
        );
        let a = parse_anthropic(
            r#"{"data":[{"id":"claude-sonnet-5-5","display_name":"Claude Sonnet 5.5"},{"id":"claude-x"}]}"#,
        );
        assert_eq!((a[0].label.as_str(), a[1].label.as_str()), ("Claude Sonnet 5.5", "claude-x"));
        assert!(parse_openai("not json", false).is_empty());
    }
}
