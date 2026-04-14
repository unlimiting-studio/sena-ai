/**
 * Convert standard Markdown to Slack-safe mrkdwn format.
 *
 * Safe mode rules:
 *  - Never rely on Slack auto parsing.
 *  - Preserve explicit Slack tokens like <@U123>, <#C123>, <!here>, <https://x|label>.
 *  - Escape plain-text &, <, > outside code and explicit Slack tokens.
 */

const PH = '\u200B\u200B'

export const SAFE_SLACK_MESSAGE_OPTIONS = Object.freeze({
  parse: 'none' as const,
  link_names: false as const,
  unfurl_links: true as const,
  unfurl_media: true as const,
})

export type SlackMessagePayload = {
  text: string
  blocks?: Array<Record<string, unknown>>
  parse: 'none'
  link_names: false
  unfurl_links: true
  unfurl_media: true
}

type Segment = { type: 'text' | 'table'; content: string }

const SECTION_TEXT_LIMIT = 3000
const EXPLICIT_SLACK_TOKEN_RE =
  /<?<(?:@[A-Z0-9]+(?:\|[^>\n]+)?|#[A-Z0-9]+(?:\|[^>\n]+)?|![^>\n]+|(?:https?|mailto|tel|slack):[^>\n]+|www\.[^>\n]+)>>?/gi

export function createSlackTextPayload(text: string): SlackMessagePayload {
  return {
    text,
    ...SAFE_SLACK_MESSAGE_OPTIONS,
  }
}

function createSlackPayload(
  text: string,
  blocks?: Array<Record<string, unknown>>,
): SlackMessagePayload {
  return blocks && blocks.length > 0
    ? {
        text,
        blocks,
        ...SAFE_SLACK_MESSAGE_OPTIONS,
      }
    : createSlackTextPayload(text)
}

export function markdownToMrkdwn(md: string): string {
  const placeholders: string[] = []

  function hold(value: string): string {
    placeholders.push(value)
    return `${PH}PH_${placeholders.length - 1}${PH}`
  }

  let text = md.replace(/```[\s\S]*?```/g, match => hold(match))
  text = text.replace(/`[^`\n]+`/g, match => hold(match))
  text = text.replace(EXPLICIT_SLACK_TOKEN_RE, match => {
    // Normalize: strip extra outer brackets  <<token>> → <token>
    let inner = match
    if (inner.startsWith('<<')) inner = inner.slice(1)
    if (inner.endsWith('>>')) inner = inner.slice(0, -1)
    return hold(inner)
  })
  text = replaceMarkdownImages(text, hold)
  text = replaceMarkdownLinks(text, hold)

  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_, content) => hold(`*${content}*`))
  text = text.replace(/\*{3}(.+?)\*{3}/g, (_, content) => hold(`*_${content}_*`))
  text = text.replace(/_{3}(.+?)_{3}/g, (_, content) => hold(`*_${content}_*`))
  text = text.replace(/\*{2}(.+?)\*{2}/g, (_, content) => hold(`*${content}*`))
  text = text.replace(/_{2}(.+?)_{2}/g, (_, content) => hold(`*${content}*`))
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_')
  text = text.replace(/(?<!\w)_(?!_)(.+?)(?<!_)_(?!\w)/g, '_$1_')
  text = text.replace(/~~(.+?)~~/g, '~$1~')
  text = text.replace(/^[-*_]{3,}$/gm, '———')
  text = text.replace(/^(\s*)[-*+]\s+/gm, '$1• ')
  text = text.replace(/^(?:>\s?)+/gm, match => hold(match))

  text = escapePlainText(text)

  // Strip entity-encoded brackets wrapping Slack token placeholders
  // e.g. &lt;<url|label>&gt; from previously-encoded text
  const phPat = `\u200B\u200BPH_\\d+\u200B\u200B`
  text = text.replace(new RegExp(`&lt;(${phPat})`, 'g'), '$1')
  text = text.replace(new RegExp(`(${phPat})&gt;`, 'g'), '$1')

  for (let i = placeholders.length - 1; i >= 0; i--) {
    text = text.replaceAll(`${PH}PH_${i}${PH}`, placeholders[i])
  }

  return text
}

function replaceMarkdownImages(text: string, hold: (value: string) => string): string {
  return replaceMarkdownLinkLike(text, hold, true)
}

function replaceMarkdownLinks(text: string, hold: (value: string) => string): string {
  return replaceMarkdownLinkLike(text, hold, false)
}

function replaceMarkdownLinkLike(
  text: string,
  hold: (value: string) => string,
  image: boolean,
): string {
  let out = ''
  let i = 0

  while (i < text.length) {
    const markerStart = image ? '![' : '['
    if (!text.startsWith(markerStart, i)) {
      out += text[i]
      i++
      continue
    }

    const labelStart = image ? i + 1 : i
    const labelEnd = findClosingBracket(text, labelStart)
    if (labelEnd < 0 || text[labelEnd + 1] !== '(') {
      out += text[i]
      i++
      continue
    }

    const urlEnd = findClosingParen(text, labelEnd + 1)
    if (urlEnd < 0) {
      out += text[i]
      i++
      continue
    }

    const label = text.slice(labelStart + 1, labelEnd)
    const url = text.slice(labelEnd + 2, urlEnd).trim()
    out += hold(`<${url}|${label}>`)
    i = urlEnd + 1
  }

  return out
}

function findClosingBracket(text: string, start: number): number {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '[') depth++
    if (ch === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function findClosingParen(text: string, start: number): number {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function escapePlainText(text: string): string {
  return text
    .replace(/&(?!(?:amp|lt|gt);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function isTableSeparator(line: string): boolean {
  return /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/.test(line.trim())
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.includes('|') && trimmed.length > 0 && !isTableSeparator(trimmed)
}

function containsTable(text: string): boolean {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    if (isTableRow(lines[i]) && isTableSeparator(lines[i + 1])) return true
  }
  return false
}

function splitIntoSegments(md: string): Segment[] {
  const lines = md.split('\n')
  const segments: Segment[] = []
  let textBuf: string[] = []
  let inCodeBlock = false
  let i = 0

  while (i < lines.length) {
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

    if (i + 1 < lines.length && isTableRow(lines[i]) && isTableSeparator(lines[i + 1])) {
      if (textBuf.length > 0) {
        segments.push({ type: 'text', content: textBuf.join('\n') })
        textBuf = []
      }

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

function parseRowCells(line: string): string[] {
  const source = line.trim().replace(/^\|/, '').replace(/\|\s*$/, '')
  const cells: string[] = []
  let current = ''
  let escaped = false
  let inInlineCode = false

  for (const ch of source) {
    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === '\\') {
      escaped = true
      current += ch
      continue
    }

    if (ch === '`') {
      inInlineCode = !inInlineCode
      current += ch
      continue
    }

    if (ch === '|' && !inInlineCode) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += ch
  }

  cells.push(current.trim())
  return cells
}

