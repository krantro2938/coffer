/** Translations of one part of the app, keyed by the English text in the code. */
export type Messages = Record<string, string>

export type Locale = {
  /**
   * Which of an entry's plural forms goes with a number. A plural entry holds
   * its forms separated by "|", in the order this function counts them.
   */
  plural: (n: number) => number
  messages: Messages
}
