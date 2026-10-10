package storage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// s3Store keeps blobs in a bucket on any S3-compatible object store, one
// object per encrypted chunk: "<blob id>/<chunk number>". The bucket only ever
// receives ciphertext.
//
// A bucket may keep every version of an object, where a plain delete merely
// hides it, so everything here deletes by version id to make removal permanent.
type s3Store struct {
	endpoint, region, bucket, keyID, secret string
	// prefix is put in front of every key. Deployments sharing a bucket must
	// each have their own, or one's orphan sweep would delete the other's files.
	prefix string
	hc     *http.Client
}

const backupDir = "_backup/"

// S3Options name a bucket and the key that may use it.
type S3Options struct {
	Endpoint string // https://s3.<region>.example.com
	Region   string // the second label of the endpoint's host when empty
	Bucket   string
	KeyID    string
	Key      string
	Prefix   string // put in front of every object key
}

// NewS3 returns a Store backed by the bucket, after checking it can be reached.
func NewS3(o S3Options) (Store, error) {
	u, err := url.Parse(o.Endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return nil, errors.New("S3_ENDPOINT must be an https URL")
	}
	region := o.Region
	if region == "" {
		// s3.eu-central-1.example.com → eu-central-1
		parts := strings.Split(u.Hostname(), ".")
		if len(parts) < 4 || parts[0] != "s3" {
			return nil, errors.New("S3_REGION is needed unless S3_ENDPOINT looks like https://s3.<region>.example.com")
		}
		region = parts[1]
	}
	s := &s3Store{
		endpoint: o.Endpoint, region: region, bucket: o.Bucket, keyID: o.KeyID, secret: o.Key,
		prefix: o.Prefix,
		hc: &http.Client{Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			MaxIdleConnsPerHost:   32,
			IdleConnTimeout:       90 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
			TLSHandshakeTimeout:   15 * time.Second,
		}},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := s.list(ctx, url.Values{"max-keys": {"1"}}); err != nil {
		return nil, fmt.Errorf("s3: cannot reach bucket %q: %w", s.bucket, err)
	}
	return s, nil
}

// blobIDRe matches the ids blobs are stored under: 26 characters of Crockford base32.
var blobIDRe = regexp.MustCompile(`^[0-9a-hjkmnp-tv-z]{26}$`)

func sha(b []byte) []byte {
	s := sha256.Sum256(b)
	return s[:]
}

func hmacSHA(key, msg []byte) []byte {
	m := hmac.New(sha256.New, key)
	m.Write(msg)
	return m.Sum(nil)
}

func chunkKey(id string, n int64) string { return fmt.Sprintf("%s/%06d", id, n) }

type s3Error struct {
	Status  int
	Code    string `xml:"Code"`
	Message string `xml:"Message"`
}

func (e *s3Error) Error() string { return fmt.Sprintf("s3: %d %s: %s", e.Status, e.Code, e.Message) }

// do sends a signed request, retrying the transient failures object stores
// expect clients to ride out. The caller closes the response body.
func (s *s3Store) do(ctx context.Context, method, key string, query url.Values, body []byte) (*http.Response, error) {
	var last error
	for attempt := range 5 {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(attempt*attempt) * 300 * time.Millisecond):
			}
		}
		res, err := s.send(ctx, method, key, query, body)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			last = err
			continue
		}
		if res.StatusCode < 300 {
			return res, nil
		}
		se := &s3Error{Status: res.StatusCode}
		b, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		res.Body.Close()
		_ = xml.Unmarshal(b, se)
		last = se
		if res.StatusCode < 500 && res.StatusCode != http.StatusTooManyRequests && res.StatusCode != http.StatusRequestTimeout {
			return nil, se
		}
	}
	return nil, last
}

func (s *s3Store) send(ctx context.Context, method, key string, query url.Values, body []byte) (*http.Response, error) {
	path := "/" + s.bucket
	if key != "" {
		for seg := range strings.SplitSeq(key, "/") {
			path += "/" + url.PathEscape(seg)
		}
	}
	// SigV4 wants the query sorted and percent-encoded, with %20 for spaces.
	rawQuery := strings.ReplaceAll(query.Encode(), "+", "%20")
	target := s.endpoint + path
	if rawQuery != "" {
		target += "?" + rawQuery
	}
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	t := time.Now().UTC()
	stamp, day := t.Format("20060102T150405Z"), t.Format("20060102")
	sum := sha256.Sum256(body)
	payload := hex.EncodeToString(sum[:])
	req.Header.Set("X-Amz-Date", stamp)
	req.Header.Set("X-Amz-Content-Sha256", payload)

	const signed = "host;x-amz-content-sha256;x-amz-date"
	canonical := strings.Join([]string{
		method, path, rawQuery,
		"host:" + req.URL.Host, "x-amz-content-sha256:" + payload, "x-amz-date:" + stamp, "",
		signed, payload,
	}, "\n")
	scope := day + "/" + s.region + "/s3/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + stamp + "\n" + scope + "\n" + hex.EncodeToString(sha(([]byte)(canonical)))
	k := hmacSHA([]byte("AWS4"+s.secret), []byte(day))
	for _, part := range []string{s.region, "s3", "aws4_request"} {
		k = hmacSHA(k, []byte(part))
	}
	req.Header.Set("Authorization", fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		s.keyID, scope, signed, hex.EncodeToString(hmacSHA(k, []byte(toSign)))))
	return s.hc.Do(req)
}

