use std::cmp::Ordering;
use std::fmt;

/// Versione semantica `MAJOR.MINOR.PATCH` (senza pre-release).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Version(pub u64, pub u64, pub u64);

impl Version {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_e_confronto() {
        assert_eq!(Version::parse("1.2.3"), Some(Version(1, 2, 3)));
        assert!(Version::parse("1.2").is_none());
        assert!(Version::parse("1.2.3.4").is_none());
        assert!(Version::parse("1.x.3").is_none());
        assert!(Version(1, 10, 0) > Version(1, 9, 9));
    }
}