function parseColumnAlignments(separator: string): ('left' | 'center' | 'right')[] {
  return parseRowCells(separator).map(col => {
    const t = col.trim()
    if (t.startsWith(':') && t.endsWith(':')) return 'center'
    if (t.endsWith(':')) return 'right'
    return 'left'
  })
}

function parseTableToBlock(tableStr: string): Record<string, unknown> {
  const lines = tableStr.trim().split('\n')
  const headerCells = parseRowCells(lines[0])
  const alignments = parseColumnAlignments(lines[1])
  const colCount = headerCells.length

  const columnSettings = Array.from({ length: colCount }, (_, i) => ({
    align: alignments[i] || ('left' as const),
  }))

  const rows: Array<Array<{ type: string; text: string }>> = []
  rows.push(headerCells.map(text => ({ type: 'raw_text', text })))

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

function createMrkdwnSection(text: string): Record<string, unknown> {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text,
      verbatim: true,
    },
  }
}

export function markdownToSlack(md: string): SlackMessagePayload {
  const mrkdwnText = markdownToMrkdwn(md)
  const withoutCode = md.replace(/```[\s\S]*?```/g, '')
  if (!containsTable(withoutCode)) {
    return createSlackTextPayload(mrkdwnText)
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
        blocks.push(createMrkdwnSection('```\n' + seg.content + '\n```'))
      }
      continue
    }

    const mrkdwn = markdownToMrkdwn(seg.content).trim()
    if (!mrkdwn) continue

    if (mrkdwn.length <= SECTION_TEXT_LIMIT) {
      blocks.push(createMrkdwnSection(mrkdwn))
      continue
    }

    let remaining = mrkdwn
    while (remaining.length > 0) {
      if (remaining.length <= SECTION_TEXT_LIMIT) {
        blocks.push(createMrkdwnSection(remaining))
        break
      }

      const splitAt = remaining.lastIndexOf('\n\n', SECTION_TEXT_LIMIT)
      const cutPoint = splitAt > 0 ? splitAt : SECTION_TEXT_LIMIT
      blocks.push(createMrkdwnSection(remaining.slice(0, cutPoint)))
      remaining = remaining.slice(cutPoint).replace(/^\n+/, '')
    }
  }

  return createSlackPayload(mrkdwnText, blocks)
}
