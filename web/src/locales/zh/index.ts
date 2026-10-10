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

/** Chinese (Simplified). Plural entries hold: a single form. */
const locale: Locale = {
  plural: () => 0,
  messages: { ...common, ...landing, ...share, ...auth, ...drive, ...security, ...requests, ...billing, ...errors },
}

export default locale