func (s *s3Store) Put(ctx context.Context, id string, n, _ int64, data []byte) error {
	return s.putObject(ctx, s.prefix+chunkKey(id, n), data)
}

// putObject uploads data. Re-uploading a key (a retried chunk) leaves the old
// version behind; sweep removes those.
func (s *s3Store) putObject(ctx context.Context, key string, data []byte) error {
	res, err := s.do(ctx, http.MethodPut, key, nil, data)
	if err != nil {
		return err
	}
	return res.Body.Close()
}

func (s *s3Store) Get(ctx context.Context, id string, n, _, _ int64) (io.ReadCloser, error) {
	res, err := s.do(ctx, http.MethodGet, s.prefix+chunkKey(id, n), nil, nil)
	if err != nil {
		return nil, err
	}
	return res.Body, nil
}

func (s *s3Store) Remove(ctx context.Context, id string) error {
	return s.eachVersion(ctx, s.prefix+id+"/", func(v s3Version) error { return s.deleteVersion(ctx, v) })
}

func (s *s3Store) Sweep(ctx context.Context, keep func(id string) bool) error {
	known := map[string]bool{}
	return s.eachVersion(ctx, s.prefix, func(v s3Version) error {
		key := strings.TrimPrefix(v.Key, s.prefix)
		id, _, ok := strings.Cut(key, "/")
		// Only our own blobs: "<26-character id>/<chunk>" directly under the prefix.
		if !ok || !blobIDRe.MatchString(id) || time.Since(v.LastModified) < orphanAge {
			return nil
		}
		k, seen := known[id]
		if !seen {
			k = keep(id)
			known[id] = k
		}
		if k && v.IsLatest && !v.marker {
			return nil
		}
		return s.deleteVersion(ctx, v)
	})
}

func (s *s3Store) Backup(ctx context.Context, name, path string, keepN int) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	defer os.Remove(path)
	if err := s.putObject(ctx, s.prefix+backupDir+name, data); err != nil {
		return err
	}
	byName := map[string][]s3Version{}
	var names []string
	err = s.eachVersion(ctx, s.prefix+backupDir+BackupPrefix, func(v s3Version) error {
		// A second snapshot on the same day replaces the first.
		if !v.IsLatest || v.marker {
			return s.deleteVersion(ctx, v)
		}
		n := strings.TrimPrefix(v.Key, s.prefix+backupDir)
		if _, ok := byName[n]; !ok {
			names = append(names, n)
		}
		byName[n] = append(byName[n], v)
		return nil
	})
	if err != nil {
		return err
	}
	for _, old := range stale(names, keepN) {
		for _, v := range byName[old] {
			if err := s.deleteVersion(ctx, v); err != nil {
				return err
			}
		}
	}
	return nil
}

type s3Version struct {
	Key          string    `xml:"Key"`
	VersionID    string    `xml:"VersionId"`
	LastModified time.Time `xml:"LastModified"`
	IsLatest     bool      `xml:"IsLatest"`
	marker       bool      // a "hidden" marker left by a plain delete
}

type s3Versions struct {
	IsTruncated         bool        `xml:"IsTruncated"`
	NextKeyMarker       string      `xml:"NextKeyMarker"`
	NextVersionIDMarker string      `xml:"NextVersionIdMarker"`
	Versions            []s3Version `xml:"Version"`
	DeleteMarkers       []s3Version `xml:"DeleteMarker"`
}

func (s *s3Store) list(ctx context.Context, q url.Values) (*s3Versions, error) {
	q.Set("versions", "")
	res, err := s.do(ctx, http.MethodGet, "", q, nil)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var out s3Versions
	if err := xml.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	for i := range out.DeleteMarkers {
		out.DeleteMarkers[i].marker = true
	}
	return &out, nil
}

// eachVersion calls fn for every stored version (and hide marker) under prefix.
func (s *s3Store) eachVersion(ctx context.Context, prefix string, fn func(s3Version) error) error {
	q := url.Values{"max-keys": {"1000"}}
	if prefix != "" {
		q.Set("prefix", prefix)
	}
	for {
		page, err := s.list(ctx, q)
		if err != nil {
			return err
		}
		for _, v := range append(page.Versions, page.DeleteMarkers...) {
			if err := fn(v); err != nil {
				return err
			}
		}
		if !page.IsTruncated || page.NextKeyMarker == "" {
			return nil
		}
		q.Set("key-marker", page.NextKeyMarker)
		q.Set("version-id-marker", page.NextVersionIDMarker)
	}
}

func (s *s3Store) deleteVersion(ctx context.Context, v s3Version) error {
	res, err := s.do(ctx, http.MethodDelete, v.Key, url.Values{"versionId": {v.VersionID}}, nil)
	if err != nil {
		var se *s3Error
		if errors.As(err, &se) && se.Status == http.StatusNotFound {
			return nil
		}
		return err
	}
	res.Body.Close()
	return nil
}
