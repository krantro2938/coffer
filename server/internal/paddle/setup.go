package paddle

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
)

// Setup creates whatever is missing in the Paddle account: a product and a
// monthly and a yearly price per plan, a client-side token for the checkout page and, when
// given the site's public URL, the webhook destination. Safe to run again.
// It reports on stderr, prints lines for the .env file on stdout and returns
// the process exit code.
func Setup(key, clientToken, webhookSecret string, args []string) int {
	if key == "" {
		fmt.Fprintln(os.Stderr, "PADDLE_API_KEY is not set")
		return 1
	}
	b := New(key, clientToken, webhookSecret)
	ctx := context.Background()
	fail := func(what string, err error) int {
		fmt.Fprintf(os.Stderr, "%s: %v\n", what, err)
		return 1
	}
	env := "live"
	if b.Sandbox {
		env = "sandbox"
	}
	fmt.Fprintf(os.Stderr, "Paddle environment: %s\n", env)

	var products []struct {
		ID         string  `json:"id"`
		CustomData *Tag    `json:"custom_data"`
		Prices     []Price `json:"prices"`
	}
	if err := b.Call(ctx, http.MethodGet, "/products?status=active&per_page=200&include=prices", nil, &products); err != nil {
		return fail("list products", err)
	}
	for _, pl := range Plans {
		productID := ""
		have := map[string]bool{} // intervals this plan already has an active price for
		for _, p := range products {
			if p.CustomData == nil || p.CustomData.Plan != pl.ID {
				continue
			}
			productID = p.ID
			for _, pr := range p.Prices {
				if plan, interval := pr.listed(); pr.Status == "active" && plan == pl.ID {
					have[interval] = true
				}
			}
		}
		if productID == "" {
			var created struct {
				ID string `json:"id"`
			}
			product := map[string]any{
				"name":         "Coffer " + pl.Name,
				"description":  fmt.Sprintf("%d GB of end-to-end encrypted storage", pl.Quota>>30),
				"tax_category": "saas",
				"custom_data":  Tag{Plan: pl.ID},
			}
			err := b.Call(ctx, http.MethodPost, "/products", product, &created)
			if err != nil {
				// The SaaS tax category has to be enabled on the account; fall back to the default.
				product["tax_category"] = "standard"
				err = b.Call(ctx, http.MethodPost, "/products", product, &created)
			}
			if err != nil {
				return fail("create product "+pl.Name, err)
			}
			productID = created.ID
			fmt.Fprintf(os.Stderr, "created product %s (%s)\n", pl.Name, productID)
		}
		for _, c := range []struct {
			interval string
			cents    int
			tag      Tag
		}{
			{Month, pl.Cents, Tag{Plan: pl.ID}},
			{Year, pl.YearCents(), Tag{PlanYear: pl.ID}},
		} {
			if have[c.interval] {
				fmt.Fprintf(os.Stderr, "plan %s already has its %sly price\n", pl.Name, c.interval)
				continue
			}
			err := b.Call(ctx, http.MethodPost, "/prices", map[string]any{
				"product_id":    productID,
				"name":          pl.Name,
				"description":   pl.Name + ", " + c.interval + "ly",
				"unit_price":    map[string]string{"amount": fmt.Sprint(c.cents), "currency_code": "EUR"},
				"billing_cycle": map[string]any{"interval": c.interval, "frequency": 1},
				"quantity":      map[string]int{"minimum": 1, "maximum": 1},
				"custom_data":   c.tag,
			}, nil)
			if err != nil {
				return fail("create "+c.interval+"ly price "+pl.Name, err)
			}
			fmt.Fprintf(os.Stderr, "created price for %s: €%d.%02d / %s\n", pl.Name, c.cents/100, c.cents%100, c.interval)
		}
	}

	// Lines on stdout are meant for the .env file.
	if clientToken == "" {
		var tok struct {
			Token string `json:"token"`
		}
		if err := b.Call(ctx, http.MethodPost, "/client-tokens", map[string]string{"name": "Coffer checkout"}, &tok); err != nil {
			return fail("create client-side token", err)
		}
		fmt.Printf("PADDLE_CLIENT_TOKEN=%s\n", tok.Token)
	}
	if len(args) > 0 && webhookSecret == "" {
		var dest struct {
			Secret string `json:"endpoint_secret_key"`
		}
		err := b.Call(ctx, http.MethodPost, "/notification-settings", map[string]any{
			"description": "Coffer",
			"destination": strings.TrimRight(args[0], "/") + WebhookPath,
			"type":        "url",
			"subscribed_events": []string{
				"subscription.created", "subscription.updated", "subscription.activated", "subscription.canceled",
				"subscription.past_due", "subscription.paused", "subscription.resumed", "subscription.trialing",
			},
		}, &dest)
		if err != nil {
			return fail("create webhook destination", err)
		}
		fmt.Printf("PADDLE_WEBHOOK_SECRET=%s\n", dest.Secret)
	}
	return 0
}
