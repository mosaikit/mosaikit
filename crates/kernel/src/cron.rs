//! A small cron parser for schedules (see `schedules.rs`): five fields, UTC only.
//!
//! `minute hour day-of-month month day-of-week`, each one `*`, a number, a range `a-b`, a list
//! `a,b,c` of those, or a step `*/n`, `a-b/n`, `a/n`. No names (`MON`, `JAN`), no `L`, `W`, `#`, `?`
//! and no seconds. Day of week is 0-6 (Sunday is 0; 7 is read as 0). As in classic cron, when both the
//! day of month and the day of week are restricted a day matches when EITHER does.
//!
//! No dependency on purpose: the grammar is this small and a crate for it is a supply-chain cost the
//! kernel does not need.

use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Timelike, Utc};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cron {
    minutes: u64,
    hours: u64,
    days: u64,
    months: u64,
    weekdays: u64,
    /// the field starts with `*`: it does not restrict
    any_day: bool,
    any_weekday: bool,
}

/// Why an expression is refused (the text is shown to the person).
pub type ParseError = String;

fn field(src: &str, name: &str, lo: u32, hi: u32) -> Result<(u64, bool), ParseError> {
    let bad = |why: &str| format!("cron {name} '{src}': {why}");
    let num = |s: &str| -> Result<u32, ParseError> {
        if s.is_empty() || s.len() > 2 || !s.bytes().all(|b| b.is_ascii_digit()) {
            return Err(bad("numbers only (no names)"));
        }
        let n: u32 = s.parse().map_err(|_| bad("not a number"))?;
        if n < lo || n > hi {
            return Err(bad(&format!("{lo} to {hi}")));
        }
        Ok(n)
    };
    let mut mask = 0u64;
    for part in src.split(',') {
        let (range, step) = match part.split_once('/') {
            Some((r, s)) => {
                let step = num_step(s).ok_or_else(|| bad("the step is a number from 1 to 59"))?;
                (r, Some(step))
            }
            None => (part, None),
        };
        let (from, to) = if range == "*" {
            (lo, hi)
        } else if let Some((a, b)) = range.split_once('-') {
            let (a, b) = (num(a)?, num(b)?);
            if a > b {
                return Err(bad("a range runs upwards"));
            }
            (a, b)
        } else {
            let a = num(range)?;
            // `a/n` runs from a to the end of the field
            (a, if step.is_some() { hi } else { a })
        };
        let step = step.unwrap_or(1);
        let mut v = from;
        while v <= to {
            mask |= 1 << v;
            v += step;
        }
    }
    Ok((mask, src.starts_with('*')))
}

fn num_step(s: &str) -> Option<u32> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n: u32 = s.parse().ok()?;
    (1..=59).contains(&n).then_some(n)
}

impl Cron {
    pub fn parse(expr: &str) -> Result<Cron, ParseError> {
        let parts: Vec<&str> = expr.split_whitespace().collect();
        if parts.len() != 5 {
            return Err("cron needs five fields: minute hour day-of-month month day-of-week".into());
        }
        let (minutes, _) = field(parts[0], "minute", 0, 59)?;
        let (hours, _) = field(parts[1], "hour", 0, 23)?;
        let (days, any_day) = field(parts[2], "day of month", 1, 31)?;
        let (months, _) = field(parts[3], "month", 1, 12)?;
        let (mut weekdays, any_weekday) = field(parts[4], "day of week", 0, 7)?;
        if weekdays & (1 << 7) != 0 {
            weekdays = (weekdays & !(1 << 7)) | 1;
        }
        Ok(Cron { minutes, hours, days, months, weekdays, any_day, any_weekday })
    }

    fn day_matches(&self, d: NaiveDate) -> bool {
        let dom = self.days & (1 << d.day()) != 0;
        let dow = self.weekdays & (1 << d.weekday().num_days_from_sunday()) != 0;
        match (self.any_day, self.any_weekday) {
            (false, false) => dom || dow,
            (false, true) => dom,
            (true, false) => dow,
            (true, true) => true,
        }
    }

