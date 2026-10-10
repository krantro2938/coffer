package app

import (
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// The checkout page. It is the one place third-party code runs, so it is a
// bare page of its own, away from the app shell: Paddle's script is never
// loaded next to an open drive. Serve it from a hostname of its own
// (https://pay.<domain>/pay, set as Paddle's default payment link, with
// PUBLIC_URL naming the app) so that script cannot reach the app's storage
// either; a page on the same origin could.
//
// The page is ours: the order summary, the copy and the styling. Paddle only
// draws the payment form itself, in a frame it controls.

//go:embed assets/geist-latin.woff2
var geistLatin []byte

//go:embed assets/geist-cyrillic.woff2
var geistCyrillic []byte

const payHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Coffer · Checkout</title>
<style>
@font-face { font-family: Geist; font-weight: 100 900; font-display: swap; src: url(data:font/woff2;base64,__LATIN__) format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: Geist; font-weight: 100 900; font-display: swap; src: url(data:font/woff2;base64,__CYRILLIC__) format("woff2");
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
:root {
  color-scheme: light dark;
  --bg: oklch(0.975 0.005 95); --fg: oklch(0.21 0.022 160); --muted: oklch(0.5 0.015 160);
  --card: #fff; --line: oklch(0.91 0.008 95);
  --forest: oklch(0.3 0.055 158); --on-forest: oklch(0.96 0.02 140); --mint: oklch(0.9 0.06 150);
}
@media (prefers-color-scheme: dark) {
  :root { --bg: oklch(0.165 0.012 160); --fg: oklch(0.95 0.008 150); --muted: oklch(0.68 0.015 155);
    --card: oklch(0.2 0.014 160); --line: oklch(1 0 0 / 8%); --forest: oklch(0.24 0.04 158); }
}
* { box-sizing: border-box; }
html { font-family: Geist, ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; font-feature-settings: "ss01", "cv11"; }
body { margin: 0; min-height: 100svh; background: var(--bg); color: var(--fg); font-size: 15px; line-height: 1.5; }
a { color: inherit; }
.page { display: grid; min-height: 100svh; }
.summary { position: relative; overflow: hidden; background: var(--forest); color: var(--on-forest); padding: 20px 20px 32px; display: flex; flex-direction: column; gap: 32px; }
.summary::before, .summary::after { content: ""; position: absolute; border-radius: 50%; border: 1px solid rgb(255 255 255 / 10%); pointer-events: none; }
.summary::before { width: 36rem; height: 36rem; right: -18rem; bottom: -20rem; }
.summary::after { width: 24rem; height: 24rem; right: -12rem; bottom: -14rem; }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; font-size: 17px; letter-spacing: -0.02em; text-decoration: none; }
.brand svg { width: 28px; height: 28px; }
.order { position: relative; max-width: 26rem; }
h1 { margin: 0; font-size: clamp(2rem, 5vw, 3rem); line-height: 1.04; font-weight: 500; letter-spacing: -0.035em; }
.what { margin: 12px 0 0; opacity: .7; text-wrap: pretty; }
.price { margin: 28px 0 0; font-size: 2.25rem; font-weight: 500; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.price small { font-size: 15px; font-weight: 400; letter-spacing: 0; opacity: .65; margin-left: 6px; }
dl { margin: 24px 0 0; padding-top: 4px; border-top: 1px solid rgb(255 255 255 / 12%); font-variant-numeric: tabular-nums; }
dl div { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid rgb(255 255 255 / 8%); }
dt { opacity: .7; } dd { margin: 0; }
dl div.due dt, dl div.due dd { opacity: 1; font-weight: 500; }
.then { margin: 14px 0 0; font-size: 13px; opacity: .65; }
.notes { position: relative; margin: auto 0 0; padding: 0; list-style: none; display: grid; gap: 10px; max-width: 26rem; font-size: 13px; }
.notes li { display: flex; gap: 10px; opacity: .8; }
.notes svg { flex: none; width: 16px; height: 16px; margin-top: 2px; color: var(--mint); }
.pay { padding: 28px 16px 40px; display: flex; flex-direction: column; align-items: center; }
.pay-inner { width: 100%; max-width: 30rem; }
.pay h2 { margin: 0 0 4px; font-size: 1.25rem; font-weight: 500; letter-spacing: -0.02em; }
.pay p.sub { margin: 0 0 20px; color: var(--muted); font-size: 14px; }
.frame { background: var(--card); border: 1px solid var(--line); border-radius: 24px; padding: 20px; min-height: 420px;
  box-shadow: 0 1px 2px oklch(0.2 0.02 160 / 4%), 0 8px 24px -8px oklch(0.2 0.02 160 / 10%); }
.frame[data-state="loading"] { display: grid; place-items: center; color: var(--muted); }
.spinner { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--forest); animation: spin .8s linear infinite; }
@keyframes spin { to { rotate: 360deg; } }
.foot { margin-top: 18px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px; color: var(--muted); font-size: 13px; }
.foot a { text-underline-offset: 3px; }
.error { color: var(--fg); text-align: center; }
.skeleton { display: inline-block; min-width: 4ch; border-radius: 6px; background: rgb(255 255 255 / 12%); color: transparent; }
@media (min-width: 900px) {
  .page { grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); }
  .summary { padding: 28px 40px 40px; }
  .order { margin-top: 12vh; }
  .pay { padding: 0 32px; justify-content: center; }
}
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
</head>
<body>
<div class="page">
  <section class="summary">
    <a class="brand" id="home" href="/">
      <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="oklch(0.96 0.02 140)"/><circle cx="16" cy="13.5" r="4.25" fill="oklch(0.3 0.055 158)"/><path d="M14.1 16.5h3.8l1.1 7.5h-6z" fill="oklch(0.3 0.055 158)"/><circle cx="16" cy="13.5" r="1.6" fill="oklch(0.96 0.02 140)"/></svg>
      Coffer
    </a>
    <div class="order">
      <h1 id="name"><span class="skeleton">Coffer</span></h1>
      <p class="what" id="what"></p>
      <p class="price"><span id="price"><span class="skeleton">00.00</span></span><small id="per"></small></p>
      <dl>
        <div><dt id="l-sub"></dt><dd id="subtotal">–</dd></div>
        <div><dt id="l-tax"></dt><dd id="tax">–</dd></div>
        <div class="due"><dt id="l-due"></dt><dd id="total">–</dd></div>
      </dl>
      <p class="then" id="then"></p>
    </div>
    <ul class="notes">
      <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span id="n-card"></span></li>
      <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span id="n-cancel"></span></li>
    </ul>
  </section>
  <section class="pay">
    <div class="pay-inner">
      <h2 id="pay-title"></h2>
      <p class="sub" id="pay-sub"></p>
      <div class="frame" id="frame" data-state="loading"><div class="spinner" role="status" id="spinner"></div><div class="coffer-checkout"></div></div>
      <div class="foot"><a id="back" href="/"></a><span><a id="terms" href="/terms"></a> · <a id="privacy" href="/privacy"></a></span></div>
    </div>
  </section>
