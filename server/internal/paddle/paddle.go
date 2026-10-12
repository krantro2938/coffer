package paddle

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Plan is a paid drive size. Its prices live in Paddle (created by `coffer
// paddle-setup`), tagged with the plan id so they can be found again: a
// monthly one and a yearly one.
type Plan struct {
	ID    string
	Name  string
	Quota int64 // bytes of ciphertext
	Cents int   // monthly price in EUR cents, used only when creating the Paddle price
}

// Billing intervals a listed plan is sold in.
const (
	Month = "month"
	Year  = "year"
)

// ValidInterval reports whether s is an interval a listed plan can be bought in.
func ValidInterval(s string) bool { return s == Month || s == Year }

// YearCents is the yearly price: ten months, so two are free. Used only when
// creating the Paddle price.
func (p Plan) YearCents() int { return p.Cents * 10 }

// Plans are the drive sizes on sale.
var Plans = []Plan{
	{"starter", "Starter", 100 << 30, 499},
	{"plus", "Plus", 500 << 30, 1199},
	{"pro", "Pro", 1 << 40, 1999},
}

// PlanByID finds a listed plan.
func PlanByID(id string) *Plan {
	for i := range Plans {
		if Plans[i].ID == id {
			return &Plans[i]
		}
	}
	return nil
}

// WebhookPath is where this server receives Paddle's subscription events.
const WebhookPath = "/api/paddle/webhook"

// Client is a minimal client for the Paddle Billing API. It also caches the
// plan → Paddle price mapping.
type Client struct {
	Sandbox       bool
	ClientToken   string // for the checkout page
	WebhookSecret string

	base, key string
	hc        *http.Client

	mu     sync.Mutex
	prices map[string]PlanPrices // by plan id
	loaded time.Time
}

// New returns a client for the account the API key belongs to. Sandbox keys
// talk to Paddle's sandbox; PADDLE_ENV overrides the guess.
func New(key, clientToken, webhookSecret string) *Client {
	sandbox := strings.Contains(key, "_sdbx_")
	switch strings.ToLower(os.Getenv("PADDLE_ENV")) {
	case "sandbox":
		sandbox = true
	case "live", "production":
		sandbox = false
	}
	p := &Client{
		Sandbox: sandbox, ClientToken: clientToken, WebhookSecret: webhookSecret,
		base: "https://api.paddle.com", key: key, hc: &http.Client{Timeout: 30 * time.Second},
	}
	if sandbox {
		p.base = "https://sandbox-api.paddle.com"
	}
	return p
}

// SetBaseURL points the client at another API address; for tests.
func (p *Client) SetBaseURL(u string) { p.base = u }

// Error is a refusal from the Paddle API.
type Error struct {
	Status int
	Code   string `json:"code"`
	Detail string `json:"detail"`
}

func (e *Error) Error() string {
	return fmt.Sprintf("paddle: %d %s: %s", e.Status, e.Code, e.Detail)
}

