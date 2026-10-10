import type { Locale } from "../types"

/**
 * English is the language the app is written in: the text in the code is the
 * English text, and the key every other language translates. So there is
 * nothing to look up here, and plurals are the two forms the code passes.
 */
const locale: Locale = {
  plural: (n) => (n === 1 ? 0 : 1),
  messages: {},
}

export default locale
