package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"strings"
	"time"
)

// Mailer sends the few transactional emails Coffer needs through Resend:
// sign-up codes and the warnings before a lapsed drive is emptied.
type Mailer struct {
	key, from string
	hc        *http.Client
}

// New returns nil when either the Resend key or the sender is missing.
func New(key, from string) *Mailer {
	if key == "" || from == "" {
		return nil
	}
	return &Mailer{key: key, from: from, hc: &http.Client{Timeout: 20 * time.Second}}
}

// Message is one email in the two languages the app speaks.
type Message struct {
	Subject, Heading, Body string
	Code                   string // shown large, e.g. a sign-in code
	Link, LinkLabel        string // a button to press, e.g. to accept an invitation
	Footer                 string
}

func (m *Mailer) Send(ctx context.Context, to string, msg Message) error {
	text := msg.Heading + "\n\n" + msg.Body
	if msg.Code != "" {
		text += "\n\n" + msg.Code
	}
	if msg.Link != "" {
		text += "\n\n" + msg.LinkLabel + ":\n" + msg.Link
	}
	text += "\n\n" + msg.Footer
	body, _ := json.Marshal(map[string]any{
		"from": m.from, "to": []string{to}, "subject": msg.Subject, "text": text, "html": msg.html(),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+m.key)
	req.Header.Set("Content-Type", "application/json")
	res, err := m.hc.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 2<<10))
		return fmt.Errorf("mail: %d %s", res.StatusCode, strings.TrimSpace(string(b)))
	}
	return nil
}

func (msg Message) html() string {
	code := ""
	if msg.Code != "" {
		code = `<p style="margin:28px 0;font:600 34px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:10px;color:#17382a">` +
			html.EscapeString(msg.Code) + `</p>`
	}
	link := ""
	if msg.Link != "" {
		href := html.EscapeString(msg.Link)
		link = `<p style="margin:28px 0 0"><a href="` + href + `" style="display:inline-block;background:#1f4b37;color:#f4f8f2;font-size:15px;font-weight:600;text-decoration:none;padding:13px 26px;border-radius:999px">` +
			html.EscapeString(msg.LinkLabel) + `</a></p>
<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#8a877e">If the button does not work, open this link:<br><a href="` + href + `" style="color:#55534c;word-break:break-all">` + href + `</a></p>`
	}
	return `<!doctype html><html><body style="margin:0;background:#f7f6f2;padding:40px 16px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1b19">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid #e6e4dc;border-radius:24px">
<tr><td style="padding:36px 36px 32px">
<p style="margin:0 0 28px;font-size:15px;font-weight:600;color:#17382a">Coffer</p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:600">` + html.EscapeString(msg.Heading) + `</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#55534c">` + strings.ReplaceAll(html.EscapeString(msg.Body), "\n", "<br>") + `</p>` + code + link + `
<p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #eeece5;font-size:12px;line-height:1.6;color:#8a877e">` + html.EscapeString(msg.Footer) + `</p>
</td></tr></table></td></tr></table></body></html>`
}

func ru(lang string) bool { return lang == "ru" }

func CodeMessage(lang, code string) Message {
	if ru(lang) {
		return Message{
			Subject: code + " — ваш код Coffer",
			Heading: "Подтвердите почту",
			Body:    "Введите этот код, чтобы закончить создание диска. Он действует 10 минут.",
			Code:    code,
			Footer:  "Если вы не создавали аккаунт Coffer, просто проигнорируйте это письмо.",
		}
	}
	return Message{
		Subject: code + " is your Coffer code",
		Heading: "Confirm your email",
		Body:    "Enter this code to finish creating your drive. It works for 10 minutes.",
		Code:    code,
		Footer:  "If you didn't create a Coffer account, you can ignore this email.",
	}
}

func LapseMessage(lang string, deleteAt time.Time, final bool) Message {
	date := deleteAt.UTC().Format("2 January 2006")
	if ru(lang) {
		date = deleteAt.UTC().Format("02.01.2006")
		msg := Message{
			Subject: "Ваш диск Coffer доступен только для чтения",
			Heading: "Срок тарифа истёк",
			Body:    "Файлы на месте: их можно скачивать и удалять, но нельзя добавлять, а ссылки приостановлены.\nЕсли не продлить тариф, " + date + " файлы будут удалены без возможности восстановления.",
			Footer:  "Продлить тариф можно в настройках Coffer. Мы не можем восстановить удалённые файлы: ключи есть только у вас.",
		}
		if final {
			msg.Subject = "Файлы в Coffer будут удалены " + date
			msg.Heading = "Осталась неделя"
		}
		return msg
	}
	msg := Message{
		Subject: "Your Coffer drive is now read-only",
		Heading: "Your plan has ended",
		Body:    "Your files are still there: you can download and delete them, but not add more, and your share links are paused.\nUnless you renew, they will be permanently deleted on " + date + ".",
		Footer:  "Renew any time from Settings in Coffer. Deleted files cannot be recovered by anyone: only you ever held the keys.",
	}
	if final {
		msg.Subject = "Your Coffer files will be deleted on " + date
		msg.Heading = "One week left"
	}
	return msg
}

func PurgedMessage(lang string) Message {
	if ru(lang) {
		return Message{
			Subject: "Файлы в Coffer удалены",
			Heading: "Диск очищен",
			Body:    "Тариф не был продлён, поэтому файлы, папки и ссылки удалены. Аккаунт остался: выберите тариф, чтобы начать заново.",
			Footer:  "Это письмо отправлено, потому что у вас есть аккаунт Coffer.",
		}
	}
	return Message{
		Subject: "Your Coffer files have been deleted",
		Heading: "Your drive has been emptied",
		Body:    "Your plan was not renewed, so the files, folders and links in your drive have been deleted. Your account is still here: pick a plan to start again.",
		Footer:  "You are receiving this because you have a Coffer account.",
	}
}
