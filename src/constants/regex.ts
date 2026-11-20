// Sentences containing any of these get dropped outright.
export const TELL_SENTENCES: RegExp[] = [
    /\bas an? (ai|artificial intelligence|language model|llm|assistant)\b/i,
    /\b(large )?language model\b/i,
    /\bI (don't|do not) have (personal )?(opinions|beliefs|views|feelings)\b/i,
    /\bI('m| am) (just )?an? (ai|assistant|chatbot|bot)\b/i,
    /\bmy (training|training data|knowledge cutoff)\b/i,
    /\bI('m| am) (not able|unable) to (take sides|have opinions)\b/i,
];

// Phrases trimmed in place.
export const TELL_PHRASES: RegExp[] = [
    /^(great|good|excellent) question[.!,]?\s*/i,
    /^(certainly|absolutely|of course)[.!,]\s*/i,
    /\*\*(.+?)\*\*/g, // bold markdown
    /^#{1,6}\s+/gm, // headings
    /^\s*[-*•]\s+/gm, // bullets
];



export const STILL_SUSPICIOUS = /\b(ai|a\.i\.|model|assistant|chatbot|opinions?|neutral|both sides|it'?s important to note|nuanced)\b/i;
