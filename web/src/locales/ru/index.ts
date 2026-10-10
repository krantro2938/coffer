import type { Locale } from "../types"
import common from "./common"
import landing from "./landing"
import share from "./share"
import auth from "./auth"
import drive from "./drive"
import security from "./security"
import requests from "./requests"
import billing from "./billing"
import errors from "./errors"

/** Russian. Plural entries hold: one | few | many. */
const locale: Locale = {
  plural: (n) => {
    const a = Math.abs(n) % 100
    const b = a % 10
    if (a > 10 && a < 20) return 2
    if (b === 1) return 0
    if (b >= 2 && b <= 4) return 1
    return 2
  },
  messages: { ...common, ...landing, ...share, ...auth, ...drive, ...security, ...requests, ...billing, ...errors },
}

export default locale
