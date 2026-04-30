/** Split text into chunks ≤ limit, preferring sentence boundaries, then clauses, then words. */
export function chunkText(text, limit) {
    if (limit <= 0) {
        throw new Error("chunkText: limit must be > 0");
    }
    const trimmed = text.trim();
    if (trimmed.length === 0)
        return [];
    if (trimmed.length <= limit) {
        return [{ index: 0, text: trimmed, charCount: trimmed.length }];
    }
    const sentences = splitSentences(trimmed);
    const chunks = [];
    let buffer = "";
    for (const sentence of sentences) {
        if (sentence.length > limit) {
            // Single sentence is too long — flush buffer, then split sentence further.
            if (buffer.length > 0) {
                chunks.push(buffer);
                buffer = "";
            }
            for (const sub of splitOversized(sentence, limit)) {
                chunks.push(sub);
            }
            continue;
        }
        const candidate = buffer.length === 0 ? sentence : `${buffer} ${sentence}`;
        if (candidate.length <= limit) {
            buffer = candidate;
        }
        else {
            chunks.push(buffer);
            buffer = sentence;
        }
    }
    if (buffer.length > 0)
        chunks.push(buffer);
    return chunks.map((t, i) => ({ index: i, text: t, charCount: t.length }));
}
function splitSentences(text) {
    return text
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
/** A single oversized sentence — split at clause boundaries, then by word as last resort. */
function splitOversized(sentence, limit) {
    const out = [];
    const clauses = sentence
        .split(/(?<=[,;:])\s+/)
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
    let buffer = "";
    for (const clause of clauses) {
        if (clause.length > limit) {
            if (buffer.length > 0) {
                out.push(buffer);
                buffer = "";
            }
            for (const wordChunk of splitByWords(clause, limit)) {
                out.push(wordChunk);
            }
            continue;
        }
        const candidate = buffer.length === 0 ? clause : `${buffer} ${clause}`;
        if (candidate.length <= limit) {
            buffer = candidate;
        }
        else {
            out.push(buffer);
            buffer = clause;
        }
    }
    if (buffer.length > 0)
        out.push(buffer);
    return out;
}
function splitByWords(text, limit) {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const out = [];
    let buffer = "";
    for (const word of words) {
        const candidate = buffer.length === 0 ? word : `${buffer} ${word}`;
        if (candidate.length <= limit) {
            buffer = candidate;
        }
        else {
            if (buffer.length > 0)
                out.push(buffer);
            // If a single word is longer than limit, hard-cut it.
            if (word.length > limit) {
                for (let i = 0; i < word.length; i += limit) {
                    out.push(word.slice(i, i + limit));
                }
                buffer = "";
            }
            else {
                buffer = word;
            }
        }
    }
    if (buffer.length > 0)
        out.push(buffer);
    return out;
}
