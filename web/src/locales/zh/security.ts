import type { Messages } from "../types"

/** The security page. */
const messages: Messages = {
  "Security model": "安全模型",
  "How Coffer keeps your data unreadable.": "Coffer 如何让你的数据无法被读取。",
  "Coffer is designed so that a complete compromise of the server — database, disks and code on disk — reveals nothing about what you've stored or shared.":
    "Coffer 的设计目标是：即使服务器被彻底攻破——数据库、硬盘以及硬盘上的代码——也不会泄露你存储或分享的任何内容。",
  "Everything is encrypted before upload": "一切在上传前加密",
  "Each file or note gets its own random 256-bit key. Content is split into 4 MB chunks and sealed with AES-256-GCM in your browser. Chunk nonces encode position and a final-chunk flag, so the server can't reorder, drop or truncate data without detection. File names, types and sizes are encrypted separately.":
    "每个文件或笔记都有自己的 256 位随机密钥。内容被切成 4 MB 的分块，在你的浏览器中用 AES-256-GCM 封存。分块的随机数编码了位置和“最后一块”标记，因此服务器无法在不被察觉的情况下重排、丢弃或截断数据。文件名、类型和大小另行加密。",
  "Share links carry the key": "分享链接携带密钥",
  "A link looks like /s/k7m3xq2#h4c9w2pz8rtf6mxn. The part after # is an 80-bit secret that browsers never send to servers. From it we derive two things: a key that unwraps the file key, and an access token. The server only stores a SHA-256 hash of that token, so it can check a recipient without being able to decrypt anything.":
    "链接形如 /s/k7m3xq2#h4c9w2pz8rtf6mxn。# 之后的部分是一个 80 位的密钥，浏览器从不把它发送给服务器。我们由它派生出两样东西：一个用来解开文件密钥的密钥，以及一个访问令牌。服务器只保存该令牌的 SHA-256 哈希，因此它能核验接收者，却无法解密任何内容。",
  "Folders are shared as sealed snapshots": "文件夹以封存快照的形式分享",
  "Sharing a folder encrypts a manifest of its files — names, paths and each file's key — under a fresh link key. The server only learns which encrypted items that link is allowed to serve, so a folder link can never be used to fetch anything else.":
    "分享文件夹时，会把其中文件的清单——名称、路径和每个文件的密钥——用一个全新的链接密钥加密。服务器只知道这个链接可以提供哪些加密项目，因此文件夹链接永远无法被用来获取别的内容。",
  "Short links trade secrecy for convenience — only if you choose": "短链接以保密换取便利——只在你选择时",
  'A "short link only" share is just /s/k7m3xq2 with no key in it, which is easy to read out or type. To make that work the server keeps the link key, so it isn\'t end-to-end encrypted. Add a password and the content stays unreadable to the server. Short ids are rate limited against guessing.':
    "“仅短链接”的分享就是 /s/k7m3xq2，其中不含密钥，便于口述或输入。为此服务器需要保管链接密钥，所以它不是端到端加密。加上密码，内容对服务器依然不可读。短 ID 设有防猜测的频率限制。",
  "Passwords add a second factor": "密码提供第二重保护",
  "Password-protected links mix an Argon2id-stretched password (64 MiB, 3 passes) into the key derivation. Someone who intercepts the link still can't open it, and wrong guesses are rate limited and never burn a view.":
    "有密码保护的链接会把经 Argon2id 拉伸的密码（64 MiB，3 轮）混入密钥派生。截获链接的人仍然打不开，猜错会受到频率限制，且永远不会消耗查看次数。",
  "Your account password never leaves your device": "你的账户密码从不离开你的设备",
  "Signing in stretches your password with Argon2id locally and splits the result: an authentication key (which the server peppers and hashes) and a key-encryption key that unwraps your random master key. The server never learns your password or your master key. Changing your password only re-seals the master key.":
    "登录时，密码在本地用 Argon2id 拉伸，结果分成两部分：一个认证密钥（服务器加入自己的密钥后再保存哈希），以及一个用来解开你随机主密钥的密钥。服务器永远不知道你的密码和主密钥。修改密码只是重新封存主密钥。",
  "Recovery without a back door": "没有后门的恢复方式",
  "At sign-up you receive a 256-bit recovery key. It independently wraps your master key, so you can reset a forgotten password. Lose both, and your data is gone — no one, including the operator, can recover it.":
    "注册时你会得到一把 256 位的恢复密钥。它独立封装你的主密钥，因此你可以重置忘记的密码。如果两者都丢失，数据就无法挽回——包括运营者在内，没有人能恢复。",
  "Hardened server": "加固的服务器",
  "Strict Content-Security-Policy with hashed inline scripts, no third-party requests, HttpOnly SameSite=Strict session cookies, CSRF headers, no-referrer policy, rate limits on sign-in and link access, and a janitor that deletes expired and burned data every minute.":
    "严格的内容安全策略（内联脚本按哈希放行），不向第三方发起请求，会话 Cookie 设置 HttpOnly 和 SameSite=Strict，CSRF 请求头，no-referrer 策略，登录和链接访问的频率限制，以及每分钟清理过期和已焚毁数据的清理程序。",
  "One honest caveat:": "一个坦诚的提醒：",
  "end-to-end encryption in a web app relies on the server delivering honest JavaScript. Self-host Coffer, pin your image version and serve it over HTTPS.":
    "网页应用中的端到端加密依赖于服务器提供诚实的 JavaScript。请自行部署 Coffer，固定镜像版本，并通过 HTTPS 提供服务。",
  "Upload links can add files, and nothing else": "上传链接只能添加文件，别无他用",
  "A file request has its own key pair. The uploader's browser encrypts each file under a fresh key and seals that key to the request's public key (ECDH on P-256, then AES-256-GCM), so only the request's owner can open what arrives. The link cannot list, read or delete anything, not even what it sent, and the server holds the private key only in a form sealed by your master key.":
    "每个文件请求都有自己的密钥对。上传者的浏览器用全新的密钥加密每个文件，再把该密钥封给请求的公钥（P-256 上的 ECDH，然后是 AES-256-GCM），因此只有请求的所有者能打开收到的内容。这个链接无法列出、读取或删除任何东西，连它自己发送的内容也不行；服务器保存的私钥只是由你的主密钥封存后的形式。",
}

export default messages
