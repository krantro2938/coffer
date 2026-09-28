package main

import (
	"sync"
	"time"
)

// limiter is a fixed-window counter keyed by an arbitrary string (IP, email, share id).
type limiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	buckets map[string]*bucket
}

type bucket struct {
	count int
	reset time.Time
}

func newLimiter(limit int, window time.Duration) *limiter {
	l := &limiter{limit: limit, window: window, buckets: map[string]*bucket{}}
	go func() {
		for range time.Tick(time.Minute) {
			l.mu.Lock()
			t := time.Now()
			for k, b := range l.buckets {
				if t.After(b.reset) {
					delete(l.buckets, k)
				}
			}
			l.mu.Unlock()
		}
	}()
	return l
}

// allow records a hit and reports whether the key is still under its limit.
func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.get(key)
	b.count++
	return b.count <= l.limit
}

// blocked reports whether the key is over its limit without recording a hit.
func (l *limiter) blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.get(key).count >= l.limit
}

func (l *limiter) get(key string) *bucket {
	t := time.Now()
	b, ok := l.buckets[key]
	if !ok || t.After(b.reset) {
		b = &bucket{reset: t.Add(l.window)}
		l.buckets[key] = b
	}
	return b
}
