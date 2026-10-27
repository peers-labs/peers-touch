package service

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	scheduledKindCron     = "cron"
	scheduledKindInterval = "interval"
	scheduledKindOnce     = "once"

	minScheduledIntervalSec = int64(60)
	// Bound the minute scan so malformed-but-parseable expressions cannot
	// burn a full year of iterations on every sweep.
	maxCronProbeMinutes = 366 * 24 * 60
)

// jobSchedule computes the next due instant for a persisted ScheduledJob.
// All methods are deterministic and side-effect free so they can run both in
// the API path (next_due_at projection) and in the sweep worker.
type jobSchedule struct {
	kind     string
	cron     [5]cronField
	interval time.Duration
	runAt    time.Time
	location *time.Location
}

type cronField struct {
	allowed map[int]bool
	star    bool
}

func parseJobSchedule(kind, cronExpr string, intervalSec int64, runAtText, timezone string) (jobSchedule, error) {
	location := time.UTC
	if zone := strings.TrimSpace(timezone); zone != "" {
		loc, err := time.LoadLocation(zone)
		if err != nil {
			return jobSchedule{}, fmt.Errorf("invalid schedule timezone %q: %w", zone, err)
		}
		location = loc
	}
	schedule := jobSchedule{kind: strings.TrimSpace(kind), location: location}
	switch schedule.kind {
	case scheduledKindCron:
		fields, err := parseCronExpression(cronExpr)
		if err != nil {
			return jobSchedule{}, err
		}
		schedule.cron = fields
	case scheduledKindInterval:
		if intervalSec < minScheduledIntervalSec {
			return jobSchedule{}, fmt.Errorf("interval schedule must be at least %d seconds", minScheduledIntervalSec)
		}
		schedule.interval = time.Duration(intervalSec) * time.Second
	case scheduledKindOnce:
		runAt, err := time.Parse(time.RFC3339, strings.TrimSpace(runAtText))
		if err != nil {
			return jobSchedule{}, fmt.Errorf("once schedule requires an RFC3339 run_at: %w", err)
		}
		schedule.runAt = runAt.UTC()
	default:
		return jobSchedule{}, fmt.Errorf("unsupported schedule kind %q", schedule.kind)
	}
	return schedule, nil
}

// nextAfter returns the next due instant strictly after the reference.
// A zero time with retired=false semantics is represented by ok=false when
// the schedule can never fire again (a past one-shot).
func (s jobSchedule) nextAfter(after time.Time) (time.Time, bool, error) {
	switch s.kind {
	case scheduledKindInterval:
		return after.Add(s.interval).UTC(), true, nil
	case scheduledKindOnce:
		if !s.runAt.After(after) {
			return time.Time{}, false, nil
		}
		return s.runAt.UTC(), true, nil
	case scheduledKindCron:
		return s.nextCronAfter(after)
	default:
		return time.Time{}, false, fmt.Errorf("unsupported schedule kind %q", s.kind)
	}
}

func (s jobSchedule) nextCronAfter(after time.Time) (time.Time, bool, error) {
	// Start at the next whole minute in the schedule's wall clock.
	local := after.In(s.location)
	candidate := local.Truncate(time.Minute).Add(time.Minute)
	for offset := 0; offset < maxCronProbeMinutes; offset++ {
		if s.cronMatches(candidate) {
			return candidate.UTC(), true, nil
		}
		candidate = candidate.Add(time.Minute)
	}
	return time.Time{}, false, fmt.Errorf("cron schedule has no occurrence within one year")
}

func (s jobSchedule) cronMatches(t time.Time) bool {
	if !s.cron[0].matches(t.Minute()) ||
		!s.cron[1].matches(t.Hour()) ||
		!s.cron[3].matches(int(t.Month())) {
		return false
	}
	// Standard cron OR rule: when both day-of-month and day-of-week are
	// restricted, a day matches when EITHER field matches.
	dom := s.cron[2]
	dow := s.cron[4]
	switch {
	case dom.star && dow.star:
		return true
	case dom.star:
		return dow.matches(int(t.Weekday()))
	case dow.star:
		return dom.matches(t.Day())
	default:
		return dom.matches(t.Day()) || dow.matches(int(t.Weekday()))
	}
}

func parseCronExpression(expr string) ([5]cronField, error) {
	var parsed [5]cronField
	parts := strings.Fields(strings.TrimSpace(expr))
	if len(parts) != 5 {
		return parsed, fmt.Errorf("cron expression must contain exactly 5 fields")
	}
	bounds := [][2]int{{0, 59}, {0, 23}, {1, 31}, {1, 12}, {0, 7}}
	for index, part := range parts {
		field, err := parseCronField(part, bounds[index][0], bounds[index][1])
		if err != nil {
			return parsed, fmt.Errorf("cron field %d (%q): %w", index+1, part, err)
		}
		parsed[index] = field
	}
	return parsed, nil
}

func parseCronField(value string, min, max int) (cronField, error) {
	field := cronField{allowed: map[int]bool{}}
	for _, term := range strings.Split(value, ",") {
		step := 1
		rangePart := term
		if slash := strings.Index(term, "/"); slash >= 0 {
			parsed, err := strconv.Atoi(term[slash+1:])
			if err != nil || parsed <= 0 {
				return field, fmt.Errorf("step must be a positive integer")
			}
			step = parsed
			rangePart = term[:slash]
		}
		low, high := min, max
		switch {
		case rangePart == "*" || rangePart == "":
			if step == 1 {
				field.star = true
			}
		case strings.Contains(rangePart, "-"):
			bounds := strings.SplitN(rangePart, "-", 2)
			var err error
			low, err = strconv.Atoi(bounds[0])
			if err != nil {
				return field, fmt.Errorf("invalid range start")
			}
			high, err = strconv.Atoi(bounds[1])
			if err != nil {
				return field, fmt.Errorf("invalid range end")
			}
		default:
			value, err := strconv.Atoi(rangePart)
			if err != nil {
				return field, fmt.Errorf("value must be numeric or *")
			}
			low, high = value, value
		}
		if low < min || high > max || low > high {
			return field, fmt.Errorf("value %d-%d outside allowed range %d-%d", low, high, min, max)
		}
		for value := low; value <= high; value += step {
			// Day-of-week field accepts 7 as Sunday alias.
			if min == 0 && max == 7 && value == 7 {
				field.allowed[0] = true
				continue
			}
			field.allowed[value] = true
		}
	}
	return field, nil
}

func (f cronField) matches(value int) bool {
	if f.star {
		return true
	}
	return f.allowed[value]
}