// Call makes one API request, decoding the reply's data into out.
func (p *Client) Call(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, p.base+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.key)
	req.Header.Set("Paddle-Version", "1")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := p.hc.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var envelope struct {
		Data  json.RawMessage `json:"data"`
		Error *Error          `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&envelope); err != nil && res.StatusCode < 300 {
		return fmt.Errorf("paddle: %s %s: %w", method, path, err)
	}
	if res.StatusCode >= 300 {
		if envelope.Error == nil {
			envelope.Error = &Error{}
		}
		envelope.Error.Status = res.StatusCode
		return envelope.Error
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(envelope.Data, out)
}

// Tag is the custom data Coffer attaches to Paddle objects to find them again.
//
// A plan's monthly price is tagged Plan and its yearly price PlanYear, never
// both. The key differs because a server on an older release that shares the
// Paddle account would otherwise take the yearly price for the monthly one
// (it keeps whichever tagged price it sees last). The tag only says which plan
// a price is for; the billing cycle on the price itself says what it charges,
// and a price is only listed when the two agree.
type Tag struct {
	Plan     string `json:"coffer_plan,omitempty"`
	PlanYear string `json:"coffer_plan_year,omitempty"`
	UserID   string `json:"user_id,omitempty"`
	Quota    int64  `json:"coffer_quota,omitempty"` // on a personal price: the storage it buys
}

// Price is a Paddle price, as much of it as Coffer reads.
type Price struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	CustomData *Tag   `json:"custom_data"`
	UnitPrice  struct {
		Amount   string `json:"amount"` // minor units
		Currency string `json:"currency_code"`
	} `json:"unit_price"`
	BillingCycle *BillingCycle `json:"billing_cycle"`
}

// BillingCycle is how often a price or subscription bills.
type BillingCycle struct {
	Interval  string `json:"interval"`
	Frequency int    `json:"frequency"`
}

// PlanPrices are a plan's listed prices. Year is nil until `coffer
// paddle-setup` has created it.
type PlanPrices struct {
	Month, Year *Price
}

// For returns the price for an interval, or false for a missing price or an
// interval that is not sold.
func (pp PlanPrices) For(interval string) (Price, bool) {
	var p *Price
	switch interval {
	case Month:
		p = pp.Month
	case Year:
		p = pp.Year
	}
	if p == nil {
		return Price{}, false
	}
	return *p, true
}

// listed names the plan and interval of a price Coffer sells, or "" when it is
// not one: the tag and the billing cycle must agree.
func (p Price) listed() (plan, interval string) {
	if p.CustomData == nil || p.BillingCycle == nil || p.BillingCycle.Frequency != 1 {
		return "", ""
	}
	switch {
	case p.CustomData.Plan != "" && p.CustomData.PlanYear == "" && p.BillingCycle.Interval == Month:
		plan, interval = p.CustomData.Plan, Month
	case p.CustomData.PlanYear != "" && p.CustomData.Plan == "" && p.BillingCycle.Interval == Year:
		plan, interval = p.CustomData.PlanYear, Year
	}
	if PlanByID(plan) == nil {
		return "", ""
	}
	return plan, interval
}

// Subscription is a Paddle subscription, as much of it as Coffer reads.
type Subscription struct {
	ID            string        `json:"id"`
	Status        string        `json:"status"`
	CustomerID    string        `json:"customer_id"`
	CustomData    *Tag          `json:"custom_data"`
	UpdatedAt     time.Time     `json:"updated_at"`
	BillingCycle  *BillingCycle `json:"billing_cycle"`
	CurrentPeriod *struct {
		EndsAt time.Time `json:"ends_at"`
	} `json:"current_billing_period"`
	ScheduledChange *struct {
		Action      string    `json:"action"`
		EffectiveAt time.Time `json:"effective_at"`
	} `json:"scheduled_change"`
	Items []struct {
		Price struct {
			ID         string `json:"id"`
			CustomData *Tag   `json:"custom_data"`
		} `json:"price"`
	} `json:"items"`
}

// Catalog returns the active prices for each plan, refreshed hourly. A failed
// refresh keeps serving the previous answer.
func (b *Client) Catalog(ctx context.Context) (map[string]PlanPrices, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.prices != nil && time.Since(b.loaded) < time.Hour {
		return b.prices, nil
	}
	var all []Price
	if err := b.Call(ctx, http.MethodGet, "/prices?status=active&per_page=200", nil, &all); err != nil {
		if b.prices != nil {
			return b.prices, nil
		}
		return nil, err
	}
	b.prices, b.loaded = catalogOf(all), time.Now()
	return b.prices, nil
}

// catalogOf picks the listed prices out of an account's prices.
func catalogOf(all []Price) map[string]PlanPrices {
	prices := map[string]PlanPrices{}
	for i := range all {
		p := all[i]
		plan, interval := p.listed()
		if plan == "" {
			continue
		}
		pp := prices[plan]
		if interval == Year {
			pp.Year = &p
		} else {
			pp.Month = &p
		}
		prices[plan] = pp
	}
	return prices
}

// PlanOfPrice names the listed plan a Paddle price belongs to and the interval
// it bills at, if it is one of ours.
func (b *Client) PlanOfPrice(ctx context.Context, priceID string) (*Plan, string) {
	prices, err := b.Catalog(ctx)
	if err != nil {
		return nil, ""
	}
	for id, pp := range prices {
		switch {
		case pp.Month != nil && pp.Month.ID == priceID:
			return PlanByID(id), Month
		case pp.Year != nil && pp.Year.ID == priceID:
			return PlanByID(id), Year
		}
	}
	return nil, ""
}

// UpdatePreview is Paddle's preview of a subscription update, as much of it
// as Coffer shows the customer.
type UpdatePreview struct {
	// What the card is charged (or the balance credited) by the change itself,
	// after any credit the customer already holds is used up.
	ImmediateTransaction *struct {
		Details struct {
			Totals struct {
				Total           string `json:"total"`
				Credit          string `json:"credit"`            // existing credit applied to this transaction
				CreditToBalance string `json:"credit_to_balance"` // credit this change leaves for later bills
				Balance         string `json:"balance"`           // what is still to be paid now
			} `json:"totals"`
		} `json:"details"`
	} `json:"immediate_transaction"`
	// The change's own net figure, used when there is no immediate transaction.
	UpdateSummary *struct {
		Result struct {
			Action   string `json:"action"` // charge or credit
			Amount   string `json:"amount"` // minor units
			Currency string `json:"currency_code"`
		} `json:"result"`
	} `json:"update_summary"`
	NextBilledAt *time.Time `json:"next_billed_at"`
}

// PreviewSummary is what the customer is told about a change.
type PreviewSummary struct {
	Action       string `json:"action"` // "charge": pay now; "credit": credited to later bills; "none"
	Amount       int64  `json:"amount"` // minor units, always positive
	Currency     string `json:"currency"`
	NextBilledAt int64  `json:"nextBilledAt,omitempty"` // unix seconds
	FromCredit   bool   `json:"fromCredit,omitempty"`   // action "none" because credit the customer holds pays for it
}

// Summary reduces a preview to what is shown: what the card pays now, or what
// is credited to later bills. A charge that credit already held covers in full
// is "none", and one it covers in part is only the remainder.
func (u UpdatePreview) Summary() PreviewSummary {
	out := PreviewSummary{Action: "none", Currency: "EUR"}
	amount := func(s string) int64 {
		var n int64
		fmt.Sscan(s, &n)
		return n
	}
	switch {
	case u.ImmediateTransaction != nil:
		t := u.ImmediateTransaction.Details.Totals
		switch {
		case amount(t.Balance) > 0:
			out.Action, out.Amount = "charge", amount(t.Balance)
		case amount(t.CreditToBalance) > 0:
			out.Action, out.Amount = "credit", amount(t.CreditToBalance)
		case amount(t.Total) > 0 && amount(t.Credit) > 0:
			out.FromCredit = true
		}
		if u.UpdateSummary != nil && u.UpdateSummary.Result.Currency != "" {
			out.Currency = u.UpdateSummary.Result.Currency
		}
	case u.UpdateSummary != nil:
		r := u.UpdateSummary.Result
		out.Currency = r.Currency
		if n := amount(r.Amount); n != 0 && (r.Action == "charge" || r.Action == "credit") {
			out.Action, out.Amount = r.Action, n
		}
	}
	if u.NextBilledAt != nil {
		out.NextBilledAt = u.NextBilledAt.Unix()
	}
	return out
}
