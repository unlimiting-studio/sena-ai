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

// --- Slack Table Block Support ---

export type SlackMessagePayload = {
  text: string
  blocks?: Array<Record<string, unknown>>
}

/** Check if a line is a markdown table separator (|---|---|) */
function isTableSeparator(line: string): boolean {
  return /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line.trim())
}

/** Check if a line looks like a markdown table row */
function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.includes('|') && trimmed.length > 0 && !isTableSeparator(trimmed)
}

/** Check if text contains a markdown table (header + separator pattern) */
function containsTable(text: string): boolean {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    if (isTableRow(lines[i]) && isTableSeparator(lines[i + 1])) return true
  }
  return false
}

type Segment = { type: 'text' | 'table'; content: string }

/** Split markdown into text and table segments, keeping code blocks intact */
function splitIntoSegments(md: string): Segment[] {
  const lines = md.split('\n')
  const segments: Segment[] = []
  let textBuf: string[] = []
  let inCodeBlock = false
  let i = 0

  while (i < lines.length) {
    // Track fenced code block boundaries
    if (lines[i].trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      textBuf.push(lines[i])
      i++
      continue
    }

    if (inCodeBlock) {
      textBuf.push(lines[i])
      i++
      continue
    }

    // Detect table start: header row followed by separator row
    if (i + 1 < lines.length && isTableRow(lines[i]) && isTableSeparator(lines[i + 1])) {
      // Flush accumulated text
      if (textBuf.length > 0) {
        segments.push({ type: 'text', content: textBuf.join('\n') })
        textBuf = []
      }

      // Collect all table lines (header + separator + data rows)
      const tableLines = [lines[i], lines[i + 1]]
      i += 2
      while (i < lines.length && isTableRow(lines[i])) {
        tableLines.push(lines[i])
        i++
      }
      segments.push({ type: 'table', content: tableLines.join('\n') })
    } else {
      textBuf.push(lines[i])
      i++
    }
  }

  if (textBuf.length > 0) {
    segments.push({ type: 'text', content: textBuf.join('\n') })
  }

  return segments
}

/** Parse cells from a table row line */
function parseRowCells(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())
}

/** Parse column alignments from a separator row */
function parseColumnAlignments(separator: string): ('left' | 'center' | 'right')[] {
  return parseRowCells(separator).map(col => {
    const t = col.trim()
    if (t.startsWith(':') && t.endsWith(':')) return 'center'
    if (t.endsWith(':')) return 'right'
    return 'left'
  })
}

/** Convert a markdown table string into a Slack table block */
function parseTableToBlock(tableStr: string): Record<string, unknown> {
  const lines = tableStr.trim().split('\n')
  const headerCells = parseRowCells(lines[0])
  const alignments = parseColumnAlignments(lines[1])
  const colCount = headerCells.length

  const columnSettings = Array.from({ length: colCount }, (_, i) => ({
    align: alignments[i] || ('left' as const),
  }))

  const rows: Array<Array<{ type: string; text: string }>> = []

  // Header row
  rows.push(headerCells.map(text => ({ type: 'raw_text', text })))

  // Data rows (pad to column count if needed)
  for (let r = 2; r < lines.length; r++) {
    const cells = parseRowCells(lines[r])
    rows.push(
      Array.from({ length: colCount }, (_, i) => ({
        type: 'raw_text',
        text: cells[i] ?? '',
      })),
    )
  }

  return { type: 'table', column_settings: columnSettings, rows }
}

const SECTION_TEXT_LIMIT = 3000

/**
 * Convert markdown to a Slack message payload with Block Kit support.
 *
 * When the markdown contains tables, they are converted to Slack table blocks.
 * Non-table text is wrapped in section blocks with mrkdwn formatting.
 * When no tables are present, returns plain mrkdwn text (no blocks).
 *
 * Slack limits: max 1 table block per message. If multiple tables exist,
 * only the first becomes a table block; the rest are rendered as code blocks.
 */
export function markdownToSlack(md: string): SlackMessagePayload {
  // Quick check: strip code blocks and look for tables
  const withoutCode = md.replace(/```[\s\S]*?```/g, '')
  if (!containsTable(withoutCode)) {
    return { text: markdownToMrkdwn(md) }
  }

  const segments = splitIntoSegments(md)
  const blocks: Array<Record<string, unknown>> = []
  let tableUsed = false

  for (const seg of segments) {
    if (seg.type === 'table') {
      if (!tableUsed) {
        blocks.push(parseTableToBlock(seg.content))
        tableUsed = true
      } else {
        // Slack allows only 1 table per message; extras become code blocks
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: '```\n' + seg.content + '\n```' },
        })
      }
    } else {
      const mrkdwn = markdownToMrkdwn(seg.content).trim()
      if (!mrkdwn) continue

      if (mrkdwn.length <= SECTION_TEXT_LIMIT) {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: mrkdwn } })
      } else {
        // Split long text at paragraph boundaries to stay within section limit
        let remaining = mrkdwn
        while (remaining.length > 0) {
          if (remaining.length <= SECTION_TEXT_LIMIT) {
            blocks.push({ type: 'section', text: { type: 'mrkdwn', text: remaining } })
            break
          }
          const splitAt = remaining.lastIndexOf('\n\n', SECTION_TEXT_LIMIT)
          const cutPoint = splitAt > 0 ? splitAt : SECTION_TEXT_LIMIT
          blocks.push({ type: 'section', text: { type: 'mrkdwn', text: remaining.slice(0, cutPoint) } })
          remaining = remaining.slice(cutPoint).replace(/^\n+/, '')
        }
      }
    }
  }

  // Fallback text for notifications / accessibility
  return { text: markdownToMrkdwn(md), blocks }
}
