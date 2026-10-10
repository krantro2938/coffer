import type { Messages } from "../types"

/** The security page. */
const messages: Messages = {
  "Security model": "Modelo de seguridad",
  "How Coffer keeps your data unreadable.": "Cómo Coffer mantiene tus datos ilegibles.",
  "Coffer is designed so that a complete compromise of the server — database, disks and code on disk — reveals nothing about what you've stored or shared.":
    "Coffer está diseñado para que un compromiso total del servidor — base de datos, discos y código en disco — no revele nada sobre lo que has guardado o compartido.",
  "Everything is encrypted before upload": "Todo se cifra antes de subirlo",
  "Each file or note gets its own random 256-bit key. Content is split into 4 MB chunks and sealed with AES-256-GCM in your browser. Chunk nonces encode position and a final-chunk flag, so the server can't reorder, drop or truncate data without detection. File names, types and sizes are encrypted separately.":
    "Cada archivo o nota recibe su propia clave aleatoria de 256 bits. El contenido se divide en bloques de 4 MB y se sella con AES-256-GCM en tu navegador. Los nonces de los bloques codifican la posición y una marca de último bloque, así que el servidor no puede reordenar, omitir ni truncar datos sin que se note. Los nombres, tipos y tamaños de los archivos se cifran aparte.",
  "Share links carry the key": "Los enlaces llevan la clave",
  "A link looks like /s/k7m3xq2#h4c9w2pz8rtf6mxn. The part after # is an 80-bit secret that browsers never send to servers. From it we derive two things: a key that unwraps the file key, and an access token. The server only stores a SHA-256 hash of that token, so it can check a recipient without being able to decrypt anything.":
    "Un enlace tiene la forma /s/k7m3xq2#h4c9w2pz8rtf6mxn. La parte que va después del # es un secreto de 80 bits que los navegadores nunca envían a los servidores. De él derivamos dos cosas: una clave que desenvuelve la clave del archivo y un token de acceso. El servidor solo guarda un hash SHA-256 de ese token, así que puede comprobar a un destinatario sin poder descifrar nada.",
  "Folders are shared as sealed snapshots": "Las carpetas se comparten como instantáneas selladas",
  "Sharing a folder encrypts a manifest of its files — names, paths and each file's key — under a fresh link key. The server only learns which encrypted items that link is allowed to serve, so a folder link can never be used to fetch anything else.":
    "Al compartir una carpeta se cifra un manifiesto de sus archivos — nombres, rutas y la clave de cada uno — con una clave de enlace nueva. El servidor solo sabe qué elementos cifrados puede servir ese enlace, así que un enlace de carpeta nunca sirve para obtener otra cosa.",
  "Short links trade secrecy for convenience — only if you choose":
    "Los enlaces cortos cambian secreto por comodidad, solo si tú lo eliges",
  'A "short link only" share is just /s/k7m3xq2 with no key in it, which is easy to read out or type. To make that work the server keeps the link key, so it isn\'t end-to-end encrypted. Add a password and the content stays unreadable to the server. Short ids are rate limited against guessing.':
    "Un envío «solo enlace corto» es simplemente /s/k7m3xq2, sin clave dentro, fácil de dictar o de escribir. Para que funcione, el servidor guarda la clave del enlace, así que no está cifrado de extremo a extremo. Añade una contraseña y el contenido seguirá siendo ilegible para el servidor. Los identificadores cortos tienen límite de intentos contra la adivinación.",
  "Passwords add a second factor": "Las contraseñas añaden un segundo factor",
  "Password-protected links mix an Argon2id-stretched password (64 MiB, 3 passes) into the key derivation. Someone who intercepts the link still can't open it, and wrong guesses are rate limited and never burn a view.":
    "Los enlaces protegidos con contraseña mezclan una contraseña estirada con Argon2id (64 MiB, 3 pasadas) en la derivación de la clave. Quien intercepte el enlace seguirá sin poder abrirlo, y los intentos fallidos están limitados y nunca gastan una vista.",
  "Your account password never leaves your device": "La contraseña de tu cuenta nunca sale de tu dispositivo",
  "Signing in stretches your password with Argon2id locally and splits the result: an authentication key (which the server peppers and hashes) and a key-encryption key that unwraps your random master key. The server never learns your password or your master key. Changing your password only re-seals the master key.":
    "Al iniciar sesión, tu contraseña se estira en local con Argon2id y el resultado se divide en dos: una clave de autenticación (a la que el servidor añade un secreto antes de guardar su hash) y una clave que desenvuelve tu clave maestra aleatoria. El servidor nunca conoce tu contraseña ni tu clave maestra. Cambiar la contraseña solo vuelve a sellar la clave maestra.",
  "Recovery without a back door": "Recuperación sin puerta trasera",
  "At sign-up you receive a 256-bit recovery key. It independently wraps your master key, so you can reset a forgotten password. Lose both, and your data is gone — no one, including the operator, can recover it.":
    "Al registrarte recibes una clave de recuperación de 256 bits. Envuelve tu clave maestra de forma independiente, así que puedes restablecer una contraseña olvidada. Si pierdes ambas, tus datos se pierden: nadie, ni siquiera el operador, puede recuperarlos.",
  "Hardened server": "Servidor reforzado",
  "Strict Content-Security-Policy with hashed inline scripts, no third-party requests, HttpOnly SameSite=Strict session cookies, CSRF headers, no-referrer policy, rate limits on sign-in and link access, and a janitor that deletes expired and burned data every minute.":
    "Content-Security-Policy estricta con scripts en línea identificados por hash, ninguna petición a terceros, cookies de sesión HttpOnly y SameSite=Strict, cabeceras CSRF, política no-referrer, límites de intentos en el inicio de sesión y en el acceso a enlaces, y un proceso de limpieza que borra cada minuto los datos caducados y destruidos.",
  "One honest caveat:": "Una salvedad honesta:",
  "end-to-end encryption in a web app relies on the server delivering honest JavaScript. Self-host Coffer, pin your image version and serve it over HTTPS.":
    "el cifrado de extremo a extremo en una aplicación web depende de que el servidor entregue JavaScript honesto. Aloja Coffer tú mismo, fija la versión de la imagen y sírvelo por HTTPS.",
  "Upload links can add files, and nothing else": "Los enlaces de subida permiten añadir archivos y nada más",
  "A file request has its own key pair. The uploader's browser encrypts each file under a fresh key and seals that key to the request's public key (ECDH on P-256, then AES-256-GCM), so only the request's owner can open what arrives. The link cannot list, read or delete anything, not even what it sent, and the server holds the private key only in a form sealed by your master key.":
    "Una petición de archivos tiene su propio par de claves. El navegador de quien sube cifra cada archivo con una clave nueva y sella esa clave para la clave pública de la petición (ECDH sobre P-256 y después AES-256-GCM), de modo que solo el dueño de la petición puede abrir lo que llega. El enlace no puede listar, leer ni eliminar nada, ni siquiera lo que él mismo envió, y el servidor solo guarda la clave privada sellada con tu clave maestra.",
}

export default messages
