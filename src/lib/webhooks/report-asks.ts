/**
 * Which lines of an agent's report ask Chip for something or report a failed run.
 *
 * The grammar is the one the Discord poster gates on (`~/.c3/scripts/discord/post.py`, ASK and
 * BARE_ASK), narrowed to Chip: `Needs from you:`, `Needs you:`, `Needs Chip:`, `Needs from Chip:`.
 * `Needs Luca:` is Luca's and stays in its own channel. The list items under an ask are asks too:
 * agents write "Needs from you: two yes or no." and then number them. The shared cases live in
 * tests/fixtures/ask-lines.json, which the poster's tests also read, so the two cannot drift.
 */

const LIST_MARKER = /^(?:[-*•]|\d+[.)])\s+/
const CHIP_ASK = /^needs\s+(?:from\s+)?(?:you|chip)\s*:\s*(.*)$/i
// Any "nothing ..." or "n/a" is not an ask; "none" is, only as "None of the builds pass ...".
const NOTHING = /^(?:nothing\b|none\b(?!\s+of\b)|n\/?a\b)/i
const FAILED = /^run failed\b\s*:?\s*(.*)$/i

function clean(line: string): string {
  return line.replace(/\*\*|__/g, '').trim().replace(LIST_MARKER, '').replace(/^[#>\s]+/, '').trim()
}

/** Chip's asks in a post, in order: the text after each ask line, then the list items under it. */
export function chipAsks(text: string): string[] {
  const raw = text.split('\n')
  const asks: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const m = CHIP_ASK.exec(clean(raw[i]))
    if (!m) continue
    const rest = m[1].trim()
    if (NOTHING.test(rest)) continue
    if (rest) asks.push(rest)
    let j = i + 1
    // A bare ask may leave a blank line before its list, as post.py's gate allows.
    if (!rest) while (j < raw.length && !raw[j].trim()) j++
    while (j < raw.length && LIST_MARKER.test(raw[j].replace(/\*\*|__/g, '').trim())) {
      const item = clean(raw[j])
      if (item) asks.push(item)
      j++
    }
    i = j - 1
  }
  return asks
}

/** The text after a `Run failed:` line, or null when the post does not say its run broke. */
export function runFailed(text: string): string | null {
  for (const line of text.split('\n')) {
    const m = FAILED.exec(clean(line))
    if (m) return m[1].trim() || 'the run failed'
  }
  return null
}
