package app

import (
	"context"
	"crypto/hmac"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"coffer/internal/mail"
	"coffer/internal/paddle"
	"coffer/internal/store"
)

// Subscriptions. With billing on there is no free drive: an account can only
// add to its drive while a Paddle subscription is in good standing. When one
// lapses the drive turns read-only (files can still be downloaded and deleted)
// and its share links pause; after a grace period, and two warnings, the files
// are deleted.
//
// Paddle learns the email and payment details the customer types into its
// checkout. It never sees keys, file names or contents.

// subState is where an account stands, with the rules that follow from it.
type subState struct {
	store.Standing
	Offer *offer
}

// offer is a personal price an admin has put to one account, bought through
// the normal checkout instead of one of the listed plans.
type offer struct {
	Cents     int    `json:"cents"`     // per interval, in EUR cents
	Interval  string `json:"interval"`  // "month" or "year"
	TrialDays int    `json:"trialDays"` // free days before the first charge
	Quota     int64  `json:"quota"`     // bytes
}

func (o *offer) valid() bool {
	return o.Cents >= 100 && o.Cents <= 1_000_000 && (o.Interval == "month" || o.Interval == "year") &&
		o.TrialDays >= 0 && o.TrialDays <= 365 && o.Quota >= 1<<30 && o.Quota <= 100<<40
}

// comped reports whether an admin's complimentary allowance is in force.
func (s *subState) comped() bool {
	return s.CompQuota.Valid && (!s.CompUntil.Valid || s.CompUntil.Int64 > now())
}

// covered reports whether the drive can be added to: a plan in good standing
// or a complimentary allowance, and no suspension.
func (s *subState) covered() bool {
	return !s.Suspended && (entitled(s.Status.String) || s.comped())
}

// allowance is how many bytes the account may store right now.
func (s *subState) allowance() int64 {
	q := int64(0)
	if entitled(s.Status.String) || !s.Plan.Valid {
		q = s.Quota // a running plan, or a free drive on a server without billing
	}
	if s.comped() {
		q = max(q, s.CompQuota.Int64)
	}
	return q
}

// entitled reports whether a subscription status lets the drive be written to.
// past_due stays writable while Paddle retries the payment.
func entitled(status string) bool {
	return status == "active" || status == "trialing" || status == "past_due"
}

func (a *App) subState(uid string) (*subState, error) {
	st, err := a.db.Standing(uid)
	if err != nil {
		return nil, err
	}
	s := subState{Standing: *st}
	if st.OfferJSON.Valid {
		var o offer
		if json.Unmarshal([]byte(st.OfferJSON.String), &o) == nil && o.valid() {
			s.Offer = &o
		}
	}
	return &s, nil
}

var (
	errNoPlan     = errf(http.StatusPaymentRequired, "an active plan is needed to add to your drive")
	errUnverified = errf(http.StatusForbidden, "confirm your email first")
	errSuspended  = errf(http.StatusForbidden, "this account has been suspended")
)

// writeQuota returns how much the user may store, or errNoPlan when the drive is read-only.
func (a *App) writeQuota(uid string) (int64, error) {
	s, err := a.subState(uid)
	if err != nil {
		return 0, err
	}
	if s.Suspended {
		return 0, errSuspended
	}
	if !s.Verified {
		return 0, errUnverified
	}
	if a.billing != nil && !s.covered() {
		return 0, errNoPlan
	}
	return s.allowance(), nil
}

func (a *App) billingJSON(s *subState) any {
	if a.billing == nil {
		return nil
	}
	out := map[string]any{
		"plan":     nil,
		"status":   nil,
		"entitled": s.covered(),
		"pending":  s.PendingTxn.Valid,
	}
	if s.Plan.Valid {
		out["plan"] = s.Plan.String
		out["status"] = s.Status.String
	}
	if s.comped() {
		comp := map[string]any{"quota": s.CompQuota.Int64}
		if s.CompUntil.Valid {
			comp["until"] = s.CompUntil.Int64
		}
		out["comp"] = comp
	}
	if s.Offer != nil && !entitled(s.Status.String) {
		out["offer"] = map[string]any{
			"amount": s.Offer.Cents, "currency": "EUR", "interval": s.Offer.Interval,
			"trialDays": s.Offer.TrialDays, "quota": s.Offer.Quota,
		}
	}
	if s.PeriodEnd.Valid {
		out["periodEnd"] = s.PeriodEnd.Int64
	}
	if s.CancelAt.Valid {
		out["cancelAt"] = s.CancelAt.Int64
	}
	// A lapsed drive is emptied once its grace period is over.
	if s.LapsedAt.Valid && !s.covered() {
		out["deleteAt"] = s.LapsedAt.Int64 + int64(a.cfg.LapseGrace.Seconds())
	}
	return out
}

