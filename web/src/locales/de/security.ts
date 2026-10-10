import type { Messages } from "../types"

/** The security page. */
const messages: Messages = {
  "Security model": "Sicherheitsmodell",
  "How Coffer keeps your data unreadable.": "Wie Coffer Ihre Daten unlesbar hält.",
  "Coffer is designed so that a complete compromise of the server — database, disks and code on disk — reveals nothing about what you've stored or shared.":
    "Coffer ist so gebaut, dass selbst eine vollständige Kompromittierung des Servers — Datenbank, Festplatten und Code auf der Platte — nichts darüber verrät, was Sie gespeichert oder geteilt haben.",
  "Everything is encrypted before upload": "Alles wird vor dem Upload verschlüsselt",
  "Each file or note gets its own random 256-bit key. Content is split into 4 MB chunks and sealed with AES-256-GCM in your browser. Chunk nonces encode position and a final-chunk flag, so the server can't reorder, drop or truncate data without detection. File names, types and sizes are encrypted separately.":
    "Jede Datei oder Notiz erhält einen eigenen zufälligen 256-Bit-Schlüssel. Der Inhalt wird in 4-MB-Blöcke geteilt und in Ihrem Browser mit AES-256-GCM versiegelt. Die Nonces der Blöcke kodieren die Position und ein Kennzeichen für den letzten Block, sodass der Server Daten nicht unbemerkt umsortieren, weglassen oder abschneiden kann. Dateinamen, Typen und Größen werden getrennt verschlüsselt.",
  "Share links carry the key": "Links tragen den Schlüssel",
  "A link looks like /s/k7m3xq2#h4c9w2pz8rtf6mxn. The part after # is an 80-bit secret that browsers never send to servers. From it we derive two things: a key that unwraps the file key, and an access token. The server only stores a SHA-256 hash of that token, so it can check a recipient without being able to decrypt anything.":
    "Ein Link sieht aus wie /s/k7m3xq2#h4c9w2pz8rtf6mxn. Der Teil nach dem # ist ein 80-Bit-Geheimnis, das Browser nie an Server senden. Daraus leiten wir zwei Dinge ab: einen Schlüssel, der den Dateischlüssel entpackt, und ein Zugriffstoken. Der Server speichert nur einen SHA-256-Hash dieses Tokens und kann so einen Empfänger prüfen, ohne etwas entschlüsseln zu können.",
  "Folders are shared as sealed snapshots": "Ordner werden als versiegelte Momentaufnahmen geteilt",
  "Sharing a folder encrypts a manifest of its files — names, paths and each file's key — under a fresh link key. The server only learns which encrypted items that link is allowed to serve, so a folder link can never be used to fetch anything else.":
    "Beim Teilen eines Ordners wird ein Verzeichnis seiner Dateien — Namen, Pfade und der Schlüssel jeder Datei — unter einem neuen Link-Schlüssel verschlüsselt. Der Server erfährt nur, welche verschlüsselten Elemente dieser Link ausliefern darf; ein Ordner-Link lässt sich also nie nutzen, um etwas anderes abzurufen.",
  "Short links trade secrecy for convenience — only if you choose":
    "Kurzlinks tauschen Geheimhaltung gegen Bequemlichkeit — nur wenn Sie es wählen",
  'A "short link only" share is just /s/k7m3xq2 with no key in it, which is easy to read out or type. To make that work the server keeps the link key, so it isn\'t end-to-end encrypted. Add a password and the content stays unreadable to the server. Short ids are rate limited against guessing.':
    "Eine Freigabe „nur Kurzlink“ ist einfach /s/k7m3xq2 ohne Schlüssel darin, leicht vorzulesen oder zu tippen. Damit das funktioniert, bewahrt der Server den Link-Schlüssel auf; sie ist also nicht Ende-zu-Ende-verschlüsselt. Mit einem Passwort bleibt der Inhalt für den Server unlesbar. Kurze IDs sind gegen Erraten ratenbegrenzt.",
  "Passwords add a second factor": "Passwörter sind ein zweiter Faktor",
  "Password-protected links mix an Argon2id-stretched password (64 MiB, 3 passes) into the key derivation. Someone who intercepts the link still can't open it, and wrong guesses are rate limited and never burn a view.":
    "Passwortgeschützte Links mischen ein mit Argon2id gestrecktes Passwort (64 MiB, 3 Durchläufe) in die Schlüsselableitung. Wer den Link abfängt, kann ihn trotzdem nicht öffnen; falsche Versuche sind ratenbegrenzt und verbrauchen nie einen Aufruf.",
  "Your account password never leaves your device": "Ihr Kontopasswort verlässt Ihr Gerät nie",
  "Signing in stretches your password with Argon2id locally and splits the result: an authentication key (which the server peppers and hashes) and a key-encryption key that unwraps your random master key. The server never learns your password or your master key. Changing your password only re-seals the master key.":
    "Beim Anmelden wird Ihr Passwort lokal mit Argon2id gestreckt und das Ergebnis geteilt: in einen Authentifizierungsschlüssel (den der Server pfeffert und hasht) und einen Schlüssel, der Ihren zufälligen Hauptschlüssel entpackt. Der Server erfährt weder Ihr Passwort noch Ihren Hauptschlüssel. Eine Passwortänderung versiegelt nur den Hauptschlüssel neu.",
  "Recovery without a back door": "Wiederherstellung ohne Hintertür",
  "At sign-up you receive a 256-bit recovery key. It independently wraps your master key, so you can reset a forgotten password. Lose both, and your data is gone — no one, including the operator, can recover it.":
    "Bei der Registrierung erhalten Sie einen 256-Bit-Wiederherstellungsschlüssel. Er verpackt Ihren Hauptschlüssel unabhängig, sodass Sie ein vergessenes Passwort zurücksetzen können. Verlieren Sie beides, sind Ihre Daten weg — niemand, auch nicht der Betreiber, kann sie wiederherstellen.",
  "Hardened server": "Gehärteter Server",
  "Strict Content-Security-Policy with hashed inline scripts, no third-party requests, HttpOnly SameSite=Strict session cookies, CSRF headers, no-referrer policy, rate limits on sign-in and link access, and a janitor that deletes expired and burned data every minute.":
    "Strikte Content-Security-Policy mit gehashten Inline-Skripten, keine Anfragen an Dritte, Sitzungscookies mit HttpOnly und SameSite=Strict, CSRF-Header, No-Referrer-Richtlinie, Ratenbegrenzung für Anmeldung und Link-Zugriff sowie ein Aufräumdienst, der abgelaufene und vernichtete Daten jede Minute löscht.",
  "One honest caveat:": "Ein ehrlicher Vorbehalt:",
  "end-to-end encryption in a web app relies on the server delivering honest JavaScript. Self-host Coffer, pin your image version and serve it over HTTPS.":
    "Ende-zu-Ende-Verschlüsselung in einer Web-App setzt voraus, dass der Server ehrliches JavaScript ausliefert. Betreiben Sie Coffer selbst, legen Sie Ihre Image-Version fest und liefern Sie es über HTTPS aus.",
  "Upload links can add files, and nothing else": "Upload-Links können Dateien hinzufügen, sonst nichts",
  "A file request has its own key pair. The uploader's browser encrypts each file under a fresh key and seals that key to the request's public key (ECDH on P-256, then AES-256-GCM), so only the request's owner can open what arrives. The link cannot list, read or delete anything, not even what it sent, and the server holds the private key only in a form sealed by your master key.":
    "Eine Dateianfrage hat ein eigenes Schlüsselpaar. Der Browser des Absenders verschlüsselt jede Datei mit einem neuen Schlüssel und versiegelt diesen für den öffentlichen Schlüssel der Anfrage (ECDH auf P-256, dann AES-256-GCM), sodass nur der Besitzer der Anfrage öffnen kann, was ankommt. Der Link kann nichts auflisten, lesen oder löschen, nicht einmal das selbst Gesendete, und der Server hält den privaten Schlüssel nur in einer von Ihrem Hauptschlüssel versiegelten Form.",
}

export default messages