</div>
<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
<script src="/pay.js"></script>
</body>
</html>
`

const payJS = `(function () {
  var cfg = __CFG__;
  var app = cfg.app || location.origin;
  var ru = /(?:^|;\s*)coffer-lang=ru\b/.test(document.cookie) || (!/coffer-lang=en/.test(document.cookie) && /^ru\b/i.test(navigator.language || ""));
  var T = ru ? {
    sub: "Подытог", tax: "НДС", due: "К оплате сегодня", payTitle: "Способ оплаты", paySub: "Форму ниже показывает Paddle, наш платёжный партнёр.",
    card: "Данные карты уходят напрямую в Paddle. Coffer их не видит и не хранит.",
    cancel: "Отменить можно в любой момент в настройках. Диск останется открыт до конца оплаченного периода.",
    back: "Вернуться в Coffer", terms: "Условия", privacy: "Конфиденциальность",
    month: "в месяц", year: "в год", then: "Далее {price} {per}, пока вы не отмените.",
    trial: "Первые {n} дн. бесплатно, затем {price} {per}.", free: "Сегодня ничего не списывается",
    error: "Не удалось открыть оплату. Вернитесь в Coffer и попробуйте ещё раз."
  } : {
    sub: "Subtotal", tax: "VAT", due: "Due today", payTitle: "Payment", paySub: "The form below is shown by Paddle, our payment partner.",
    card: "Your card details go straight to Paddle. Coffer never sees or stores them.",
    cancel: "Cancel whenever you like from Settings. Your drive stays open until the end of the period you paid for.",
    back: "Back to Coffer", terms: "Terms", privacy: "Privacy",
    month: "a month", year: "a year", then: "Then {price} {per} until you cancel.",
    trial: "Free for the first {n} days, then {price} {per}.", free: "Nothing is charged today",
    error: "The checkout could not be opened. Go back to Coffer and try again."
  };
  var $ = function (id) { return document.getElementById(id); };
  var set = function (id, text) { $(id).textContent = text; };
  document.documentElement.lang = ru ? "ru" : "en";
  set("l-sub", T.sub); set("l-tax", T.tax); set("l-due", T.due); set("pay-title", T.payTitle); set("pay-sub", T.paySub);
  set("n-card", T.card); set("n-cancel", T.cancel); set("back", T.back); set("terms", T.terms); set("privacy", T.privacy);
  $("terms").href = app + "/terms"; $("privacy").href = app + "/privacy";
  $("back").href = app + "/drive?billing=closed";
  $("home").href = app + "/";

  var fail = function () {
    $("frame").dataset.state = "loading";
    $("frame").innerHTML = '<p class="error"></p>';
    $("frame").firstChild.textContent = T.error;
  };
  if (!/[?&]_ptxn=/.test(location.search)) return location.replace(app + "/drive");
  if (!window.Paddle) return fail();

  var money = function (n, currency) {
    return new Intl.NumberFormat(ru ? "ru" : "en", { style: "currency", currency: currency }).format(n);
  };
  // Paddle reports what is in the checkout; the summary on the left is drawn from that.
  var show = function (d) {
    if (!d || !d.items || !d.items.length) return;
    var item = d.items[0], cur = d.currency_code, per = item.billing_cycle ? T[item.billing_cycle.interval] || "" : "";
    var recurring = d.recurring_totals ? d.recurring_totals.total : d.totals.total;
    set("name", item.product.name);
    set("what", item.product.description || "");
    set("price", money(recurring, cur));
    set("per", per);
    set("subtotal", money(d.totals.subtotal, cur));
    set("tax", money(d.totals.tax, cur));
    set("total", money(d.totals.total, cur));
    var fill = function (s) { return s.replace("{price}", money(recurring, cur)).replace("{per}", per); };
    if (item.trial_period) {
      var days = item.trial_period.frequency * ({ day: 1, week: 7, month: 30, year: 365 }[item.trial_period.interval] || 1);
      set("then", fill(T.trial).replace("{n}", days));
      set("l-due", T.free);
    } else set("then", per ? fill(T.then) : "");
  };

  if (cfg.sandbox) Paddle.Environment.set("sandbox");
  Paddle.Initialize({
    token: cfg.token,
    checkout: {
      settings: {
        displayMode: "inline",
        variant: "one-page",
        frameTarget: "coffer-checkout",
        frameInitialHeight: 420,
        frameStyle: "width: 100%; min-width: 280px; background-color: transparent; border: none;",
        theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        locale: ru ? "ru" : "en",
        successUrl: app + "/drive?billing=success",
        allowLogout: false
      }
    },
    eventCallback: function (e) {
      if (e.name === "checkout.loaded") { $("spinner").remove(); $("frame").dataset.state = "ready"; }
      if (e.name === "checkout.loaded" || e.name === "checkout.updated" || e.name === "checkout.customer.created" || e.name === "checkout.customer.updated") show(e.data);
      if (e.name === "checkout.completed") setTimeout(function () { location.replace(app + "/drive?billing=success"); }, 1500);
      if (e.name === "checkout.error" && $("frame").dataset.state === "loading") fail();
    }
  });
})();
`

func (a *App) payCSP() string {
	buy, cdn := "https://buy.paddle.com", "https://cdn.paddle.com"
	if a.billing.Sandbox {
		buy, cdn = "https://sandbox-buy.paddle.com", "https://cdn.paddle.com https://sandbox-cdn.paddle.com"
	}
	return strings.Join([]string{
		"default-src 'none'",
		"script-src 'self' https://cdn.paddle.com https://public.profitwell.com",
		"style-src 'unsafe-inline' " + cdn,
		"img-src data: " + cdn,
		"font-src data:",
		"frame-src " + buy,
		"connect-src " + buy + " " + cdn,
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'",
	}, "; ")
}

func (a *App) handlePayPage(w http.ResponseWriter, r *http.Request) error {
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Security-Policy", a.payCSP())
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), usb=(), interest-cohort=()")
	_, _ = io.WriteString(w, a.payPage)
	return nil
}

func (a *App) handlePayScript(w http.ResponseWriter, r *http.Request) error {
	cfg, _ := json.Marshal(map[string]any{"token": a.billing.ClientToken, "sandbox": a.billing.Sandbox, "app": a.cfg.PublicURL})
	h := w.Header()
	h.Set("Content-Type", "text/javascript; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	_, _ = io.WriteString(w, strings.Replace(payJS, "__CFG__", string(cfg), 1))
	return nil
}

func renderPayPage() string {
	return strings.NewReplacer(
		"__LATIN__", base64.StdEncoding.EncodeToString(geistLatin),
		"__CYRILLIC__", base64.StdEncoding.EncodeToString(geistCyrillic),
	).Replace(payHTML)
}
