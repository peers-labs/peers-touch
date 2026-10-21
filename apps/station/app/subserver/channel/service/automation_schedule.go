package service

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const defaultAutomationMissedWindow = 15 * time.Minute

type automationScheduleSpec struct {
	Kind                string `json:"kind"`
	IntervalSeconds     int64  `json:"interval_seconds,omitempty"`
	Time                string `json:"time,omitempty"`
	Weekdays            []int  `json:"weekdays,omitempty"`
	Timezone            string `json:"timezone,omitempty"`
	At                  string `json:"at,omitempty"`
	MissedWindowSeconds int64  `json:"missed_window_seconds,omitempty"`
}

var naturalSchedulePattern = regexp.MustCompile(
	`^(?:every|each)\s+(day|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+at\s+([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm)?$`,
)

func parseAutomationSchedule(
	value string,
	now time.Time,
) (automationScheduleSpec, time.Time, time.Duration, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return automationScheduleSpec{}, time.Time{}, 0, fmt.Errorf("schedule is required")
	}
	var spec automationScheduleSpec
	if strings.HasPrefix(value, "{") {
		if err := json.Unmarshal([]byte(value), &spec); err != nil {
			return automationScheduleSpec{}, time.Time{}, 0, fmt.Errorf("decode schedule: %w", err)
		}
	} else {
		var err error
		spec, err = parseNaturalAutomationSchedule(value)
		if err != nil {
			return automationScheduleSpec{}, time.Time{}, 0, err
		}
	}
	if spec.Timezone == "" {
		spec.Timezone = "UTC"
	}
	window := defaultAutomationMissedWindow
	if spec.MissedWindowSeconds > 0 {
		window = time.Duration(spec.MissedWindowSeconds) * time.Second
	}
	next, err := spec.nextAfter(now)
	if err != nil {
		return automationScheduleSpec{}, time.Time{}, 0, err
	}
	if next.IsZero() {
		return automationScheduleSpec{}, time.Time{}, 0, fmt.Errorf("schedule has no future occurrence")
	}
	return spec, next.UTC(), window, nil
}

func parseNaturalAutomationSchedule(value string) (automationScheduleSpec, error) {
	normalized := strings.ToLower(strings.Join(strings.Fields(value), " "))
	if strings.HasPrefix(normalized, "every ") {
		if interval, err := time.ParseDuration(strings.TrimSpace(strings.TrimPrefix(normalized, "every "))); err == nil {
			if interval < time.Minute {
				return automationScheduleSpec{}, fmt.Errorf("schedule interval must be at least one minute")
			}
			return automationScheduleSpec{
				Kind: "interval", IntervalSeconds: int64(interval.Seconds()), Timezone: "UTC",
			}, nil
		}
	}
	if strings.HasPrefix(normalized, "daily at ") {
		normalized = "every day at " + strings.TrimPrefix(normalized, "daily at ")
	}
	if matches := naturalSchedulePattern.FindStringSubmatch(normalized); matches != nil {
		hour, minute, err := parseClock(matches[2], matches[3], matches[4])
		if err != nil {
			return automationScheduleSpec{}, err
		}
		spec := automationScheduleSpec{
			Kind: "daily", Time: fmt.Sprintf("%02d:%02d", hour, minute), Timezone: "UTC",
		}
		if matches[1] != "day" {
			spec.Kind = "weekly"
			spec.Weekdays = []int{weekdayNumber(matches[1])}
		}
		return spec, nil
	}
	if at, err := time.Parse(time.RFC3339, value); err == nil {
		return automationScheduleSpec{Kind: "once", At: at.UTC().Format(time.RFC3339), Timezone: "UTC"}, nil
	}
	return automationScheduleSpec{}, fmt.Errorf(
		"unsupported schedule; use a structured schedule, RFC3339, \"every 30m\", or \"every Friday at 5 PM\"",
	)
}

