use std::cmp::Ordering;
use std::fmt;

/// Semantic version `MAJOR.MINOR.PATCH` (without pre-release).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Version(pub u64, pub u64, pub u64);

impl Version {
    /// Parses the version, ignoring a pre-release or build suffix (`1.2.3-dev`, `1.2.3+abc`).
    pub fn parse_lenient(s: &str) -> Option<Version> {
        Version::parse(s.split(['-', '+']).next()?)
    }

    pub fn parse(s: &str) -> Option<Version> {
        let mut it = s.trim().split('.');
        let v = Version(it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?);
        if it.next().is_some() {
            return None;
        }
        Some(v)
    }
}

impl Ord for Version {
    fn cmp(&self, o: &Self) -> Ordering {
        (self.0, self.1, self.2).cmp(&(o.0, o.1, o.2))
    }
}
impl PartialOrd for Version {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

impl fmt::Display for Version {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.0, self.1, self.2)
    }
}

/// A range of versions: comparators separated by commas, all of which must hold.
/// Operators: `>=`, `>`, `<=`, `<`, `=`, `^` (compatible: same major, or same minor below 1.0) and `~` (same
/// minor). A bare version is `^`. `*` or an empty range accepts anything. Versions may omit minor and patch
/// (`>=1.2` means `>=1.2.0`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionReq {
    text: String,
    parts: Vec<(Op, Version)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Ge,
    Lt,
}

fn partial(s: &str) -> Option<(Version, usize)> {
    let mut nums = Vec::new();
    for p in s.trim().split('.') {
        nums.push(p.parse::<u64>().ok()?);
    }
    if nums.is_empty() || nums.len() > 3 {
        return None;
    }
    let n = nums.len();
    nums.resize(3, 0);
    Some((Version(nums[0], nums[1], nums[2]), n))
}

impl VersionReq {
    pub fn parse(s: &str) -> Option<VersionReq> {
        let mut parts = Vec::new();
        for c in s.split(',').map(str::trim) {
            if c.is_empty() || c == "*" {
                continue;
            }
            let (op, rest) = ["<=", ">=", "<", ">", "=", "^", "~"]
                .iter()
                .find_map(|o| c.strip_prefix(o).map(|r| (*o, r)))
                .unwrap_or(("^", c));
            let (v, n) = partial(rest)?;
            match op {
                ">=" => parts.push((Op::Ge, v)),
                ">" => {
                    // `>1.2` (partial) means from 1.3.0
                    let next = match n {
                        1 => Version(v.0 + 1, 0, 0),
                        2 => Version(v.0, v.1 + 1, 0),
                        _ => Version(v.0, v.1, v.2 + 1),
                    };
                    parts.push((Op::Ge, next));
                }
                "<=" => {
                    let next = match n {
                        1 => Version(v.0 + 1, 0, 0),
                        2 => Version(v.0, v.1 + 1, 0),
                        _ => Version(v.0, v.1, v.2 + 1),
                    };
                    parts.push((Op::Lt, next));
                }
                "<" => parts.push((Op::Lt, v)),
                "=" => {
                    parts.push((Op::Ge, v));
                    parts.push((
                        Op::Lt,
                        match n {
                            1 => Version(v.0 + 1, 0, 0),
                            2 => Version(v.0, v.1 + 1, 0),
                            _ => Version(v.0, v.1, v.2 + 1),
                        },
                    ));
                }
                "~" => {
                    parts.push((Op::Ge, v));
                    parts.push((
                        Op::Lt,
                        if n == 1 { Version(v.0 + 1, 0, 0) } else { Version(v.0, v.1 + 1, 0) },
                    ));
                }
                _ => {
                    // caret
                    parts.push((Op::Ge, v));
                    parts.push((
                        Op::Lt,
                        if v.0 > 0 || n == 1 {
                            Version(v.0 + 1, 0, 0)
                        } else if v.1 > 0 || n == 2 {
                            Version(0, v.1 + 1, 0)
                        } else {
                            Version(0, 0, v.2 + 1)
                        },
                    ));
                }
            }
        }
        Some(VersionReq { text: s.trim().to_string(), parts })
    }

    /// A range that accepts `>= min` (the old `min_kernel`).
    pub fn at_least(min: Version) -> VersionReq {
        VersionReq { text: format!(">={min}"), parts: vec![(Op::Ge, min)] }
    }

    pub fn matches(&self, v: Version) -> bool {
        self.parts.iter().all(|(op, r)| match op {
            Op::Ge => v >= *r,
            Op::Lt => v < *r,
        })
    }
}

impl fmt::Display for VersionReq {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(if self.text.is_empty() { "*" } else { &self.text })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_and_compare() {
        assert_eq!(Version::parse("1.2.3"), Some(Version(1, 2, 3)));
        assert!(Version::parse("1.2").is_none());
        assert!(Version::parse("1.2.3.4").is_none());
        assert!(Version::parse("1.x.3").is_none());
        assert!(Version(1, 10, 0) > Version(1, 9, 9));
    }

    fn req(s: &str) -> VersionReq {
        VersionReq::parse(s).unwrap()
    }

    #[test]
    fn ranges() {
        let r = req(">=1.2, <2");
        assert!(r.matches(Version(1, 2, 0)) && r.matches(Version(1, 9, 9)));
        assert!(!r.matches(Version(1, 1, 9)) && !r.matches(Version(2, 0, 0)));
        assert!(req("^1.2").matches(Version(1, 5, 0)) && !req("^1.2").matches(Version(2, 0, 0)));
        assert!(req("1.2.3").matches(Version(1, 2, 4)) && !req("1.2.3").matches(Version(1, 2, 2)));
        assert!(req("^0.3").matches(Version(0, 3, 9)) && !req("^0.3").matches(Version(0, 4, 0)));
        assert!(req("~1.2").matches(Version(1, 2, 9)) && !req("~1.2").matches(Version(1, 3, 0)));
        assert!(req("=1.2").matches(Version(1, 2, 7)) && !req("=1.2").matches(Version(1, 3, 0)));
        assert!(req(">1.2").matches(Version(1, 3, 0)) && !req(">1.2").matches(Version(1, 2, 9)));
        assert!(req("<=1.2").matches(Version(1, 2, 9)) && !req("<=1.2").matches(Version(1, 3, 0)));
        assert!(req("*").matches(Version(9, 9, 9)) && req("").matches(Version(0, 0, 1)));
        assert!(VersionReq::parse(">=x").is_none() && VersionReq::parse(">=1.2.3.4").is_none());
        assert_eq!(Version::parse_lenient("1.2.3-dev"), Some(Version(1, 2, 3)));
    }
}