// plansJSON lists the plans that can be bought right now, with Paddle's prices.
func (a *App) plansJSON(ctx context.Context) []map[string]any {
	out := []map[string]any{}
	prices, err := a.billing.Catalog(ctx)
	if err != nil {
		log.Printf("billing: catalog: %v", err)
		return out
	}
	for _, pl := range paddle.Plans {
		p, ok := prices[pl.ID]
		if !ok {
			continue
		}
		amount, _ := strconv.ParseInt(p.UnitPrice.Amount, 10, 64)
		out = append(out, map[string]any{
			"id": pl.ID, "name": pl.Name, "quota": pl.Quota, "amount": amount, "currency": p.UnitPrice.Currency,
		})
	}
	return out
}

func (a *App) handleCheckout(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	var req struct {
		Plan string `json:"plan"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	// A payment may have gone through since we last heard from Paddle.
	if err := a.syncBilling(r.Context(), uid); err != nil {
		log.Printf("billing: sync: %v", err)
	}
	s, err := a.subState(uid)
	if err != nil {
		return err
	}
	if s.Suspended {
		return errSuspended
	}
	if !s.Verified {
		return errUnverified
	}
	if entitled(s.Status.String) {
		return errf(http.StatusConflict, "you already have a plan")
	}
	// Either one of the listed plans, or the price an admin set for this account.
	item := map[string]any{"quantity": 1}
	if req.Plan == "offer" && s.Offer != nil {
		o := s.Offer
		price := map[string]any{
			"name":          fmt.Sprintf("%d GB", o.Quota>>30),
			"description":   "Coffer, personal plan",
			"unit_price":    map[string]string{"amount": strconv.Itoa(o.Cents), "currency_code": "EUR"},
			"billing_cycle": map[string]any{"interval": o.Interval, "frequency": 1},
			"quantity":      map[string]int{"minimum": 1, "maximum": 1},
			"custom_data":   paddle.Tag{Quota: o.Quota},
			"product": map[string]any{
				"name": "Coffer", "tax_category": "standard",
				"description": fmt.Sprintf("%d GB of end-to-end encrypted storage", o.Quota>>30),
			},
		}
		if o.TrialDays > 0 {
			price["trial_period"] = map[string]any{"interval": "day", "frequency": o.TrialDays}
		}
		item["price"] = price
	} else {
		prices, err := a.billing.Catalog(r.Context())
		if err != nil {
			return err
		}
		price, ok := prices[req.Plan]
		if !ok {
			return errf(http.StatusBadRequest, "this plan is not available")
		}
		item["price_id"] = price.ID
	}
	// Paddle sends the customer to the account's default payment link, which
	// must point at this server's /pay page, unless another approved page is named.
	body := map[string]any{
		"items":       []map[string]any{item},
		"custom_data": paddle.Tag{UserID: uid},
	}
	// Naming the customer saves them typing their email again at the checkout.
	if customer, err := a.paddleCustomer(r.Context(), uid, s); err != nil {
		log.Printf("billing: customer: %v", err)
	} else {
		body["customer_id"] = customer
	}
	if a.cfg.PaddleCheckoutURL != "" {
		body["checkout"] = map[string]string{"url": a.cfg.PaddleCheckoutURL}
	}
	var txn struct {
		ID       string `json:"id"`
		Checkout struct {
			URL string `json:"url"`
		} `json:"checkout"`
	}
	if err := a.billing.Call(r.Context(), http.MethodPost, "/transactions", body, &txn); err != nil {
		log.Printf("billing: checkout: %v", err)
		return errf(http.StatusBadGateway, "the checkout could not be opened, please try again shortly")
	}
	if err := a.db.SetPendingTxn(uid, txn.ID); err != nil {
		return err
	}
	link := txn.Checkout.URL
	// On a plain-http development server, open the transaction on this server's
	// own checkout page instead of the one Paddle knows about.
	if !a.isSecure(r) && a.cfg.PaddleCheckoutURL == "" {
		link = "http://" + r.Host + "/pay?_ptxn=" + url.QueryEscape(txn.ID)
	}
	writeJSON(w, 200, map[string]string{"url": link})
	return nil
}

func (a *App) handleBillingSync(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	if err := a.syncBilling(r.Context(), uid); err != nil {
		return err
	}
	return a.writeMe(w, uid)
}

// handleChangePlan moves a running subscription to another plan. Paddle
// charges or credits the difference for the rest of the period right away.
func (a *App) handleChangePlan(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	var req struct {
		Plan string `json:"plan"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	s, err := a.subState(uid)
	if err != nil {
		return err
	}
	pl := paddle.PlanByID(req.Plan)
	prices, err := a.billing.Catalog(r.Context())
	if err != nil {
		return err
	}
	price, ok := prices[req.Plan]
	if pl == nil || !ok {
		return errf(http.StatusBadRequest, "this plan is not available")
	}
	if !s.SubID.Valid || s.Status.String != "active" {
		return errf(http.StatusConflict, "there is no active plan to change")
	}
	if s.Plan.String == pl.ID {
		return errf(http.StatusConflict, "you are already on this plan")
	}
	used, err := a.db.Usage(uid)
	if err != nil {
		return err
	}
	if used > pl.Quota {
		return errf(http.StatusConflict, "you are storing more than this plan holds")
	}
	var sub paddle.Subscription
	err = a.billing.Call(r.Context(), http.MethodPatch, "/subscriptions/"+s.SubID.String, map[string]any{
		"items":                  []map[string]any{{"price_id": price.ID, "quantity": 1}},
		"proration_billing_mode": "prorated_immediately",
	}, &sub)
	if err != nil {
		var pe *paddle.Error
		if errors.As(err, &pe) && pe.Status < 500 {
			log.Printf("billing: change plan: %v", err)
			return errf(http.StatusConflict, "the plan could not be changed, check your payment method")
		}
		return err
	}
	if err := a.applySub(r.Context(), uid, &sub); err != nil {
		return err
	}
	return a.writeMe(w, uid)
}

// handlePortal sends the customer to Paddle's portal to update their card,
// download invoices or cancel.
func (a *App) handlePortal(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	s, err := a.subState(uid)
	if err != nil {
		return err
	}
	if !s.CustomerID.Valid {
		return errf(http.StatusConflict, "there is no plan to manage yet")
	}
	body := map[string]any{}
	if s.SubID.Valid {
		body["subscription_ids"] = []string{s.SubID.String}
	}
	var out struct {
		URLs struct {
			General struct {
				Overview string `json:"overview"`
			} `json:"general"`
		} `json:"urls"`
	}
	if err := a.billing.Call(r.Context(), http.MethodPost, "/customers/"+s.CustomerID.String+"/portal-sessions", body, &out); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]string{"url": out.URLs.General.Overview})
	return nil
}

