package app

import (
	"bytes"
	"encoding/json"
	"html"
	"net/http"
	"regexp"
	"strings"
)

// What a search engine or a link preview is told about each page. The web
// app is a single shell that draws itself with JavaScript, so without this
// every address would look the same from outside: one title, no preview.
//
// The titles and descriptions here are repeated in the routes' own `head` in
// web/src/routes, which is what a browser shows once the app has loaded.
// Keep the two in step.

type pageMeta struct{ title, description string }

// publicPages are the pages worth finding. Every other address is someone's
// link or someone's drive, and is marked as not to be indexed.
var publicPages = map[string]pageMeta{
	"/": {
		homeTitle,
		homeDescription,
	},
	"/security": {
		"Security model — Coffer",
		"How Coffer keeps your files unreadable to its own server: what is encrypted, how links carry their keys, and where the protection stops.",
	},
	"/receive": {
		"Receive a share — Coffer",
		"Open something that was shared with you through Coffer by typing its short code. It is decrypted in your browser.",
	},
	"/register": {
		"Create your free drive — Coffer",
		"A free end-to-end encrypted drive for collecting and sending documents: upload links for your clients, share links that expire. Your password never leaves your device.",
	},
	"/login": {
		"Sign in — Coffer",
		"Unlock your encrypted Coffer drive.",
	},
	"/terms": {
		"Terms of service — Coffer",
		"The terms on which Coffer is offered.",
	},
	"/privacy": {
		"Privacy policy — Coffer",
		"What Coffer knows about you, what it cannot know, and who else is involved.",
	},
	"/dpa": {
		"Data processing agreement — Coffer",
		"The GDPR data processing agreement for businesses that collect personal data from their clients through Coffer. It applies automatically.",
	},
}

// The home page's title and description, also the shell's default (web/src/routes/__root.tsx).
const (
	homeTitle       = "Coffer — collect documents from clients, end-to-end encrypted"
	homeDescription = "Send clients an upload link. Files are encrypted in their browser before upload, so only you can open them. No account for your clients, open source, free to start."
)

// ogImage is the link preview's address. X and other sites keep their own copy
// of a preview under its address, so change the version whenever og.png changes.
const ogImage = "/og.png?v=2"

// structuredData tells search engines what Coffer is, for the home page.
const structuredData = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[` +
	`{"@type":"WebSite","name":"Coffer","url":"ORIGIN/"},` +
	`{"@type":"SoftwareApplication","name":"Coffer","url":"ORIGIN/","applicationCategory":"BusinessApplication","operatingSystem":"Any (web browser)",` +
	`"description":"DESCRIPTION","image":"ORIGIN` + ogImage + `","isAccessibleForFree":true,` +
	`"offers":{"@type":"Offer","price":"0","priceCurrency":"EUR","description":"Free account: 300 MB, upload links and share links"},` +
	`"license":"https://www.gnu.org/licenses/agpl-3.0.html","codeRepository":"https://github.com/krantro2938/coffer"}]}</script>`

// sitemapOrder lists the public pages in the order a sitemap should give them.
var sitemapOrder = []string{"/", "/security", "/receive", "/register", "/login", "/terms", "/privacy", "/dpa"}

// noscriptHome is the home page in plain words, for readers that do not run
// JavaScript: some crawlers, and every link-preview scraper.
const noscriptHome = `<noscript><main style="max-width:40rem;margin:3rem auto;padding:0 1rem;font-family:system-ui,sans-serif;line-height:1.6">
<h1>Collect documents from clients. Encrypted on their device, before upload.</h1>
<p>Coffer is an end-to-end encrypted way to request, send and keep files. Send a link, and your client uploads from any browser with no account. Files are encrypted in their browser with AES-256-GCM before they leave it, so the server stores only ciphertext: it cannot read a file or its name. It does see how large a file is and when it arrived.</p>
<h2>Request files</h2>
<p>Make an upload link, say what you need and by when, and set how many files it takes and when it closes. Your client opens it and drops their files in. The link can only upload: it cannot read, list or delete anything. For accountants collecting statements and IDs, lawyers collecting case documents, recruiters collecting CVs, landlords collecting applications, and teachers collecting coursework by a deadline.</p>
<h2>Send files</h2>
<p>Drop files or paste a note and get a link. Whoever opens it needs no account and installs nothing. Links can expire, burn after a number of views, carry a password, and be revoked.</p>
<h2>Keep a drive</h2>
<p>Encrypted folders and notes, and a list of every link you have shared. Start free with 300 MB; paid plans from 100 GB. Servers in Germany, encrypted files stored in the EU.</p>
<h2>Open source</h2>
<p>Coffer is free software under the AGPL and runs as a single container. <a href="https://github.com/krantro2938/coffer">Source on GitHub</a>. Read the <a href="/security">security model</a>, the <a href="/terms">terms</a>, the <a href="/privacy">privacy policy</a> and the <a href="/dpa">data processing agreement</a>.</p>
<p>Coffer needs JavaScript to encrypt and decrypt in your browser.</p>
</main></noscript>`

var (
	titleRe = regexp.MustCompile(`<title>[^<]*</title>`)
	descRe  = regexp.MustCompile(`<meta name="description" content="[^"]*"\s*/?>`)
	bodyRe  = regexp.MustCompile(`<body[^>]*>`)
)