func parseClock(hourText, minuteText, meridiem string) (int, int, error) {
	parts := strings.Split(strings.TrimSpace(hourText), ":")
	if len(parts) == 2 && minuteText == "" {
		hourText, minuteText = parts[0], parts[1]
	}
	hour, err := strconv.Atoi(hourText)
	if err != nil {
		return 0, 0, fmt.Errorf("invalid schedule hour")
	}
	minute := 0
	if minuteText != "" {
		minute, err = strconv.Atoi(minuteText)
		if err != nil {
			return 0, 0, fmt.Errorf("invalid schedule minute")
		}
	}
	if minute < 0 || minute > 59 {
		return 0, 0, fmt.Errorf("invalid schedule minute")
	}
	switch meridiem {
	case "am":
		if hour < 1 || hour > 12 {
			return 0, 0, fmt.Errorf("invalid 12-hour schedule time")
		}
		if hour == 12 {
			hour = 0
		}
	case "pm":
		if hour < 1 || hour > 12 {
			return 0, 0, fmt.Errorf("invalid 12-hour schedule time")
		}
		if hour != 12 {
			hour += 12
		}
	default:
		if hour < 0 || hour > 23 {
			return 0, 0, fmt.Errorf("invalid 24-hour schedule time")
		}
	}
	return hour, minute, nil
}

func weekdayNumber(value string) int {
	for index, name := range []string{
		"sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
	} {
		if value == name {
			return index
		}
	}
	return -1
}

func (s automationScheduleSpec) nextAfter(after time.Time) (time.Time, error) {
	location, err := time.LoadLocation(firstNonEmpty(strings.TrimSpace(s.Timezone), "UTC"))
	if err != nil {
		return time.Time{}, fmt.Errorf("load schedule timezone: %w", err)
	}
	switch strings.ToLower(strings.TrimSpace(s.Kind)) {
	case "interval":
		interval := time.Duration(s.IntervalSeconds) * time.Second
		if interval < time.Minute {
			return time.Time{}, fmt.Errorf("schedule interval must be at least one minute")
		}
		return after.Add(interval), nil
	case "once":
		at, err := time.Parse(time.RFC3339, strings.TrimSpace(s.At))
		if err != nil {
			return time.Time{}, fmt.Errorf("parse one-time schedule: %w", err)
		}
		if !at.After(after) {
			return time.Time{}, nil
		}
		return at, nil
	case "daily", "weekly":
		hour, minute, err := parseClock(strings.TrimSpace(s.Time), "", "")
		if err != nil {
			return time.Time{}, err
		}
		localAfter := after.In(location)
		allowed := map[int]bool{}
		if s.Kind == "weekly" {
			for _, weekday := range s.Weekdays {
				if weekday < 0 || weekday > 6 {
					return time.Time{}, fmt.Errorf("invalid schedule weekday %d", weekday)
				}
				allowed[weekday] = true
			}
			if len(allowed) == 0 {
				return time.Time{}, fmt.Errorf("weekly schedule requires at least one weekday")
			}
		}
		for offset := 0; offset <= 8; offset++ {
			day := localAfter.AddDate(0, 0, offset)
			if s.Kind == "weekly" && !allowed[int(day.Weekday())] {
				continue
			}
			candidate := time.Date(
				day.Year(), day.Month(), day.Day(), hour, minute, 0, 0, location,
			)
			if candidate.After(localAfter) {
				return candidate, nil
			}
		}
		return time.Time{}, fmt.Errorf("schedule has no next occurrence")
	default:
		return time.Time{}, fmt.Errorf("unsupported schedule kind %q", s.Kind)
	}
}

func nextScheduleAfterNow(
	spec automationScheduleSpec,
	previous, now time.Time,
) (time.Time, error) {
	next, err := spec.nextAfter(previous)
	for err == nil && !next.IsZero() && !next.After(now) {
		next, err = spec.nextAfter(next)
	}
	return next.UTC(), err
}
