import { describe, it, expect } from 'vitest'
import {
  SAFE_SLACK_MESSAGE_OPTIONS,
  createSlackTextPayload,
  markdownToMrkdwn,
  markdownToSlack,
} from '../mrkdwn.js'

describe('markdownToMrkdwn', () => {
  it('converts bold', () => {
    expect(markdownToMrkdwn('this is **bold** text')).toBe('this is *bold* text')
  })

  it('converts italic (single asterisk)', () => {
    expect(markdownToMrkdwn('this is *italic* text')).toBe('this is _italic_ text')
  })

  it('converts bold+italic', () => {
    expect(markdownToMrkdwn('this is ***bold italic*** text')).toBe('this is *_bold italic_* text')
  })

  it('converts strikethrough', () => {
    expect(markdownToMrkdwn('this is ~~deleted~~ text')).toBe('this is ~deleted~ text')
  })

  it('converts links with nested parentheses', () => {
    expect(markdownToMrkdwn('click [here](https://example.com/a_(b))')).toBe(
      'click <https://example.com/a_(b)|here>',
    )
  })

  it('converts images to links', () => {
    expect(markdownToMrkdwn('![alt text](https://img.png)')).toBe('<https://img.png|alt text>')
  })

  it('preserves explicit Slack link tokens', () => {
    expect(markdownToMrkdwn('열기 <https://example.com|문서>')).toBe('열기 <https://example.com|문서>')
  })

  it('preserves explicit mention and channel tokens', () => {
    expect(markdownToMrkdwn('<@U123> in <#C123|general>')).toBe('<@U123> in <#C123|general>')
  })

  it('converts headings to bold', () => {
    expect(markdownToMrkdwn('# Title\n## Subtitle')).toBe('*Title*\n*Subtitle*')
  })

  it('converts horizontal rules', () => {
    expect(markdownToMrkdwn('above\n---\nbelow')).toBe('above\n———\nbelow')
  })

  it('converts unordered list markers to bullets', () => {
    expect(markdownToMrkdwn('- item 1\n- item 2\n* item 3')).toBe('• item 1\n• item 2\n• item 3')
  })

  it('escapes plain-text angle brackets and ampersands', () => {
    expect(markdownToMrkdwn('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d')
  })

  it('preserves inline code', () => {
    expect(markdownToMrkdwn('use `**not bold**` here')).toBe('use `**not bold**` here')
  })

  it('preserves code blocks', () => {
    const input = '```\n**not bold**\n[not a link](url)\n```'
    expect(markdownToMrkdwn(input)).toBe(input)
  })

  it('handles mixed content', () => {
    const input = '## Summary\n\nThis is **important** and [link](https://x.com).\n\n```js\nconst x = 1\n```'
    const expected = '*Summary*\n\nThis is *important* and <https://x.com|link>.\n\n```js\nconst x = 1\n```'
    expect(markdownToMrkdwn(input)).toBe(expected)
  })

  it('passes through plain text unchanged', () => {
    const input = 'just plain text with no formatting'
    expect(markdownToMrkdwn(input)).toBe(input)
  })

  it('handles numbered lists (no change needed)', () => {
    const input = '1. first\n2. second'
    expect(markdownToMrkdwn(input)).toBe(input)
  })

  it('preserves blockquotes', () => {
    const input = '> this is a quote'
    expect(markdownToMrkdwn(input)).toBe('> this is a quote')
  })

  it('normalizes double-bracket wrapped Slack tokens', () => {
    expect(markdownToMrkdwn('<<https://slack.com/archives/C1/p123|쓰레드>>')).toBe(
      '<https://slack.com/archives/C1/p123|쓰레드>',
    )
  })

  it('normalizes double-bracket Slack tokens with surrounding text', () => {
    expect(markdownToMrkdwn('여기 <<https://example.com|link>> 참고')).toBe(
      '여기 <https://example.com|link> 참고',
    )
  })

  it('strips entity-encoded brackets wrapping raw Slack tokens', () => {
    expect(markdownToMrkdwn('&lt;<https://example.com|link>&gt;')).toBe(
      '<https://example.com|link>',
    )
  })

  it('preserves entity-encoded Slack tokens as-is (intentional escaping)', () => {
    expect(markdownToMrkdwn('&lt;https://example.com|link&gt;')).toBe(
      '&lt;https://example.com|link&gt;',
    )
  })
})

describe('createSlackTextPayload', () => {
  it('applies safe-mode message options', () => {
    expect(createSlackTextPayload('hello')).toEqual({
      text: 'hello',
      ...SAFE_SLACK_MESSAGE_OPTIONS,
    })
  })
})

describe('markdownToSlack', () => {
  it('returns safe text payload when no tables', () => {
    const result = markdownToSlack('just **bold** text')
    expect(result).toEqual({
      text: 'just *bold* text',
      ...SAFE_SLACK_MESSAGE_OPTIONS,
    })
    expect(result.blocks).toBeUndefined()
  })

  it('converts a simple markdown table to a table block', () => {
    const md = '| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |'
    const result = markdownToSlack(md)
    expect(result.blocks).toBeDefined()
    expect(result.blocks).toHaveLength(1)

    const table = result.blocks![0]
    expect(table.type).toBe('table')
    expect(table.rows).toHaveLength(3)
    expect(table.column_settings).toEqual([{ align: 'left' }, { align: 'left' }])

    const rows = table.rows as Array<Array<{ type: string; text: string }>>
    expect(rows[0]).toEqual([
      { type: 'raw_text', text: 'Name' },
      { type: 'raw_text', text: 'Age' },
    ])
    expect(rows[1]).toEqual([
      { type: 'raw_text', text: 'Alice' },
      { type: 'raw_text', text: '30' },
    ])
  })

  it('detects single-column markdown tables', () => {
    const md = '| Col |\n|---|\n| value |'
    const result = markdownToSlack(md)
    expect(result.blocks?.[0].type).toBe('table')
  })

  it('respects column alignment from separator row', () => {
    const md = '| Left | Center | Right |\n|:-----|:------:|------:|\n| a | b | c |'
    const result = markdownToSlack(md)
    const table = result.blocks![0]
    expect(table.column_settings).toEqual([
      { align: 'left' },
      { align: 'center' },
      { align: 'right' },
    ])
  })

  it('wraps surrounding text in verbatim section blocks', () => {
    const md = 'Before table\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nAfter table'
    const result = markdownToSlack(md)
    expect(result.blocks).toHaveLength(3)
    const first = result.blocks![0] as { type: string; text?: { verbatim?: boolean } }
    const last = result.blocks![2] as { type: string; text?: { verbatim?: boolean } }
    expect(first.type).toBe('section')
    expect(first.text?.verbatim).toBe(true)
    expect(result.blocks![1].type).toBe('table')
    expect(last.type).toBe('section')
    expect(last.text?.verbatim).toBe(true)
  })

  it('does not convert tables inside code blocks', () => {
    const md = '```\n| A | B |\n|---|---|\n| 1 | 2 |\n```'
    const result = markdownToSlack(md)
    expect(result.blocks).toBeUndefined()
  })

  it('converts only first table to block, extras become code blocks', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |\n\n| C | D |\n|---|---|\n| 3 | 4 |'
    const result = markdownToSlack(md)
    expect(result.blocks).toBeDefined()
    const tableBlocks = result.blocks!.filter(b => b.type === 'table')
    expect(tableBlocks).toHaveLength(1)

    const sectionBlocks = result.blocks!.filter(b => b.type === 'section')
    const hasCodeBlock = sectionBlocks.some(b => {
      const text = (b.text as { text: string })?.text ?? ''
      return text.includes('```')
    })
    expect(hasCodeBlock).toBe(true)
  })

  it('pads rows with fewer cells than header', () => {
    const md = '| A | B | C |\n|---|---|---|\n| 1 |'
    const result = markdownToSlack(md)
    const rows = result.blocks![0].rows as Array<Array<{ type: string; text: string }>>
    expect(rows[1]).toHaveLength(3)
    expect(rows[1][1].text).toBe('')
    expect(rows[1][2].text).toBe('')
  })

  it('includes fallback text and safe-mode options for notifications', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    const result = markdownToSlack(md)
    expect(result).toMatchObject({
      text: expect.any(String),
      ...SAFE_SLACK_MESSAGE_OPTIONS,
    })
  })
})
