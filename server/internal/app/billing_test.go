package app

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"coffer/internal/config"
	"coffer/internal/paddle"
)

const webhookSecret = "pdl_ntfset_test_secret"

// fakePaddle answers the few Paddle calls billing makes, and remembers what it was asked.
type fakePaddle struct {
	*httptest.Server
	mu          sync.Mutex
	txnItems    []map[string]any // items of the transactions created
	patched     []map[string]any // bodies of subscription updates
	previewed   []map[string]any
	subInterval string // what the subscription bills at, as Paddle would report it
	subPrice    string
	cancelAt    time.Time // a cancellation Paddle has scheduled, zero for none
}

func newFakePaddle(t *testing.T) *fakePaddle {
	f := &fakePaddle{subInterval: "month", subPrice: "pri_m_starter"}
	prices := []map[string]any{}
	for _, c := range []struct{ id, tag, interval, amount string }{
		{"pri_m_starter", "coffer_plan", "month", "499"},
		{"pri_y_starter", "coffer_plan_year", "year", "4990"},
		{"pri_m_plus", "coffer_plan", "month", "1199"},
		{"pri_y_plus", "coffer_plan_year", "year", "11990"},
	} {
		plan := strings.Split(c.id, "_")[2]
		prices = append(prices, map[string]any{
			"id": c.id, "status": "active", "custom_data": map[string]string{c.tag: plan},
			"unit_price":    map[string]string{"amount": c.amount, "currency_code": "EUR"},
			"billing_cycle": map[string]any{"interval": c.interval, "frequency": 1},
		})
	}
	reply := func(w http.ResponseWriter, data any) {
		json.NewEncoder(w).Encode(map[string]any{"data": data})
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /prices", func(w http.ResponseWriter, r *http.Request) { reply(w, prices) })
	mux.HandleFunc("POST /customers", func(w http.ResponseWriter, r *http.Request) { reply(w, map[string]string{"id": "ctm_1"}) })
	mux.HandleFunc("POST /transactions", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Items []map[string]any `json:"items"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.txnItems = append(f.txnItems, body.Items...)
		f.mu.Unlock()
		reply(w, map[string]any{"id": "txn_1", "checkout": map[string]string{"url": "https://pay.test/?_ptxn=txn_1"}})
	})
	mux.HandleFunc("PATCH /subscriptions/sub_1", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.patched = append(f.patched, body)
		if change, ok := body["scheduled_change"]; ok && change == nil {
			f.cancelAt = time.Time{}
		}
		if items, ok := body["items"].([]any); ok {
			f.subPrice = items[0].(map[string]any)["price_id"].(string)
			f.subInterval = "month"
			if strings.HasPrefix(f.subPrice, "pri_y_") {
				f.subInterval = "year"
			}
		}
		reply(w, f.subscription(time.Now()))
		f.mu.Unlock()
	})
	mux.HandleFunc("PATCH /subscriptions/sub_1/preview", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.previewed = append(f.previewed, body)
		f.mu.Unlock()
		reply(w, map[string]any{
			"update_summary": map[string]any{"result": map[string]string{"action": "credit", "amount": "638", "currency_code": "EUR"}},
			"immediate_transaction": map[string]any{"details": map[string]any{"totals": map[string]string{
				"total": "-638", "credit": "0", "credit_to_balance": "638", "balance": "0",
			}}},
			"next_billed_at": "2027-10-11T13:12:27Z",
		})
	})
	f.Server = httptest.NewServer(mux)
	t.Cleanup(f.Close)
	return f
}

// subscription is the subscription as Paddle would send it: a webhook's data or a reply.
func (f *fakePaddle) subscription(updated time.Time) map[string]any {
	sub := map[string]any{
		"id": "sub_1", "status": "active", "customer_id": "ctm_1", "updated_at": updated.Format(time.RFC3339Nano),
		"custom_data":            map[string]string{"user_id": "UID"},
		"billing_cycle":          map[string]any{"interval": f.subInterval, "frequency": 1},
		"current_billing_period": map[string]string{"ends_at": updated.AddDate(1, 0, 0).Format(time.RFC3339)},
		"items":                  []any{map[string]any{"price": map[string]any{"id": f.subPrice}}},
	}
	if !f.cancelAt.IsZero() {
		sub["scheduled_change"] = map[string]string{"action": "cancel", "effective_at": f.cancelAt.Format(time.RFC3339)}
	}
	return sub
}

func billingServer(t *testing.T) (*server, *fakePaddle) {
	f := newFakePaddle(t)
	s := newServer(t, func(c *config.Config) {
		c.PaddleKey, c.PaddleClientToken, c.PaddleWebhookSecret = "pdl_sdbx_test", "test_token", webhookSecret
		c.FreeQuota = 1000
	})
	s.app.billing.SetBaseURL(f.URL)
	return s, f
}

func (s *server) webhook(t *testing.T, event string, data any) int {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"event_type": event, "data": data})
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	sig := hex.EncodeToString(hmacSHA([]byte(webhookSecret), append([]byte(ts+":"), raw...)))
	req, _ := http.NewRequest("POST", s.public.URL+paddle.WebhookPath, strings.NewReader(string(raw)))
	req.Header.Set("Paddle-Signature", fmt.Sprintf("ts=%s;h1=%s", ts, sig))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

type billingView struct {
	Free *struct {
		RequestLinks int `json:"requestLinks"`
		ShareDays    int `json:"shareDays"`
	} `json:"free"`
	Plan      *string `json:"plan"`
	Interval  *string `json:"interval"`
	Status    *string `json:"status"`
	Entitled  bool    `json:"entitled"`
	PeriodEnd int64   `json:"periodEnd"`
	CancelAt  int64   `json:"cancelAt"`
}

func (c *client) billing(t *testing.T) (billingView, int64) {
	var me struct {
		Billing billingView `json:"billing"`
		Quota   int64       `json:"quota"`
	}
	c.must(200, "GET", "/api/auth/me", nil, &me)
	return me.Billing, me.Quota
}

func TestListedPriceRejectsWhatIsNotAListedPlanAndInterval(t *testing.T) {
	catalog := map[string]paddle.PlanPrices{
		"starter": {Month: &paddle.Price{ID: "m"}, Year: &paddle.Price{ID: "y"}},
		"plus":    {Month: &paddle.Price{ID: "pm"}},
	}
	for _, c := range []struct {
		plan, interval, want string // want "" for rejected
	}{
		{"starter", "month", "m"}, {"starter", "year", "y"}, {"plus", "month", "pm"},
		{"plus", "year", ""}, // no yearly price created yet
		{"starter", "", ""}, {"starter", "week", ""}, {"starter", "YEAR", ""}, {"starter", "years", ""},
		{"offer", "month", ""}, {"custom", "year", ""}, {"", "month", ""}, {"gold", "year", ""},
	} {
		_, price, err := listedPrice(catalog, c.plan, c.interval)
		if (err == nil) != (c.want != "") || price.ID != c.want {
			t.Errorf("%q %q: price %q, err %v; want %q", c.plan, c.interval, price.ID, err, c.want)
		}
	}
}

func TestPlansListBothPrices(t *testing.T) {
	s, _ := billingServer(t)
	var cfg struct {
		Plans []struct {
			ID     string           `json:"id"`
			Amount int64            `json:"amount"`
			Prices map[string]int64 `json:"prices"`
		} `json:"plans"`
	}
	s.browser().must(200, "GET", "/api/config", nil, &cfg)
	if len(cfg.Plans) != 2 {
		t.Fatalf("plans: %+v", cfg.Plans)
	}
	if p := cfg.Plans[0]; p.ID != "starter" || p.Amount != 499 || p.Prices["month"] != 499 || p.Prices["year"] != 4990 {
		t.Errorf("starter: %+v", p)
	}
}

func TestCheckoutTakesAPlanAndAnInterval(t *testing.T) {
	s, f := billingServer(t)
	c := s.browser()
	c.mustRegister("ann@example.com")

	for _, bad := range []map[string]any{
		{"plan": "starter"}, {"plan": "starter", "interval": "week"}, {"plan": "starter", "interval": ""},
		{"plan": "gold", "interval": "year"}, {"plan": "offer", "interval": "year"}, {"interval": "month"},
	} {
		if status := c.do("POST", "/api/billing/checkout", bad, nil); status != http.StatusBadRequest {
			t.Errorf("checkout %v: %d; want 400", bad, status)
		}
	}
	if len(f.txnItems) != 0 {
		t.Fatalf("a transaction was made for bad input: %v", f.txnItems)
	}
	for _, c2 := range []struct{ plan, interval, price string }{
		{"starter", "month", "pri_m_starter"}, {"starter", "year", "pri_y_starter"}, {"plus", "year", "pri_y_plus"},
	} {
		c.must(200, "POST", "/api/billing/checkout", map[string]any{"plan": c2.plan, "interval": c2.interval}, nil)
		if got := f.txnItems[len(f.txnItems)-1]["price_id"]; got != c2.price {
			t.Errorf("%s %s: bought %v; want %s", c2.plan, c2.interval, got, c2.price)
		}
	}
}

func TestWebhookForAYearlySubscription(t *testing.T) {
	s, f := billingServer(t)
	c := s.browser()
	c.mustRegister("ann@example.com")
	uid := mustUserID(t, s)

	f.subInterval, f.subPrice = "year", "pri_y_plus"
	sub := f.subscription(time.Now())
	sub["custom_data"] = map[string]string{"user_id": uid}
	if status := s.webhook(t, "subscription.created", sub); status != 200 {
		t.Fatalf("webhook: %d", status)
	}
	b, quota := c.billing(t)
	if b.Plan == nil || *b.Plan != "plus" || b.Interval == nil || *b.Interval != "year" || !b.Entitled || quota != paddle.PlanByID("plus").Quota {
		t.Errorf("after a yearly subscription: %+v quota %d", b, quota)
	}
	if want := time.Now().AddDate(1, 0, 0).Unix(); b.PeriodEnd < want-60 || b.PeriodEnd > want+60 {
		t.Errorf("period end %d; want about %d", b.PeriodEnd, want)
	}

	// A signed event with the wrong key is refused.
	raw, _ := json.Marshal(map[string]any{"event_type": "subscription.updated", "data": sub})
	req, _ := http.NewRequest("POST", s.public.URL+paddle.WebhookPath, strings.NewReader(string(raw)))
	req.Header.Set("Paddle-Signature", "ts="+strconv.FormatInt(time.Now().Unix(), 10)+";h1=00")
	if res, err := http.DefaultClient.Do(req); err != nil || res.StatusCode != http.StatusForbidden {
		t.Errorf("bad signature: %v %v", res, err)
	}
}

func TestChangingPlanAndInterval(t *testing.T) {
	s, f := billingServer(t)
	c := s.browser()
	c.mustRegister("ann@example.com")
	uid := mustUserID(t, s)

	// A subscription from before yearly billing: monthly, with no interval on record.
	sub := f.subscription(time.Now().Add(-time.Hour))
	sub["custom_data"] = map[string]string{"user_id": uid}
	delete(sub, "billing_cycle")
	s.webhook(t, "subscription.created", sub)
	if b, _ := c.billing(t); b.Interval == nil || *b.Interval != "month" {
		t.Fatalf("a subscription with no cycle on record should read as monthly: %v", b.Interval)
	}

	change := func(plan, interval string) int {
		return c.do("POST", "/api/billing/plan", map[string]any{"plan": plan, "interval": interval}, nil)
	}
	for _, bad := range [][2]string{{"starter", ""}, {"starter", "week"}, {"gold", "year"}, {"", "year"}} {
		if status := change(bad[0], bad[1]); status != http.StatusBadRequest {
			t.Errorf("change to %v: %d; want 400", bad, status)
		}
	}
	if status := change("starter", "month"); status != http.StatusConflict {
		t.Errorf("to the plan it is on: %d; want 409", status)
	}

	// Monthly to yearly, then to a larger yearly, then back to monthly.
	for _, step := range []struct{ plan, interval, price string }{
		{"starter", "year", "pri_y_starter"}, {"plus", "year", "pri_y_plus"}, {"plus", "month", "pri_m_plus"},
	} {
		if status := change(step.plan, step.interval); status != 200 {
			t.Fatalf("%s %s: %d", step.plan, step.interval, status)
		}
		last := f.patched[len(f.patched)-1]
		item := last["items"].([]any)[0].(map[string]any)
		if item["price_id"] != step.price || last["proration_billing_mode"] != "prorated_immediately" {
			t.Errorf("%s %s: asked Paddle for %v", step.plan, step.interval, last)
		}
		b, _ := c.billing(t)
		if *b.Plan != step.plan || *b.Interval != step.interval {
			t.Errorf("after %s %s the account shows %s %s", step.plan, step.interval, *b.Plan, *b.Interval)
		}
	}
	if status := change("plus", "month"); status != http.StatusConflict {
		t.Errorf("same again: %d; want 409", status)
	}

	// The preview prices a change without making it.
	patched := len(f.patched)
	var sum struct {
		Action   string `json:"action"`
		Amount   int64  `json:"amount"`
		Currency string `json:"currency"`
	}
	c.must(200, "POST", "/api/billing/plan/preview", map[string]any{"plan": "starter", "interval": "year"}, &sum)
	if sum.Action != "credit" || sum.Amount != 638 || sum.Currency != "EUR" || len(f.patched) != patched || len(f.previewed) != 1 {
		t.Errorf("preview: %+v patched %d previewed %d", sum, len(f.patched), len(f.previewed))
	}
}

func TestTakingBackACancellation(t *testing.T) {
	s, f := billingServer(t)
	c := s.browser()
	c.mustRegister("ann@example.com")
	uid := mustUserID(t, s)

	resume := func() int { return c.do("POST", "/api/billing/resume", nil, nil) }
	if status := resume(); status != http.StatusConflict {
		t.Errorf("with no plan: %d; want 409", status)
	}
	sub := f.subscription(time.Now().Add(-time.Hour))
	sub["custom_data"] = map[string]string{"user_id": uid}
	s.webhook(t, "subscription.created", sub)
	if status := resume(); status != http.StatusConflict {
		t.Errorf("with nothing cancelled: %d; want 409", status)
	}

	// Cancelled in Paddle's portal, to end with the period.
	f.cancelAt = time.Now().AddDate(0, 1, 0).Truncate(time.Second)
	sub = f.subscription(time.Now().Add(-time.Minute))
	sub["custom_data"] = map[string]string{"user_id": uid}
	s.webhook(t, "subscription.updated", sub)
	if b, _ := c.billing(t); b.CancelAt != f.cancelAt.Unix() {
		t.Fatalf("cancelAt %d; want %d", b.CancelAt, f.cancelAt.Unix())
	}

	if status := resume(); status != 200 {
		t.Fatalf("resume: %d", status)
	}
	last := f.patched[len(f.patched)-1]
	if change, ok := last["scheduled_change"]; !ok || change != nil || len(last) != 1 {
		t.Errorf("asked Paddle for %v; want only scheduled_change: null", last)
	}
	if b, _ := c.billing(t); b.CancelAt != 0 || !b.Entitled || *b.Plan != "starter" {
		t.Errorf("after resuming: %+v", b)
	}
}

func TestFreeAccount(t *testing.T) {
	s, f := billingServer(t)
	c := s.browser()
	c.mustRegister("ann@example.com")
	uid := mustUserID(t, s)

	// Nothing is bought, and the account still has a drive of the free size.
	b, quota := c.billing(t)
	if b.Entitled || b.Free == nil || b.Free.RequestLinks != 2 || b.Free.ShareDays != 30 || quota != 1000 {
		t.Fatalf("a new account: %+v quota %d; want the free account at 1000 bytes", b, quota)
	}
	id, _ := c.upload(random(600), true)
	over := map[string]any{
		"id": randomID(26), "kind": "file", "encMeta": random(40), "wrappedKey": random(60),
		"size": 600, "chunkSize": minChunkSize, "chunkCount": 1,
	}
	if status := c.do("POST", "/api/items", over, nil); status != http.StatusInsufficientStorage {
		t.Errorf("an upload past the free size: %d; want 507", status)
	}

	// A link from the drive lasts a month at most, with or without a longer wish.
	check := func(opts map[string]any) {
		t.Helper()
		var sh struct {
			ExpiresAt int64 `json:"expiresAt"`
		}
		req := map[string]any{"itemId": id, "wrappedKey": random(60), "accessHash": sha(random(32))}
		for k, v := range opts {
			req[k] = v
		}
		c.must(201, "POST", "/api/shares", req, &sh)
		want := time.Now().Add(30 * 24 * time.Hour).Unix()
		if sh.ExpiresAt < want-60 || sh.ExpiresAt > want+60 {
			t.Errorf("link with %v expires at %d; want about %d", opts, sh.ExpiresAt, want)
		}
	}
	check(nil)
	check(map[string]any{"expiresIn": 365 * 24 * 3600})

	// Two request links at a time; closing one makes room.
	a := c.request(nil)
	c.request(nil)
	body := func() map[string]any {
		return map[string]any{"id": randomID(20), "accessHash": sha(random(32)), "encInfo": random(120), "encSecret": random(44), "encPrivate": random(170)}
	}
	if status := c.do("POST", "/api/requests", body(), nil); status != http.StatusPaymentRequired {
		t.Errorf("a third request link: %d; want 402", status)
	}
	c.must(200, "POST", "/api/requests/"+a.ID+"/revoke", nil, nil)
	c.request(nil)

	// A plan lifts the limits; the drive takes its size.
	sub := f.subscription(time.Now())
	sub["custom_data"] = map[string]string{"user_id": uid}
	s.webhook(t, "subscription.created", sub)
	b, quota = c.billing(t)
	if !b.Entitled || b.Free != nil || quota != paddle.PlanByID("starter").Quota {
		t.Fatalf("on a plan: %+v quota %d", b, quota)
	}
	c.request(nil)
	c.request(nil)
}

func TestPlansPreview(t *testing.T) {
	s := newServer(t, func(c *config.Config) {
		c.PlansPreview = true
		c.FreeQuota = 1000
	})
	c := s.browser()

	// The plans are listed at their prices, marked as not for sale.
	var cfg struct {
		Plans     []map[string]any `json:"plans"`
		PlansOpen *bool            `json:"plansOpen"`
		FreeQuota int64            `json:"freeQuota"`
	}
	c.must(200, "GET", "/api/config", nil, &cfg)
	if len(cfg.Plans) != len(paddle.Plans) || cfg.PlansOpen == nil || *cfg.PlansOpen || cfg.FreeQuota != 1000 {
		t.Fatalf("config: %+v", cfg)
	}
	if p := cfg.Plans[0]; p["id"] != "starter" || p["amount"] != float64(499) || p["prices"].(map[string]any)["year"] != float64(4990) {
		t.Errorf("first plan: %v", p)
	}

	// Every account is a free account, with its size and its limits.
	c.mustRegister("ann@example.com")
	b, quota := c.billing(t)
	if b.Entitled || b.Free == nil || quota != 1000 {
		t.Fatalf("a new account: %+v quota %d; want the free account at 1000 bytes", b, quota)
	}
	c.request(nil)
	c.request(nil)
	body := map[string]any{"id": randomID(20), "accessHash": sha(random(32)), "encInfo": random(120), "encSecret": random(44), "encPrivate": random(170)}
	if status := c.do("POST", "/api/requests", body, nil); status != http.StatusPaymentRequired {
		t.Errorf("a third request link: %d; want 402", status)
	}

	// Nothing can be bought.
	if status := c.do("POST", "/api/billing/checkout", map[string]any{"plan": "starter", "interval": "month"}, nil); status == 200 {
		t.Error("a checkout opened while the plans are not for sale")
	}
}
