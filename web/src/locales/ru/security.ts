import type { Messages } from "../types"

/** The security page. */
const messages: Messages = {
  "Security model": "Модель безопасности",
  "How Coffer keeps your data unreadable.": "Как Coffer делает ваши данные нечитаемыми.",
  "Coffer is designed so that a complete compromise of the server — database, disks and code on disk — reveals nothing about what you've stored or shared.":
    "Coffer устроен так, что даже полный взлом сервера — базы данных, дисков и кода на них — не раскрывает ничего о том, что вы храните или отправляете.",
  "Everything is encrypted before upload": "Всё шифруется до загрузки",
  "Each file or note gets its own random 256-bit key. Content is split into 4 MB chunks and sealed with AES-256-GCM in your browser. Chunk nonces encode position and a final-chunk flag, so the server can't reorder, drop or truncate data without detection. File names, types and sizes are encrypted separately.":
    "Каждый файл или заметка получает собственный случайный 256-битный ключ. Содержимое делится на блоки по 4 МБ и шифруется AES-256-GCM в вашем браузере. Nonce каждого блока кодирует его позицию и признак последнего блока, поэтому сервер не может незаметно переставить, выбросить или обрезать данные. Имена, типы и размеры файлов шифруются отдельно.",
  "Share links carry the key": "Ключ передаётся в ссылке",
  "A link looks like /s/k7m3xq2#h4c9w2pz8rtf6mxn. The part after # is an 80-bit secret that browsers never send to servers. From it we derive two things: a key that unwraps the file key, and an access token. The server only stores a SHA-256 hash of that token, so it can check a recipient without being able to decrypt anything.":
    "Ссылка выглядит так: /s/k7m3xq2#h4c9w2pz8rtf6mxn. Часть после # — 80-битный секрет, который браузеры никогда не отправляют на сервер. Из него получаются две вещи: ключ, открывающий ключ файла, и токен доступа. Сервер хранит только SHA-256-хеш токена, поэтому может проверить получателя, но не может ничего расшифровать.",
  "Folders are shared as sealed snapshots": "Папки передаются как зашифрованные снимки",
  "Sharing a folder encrypts a manifest of its files — names, paths and each file's key — under a fresh link key. The server only learns which encrypted items that link is allowed to serve, so a folder link can never be used to fetch anything else.":
    "При отправке папки её опись — имена, пути и ключи всех файлов — шифруется новым ключом ссылки. Сервер узнаёт лишь, какие зашифрованные объекты можно отдавать по этой ссылке, поэтому через неё нельзя получить ничего другого.",
  "Short links trade secrecy for convenience — only if you choose":
    "Короткие ссылки — удобство ценой секретности, и только по вашему выбору",
  'A "short link only" share is just /s/k7m3xq2 with no key in it, which is easy to read out or type. To make that work the server keeps the link key, so it isn\'t end-to-end encrypted. Add a password and the content stays unreadable to the server. Short ids are rate limited against guessing.':
    "Режим «только короткая ссылка» — это просто /s/k7m3xq2 без ключа: её легко продиктовать или набрать. Для этого ключ ссылки хранит сервер, поэтому сквозного шифрования нет. Добавьте пароль — и содержимое останется нечитаемым для сервера. Число попыток угадать короткий код ограничено.",
  "Passwords add a second factor": "Пароль — второй фактор",
  "Password-protected links mix an Argon2id-stretched password (64 MiB, 3 passes) into the key derivation. Someone who intercepts the link still can't open it, and wrong guesses are rate limited and never burn a view.":
    "В ссылках с паролем при выработке ключа подмешивается пароль, обработанный Argon2id (64 МиБ, 3 прохода). Перехватив ссылку, её всё равно не открыть, а число неверных попыток ограничено — и они не расходуют просмотры.",
  "Your account password never leaves your device": "Пароль от аккаунта не покидает ваше устройство",
  "Signing in stretches your password with Argon2id locally and splits the result: an authentication key (which the server peppers and hashes) and a key-encryption key that unwraps your random master key. The server never learns your password or your master key. Changing your password only re-seals the master key.":
    "При входе пароль локально обрабатывается Argon2id, а результат делится на две части: ключ аутентификации (сервер хранит его хеш с «перцем») и ключ, открывающий ваш случайный мастер-ключ. Сервер никогда не узнаёт ни пароль, ни мастер-ключ. Смена пароля лишь заново защищает мастер-ключ.",
  "Recovery without a back door": "Восстановление без чёрного хода",
  "At sign-up you receive a 256-bit recovery key. It independently wraps your master key, so you can reset a forgotten password. Lose both, and your data is gone — no one, including the operator, can recover it.":
    "При регистрации вы получаете 256-битный ключ восстановления. Он независимо защищает ваш мастер-ключ, поэтому забытый пароль можно сбросить. Потеряете и то и другое — данные пропадут: восстановить их не сможет никто, включая оператора сервиса.",
  "Hardened server": "Защищённый сервер",
  "Strict Content-Security-Policy with hashed inline scripts, no third-party requests, HttpOnly SameSite=Strict session cookies, CSRF headers, no-referrer policy, rate limits on sign-in and link access, and a janitor that deletes expired and burned data every minute.":
    "Строгая Content-Security-Policy с хешами встроенных скриптов, никаких сторонних запросов, сессионные cookie HttpOnly SameSite=Strict, защита от CSRF, политика no-referrer, ограничение частоты входа и открытия ссылок, а также фоновая очистка, которая каждую минуту удаляет истёкшие и сожжённые данные.",
  "One honest caveat:": "Честная оговорка:",
  "end-to-end encryption in a web app relies on the server delivering honest JavaScript. Self-host Coffer, pin your image version and serve it over HTTPS.":
    "сквозное шифрование в веб-приложении полагается на то, что сервер отдаёт честный JavaScript. Разверните Coffer у себя, зафиксируйте версию образа и работайте по HTTPS.",
  "Upload links can add files, and nothing else": "Ссылки для загрузки позволяют добавлять файлы, и больше ничего",
  "A file request has its own key pair. The uploader's browser encrypts each file under a fresh key and seals that key to the request's public key (ECDH on P-256, then AES-256-GCM), so only the request's owner can open what arrives. The link cannot list, read or delete anything, not even what it sent, and the server holds the private key only in a form sealed by your master key.":
    "У запроса файлов своя пара ключей. Браузер отправителя шифрует каждый файл новым ключом и запечатывает этот ключ открытым ключом запроса (ECDH на P-256, затем AES-256-GCM), поэтому открыть полученное может только владелец запроса. По ссылке нельзя ни посмотреть список, ни прочитать, ни удалить что-либо, даже отправленное самим отправителем, а закрытый ключ хранится на сервере только запечатанным вашим мастер-ключом.",
}

export default messages