    /// The first fire time strictly after `from` (UTC, whole minutes); `None` when the expression never
    /// fires in the next eight years (e.g. 31 February).
    pub fn next_after(&self, from: DateTime<Utc>) -> Option<DateTime<Utc>> {
        let mut t = from.naive_utc().with_second(0)?.with_nanosecond(0)? + Duration::minutes(1);
        let limit = from.year() + 8;
        while t.year() <= limit {
            if self.months & (1 << t.month()) == 0 {
                let (y, m) = if t.month() == 12 { (t.year() + 1, 1) } else { (t.year(), t.month() + 1) };
                t = NaiveDate::from_ymd_opt(y, m, 1)?.and_hms_opt(0, 0, 0)?;
            } else if !self.day_matches(t.date()) {
                t = (t.date() + Duration::days(1)).and_hms_opt(0, 0, 0)?;
            } else if self.hours & (1 << t.hour()) == 0 {
                t = t.with_minute(0)? + Duration::hours(1);
            } else if self.minutes & (1 << t.minute()) == 0 {
                t += Duration::minutes(1);
            } else {
                return Some(Utc.from_utc_datetime(&t));
            }
        }
        None
    }

    /// The smallest gap, in minutes, between the next `count` fire times after `from`; `None` when the
    /// expression fires fewer than two times.
    pub fn min_gap_minutes(&self, from: DateTime<Utc>, count: usize) -> Option<i64> {
        let mut prev = self.next_after(from)?;
        let mut gap: Option<i64> = None;
        for _ in 1..count {
            let Some(next) = self.next_after(prev) else { break };
            let g = (next - prev).num_minutes();
            gap = Some(gap.map_or(g, |x| x.min(g)));
            prev = next;
        }
        gap
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn next(expr: &str, from: &str) -> String {
        Cron::parse(expr).unwrap().next_after(at(from)).unwrap().format("%Y-%m-%dT%H:%M").to_string()
    }

    #[test]
    fn next_fire_times() {
        assert_eq!(next("*/15 * * * *", "2026-11-03T10:07:30Z"), "2026-11-03T10:15");
        // strictly after: a time that is a fire time moves to the next one
        assert_eq!(next("*/15 * * * *", "2026-11-03T10:15:00Z"), "2026-11-03T10:30");
        assert_eq!(next("0 2 * * *", "2026-11-03T10:00:00Z"), "2026-11-04T02:00");
        // Friday to Monday
        assert_eq!(next("30 9 * * 1-5", "2026-11-06T10:00:00Z"), "2026-11-09T09:30");
        assert_eq!(next("0 0 1 1 *", "2026-11-03T10:00:00Z"), "2027-01-01T00:00");
        assert_eq!(next("0 0 29 2 *", "2026-11-03T10:00:00Z"), "2028-02-29T00:00");
        assert_eq!(next("5,35 8-9 * * *", "2026-11-03T08:36:00Z"), "2026-11-03T09:05");
        assert_eq!(next("10/20 * * * *", "2026-11-03T10:00:00Z"), "2026-11-03T10:10");
        assert_eq!(next("10/20 * * * *", "2026-11-03T10:11:00Z"), "2026-11-03T10:30");
        // 7 is Sunday too
        assert_eq!(next("0 12 * * 7", "2026-11-03T10:00:00Z"), "2026-11-08T12:00");
        // both day fields restricted: either matches (the 15th, or a Monday)
        assert_eq!(next("0 0 15 * 1", "2026-11-03T10:00:00Z"), "2026-11-09T00:00");
        assert_eq!(next("0 0 15 * 1", "2026-11-10T10:00:00Z"), "2026-11-15T00:00");
        // the end of the year
        assert_eq!(next("59 23 31 12 *", "2026-12-31T23:59:00Z"), "2027-12-31T23:59");
    }

    #[test]
    fn never_fires() {
        assert!(Cron::parse("0 0 31 2 *").unwrap().next_after(at("2026-01-01T00:00:00Z")).is_none());
    }

    #[test]
    fn refuses_what_it_does_not_know() {
        for bad in [
            "",
            "* * * *",
            "* * * * * *",
            "0 0 * * MON",
            "0 0 * JAN *",
            "60 * * * *",
            "* 24 * * *",
            "* * 0 * *",
            "* * 32 * *",
            "* * * 13 *",
            "* * * * 8",
            "5-1 * * * *",
            "*/0 * * * *",
            "*/60 * * * *",
            "*/x * * * *",
            "1,,2 * * * *",
            "? * * * *",
            "L * * * *",
            "1-2-3 * * * *",
            "-1 * * * *",
            "001 * * * *",
            "0 0 1W * *",
            "*/5/2 * * * *",
        ] {
            assert!(Cron::parse(bad).is_err(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn smallest_gap() {
        let from = at("2026-11-03T10:00:00Z");
        let gap = |e: &str| Cron::parse(e).unwrap().min_gap_minutes(from, 10);
        assert_eq!(gap("*/5 * * * *"), Some(5));
        assert_eq!(gap("* * * * *"), Some(1));
        assert_eq!(gap("0,2 9 * * *"), Some(2));
        assert_eq!(gap("0 3 * * *"), Some(1440));
    }
}
