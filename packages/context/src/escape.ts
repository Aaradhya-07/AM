/**
 * Escaping for text that comes from the contract and lands in a generated view.
 *
 * Contract text is user- or agent-authored. It must reach a view as inert text:
 * never as Mermaid syntax, HTML, a Markdown link or image, or a line that
 * starts a new directive.
 */

/** Line and paragraph separators and bidirectional controls. */
const INVISIBLE_CONTROL =
  /[\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f]/u;

/** ASCII characters that are literal in a quoted Mermaid label. */
const MERMAID_SAFE_ASCII = /[A-Za-z0-9 .,:_\-/()'+=@!?*~^$[\]{}]/;

/**
 * Text for a quoted Mermaid label (`id["..."]` or `-->|"..."|`).
 *
 * An allowlist, not a blocklist: ASCII letters, digits and ordinary punctuation
 * pass through; every other ASCII character becomes a Mermaid numeric entity
 * (`#35;` is `#`), so quotes, `#`, `&`, `<`, `>`, backticks, `%`, `|` and `;`
 * cannot close the label, start a comment, open Markdown or form HTML. Control
 * characters and newlines become a space. Non-ASCII text passes through, except
 * line separators and bidirectional controls, which are encoded.
 */
export function mermaidLabel(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      out += " ";
    } else if (code < 0x80) {
      out += MERMAID_SAFE_ASCII.test(char) ? char : `#${code};`;
    } else if (INVISIBLE_CONTROL.test(char) || (code >= 0x80 && code < 0xa0)) {
      out += `#${code};`;
    } else {
      out += char;
    }
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/**
 * Text for a `%%` Mermaid comment. A comment ends at a newline, so newlines and
 * separators become spaces; `%`, `{` and `}` are replaced too, so the text can
 * never form a `%%{...}%%` directive.
 */
export function mermaidComment(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 0x20 ||
        code === 0x7f ||
        INVISIBLE_CONTROL.test(char) ||
        char === "%" ||
        char === "{" ||
        char === "}"
        ? " "
        : char;
    })
    .join("");
}

/**
 * Inline Markdown text: one line, no active syntax.
 *
 * The characters that form inline structure -- backslash, backtick, `*`, `_`,
 * `[`, `]`, `|` and `~` -- are backslash-escaped, so text cannot open code,
 * emphasis, a link, an image or a table cell; `<`, `>` and `&` become HTML
 * entities, so no raw HTML or autolink survives. Newlines and separators become
 * spaces and every value is written after a fixed prefix, so a value can never
 * start its own block: headings, lists and quotes need a line start.
 */
export function markdownText(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || INVISIBLE_CONTROL.test(char)) {
      out += " ";
    } else if (char === "<") {
      out += "&lt;";
    } else if (char === ">") {
      out += "&gt;";
    } else if (char === "&") {
      out += "&amp;";
    } else if ("\\`*_[]|~".includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/**
 * An identifier in Markdown inline code. Contract ids and refs are restricted
 * to letters, digits, `.`, `_` and `-`, but this does not rely on that: a
 * backtick or control character is replaced, so the span cannot be closed.
 */
export function markdownCode(text: string): string {
  const cleaned = [...text]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return char === "`" ||
        code < 0x20 ||
        code === 0x7f ||
        INVISIBLE_CONTROL.test(char)
        ? "?"
        : char;
    })
    .join("");
  return `\`${cleaned}\``;
}
