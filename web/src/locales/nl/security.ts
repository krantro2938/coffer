import type { Messages } from "../types"

/** The security page. */
const messages: Messages = {
  "Security model": "Beveiligingsmodel",
  "How Coffer keeps your data unreadable.": "Hoe Coffer je gegevens onleesbaar houdt.",
  "Coffer is designed so that a complete compromise of the server — database, disks and code on disk — reveals nothing about what you've stored or shared.":
    "Coffer is zo ontworpen dat een volledige inbraak op de server — database, schijven en code op schijf — niets prijsgeeft over wat je hebt bewaard of gedeeld.",
  "Everything is encrypted before upload": "Alles wordt versleuteld vóór het uploaden",
  "Each file or note gets its own random 256-bit key. Content is split into 4 MB chunks and sealed with AES-256-GCM in your browser. Chunk nonces encode position and a final-chunk flag, so the server can't reorder, drop or truncate data without detection. File names, types and sizes are encrypted separately.":
    "Elk bestand en elke notitie krijgt een eigen willekeurige 256-bits sleutel. De inhoud wordt in blokken van 4 MB verdeeld en in je browser verzegeld met AES-256-GCM. De nonces van de blokken leggen de positie vast en of het het laatste blok is, zodat de server gegevens niet ongemerkt kan herschikken, weglaten of afkappen. Bestandsnamen, typen en groottes worden apart versleuteld.",
  "Share links carry the key": "Deellinks dragen de sleutel",
  "A link looks like /s/k7m3xq2#h4c9w2pz8rtf6mxn. The part after # is an 80-bit secret that browsers never send to servers. From it we derive two things: a key that unwraps the file key, and an access token. The server only stores a SHA-256 hash of that token, so it can check a recipient without being able to decrypt anything.":
    "Een link ziet eruit als /s/k7m3xq2#h4c9w2pz8rtf6mxn. Het deel na het # is een geheim van 80 bits dat browsers nooit naar servers sturen. Daaruit leiden we twee dingen af: een sleutel die de bestandssleutel uitpakt, en een toegangstoken. De server bewaart alleen een SHA-256-hash van dat token en kan een ontvanger dus controleren zonder iets te kunnen ontsleutelen.",
  "Folders are shared as sealed snapshots": "Mappen worden gedeeld als verzegelde momentopnamen",
  "Sharing a folder encrypts a manifest of its files — names, paths and each file's key — under a fresh link key. The server only learns which encrypted items that link is allowed to serve, so a folder link can never be used to fetch anything else.":
    "Bij het delen van een map wordt een overzicht van de bestanden — namen, paden en de sleutel van elk bestand — versleuteld met een nieuwe linksleutel. De server weet alleen welke versleutelde items die link mag leveren, dus een maplink kan nooit worden gebruikt om iets anders op te halen.",
  "Short links trade secrecy for convenience — only if you choose":
    "Korte links ruilen geheimhouding in voor gemak — alleen als jij dat kiest",
  'A "short link only" share is just /s/k7m3xq2 with no key in it, which is easy to read out or type. To make that work the server keeps the link key, so it isn\'t end-to-end encrypted. Add a password and the content stays unreadable to the server. Short ids are rate limited against guessing.':
    "Een deelactie met “alleen korte link” is gewoon /s/k7m3xq2 zonder sleutel erin, makkelijk voor te lezen of te typen. Om dat te laten werken bewaart de server de linksleutel, dus het is niet end-to-end versleuteld. Voeg een wachtwoord toe en de inhoud blijft onleesbaar voor de server. Korte id's zijn begrensd tegen raden.",
  "Passwords add a second factor": "Wachtwoorden voegen een tweede factor toe",
  "Password-protected links mix an Argon2id-stretched password (64 MiB, 3 passes) into the key derivation. Someone who intercepts the link still can't open it, and wrong guesses are rate limited and never burn a view.":
    "Links met een wachtwoord mengen een met Argon2id opgerekt wachtwoord (64 MiB, 3 rondes) in de sleutelafleiding. Wie de link onderschept, kan hem nog steeds niet openen, en foute pogingen zijn begrensd en kosten nooit een weergave.",
  "Your account password never leaves your device": "Je accountwachtwoord verlaat je apparaat nooit",
  "Signing in stretches your password with Argon2id locally and splits the result: an authentication key (which the server peppers and hashes) and a key-encryption key that unwraps your random master key. The server never learns your password or your master key. Changing your password only re-seals the master key.":
    "Bij het inloggen wordt je wachtwoord lokaal opgerekt met Argon2id en wordt het resultaat gesplitst: een authenticatiesleutel (waar de server een geheim aan toevoegt voordat hij de hash bewaart) en een sleutel die je willekeurige hoofdsleutel uitpakt. De server komt je wachtwoord en je hoofdsleutel nooit te weten. Je wachtwoord wijzigen verzegelt alleen de hoofdsleutel opnieuw.",
  "Recovery without a back door": "Herstel zonder achterdeur",
  "At sign-up you receive a 256-bit recovery key. It independently wraps your master key, so you can reset a forgotten password. Lose both, and your data is gone — no one, including the operator, can recover it.":
    "Bij het aanmelden krijg je een herstelsleutel van 256 bits. Die pakt je hoofdsleutel onafhankelijk in, zodat je een vergeten wachtwoord opnieuw kunt instellen. Raak je beide kwijt, dan zijn je gegevens weg — niemand, ook de beheerder niet, kan ze terughalen.",
  "Hardened server": "Geharde server",
  "Strict Content-Security-Policy with hashed inline scripts, no third-party requests, HttpOnly SameSite=Strict session cookies, CSRF headers, no-referrer policy, rate limits on sign-in and link access, and a janitor that deletes expired and burned data every minute.":
    "Strikte Content-Security-Policy met gehashte inline scripts, geen verzoeken naar derden, sessiecookies met HttpOnly en SameSite=Strict, CSRF-headers, no-referrer-beleid, begrenzing van inlogpogingen en linktoegang, en een opruimproces dat elke minuut verlopen en vernietigde gegevens verwijdert.",
  "One honest caveat:": "Eén eerlijke kanttekening:",
  "end-to-end encryption in a web app relies on the server delivering honest JavaScript. Self-host Coffer, pin your image version and serve it over HTTPS.":
    "end-to-end-versleuteling in een webapp is afhankelijk van een server die eerlijke JavaScript levert. Host Coffer zelf, zet je imageversie vast en serveer het via HTTPS.",
  "Upload links can add files, and nothing else": "Uploadlinks kunnen bestanden toevoegen, en verder niets",
  "A file request has its own key pair. The uploader's browser encrypts each file under a fresh key and seals that key to the request's public key (ECDH on P-256, then AES-256-GCM), so only the request's owner can open what arrives. The link cannot list, read or delete anything, not even what it sent, and the server holds the private key only in a form sealed by your master key.":
    "Een bestandsverzoek heeft een eigen sleutelpaar. De browser van de uploader versleutelt elk bestand met een nieuwe sleutel en verzegelt die sleutel voor de publieke sleutel van het verzoek (ECDH op P-256, daarna AES-256-GCM), zodat alleen de eigenaar van het verzoek kan openen wat binnenkomt. De link kan niets opsommen, lezen of verwijderen, zelfs niet wat erdoor is verstuurd, en de server heeft de privésleutel alleen in een vorm die met jouw hoofdsleutel is verzegeld.",
}

export default messages
