package sandboxprov

// boundedBuffer is an io.Writer that retains at most limit bytes and reports
// whether overflow occurred. It keeps the first limit bytes (head) so a user
// sees the start of a failing command; tail capture is intentionally not
// attempted in phase 1.
type boundedBuffer struct {
	buf       []byte
	limit     int
	truncated bool
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	remaining := b.limit - len(b.buf)
	if remaining > 0 {
		take := p
		if len(p) > remaining {
			take = p[:remaining]
		}
		b.buf = append(b.buf, take...)
	}
	if len(p) > remaining {
		b.truncated = true
	}
	// Always report the full slice as consumed so the process is not blocked
	// by a short write.
	return len(p), nil
}

func (b *boundedBuffer) bytes() []byte { return b.buf }
