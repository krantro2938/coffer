/**
 * First-run state: what a new account said it wants to keep, and how far it
 * got through the welcome. It lives in this browser only and is never sent
 * anywhere; it just decides which folders are set up when the drive opens.
 */
export type Pick = "documents" | "photos" | "work" | "secrets" | "sharing"
export type Welcome = { email: string; picks: Pick[]; stage: "ask" | "unbox" }

const KEY = "coffer-welcome"

export function readWelcome(email: string | undefined): Welcome | null {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) ?? "null") as Welcome | null
    return w && email && w.email === email.toLowerCase() ? w : null
  } catch {
    return null
  }
}

export function saveWelcome(w: Welcome | null) {
  try {
    if (w) localStorage.setItem(KEY, JSON.stringify({ ...w, email: w.email.toLowerCase() }))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: the welcome is simply skipped */
  }
}

/** Folder names (English keys, translated when created) for each answer. */
export const STARTER_FOLDERS: Record<Pick, string[]> = {
  documents: ["Documents"],
  photos: ["Photos"],
  work: ["Clients", "Contracts"],
  secrets: ["Passwords & codes"],
  sharing: ["To share"],
}

export function starterFolders(picks: Pick[]): string[] {
  return [...new Set(picks.flatMap((p) => STARTER_FOLDERS[p]))].slice(0, 5)
}
