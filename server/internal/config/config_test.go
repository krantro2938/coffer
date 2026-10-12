package config

import "testing"

func TestAnalytics(t *testing.T) {
	const id = "0c1d3e5f-1a2b-4c3d-8e9f-0123456789ab"
	ok := map[string]string{
		"https://stats.example.com":      "https://stats.example.com",
		"https://stats.example.com/":     "https://stats.example.com",
		"http://localhost:3999":          "http://localhost:3999",
		"https://stats.example.com:8443": "https://stats.example.com:8443",
	}
	for in, want := range ok {
		got, gotID, err := Analytics(in, id)
		if err != nil || got != want || gotID != id {
			t.Errorf("%q: %q %q %v", in, got, gotID, err)
		}
	}
	for _, in := range []string{
		"", "stats.example.com", "ftp://stats.example.com", "https://", "https://user:pw@stats.example.com",
		"https://stats.example.com/umami", "https://stats.example.com?x=1", "https://stats.example.com#x",
		"https://stats.example.com; script-src *", "https://stats.example.com 'unsafe-inline'", "https://a.example.com,https://b.example.com",
	} {
		if got, _, err := Analytics(in, id); err == nil {
			t.Errorf("%q was accepted as %q", in, got)
		}
	}
	for _, bad := range []string{"", "not-a-uuid", id + "x"} {
		if _, _, err := Analytics("https://stats.example.com", bad); err == nil {
			t.Errorf("site id %q was accepted", bad)
		}
	}
}