// syncBilling asks Paddle for the truth about a user's subscription. Webhooks
// normally keep us current; this covers the return from checkout, missed
// webhooks and servers Paddle cannot reach.
func (a *App) syncBilling(ctx context.Context, uid string) error {
	s, err := a.subState(uid)
	if err != nil {
		return err
	}
	subID := s.SubID.String
	if s.PendingTxn.Valid {
		var txn struct {
			Status         string  `json:"status"`
			SubscriptionID *string `json:"subscription_id"`
		}
		err := a.billing.Call(ctx, http.MethodGet, "/transactions/"+s.PendingTxn.String, nil, &txn)
		var pe *paddle.Error
		switch {
		case errors.As(err, &pe) && pe.Status == http.StatusNotFound, err == nil && txn.Status == "canceled":
			if err := a.db.ClearPendingTxn(uid); err != nil {
				return err
			}
		case err != nil:
			return err
		case txn.SubscriptionID != nil:
			subID = *txn.SubscriptionID
		}
	}
	if subID == "" {
		return nil
	}
	var sub paddle.Subscription
	if err := a.billing.Call(ctx, http.MethodGet, "/subscriptions/"+subID, nil, &sub); err != nil {
		return err
	}
	return a.applySub(ctx, uid, &sub)
}

// applySub records a subscription's state on the user. Older snapshots than
// the one already stored are ignored, so late or replayed webhooks are harmless.
func (a *App) applySub(ctx context.Context, uid string, sub *paddle.Subscription) error {
	if len(sub.Items) == 0 {
		return fmt.Errorf("billing: subscription %s has no items", sub.ID)
	}
	pl := a.billing.PlanOfPrice(ctx, sub.Items[0].Price.ID)
	if tag := sub.Items[0].Price.CustomData; pl == nil && tag != nil && tag.Quota > 0 {
		pl = &paddle.Plan{ID: "custom", Quota: tag.Quota} // a personal price set by an admin
	}
	if pl == nil {
		return fmt.Errorf("billing: subscription %s is for an unknown price %s", sub.ID, sub.Items[0].Price.ID)
	}
	snap := store.Subscription{
		ID: sub.ID, CustomerID: sub.CustomerID, Plan: pl.ID, Status: sub.Status, Quota: pl.Quota,
		Entitled: entitled(sub.Status), UpdatedAt: sub.UpdatedAt.UnixMicro(),
	}
	if sub.CurrentPeriod != nil {
		end := sub.CurrentPeriod.EndsAt.Unix()
		snap.PeriodEnd = &end
	}
	if sub.ScheduledChange != nil && sub.ScheduledChange.Action == "cancel" {
		at := sub.ScheduledChange.EffectiveAt.Unix()
		snap.CancelAt = &at
	}
	return a.db.ApplySubscription(uid, snap)
}