// page returns the shell as it should be sent for a path: with that page's
// title and description and what a link preview needs, or marked as not to
// be indexed. origin is the site's address, e.g. https://coffer.example.
func (s *staticHandler) page(path, origin string) []byte {
	meta, public := publicPages[path]
	out := s.shell
	var head strings.Builder
	if public {
		t, d := html.EscapeString(meta.title), html.EscapeString(meta.description)
		url := html.EscapeString(origin + path)
		out = titleRe.ReplaceAllLiteral(out, []byte("<title>"+t+"</title>"))
		out = descRe.ReplaceAllLiteral(out, []byte(`<meta name="description" content="`+d+`"/>`))
		head.WriteString(`<link rel="canonical" href="` + url + `"/>`)
		head.WriteString(`<meta property="og:type" content="website"/><meta property="og:site_name" content="Coffer"/><meta property="og:locale" content="en_US"/>`)
		head.WriteString(`<meta property="og:title" content="` + t + `"/><meta property="og:description" content="` + d + `"/>`)
		head.WriteString(`<meta property="og:url" content="` + url + `"/>`)
		head.WriteString(`<meta property="og:image" content="` + html.EscapeString(origin+ogImage) + `"/>`)
		head.WriteString(`<meta property="og:image:width" content="1200"/><meta property="og:image:height" content="630"/>`)
		head.WriteString(`<meta property="og:image:alt" content="Coffer: collect documents from clients, encrypted on their device before upload."/>`)
		head.WriteString(`<meta name="twitter:card" content="summary_large_image"/>`)
		head.WriteString(`<meta name="twitter:title" content="` + t + `"/><meta name="twitter:description" content="` + d + `"/>`)
		head.WriteString(`<meta name="twitter:image" content="` + html.EscapeString(origin+ogImage) + `"/>`)
		if path == "/" {
			ld := strings.NewReplacer("ORIGIN", jsonString(origin), "DESCRIPTION", jsonString(meta.description)).Replace(structuredData)
			head.WriteString(ld)
		}
	} else {
		head.WriteString(`<meta name="robots" content="noindex, nofollow"/>`)
	}
	out = bytes.Replace(out, []byte("</head>"), []byte(head.String()+"</head>"), 1)
	if path == "/" {
		if loc := bodyRe.FindIndex(out); loc != nil {
			out = append(out[:loc[1]:loc[1]], append([]byte(noscriptHome), out[loc[1]:]...)...)
		}
	}
	return out
}

// robots tells crawlers which addresses are pages and which are not theirs.
func (s *staticHandler) robots(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write([]byte(`User-agent: *
Disallow: /api/
Disallow: /s/
Disallow: /r/
Disallow: /drive
Disallow: /links
Disallow: /share
Disallow: /requests
Disallow: /settings
Disallow: /welcome
Disallow: /recover
Disallow: /admin
Disallow: /pay

Sitemap: ` + s.origin(r) + `/sitemap.xml
`))
}

func (s *staticHandler) sitemap(w http.ResponseWriter, r *http.Request) {
	origin := s.origin(r)
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n" + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
	for _, p := range sitemapOrder {
		b.WriteString("  <url><loc>" + html.EscapeString(origin+p) + "</loc></url>\n")
	}
	b.WriteString("</urlset>\n")
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write([]byte(b.String()))
}

// jsonString is s as it may stand inside a JSON string in a script element.
func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return strings.ReplaceAll(string(b[1:len(b)-1]), "</", `<\/`)
}
