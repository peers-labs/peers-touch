package sandboxprov

import "testing"

func TestBoundedRingSequentialCursor(t *testing.T) {
	r := newBoundedRing(100)
	r.write([]byte("hello "))
	r.write([]byte("world"))

	got, next, truncated := r.read(0, 100)
	if string(got) != "hello world" || next != 11 || truncated {
		t.Fatalf("read=%q next=%d trunc=%v", got, next, truncated)
	}
	// Reading from the returned cursor yields nothing new.
	got, next, _ = r.read(next, 100)
	if len(got) != 0 || next != 11 {
		t.Fatalf("tail read=%q next=%d", got, next)
	}
	// Mid-stream paging.
	got, _, _ = r.read(6, 3)
	if string(got) != "wor" {
		t.Fatalf("page=%q", got)
	}
}

func TestBoundedRingDropsOldestAndSignalsGap(t *testing.T) {
	r := newBoundedRing(5)
	r.write([]byte("abcdefghij")) // keeps only "fghij", total=10, dropped=5

	got, next, truncated := r.read(0, 100)
	if !truncated {
		t.Fatalf("cursor older than window must signal truncation")
	}
	if string(got) != "fghij" || next != 10 {
		t.Fatalf("got=%q next=%d", got, next)
	}
	// Reading from the oldest retained offset is not a gap.
	got, _, truncated = r.read(5, 100)
	if string(got) != "fghij" || truncated {
		t.Fatalf("retained read got=%q trunc=%v", got, truncated)
	}
}

func TestBoundedRingHonorsMaxBytes(t *testing.T) {
	r := newBoundedRing(100)
	r.write([]byte("0123456789"))
	got, next, _ := r.read(0, 4)
	if string(got) != "0123" || next != 4 {
		t.Fatalf("got=%q next=%d", got, next)
	}
}

func TestShellQuote(t *testing.T) {
	cases := map[string]string{
		"ls":       "'ls'",
		"a'b":      "'a'\\''b'",
		"rm -rf /": "'rm -rf /'",
	}
	for in, want := range cases {
		if got := shellQuote(in); got != want {
			t.Fatalf("shellQuote(%q)=%q want %q", in, got, want)
		}
	}
}
