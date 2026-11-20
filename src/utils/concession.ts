/** Plain-text check for an explicit concession ("I concede"), ignoring "I won't concede" etc. */
export function hasConcession(text: string): boolean {
  return /(^|[^a-z'])i concede\b(?!\s+(nothing|no\b|none|only|that\b|this\b|one\b))/i.test(text) &&
    !/\b(won'?t|will not|never|don'?t|do not|not going to)\s+concede\b/i.test(text);
}
