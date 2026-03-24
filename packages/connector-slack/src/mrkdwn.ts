/**
 * Convert standard Markdown to Slack mrkdwn format.
 *
 * Key differences handled:
 *  - **bold**  → *bold*
 *  - *italic*  → _italic_
 *  - ~~strike~~ → ~strike~
 *  - [text](url) → <url|text>
 *  - ![alt](url) → <url|alt>  (images → links)
 *  - # Heading   → *Heading*
 *  - Horizontal rules (--- etc.) → ———
 *
 * Code blocks (``` and `) are preserved as-is since Slack supports them natively.
 */

// Use zero-width spaces as placeholder boundaries (won't appear in normal text)
const PH = '\u200B\u200B'

export function markdownToMrkdwn(md: string): string {
  const placeholders: string[] = []

  function hold(value: string): string {
    placeholders.push(value)
    return `${PH}PH_${placeholders.length - 1}${PH}`
  }

  // 1. Extract code blocks and inline code to protect them from conversion
  let text = md.replace(/```[\s\S]*?```/g, match => hold(match))
  text = text.replace(/`[^`\n]+`/g, match => hold(match))

  // 2. Images: ![alt](url) → <url|alt>
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => hold(`<${url}|${alt}>`))

  // 3. Links: [text](url) → <url|text>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => hold(`<${url}|${label}>`))

  // 4. Headings: # text → *text* (bold)
  //    Use placeholder to prevent italic regex from catching the *s
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_, content) => hold(`*${content}*`))

  // 5. Bold + Italic: ***text*** → *_text_*
  text = text.replace(/\*{3}(.+?)\*{3}/g, (_, content) => hold(`*_${content}_*`))

  // 6. Bold: **text** → *text* (use placeholder to protect from italic pass)
  text = text.replace(/\*{2}(.+?)\*{2}/g, (_, content) => hold(`*${content}*`))

  // 7. Italic: *text* → _text_ (remaining single asterisks)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_')

  // 8. Strikethrough: ~~text~~ → ~text~
  text = text.replace(/~~(.+?)~~/g, '~$1~')

  // 9. Horizontal rules
  text = text.replace(/^[-*_]{3,}$/gm, '———')

  // 10. Unordered list markers: - item → • item
  text = text.replace(/^(\s*)[-*+]\s+/gm, '$1• ')

  // Restore all placeholders in reverse order.
  // Later placeholders may contain earlier ones (e.g. bold wrapping inline code),
  // so we must unwrap outer placeholders first to expose inner ones.
  for (let i = placeholders.length - 1; i >= 0; i--) {
    text = text.replace(`${PH}PH_${i}${PH}`, placeholders[i])
  }

  return text
}
