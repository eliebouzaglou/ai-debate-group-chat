interface RegexSanitizeOptions {
    /** Regex patterns to strip or replace with their first capture group */
    phrasePatterns?: readonly RegExp[];
    /** Regex patterns that will remove an entire sentence if matched */
    sentencePatterns?: readonly RegExp[];
    /** Whether to collapse excessive spaces and newlines (default: true) */
    normalizeWhitespace?: boolean;
}

/**
 * Sanitizes a string by removing or replacing matched phrases and filtering out unwanted sentences.
 */
export function regexSanitize(
    text: string,
    options: RegexSanitizeOptions = {}
): string {
    const {
        phrasePatterns = [],
        sentencePatterns = [],
        normalizeWhitespace = true,
    } = options;

    let out = text;

    // 1. Strip or unwrap matched phrases
    for (const re of phrasePatterns) {
        out = out.replace(re, (_match, group1) =>
            typeof group1 === "string" ? group1 : ""
        );
    }

    // 2. Filter out matching sentences
    if (sentencePatterns.length > 0) {
        out = out
            .split(/(?<=[.!?])\s+/)
            .filter((sentence) => !sentencePatterns.some((re) => re.test(sentence)))
            .join(" ");
    }

    // 3. Clean up whitespace artifacts
    if (normalizeWhitespace) {
        out = out
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    return out;
}

// Factory function to create a pre-configured sanitizer for repeated use.
export function createRegexSanitizer(options: RegexSanitizeOptions) {
    return (text: string) => regexSanitize(text, options);
}