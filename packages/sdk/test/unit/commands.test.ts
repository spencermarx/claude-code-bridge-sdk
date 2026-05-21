import { describe, expect, it } from 'vitest';
import {
  formatInvocation,
  normalizeModelInfo,
  normalizeSlashCommand,
} from '../../src/internal/commands';

describe('formatInvocation', () => {
  it('prepends a slash', () => {
    expect(formatInvocation('demo')).toBe('/demo');
  });
  it('strips a leading slash on the input', () => {
    expect(formatInvocation('/demo')).toBe('/demo');
  });
  it('appends args when present', () => {
    expect(formatInvocation('init', 'foo bar')).toBe('/init foo bar');
  });
  it('omits the space when args is empty', () => {
    expect(formatInvocation('init', '')).toBe('/init');
  });
});

describe('normalizeSlashCommand', () => {
  it('maps the upstream shape to the bridge shape', () => {
    const out = normalizeSlashCommand({
      name: 'demo',
      description: 'A demo skill',
      argumentHint: '<file>',
      aliases: ['d'],
    });
    expect(out).toEqual({
      name: 'demo',
      description: 'A demo skill',
      argumentHint: '<file>',
      aliases: ['d'],
    });
  });
  it('omits optional fields cleanly', () => {
    const out = normalizeSlashCommand({
      name: 'a',
      description: 'b',
      argumentHint: '',
    });
    expect(out.aliases).toBeUndefined();
    expect(out.argumentHint).toBeUndefined();
  });
});

describe('formatInvocation name validation', () => {
  it('rejects newline-bearing names', () => {
    expect(() => formatInvocation('demo\ninject')).toThrow(/Invalid slash-command name/);
  });
  it('rejects shell metacharacter names', () => {
    expect(() => formatInvocation('demo;rm')).toThrow(/Invalid slash-command name/);
  });
  it('rejects whitespace in names', () => {
    expect(() => formatInvocation('demo skill')).toThrow(/Invalid slash-command name/);
  });
  it('accepts dotted, colon, and dash names', () => {
    expect(formatInvocation('plugin:skill-name.v2')).toBe('/plugin:skill-name.v2');
  });
});

describe('normalizeModelInfo', () => {
  it('maps value → id and preserves the metadata', () => {
    const out = normalizeModelInfo({
      value: 'claude-opus-4-7',
      displayName: 'Claude Opus',
      description: 'biggest',
      supportsEffort: true,
    });
    expect(out).toEqual({
      id: 'claude-opus-4-7',
      displayName: 'Claude Opus',
      description: 'biggest',
      supportsEffort: true,
    });
  });
});
