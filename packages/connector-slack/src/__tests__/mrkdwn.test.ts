import { describe, it, expect } from 'vitest'
import { markdownToMrkdwn } from '../mrkdwn.js'

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

  it('converts links', () => {
    expect(markdownToMrkdwn('click [here](https://example.com)')).toBe('click <https://example.com|here>')
  })

  it('converts images to links', () => {
    expect(markdownToMrkdwn('![alt text](https://img.png)')).toBe('<https://img.png|alt text>')
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
})
