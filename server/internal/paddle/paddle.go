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

// Plan is a paid drive size. Prices live in Paddle (created by `coffer
// paddle-setup`), tagged with the plan id so they can be found again.
type Plan struct {
	ID    string
	Name  string
	Quota int64 // bytes of ciphertext
	Cents int   // monthly price in EUR cents, used only when creating the Paddle price
}

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
	prices map[string]Price // by plan id
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
type Tag struct {
	Plan   string `json:"coffer_plan,omitempty"`
	UserID string `json:"user_id,omitempty"`
	Quota  int64  `json:"coffer_quota,omitempty"` // on a personal price: the storage it buys
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
}

// Subscription is a Paddle subscription, as much of it as Coffer reads.
type Subscription struct {
	ID            string    `json:"id"`
	Status        string    `json:"status"`
	CustomerID    string    `json:"customer_id"`
	CustomData    *Tag      `json:"custom_data"`
	UpdatedAt     time.Time `json:"updated_at"`
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

// Catalog returns the active price for each plan, refreshed hourly. A failed
// refresh keeps serving the previous answer.
func (b *Client) Catalog(ctx context.Context) (map[string]Price, error) {
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
	prices := map[string]Price{}
	for _, p := range all {
		if p.CustomData != nil && PlanByID(p.CustomData.Plan) != nil {
			prices[p.CustomData.Plan] = p
		}
	}
	b.prices, b.loaded = prices, time.Now()
	return prices, nil
}

// PlanOfPrice names the listed plan a Paddle price belongs to, if any.
func (b *Client) PlanOfPrice(ctx context.Context, priceID string) *Plan {
	prices, err := b.Catalog(ctx)
	if err != nil {
		return nil
	}
	for id, p := range prices {
		if p.ID == priceID {
			return PlanByID(id)
		}
	}
	return nil
}
