package paddle

import (
	"encoding/json"
	"testing"
)

func price(id, plan, planYear, interval string, freq int, quota int64) Price {
	p := Price{ID: id, Status: "active"}
	p.CustomData = &Tag{Plan: plan, PlanYear: planYear, Quota: quota}
	if interval != "" {
		p.BillingCycle = &BillingCycle{Interval: interval, Frequency: freq}
	}
	return p
}

func TestCatalogPicksThePriceForAPlanAndInterval(t *testing.T) {
	all := []Price{
		price("m_starter", "starter", "", "month", 1, 0),
		price("y_starter", "", "starter", "year", 1, 0),
		price("m_plus", "plus", "", "month", 1, 0), // no yearly price yet
		price("y_pro", "", "pro", "year", 1, 0),    // no monthly price
		// Not ours, or not what they claim to be:
		price("odd_year", "", "plus", "month", 1, 0), // tagged yearly, bills monthly
		price("odd_month", "pro", "", "year", 1, 0),  // tagged monthly, bills yearly
		price("every_2", "plus", "", "month", 2, 0),  // every two months
		price("both", "plus", "plus", "month", 1, 0), // tagged both ways
		price("offer", "", "", "year", 1, 5<<30),     // a personal price: only a quota
		price("unknown", "gold", "", "month", 1, 0),  // not a listed plan
		price("untagged", "", "", "month", 1, 0),     // someone else's
		price("no_cycle", "starter", "", "", 0, 0),   // one-time price
	}
	c := catalogOf(all)

	if p, ok := c["starter"].For(Month); !ok || p.ID != "m_starter" {
		t.Errorf("starter monthly = %v %v", p.ID, ok)
	}
	if p, ok := c["starter"].For(Year); !ok || p.ID != "y_starter" {
		t.Errorf("starter yearly = %v %v", p.ID, ok)
	}
	if p, ok := c["plus"].For(Month); !ok || p.ID != "m_plus" {
		t.Errorf("plus monthly = %v %v", p.ID, ok)
	}
	if _, ok := c["plus"].For(Year); ok {
		t.Error("plus has no yearly price, but one was found")
	}
	if _, ok := c["pro"].For(Month); ok {
		t.Error("pro has no monthly price, but one was found")
	}
	if p, ok := c["pro"].For(Year); !ok || p.ID != "y_pro" {
		t.Errorf("pro yearly = %v %v", p.ID, ok)
	}
	if _, ok := c["gold"]; ok || len(c) != 3 {
		t.Errorf("catalog has %d plans: %v", len(c), c)
	}
	if _, ok := c["starter"].For("week"); ok {
		t.Error("an interval that does not exist returned a price")
	}
}

func TestYearIsTenMonths(t *testing.T) {
	want := map[string]int{"starter": 4990, "plus": 11990, "pro": 19990}
	for _, pl := range Plans {
		if got := pl.YearCents(); got != want[pl.ID] {
			t.Errorf("%s yearly = %d; want %d", pl.ID, got, want[pl.ID])
		}
	}
}

// The replies below have the shape Paddle's sandbox returned for a subscription update preview.
func TestPreviewSummary(t *testing.T) {
	for _, c := range []struct {
		name, body, action string
		amount             int64
	}{
		{"monthly to yearly: pays the new price less what was unused",
			`{"update_summary":{"result":{"action":"charge","amount":"10897","currency_code":"EUR"}},
			  "immediate_transaction":{"details":{"totals":{"total":"10897","credit":"0","credit_to_balance":"0","balance":"10897"}}}}`, "charge", 10897},
		{"yearly to monthly: nothing paid, the rest is credited",
			`{"update_summary":{"result":{"action":"credit","amount":"10791","currency_code":"EUR"}},
			  "immediate_transaction":{"details":{"totals":{"total":"-10791","credit":"0","credit_to_balance":"10791","balance":"0"}}}}`, "credit", 10791},
		{"credit already held pays part: only the rest is charged",
			`{"update_summary":{"result":{"action":"charge","amount":"17991","currency_code":"EUR"}},
			  "immediate_transaction":{"details":{"totals":{"total":"17991","credit":"9991","credit_to_balance":"0","balance":"8000"}}}}`, "charge", 8000},
		{"credit already held pays all of it",
			`{"update_summary":{"result":{"action":"charge","amount":"800","currency_code":"EUR"}},
			  "immediate_transaction":{"details":{"totals":{"total":"800","credit":"800","credit_to_balance":"0","balance":"0"}}}}`, "none", 0},
		{"no immediate transaction: the update's own figure",
			`{"update_summary":{"result":{"action":"credit","amount":"638","currency_code":"EUR"}}}`, "credit", 638},
		{"nothing at all", `{}`, "none", 0},
	} {
		var u UpdatePreview
		if err := json.Unmarshal([]byte(c.body), &u); err != nil {
			t.Fatal(err)
		}
		if s := u.Summary(); s.Action != c.action || s.Amount != c.amount || s.Currency != "EUR" || s.FromCredit != (c.name == "credit already held pays all of it") {
			t.Errorf("%s: %+v; want %s %d", c.name, s, c.action, c.amount)
		}
	}
}