var customerIDRe = regexp.MustCompile(`ctm_[0-9a-z]+`)

// paddleCustomer finds or creates the Paddle customer for a verified account.
func (a *App) paddleCustomer(ctx context.Context, uid string, s *subState) (string, error) {
	if s.CustomerID.Valid {
		return s.CustomerID.String, nil
	}
	email, err := a.db.Email(uid)
	if err != nil {
		return "", err
	}
	var c struct {
		ID string `json:"id"`
	}
	err = a.billing.Call(ctx, http.MethodPost, "/customers", map[string]any{"email": email, "custom_data": paddle.Tag{UserID: uid}}, &c)
	var pe *paddle.Error
	if errors.As(err, &pe) && pe.Status == http.StatusConflict {
		// Paddle already knows this (verified) address and names the customer in its reply.
		c.ID, err = customerIDRe.FindString(pe.Detail), nil
	}
	if err != nil || c.ID == "" {
		return "", fmt.Errorf("no customer for checkout: %v", err)
	}
	return c.ID, a.db.SetCustomer(uid, c.ID)
}

// cancelSub ends a user's subscription now, e.g. when the account is deleted.
func (a *App) cancelSub(ctx context.Context, uid string) error {
	s, err := a.subState(uid)
	if err != nil {
		return err
	}
	if !s.SubID.Valid || s.Status.String == "canceled" {
		return nil
	}
	err = a.billing.Call(ctx, http.MethodPost, "/subscriptions/"+s.SubID.String+"/cancel",
		map[string]string{"effective_from": "immediately"}, nil)
	var pe *paddle.Error
	if errors.As(err, &pe) && pe.Code == "subscription_update_when_canceled" {
		return nil
	}
	return err
}

