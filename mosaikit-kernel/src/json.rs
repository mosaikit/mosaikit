//! JSON minimale std-only: parser ricorsivo + serializzatore.
//! Copre il sottoinsieme usato da manifest e record (oggetti, array,
//! stringhe con escape comuni, numeri, bool, null).

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(pairs) => pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self { Json::Str(s) => Some(s), _ => None }
    }
    pub fn as_f64(&self) -> Option<f64> {
        match self { Json::Num(n) => Some(*n), _ => None }
    }
    pub fn as_bool(&self) -> Option<bool> {
        match self { Json::Bool(b) => Some(*b), _ => None }
    }
    pub fn as_arr(&self) -> Option<&[Json]> {
        match self { Json::Arr(a) => Some(a), _ => None }
    }
    pub fn as_obj(&self) -> Option<&[(String, Json)]> {
        match self { Json::Obj(o) => Some(o), _ => None }
    }

    pub fn parse(src: &str) -> Result<Json, String> {
        let mut p = Parser { b: src.as_bytes(), pos: 0 };
        p.ws();
        let v = p.value()?;
        p.ws();
        if p.pos != p.b.len() { return Err(format!("trailing data at byte {}", p.pos)); }
        Ok(v)
    }

    pub fn to_string(&self) -> String {
        let mut s = String::new();
        self.write(&mut s);
        s
    }

    fn write(&self, out: &mut String) {
        match self {
            Json::Null => out.push_str("null"),
            Json::Bool(true) => out.push_str("true"),
            Json::Bool(false) => out.push_str("false"),
            Json::Num(n) => {
                if n.fract() == 0.0 && n.is_finite() { out.push_str(&format!("{}", *n as i64)); }
                else { out.push_str(&format!("{n}")); }
            }
            Json::Str(s) => write_str(s, out),
            Json::Arr(a) => {
                out.push('[');
                for (i, v) in a.iter().enumerate() {
                    if i > 0 { out.push(','); }
                    v.write(out);
                }
                out.push(']');
            }
            Json::Obj(o) => {
                out.push('{');
                for (i, (k, v)) in o.iter().enumerate() {
                    if i > 0 { out.push(','); }
                    write_str(k, out);
                    out.push(':');
                    v.write(out);
                }
                out.push('}');
            }
        }
    }
}

fn write_str(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

struct Parser<'a> { b: &'a [u8], pos: usize }

impl<'a> Parser<'a> {
    fn ws(&mut self) {
        while self.pos < self.b.len() && matches!(self.b[self.pos], b' ' | b'\t' | b'\n' | b'\r') {
            self.pos += 1;
        }
    }
    fn peek(&self) -> Result<u8, String> {
        self.b.get(self.pos).copied().ok_or_else(|| "unexpected end of json".to_string())
    }
    fn value(&mut self) -> Result<Json, String> {
        self.ws();
        match self.peek()? {
            b'{' => self.obj(),
            b'[' => self.arr(),
            b'"' => Ok(Json::Str(self.string()?)),
            b't' => self.lit("true", Json::Bool(true)),
            b'f' => self.lit("false", Json::Bool(false)),
            b'n' => self.lit("null", Json::Null),
            _ => self.number(),
        }
    }
    fn lit(&mut self, s: &str, v: Json) -> Result<Json, String> {
        if self.b[self.pos..].starts_with(s.as_bytes()) { self.pos += s.len(); Ok(v) }
        else { Err(format!("invalid literal at {}", self.pos)) }
    }
    fn number(&mut self) -> Result<Json, String> {
        let start = self.pos;
        while self.pos < self.b.len() && matches!(self.b[self.pos], b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E') {
            self.pos += 1;
        }
        let s = std::str::from_utf8(&self.b[start..self.pos]).map_err(|e| e.to_string())?;
        s.parse::<f64>().map(Json::Num).map_err(|_| format!("bad number '{s}'"))
    }
    fn string(&mut self) -> Result<String, String> {
        if self.peek()? != b'"' { return Err("expected string".into()); }
        self.pos += 1;
        let mut out = String::new();
        loop {
            match self.peek()? {
                b'"' => { self.pos += 1; return Ok(out); }
                b'\\' => {
                    self.pos += 1;
                    match self.peek()? {
                        b'"' => { out.push('"'); self.pos += 1; }
                        b'\\' => { out.push('\\'); self.pos += 1; }
                        b'/' => { out.push('/'); self.pos += 1; }
                        b'n' => { out.push('\n'); self.pos += 1; }
                        b'r' => { out.push('\r'); self.pos += 1; }
                        b't' => { out.push('\t'); self.pos += 1; }
                        b'u' => {
                            let hex = std::str::from_utf8(&self.b[self.pos + 1..self.pos + 5]).map_err(|e| e.to_string())?;
                            let cp = u32::from_str_radix(hex, 16).map_err(|e| e.to_string())?;
                            self.pos += 5;
                            out.push(char::from_u32(cp).unwrap_or('?'));
                        }
                        c => return Err(format!("bad escape \\{c}")),
                    }
                }
                _ => {
                    // UTF-8 pass-through: avanza di un carattere
                    let rest = std::str::from_utf8(&self.b[self.pos..]).map_err(|e| e.to_string())?;
                    let ch = rest.chars().next().ok_or("eof")?;
                    out.push(ch);
                    self.pos += ch.len_utf8();
                }
            }
        }
    }
    fn obj(&mut self) -> Result<Json, String> {
        self.pos += 1; // {
        let mut pairs = Vec::new();
        self.ws();
        if self.peek()? == b'}' { self.pos += 1; return Ok(Json::Obj(pairs)); }
        loop {
            self.ws();
            let k = self.string()?;
            self.ws();
            if self.peek()? != b':' { return Err("expected ':'".into()); }
            self.pos += 1;
            let v = self.value()?;
            pairs.push((k, v));
            self.ws();
            match self.peek()? {
                b',' => { self.pos += 1; }
                b'}' => { self.pos += 1; return Ok(Json::Obj(pairs)); }
                c => return Err(format!("expected ',' or '}}', got {c}")),
            }
        }
    }
    fn arr(&mut self) -> Result<Json, String> {
        self.pos += 1; // [
        let mut items = Vec::new();
        self.ws();
        if self.peek()? == b']' { self.pos += 1; return Ok(Json::Arr(items)); }
        loop {
            items.push(self.value()?);
            self.ws();
            match self.peek()? {
                b',' => { self.pos += 1; }
                b']' => { self.pos += 1; return Ok(Json::Arr(items)); }
                c => return Err(format!("expected ',' or ']', got {c}")),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let src = r#"{"id":"com.mosaikit.notes","n":1,"ok":true,"tags":["a","b"],"z":null}"#;
        let j = Json::parse(src).unwrap();
        assert_eq!(j.get("id").and_then(Json::as_str), Some("com.mosaikit.notes"));
        assert_eq!(j.get("n").and_then(Json::as_f64), Some(1.0));
        assert_eq!(j.get("ok").and_then(Json::as_bool), Some(true));
        assert_eq!(j.to_string(), src);
    }
}
