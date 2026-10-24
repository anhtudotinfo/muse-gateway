/**
 * Model search filtering utility with support for:
 * 1. Case-insensitive substring matching
 * 2. Negation / exclusion tokens (!keyword or -keyword)
 * 3. Combined queries (e.g. "claude !haiku")
 * 4. Regular expressions (/pattern/flags or /pattern/)
 */

export interface ParsedSearchQuery {
  raw: string;
  isEmpty: boolean;
  isRegex: boolean;
  regex: RegExp | null;
  positiveTerms: string[];
  negativeTerms: string[];
}

const EMPTY_QUERY: ParsedSearchQuery = {
  raw: "",
  isEmpty: true,
  isRegex: false,
  regex: null,
  positiveTerms: [],
  negativeTerms: [],
};

export function parseSearchQuery(rawQuery?: string | null): ParsedSearchQuery {
  if (!rawQuery || typeof rawQuery !== "string") return EMPTY_QUERY;

  const trimmed = rawQuery.trim();
  if (!trimmed) return EMPTY_QUERY;

  // Check for regex syntax: /pattern/flags or /pattern/
  if (trimmed.startsWith("/")) {
    const fullRegexMatch = trimmed.match(/^\/(.+)\/([a-z]*)$/i);
    if (fullRegexMatch) {
      try {
        const flags = fullRegexMatch[2] || "i";
        const regex = new RegExp(fullRegexMatch[1], flags);
        return {
          raw: trimmed,
          isEmpty: false,
          isRegex: true,
          regex,
          positiveTerms: [],
          negativeTerms: [],
        };
      } catch {
        // Invalid regex flags or syntax - fallback to literal
      }
    } else if (trimmed.length > 1) {
      // Allow live typing for leading slash, e.g. /claude.*
      try {
        const regex = new RegExp(trimmed.slice(1), "i");
        return {
          raw: trimmed,
          isEmpty: false,
          isRegex: true,
          regex,
          positiveTerms: [],
          negativeTerms: [],
        };
      } catch {
        // Syntax not yet valid while typing (e.g. unclosed parenthesis)
      }
    }
  }

  // Standard term parsing with negation support
  const tokens = trimmed.split(/\s+/);
  const positiveTerms: string[] = [];
  const negativeTerms: string[] = [];

  for (const token of tokens) {
    if (!token) continue;
    if ((token.startsWith("!") || token.startsWith("-")) && token.length > 1) {
      negativeTerms.push(token.slice(1).toLowerCase());
    } else {
      positiveTerms.push(token.toLowerCase());
    }
  }

  return {
    raw: trimmed,
    isEmpty: positiveTerms.length === 0 && negativeTerms.length === 0,
    isRegex: false,
    regex: null,
    positiveTerms,
    negativeTerms,
  };
}

export function matchesSearch(
  target: unknown,
  queryOrParsed: string | ParsedSearchQuery | null | undefined
): boolean {
  const parsed =
    typeof queryOrParsed === "string" || !queryOrParsed
      ? parseSearchQuery(queryOrParsed as string)
      : queryOrParsed;

  if (parsed.isEmpty) return true;

  // Extract candidate strings from target
  let candidates: string[] = [];
  if (typeof target === "string") {
    candidates = [target];
  } else if (Array.isArray(target)) {
    candidates = target.filter((t): t is string => typeof t === "string");
  } else if (target && typeof target === "object") {
    const t = target as Record<string, unknown>;
    candidates = [t.name, t.id, t.value, t.alias, t.provider].filter(
      (x): x is string => typeof x === "string"
    );
  }

  if (candidates.length === 0) return false;

  // Handle Regex
  if (parsed.isRegex && parsed.regex) {
    parsed.regex.lastIndex = 0;
    const fullText = candidates.join(" ");
    const hasNegativeAssertion = /\(\?!|\(\?<!/.test(parsed.raw);
    if (hasNegativeAssertion) {
      return parsed.regex.test(fullText);
    }
    return (
      candidates.some((text) => parsed.regex!.test(text)) ||
      parsed.regex.test(fullText)
    );
  }

  const lowerCandidates = candidates.map((c) => c.toLowerCase());

  // Handle Negations: reject if ANY candidate contains ANY negative term
  if (parsed.negativeTerms.length > 0) {
    for (const neg of parsed.negativeTerms) {
      if (lowerCandidates.some((c) => c.includes(neg))) return false;
    }
  }

  // Handle Positive Terms: ALL positive terms must match at least one candidate
  if (parsed.positiveTerms.length > 0) {
    for (const pos of parsed.positiveTerms) {
      if (!lowerCandidates.some((c) => c.includes(pos))) return false;
    }
  }

  return true;
}

export function filterModelsByQuery<T>(
  items: T[],
  query: string | ParsedSearchQuery
): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const parsed = typeof query === "string" ? parseSearchQuery(query) : query || parseSearchQuery("");
  if (parsed.isEmpty) return items;
  return items.filter((item) => matchesSearch(item, parsed));
}
