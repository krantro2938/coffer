import type { Messages } from "../types"

/** Plans and payment, reports and invitations. */
const messages: Messages = {
  "Report this link": "举报此链接",
  "Tell us what is wrong. Coffer cannot read what links contain, so your description is what we act on.":
    "请告诉我们哪里有问题。Coffer 无法读取链接里的内容，所以我们依据你的描述来处理。",
  "What is wrong?": "哪里有问题？",
  "Choose one": "请选择",
  "Choose what is wrong with this link": "请选择此链接的问题",
  "Malware or a virus": "恶意软件或病毒",
  "Phishing or a scam": "钓鱼或诈骗",
  "Illegal content": "违法内容",
  "Copyright infringement": "侵犯版权",
  "Harassment or private information": "骚扰或泄露隐私",
  "Something else": "其他",
  "What did you find?": "你发现了什么？",
  "Your email, if we may ask you more (optional)": "你的邮箱，方便我们进一步询问（可选）",
  "Let the reviewer open this link": "允许审核人员打开此链接",
  "Sends the link's key with your report. Without it we can only act on your description.":
    "把链接的密钥随举报一并发送。没有它，我们只能依据你的描述来处理。",
  "Send report": "发送举报",
  "Report sent. Thank you.": "举报已发送。谢谢。",
  "You're invited. Choose the password that encrypts your drive for {email}. It never leaves this device.":
    "你已受邀。请为 {email} 设置用于加密云盘的密码。它永远不会离开这台设备。",
  "Arranged for you": "为你专门安排",
  "{price} a year": "每年 {price}",
  "Free for the first {n} days. Cancel before then and you pay nothing.": "前 {n} 天免费。在此之前取消则无需付费。",
  "Start free trial": "开始免费试用",
  Complimentary: "赠送",
  "At no charge until {date}.": "免费使用至 {date}。",
  "At no charge, with no end date.": "免费使用，无结束日期。",
  "Personal plan": "专属套餐",
  "Ended.": "已结束。",
  Pricing: "价格",
  "Private drive": "私密云盘",
  "Pay for space, not with your data.": "为空间付费，而不是用你的数据付费。",
  "Quick shares are free and need no account. A drive is a subscription, because storage that isn't paid for by you is paid for by someone else.":
    "快速分享免费，且无需账户。云盘是订阅制，因为不由你付费的存储，总会有别人来付。",
  "Get started": "开始使用",
  "Choose plan": "选择套餐",
  "Your plan": "你的套餐",
  "per month": "每月",
  "{price} a month": "每月 {price}",
  "Personal encrypted storage": "个人加密存储",
  "For everyday cloud storage": "适合日常云存储",
  "For large private archives": "适合大型私人档案",
  "Encrypted storage": "加密存储",
  "Every plan: end-to-end encryption, a private drive, secure sharing, unlimited folders. No ads, no tracking.":
    "所有套餐均包含：端到端加密、私密云盘、安全分享、无限文件夹。没有广告，没有追踪。",
  "Payment is handled by Paddle; we never see your card. Cancel whenever you like.":
    "付款由 Paddle 处理；我们永远看不到你的卡。可随时取消。",
  "Choose the size of your drive": "选择云盘大小",
  "Your account is ready. Pick a plan to open your drive; you can change or cancel it at any time.":
    "你的账户已就绪。选择一个套餐即可打开云盘；之后可以随时更改或取消。",
  "Plans are unavailable right now. Please try again shortly.": "套餐暂时不可用。请稍后再试。",
  "Confirming your payment…": "正在确认你的付款…",
  "This takes a few seconds.": "这需要几秒钟。",
  "Your drive is ready": "你的云盘已就绪",
  "Your plan has ended.": "你的套餐已结束。",
  "Your drive is read-only: you can still download and delete, but not add.": "你的云盘现为只读：仍可下载和删除，但不能添加。",
  Renew: "续订",
  "Drives start at {price} a month. You choose a plan in the next step.": "云盘每月 {price} 起。下一步选择套餐。",
  Plan: "套餐",
  "Change the size of your drive, update your card or cancel.": "更改云盘大小、更新银行卡或取消。",
  "Manage billing": "管理账单",
  Active: "有效",
  "Renews on {date}": "将于 {date} 续订",
  "Cancelled. Your drive stays open until {date}.": "已取消。你的云盘在 {date} 之前保持可用。",
  "Ended. Your drive is read-only until you pick a plan again.": "已结束。在你重新选择套餐之前，云盘为只读。",
  "Your last payment didn't go through. Update your card under Manage billing to keep your drive open.":
    "你上一次付款未成功。请在“管理账单”中更新银行卡，以保持云盘可用。",
  Switch: "切换",
  "Switch plan": "切换套餐",
  "Switch to {plan}?": "切换到 {plan}？",
  "Too small for your files": "容量不足以存放你的文件",
  "You're now on {plan}": "你现在使用的是 {plan}",
  "Your card is charged or credited now for the rest of this billing period, then {price} a month.":
    "本计费周期剩余部分的差额将立即从你的卡中扣除或退还，之后每月 {price}。",
  "Your plan is cancelled along with it.": "你的套餐会随之取消。",
  "Payments stay away from your files": "付款与你的文件相互隔离",
  "A drive is paid for through Paddle, on a bare checkout page kept apart from the app. Paddle learns the email and card you type there and nothing else: no keys, no file names, no contents. The app itself still makes no third-party requests, and storage is rented from a provider that only ever holds ciphertext.":
    "云盘通过 Paddle 付款，使用一个与应用分开的独立结账页面。Paddle 只会知道你在那里填写的邮箱和银行卡，除此之外一无所知：没有密钥，没有文件名，没有内容。应用本身仍然不发起任何第三方请求，存储空间租自一家服务商，它保存的始终只有密文。",
}

export default messages
