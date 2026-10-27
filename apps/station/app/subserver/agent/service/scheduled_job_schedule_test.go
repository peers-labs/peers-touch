package service

import (
	"testing"
	"time"
)

func utcSchedule(t *testing.T, kind, expr string, interval int64, runAt string) jobSchedule {
	t.Helper()
	schedule, err := parseJobSchedule(kind, expr, interval, runAt, "UTC")
	if err != nil {
		t.Fatalf("parse schedule: %v", err)
	}
	return schedule
}

func mustRFC3339(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("parse %q: %v", value, err)
	}
	return parsed
}

func TestCronNextOccurrenceIsDeterministic(t *testing.T) {
	schedule := utcSchedule(t, scheduledKindCron, "30 9 * * 1-5", 0, "")
	after := mustRFC3339(t, "2026-10-25T12:00:00Z") // Sunday
	next, ok, err := schedule.nextAfter(after)
	if err != nil || !ok {
		t.Fatalf("next weekday 09:30: ok=%v err=%v", ok, err)
	}
	want := mustRFC3339(t, "2026-10-26T09:30:00Z") // Monday
	if !next.Equal(want) {
		t.Fatalf("weekday cron next = %s, want %s", next, want)
	}
}

func TestCronStepsAndSundayAlias(t *testing.T) {
	cases := []struct {
		name string
		expr string
		at   time.Time
		want time.Time
	}{
		{
			name: "fifteen minute steps",
			expr: "*/15 * * * *",
			at:   mustRFC3339(t, "2026-10-25T10:07:00Z"),
			want: mustRFC3339(t, "2026-10-25T10:15:00Z"),
		},
		{
			name: "day seven means Sunday",
			expr: "0 0 * * 7",
			at:   mustRFC3339(t, "2026-10-25T12:00:00Z"), // Sunday noon
			want: mustRFC3339(t, "2026-11-01T00:00:00Z"), // next Sunday
		},
		{
			name: "month day list",
			expr: "0 0 1,15 * *",
			at:   mustRFC3339(t, "2026-10-16T00:00:00Z"),
			want: mustRFC3339(t, "2026-11-01T00:00:00Z"),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			schedule := utcSchedule(t, scheduledKindCron, tc.expr, 0, "")
			next, ok, err := schedule.nextAfter(tc.at)
			if err != nil || !ok {
				t.Fatalf("next occurrence: ok=%v err=%v", ok, err)
			}
			if !next.Equal(tc.want) {
				t.Fatalf("next = %s, want %s", next, tc.want)
			}
		})
	}
}

func TestCronDomDowOrRule(t *testing.T) {
	// 2026-10-26 is Monday. dom=15 OR Monday => Monday 26th fires even
	// though its day-of-month is not 15.
	schedule := utcSchedule(t, scheduledKindCron, "0 10 15 * 1", 0, "")
	next, ok, err := schedule.nextAfter(mustRFC3339(t, "2026-10-25T00:00:00Z"))
	if err != nil || !ok {
		t.Fatalf("next occurrence: ok=%v err=%v", ok, err)
	}
	want := mustRFC3339(t, "2026-10-26T10:00:00Z")
	if !next.Equal(want) {
		t.Fatalf("OR-rule next = %s, want %s", next, want)
	}
}

func TestCronTimezoneUsesWallClock(t *testing.T) {
	// Asia/Shanghai is UTC+8 with no DST: 09:00 local is 01:00 UTC.
	schedule, err := parseJobSchedule(scheduledKindCron, "0 9 * * *", 0, "", "Asia/Shanghai")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	next, ok, err := schedule.nextAfter(mustRFC3339(t, "2026-10-25T02:00:00+08:00"))
	if err != nil || !ok {
		t.Fatalf("next occurrence: ok=%v err=%v", ok, err)
	}
	want := mustRFC3339(t, "2026-10-25T09:00:00+08:00")
	if !next.Equal(want) {
		t.Fatalf("timezone next = %s, want %s", next, want)
	}
}

func TestIntervalScheduleAdvancesByFixedGap(t *testing.T) {
	schedule := utcSchedule(t, scheduledKindInterval, "", 900, "")
	after := mustRFC3339(t, "2026-10-25T10:00:00Z")
	next, ok, err := schedule.nextAfter(after)
	if err != nil || !ok {
		t.Fatalf("next interval: ok=%v err=%v", ok, err)
	}
	if want := after.Add(15 * time.Minute); !next.Equal(want) {
		t.Fatalf("interval next = %s, want %s", next, want)
	}
}

func TestIntervalBelowOneMinuteRejected(t *testing.T) {
	if _, err := parseJobSchedule(scheduledKindInterval, "", 59, "", "UTC"); err == nil {
		t.Fatal("expected sub-minute interval rejection")
	}
}

func TestOnceScheduleFiresOnceAndThenRetires(t *testing.T) {
	runAt := "2026-10-25T18:00:00Z"
	schedule := utcSchedule(t, scheduledKindOnce, "", 0, runAt)
	next, ok, err := schedule.nextAfter(mustRFC3339(t, "2026-10-25T17:00:00Z"))
	if err != nil || !ok || !next.Equal(mustRFC3339(t, runAt)) {
		t.Fatalf("once next = %s ok=%v err=%v", next, ok, err)
	}
	if _, ok, err := schedule.nextAfter(mustRFC3339(t, "2026-10-25T19:00:00Z")); err != nil || ok {
		t.Fatalf("past once must retire: ok=%v err=%v", ok, err)
	}
}

func TestInvalidCronRejected(t *testing.T) {
	for _, expr := range []string{"", "* *", "60 * * * *", "* * * *", "0 0 32 * *"} {
		if _, err := parseJobSchedule(scheduledKindCron, expr, 0, "", "UTC"); err == nil {
			t.Fatalf("expected rejection for %q", expr)
		}
	}
}