// handleWebhook receives subscription events from Paddle. The signature is an
// HMAC of the timestamp and raw body under the destination's secret.
func (a *App) handleWebhook(w http.ResponseWriter, r *http.Request) error {
	if a.billing.WebhookSecret == "" {
		return errNotFound
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		return err
	}
	var ts, h1 string
	for part := range strings.SplitSeq(r.Header.Get("Paddle-Signature"), ";") {
		k, v, _ := strings.Cut(part, "=")
		switch k {
		case "ts":
			ts = v
		case "h1":
			h1 = v
		}
	}
	sent, _ := strconv.ParseInt(ts, 10, 64)
	want := hmacSHA([]byte(a.billing.WebhookSecret), append([]byte(ts+":"), raw...))
	got, _ := hex.DecodeString(h1)
	if !hmac.Equal(got, want) || time.Since(time.Unix(sent, 0)).Abs() > 5*time.Minute {
		return errForbidden
	}
	var ev struct {
		Type string          `json:"event_type"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &ev); err != nil {
		return errf(http.StatusBadRequest, "invalid event")
	}
	if strings.HasPrefix(ev.Type, "subscription.") {
		var sub paddle.Subscription
		if err := json.Unmarshal(ev.Data, &sub); err != nil {
			return errf(http.StatusBadRequest, "invalid event")
		}
		if err := a.applyEvent(r.Context(), &sub); err != nil {
			return err // Paddle retries
		}
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

func (a *App) applyEvent(ctx context.Context, sub *paddle.Subscription) error {
	// Checkouts carry our user id; fall back to the subscription we already know.
	var named string
	if sub.CustomData != nil {
		named = sub.CustomData.UserID
	}
	uid, current, err := a.db.SubscriptionAccount(named, sub.ID)
	if errors.Is(err, store.ErrNotFound) {
		log.Printf("billing: event for subscription %s matches no account", sub.ID)
		return nil
	} else if err != nil {
		return err
	}
	// An old, ended subscription must not overwrite the one that replaced it.
	if current != "" && current != sub.ID && !entitled(sub.Status) {
		return nil
	}
	if current != sub.ID {
		if err := a.db.ResetSubscriptionClock(uid); err != nil {
			return err
		}
	}
	return a.applySub(ctx, uid, sub)
}

// syncDue refreshes subscriptions whose paid period has run out, or that are
// waiting on a checkout, in case a webhook never arrived.
func (a *App) syncDue(ctx context.Context) {
	ids, err := a.db.DueSubscriptions()
	if err != nil {
		log.Printf("billing: due: %v", err)
		return
	}
	for _, uid := range ids {
		if err := a.syncBilling(ctx, uid); err != nil {
			log.Printf("billing: sync %s: %v", uid, err)
		}
	}
}

const finalWarning = 7 * 24 * time.Hour

// enforceLapse walks the drives whose plan has ended: it tells the owner once,
// warns them again a week before the end of the grace period and, after that,
// deletes the files. The account itself stays so they can start over.
func (a *App) enforceLapse(ctx context.Context) {
	// A complimentary allowance that has run out, with no plan behind it, lapses like a plan does.
	if err := a.db.LapseExpiredAllowances(); err != nil {
		log.Printf("billing: lapsed allowances: %v", err)
	}
	all, err := a.db.Lapsed()
	if err != nil {
		log.Printf("billing: lapsed: %v", err)
		return
	}

	grace := int64(a.cfg.LapseGrace.Seconds())
	week := int64(finalWarning.Seconds())
	for _, l := range all {
		deleteAt := l.At + grace
		notify := func(level int, msg mail.Message) {
			if a.mail != nil {
				if err := a.mail.Send(ctx, l.Email, msg); err != nil {
					log.Printf("mail: lapse notice: %v", err)
					return // try again next hour
				}
			}
			if err := a.db.SetLapseNotice(l.ID, level); err != nil {
				log.Printf("billing: lapse notice: %v", err)
			}
		}
		switch {
		case l.Notice == 0 && now() < deleteAt-week:
			notify(1, mail.LapseMessage(l.Lang, time.Unix(deleteAt, 0), false))
		case l.Notice < 2:
			// Whatever happened before, nothing is deleted less than a week after the final warning.
			if deleteAt < now()+week {
				deleteAt = now() + week
				if err := a.db.SetLapsedAt(l.ID, deleteAt-grace); err != nil {
					log.Printf("billing: lapse: %v", err)
					continue
				}
			}
			if now() >= deleteAt-week {
				notify(2, mail.LapseMessage(l.Lang, time.Unix(deleteAt, 0), true))
			}
		case now() >= deleteAt:
			if err := a.emptyDrive(ctx, l.ID); err != nil {
				log.Printf("billing: empty lapsed drive %s: %v", l.ID, err)
			} else if a.mail != nil {
				if err := a.mail.Send(ctx, l.Email, mail.PurgedMessage(l.Lang)); err != nil {
					log.Printf("mail: purge notice: %v", err)
				}
			}
		}
	}
}

// emptyDrive deletes everything a lapsed account stored, after checking with
// Paddle one last time that the plan really is not running.
func (a *App) emptyDrive(ctx context.Context, uid string) error {
	if a.billing != nil {
		if err := a.syncBilling(ctx, uid); err != nil {
			return err
		}
	}
	s, err := a.subState(uid)
	if err != nil {
		return err
	}
	if entitled(s.Status.String) || s.comped() || !s.LapsedAt.Valid {
		return nil // renewed in the meantime
	}
	ids, err := a.db.UserItemIDs(uid)
	if err != nil {
		return err
	}
	if err := a.db.EmptyDrive(uid); err != nil {
		return err
	}
	a.removeBlobs(ids)
	log.Printf("billing: emptied the lapsed drive of %s (%d items)", uid, len(ids))
	return nil
}
