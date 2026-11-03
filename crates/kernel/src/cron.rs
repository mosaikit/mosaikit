//! A small cron parser for schedules (see `schedules.rs`): five fields, evaluated in a time zone.
//!
//! `minute hour day-of-month month day-of-week`, each one `*`, a number, a range `a-b`, a list
//! `a,b,c` of those, or a step `*/n`, `a-b/n`, `a/n`. No names (`MON`, `JAN`), no `L`, `W`, `#`, `?`
//! and no seconds. Day of week is 0-6 (Sunday is 0; 7 is read as 0). As in classic cron, when both the
//! day of month and the day of week are restricted a day matches when EITHER does.
//!
//! The grammar has no dependency on purpose (a crate for it is a supply-chain cost the kernel does not
//! need); the time zone rules come from `chrono-tz` (the IANA database).
//!
//! **Time zones.** The fields are wall-clock times of the zone of the schedule (`next_after_in`); `next_after`
//! is the same in UTC. Daylight saving time is resolved the same way every time:
//! - a wall time that does not exist (the hour skipped when the clocks go forward) fires once, at the first
//!   instant after the gap (02:30 on a night that jumps from 02:00 to 03:00 fires at 03:00);
//! - a wall time that happens twice (the hour repeated when the clocks go back) fires once, at its FIRST
//!   occurrence; the second pass of that hour fires nothing;
//! - a result is never at or before `from`, and two consecutive fire times are never the same instant.

use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;

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

    /// The first wall-clock minute at or after `t` that matches the expression (no zone involved).
    fn first_match(&self, from_year: i32, mut t: NaiveDateTime) -> Option<NaiveDateTime> {
        let limit = from_year + 8;
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
                return Some(t);
            }
        }
        None
    }

    /// The first fire time strictly after `from` (UTC, whole minutes); `None` when the expression never
    /// fires in the next eight years (e.g. 31 February).
    pub fn next_after(&self, from: DateTime<Utc>) -> Option<DateTime<Utc>> {
        self.next_after_in(from, chrono_tz::UTC)
    }

    /// Like `next_after`, with the fields read as wall-clock times of `tz` (rules of daylight saving time
    /// in the header of this module).
    pub fn next_after_in(&self, from: DateTime<Utc>, tz: Tz) -> Option<DateTime<Utc>> {
        let local = from.with_timezone(&tz).naive_local();
        let mut t = local.with_second(0)?.with_nanosecond(0)? + Duration::minutes(1);
        // every pass moves forward by at least a minute; a few passes are enough (a gap, a repeated hour)
        for _ in 0..1000 {
            let n = self.first_match(local.year(), t)?;
            let at = match tz.from_local_datetime(&n) {
                LocalResult::Single(x) => Some(x.with_timezone(&Utc)),
                LocalResult::Ambiguous(first, _) => Some(first.with_timezone(&Utc)),
                // the wall time is in the gap: the first instant that exists after it
                LocalResult::None => {
                    let mut m = n;
                    let mut found = None;
                    for _ in 0..(24 * 60) {
                        m += Duration::minutes(1);
                        if let LocalResult::Single(x) | LocalResult::Ambiguous(x, _) =
                            tz.from_local_datetime(&m)
                        {
                            found = Some(x.with_timezone(&Utc));
                            break;
                        }
                    }
                    found
                }
            };
            match at {
                Some(x) if x > from => return Some(x),
                _ => t = n + Duration::minutes(1),
            }
        }
        None
    }

    /// The smallest gap, in minutes, between the next `count` fire times after `from`; `None` when the
    /// expression fires fewer than two times.
    pub fn min_gap_minutes(&self, from: DateTime<Utc>, count: usize) -> Option<i64> {
        self.min_gap_minutes_in(from, count, chrono_tz::UTC)
    }

    /// Like `min_gap_minutes`, in the time zone `tz`.
    pub fn min_gap_minutes_in(&self, from: DateTime<Utc>, count: usize, tz: Tz) -> Option<i64> {
        let mut prev = self.next_after_in(from, tz)?;
        let mut gap: Option<i64> = None;
        for _ in 1..count {
            let Some(next) = self.next_after_in(prev, tz) else { break };
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

    fn next_in(expr: &str, zone: &str, from: &str) -> String {
        let tz: Tz = zone.parse().unwrap();
        Cron::parse(expr).unwrap().next_after_in(at(from), tz).unwrap().format("%Y-%m-%dT%H:%MZ").to_string()
    }

    #[test]
    fn fields_are_wall_clock_times_of_the_zone() {
        // Rome is UTC+1 in winter, UTC+2 in summer
        assert_eq!(next_in("0 3 * * *", "Europe/Rome", "2026-01-10T12:00:00Z"), "2026-01-11T02:00Z");
        assert_eq!(next_in("0 3 * * *", "Europe/Rome", "2026-07-10T12:00:00Z"), "2026-07-11T01:00Z");
        assert_eq!(next_in("0 3 * * *", "UTC", "2026-07-10T12:00:00Z"), "2026-07-11T03:00Z");
        // the day of the week is the local one: 23:30 Sunday UTC is already Monday in Rome
        assert_eq!(next_in("0 8 * * 1", "Europe/Rome", "2026-11-01T23:30:00Z"), "2026-11-02T07:00Z");
    }

    #[test]
    fn a_wall_time_in_the_spring_gap_fires_once_after_the_gap() {
        // 2026-03-29 in Rome: 02:00 -> 03:00 (UTC+1 -> UTC+2); 02:30 does not exist
        assert_eq!(next_in("30 2 * * *", "Europe/Rome", "2026-03-28T12:00:00Z"), "2026-03-29T01:00Z");
        // the next day it is 02:30 local again (00:30Z)
        assert_eq!(next_in("30 2 * * *", "Europe/Rome", "2026-03-29T01:00:00Z"), "2026-03-30T00:30Z");
        // every 30 minutes across the gap: 00:30Z is 01:30 local, 01:00Z is 03:00 local, and nothing twice
        let c = Cron::parse("*/30 * * * *").unwrap();
        let tz: Tz = "Europe/Rome".parse().unwrap();
        let mut t = at("2026-03-29T00:00:00Z");
        let mut seen = Vec::new();
        for _ in 0..4 {
            t = c.next_after_in(t, tz).unwrap();
            seen.push(t.format("%H:%MZ").to_string());
        }
        assert_eq!(seen, ["00:30Z", "01:00Z", "01:30Z", "02:00Z"]);
    }

    #[test]
    fn a_wall_time_in_the_autumn_overlap_fires_once_at_its_first_occurrence() {
        // 2026-10-25 in Rome: 03:00 -> 02:00 (UTC+2 -> UTC+1); 02:30 happens at 00:30Z and at 01:30Z
        assert_eq!(next_in("30 2 * * *", "Europe/Rome", "2026-10-24T12:00:00Z"), "2026-10-25T00:30Z");
        // asked again after the first one, even during the second pass: the next day (02:30 CET = 01:30Z)
        assert_eq!(next_in("30 2 * * *", "Europe/Rome", "2026-10-25T00:30:00Z"), "2026-10-26T01:30Z");
        assert_eq!(next_in("30 2 * * *", "Europe/Rome", "2026-10-25T01:10:00Z"), "2026-10-26T01:30Z");
    }

    #[test]
    fn gap_between_runs_is_measured_in_the_zone() {
        let from = at("2026-11-03T10:00:00Z");
        let tz: Tz = "America/New_York".parse().unwrap();
        assert_eq!(Cron::parse("0 3 * * *").unwrap().min_gap_minutes_in(from, 10, tz), Some(1440));
    }
}
