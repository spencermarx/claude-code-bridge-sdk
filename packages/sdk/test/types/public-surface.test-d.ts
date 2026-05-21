import type {
  Options as UpstreamOptions,
  SDKMessage as UpstreamSDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { expectTypeOf } from 'expect-type';
import { describe, it } from 'vitest';
import {
  type ClaudeError,
  type FinalResult,
  type Options,
  type Pool,
  type RunHandle,
  type SDKMessage,
  type Session,
  type SessionSnapshot,
  claude,
  type inspect,
  type list,
  type pool,
  type run,
  type session,
} from '../../src';

// Pin the public API shape. These tests are compile-time only — if any of
// these expectations break, our public surface has drifted.

describe('public types', () => {
  it('Options is the exact upstream Options type (no drift)', () => {
    expectTypeOf<Options>().toEqualTypeOf<UpstreamOptions>();
  });

  it('SDKMessage is the exact upstream SDKMessage type', () => {
    expectTypeOf<SDKMessage>().toEqualTypeOf<UpstreamSDKMessage>();
  });

  it('claude namespace has run, session, pool, inspect, list', () => {
    expectTypeOf(claude.run).toEqualTypeOf<typeof run>();
    expectTypeOf(claude.session).toEqualTypeOf<typeof session>();
    expectTypeOf(claude.pool).toEqualTypeOf<typeof pool>();
    expectTypeOf(claude.inspect).toEqualTypeOf<typeof inspect>();
    expectTypeOf(claude.list).toEqualTypeOf<typeof list>();
  });

  it('RunHandle is iterable AND thenable', () => {
    expectTypeOf<RunHandle>().toMatchTypeOf<AsyncIterable<SDKMessage>>();
    expectTypeOf<RunHandle>().toMatchTypeOf<PromiseLike<FinalResult>>();
  });

  it('Session has commands(), models(), invoke()', () => {
    expectTypeOf<Session['commands']>().toBeFunction();
    expectTypeOf<Session['models']>().toBeFunction();
    expectTypeOf<Session['invoke']>().toBeFunction();
    expectTypeOf<ReturnType<Session['commands']>>().resolves.toBeArray();
    expectTypeOf<ReturnType<Session['models']>>().resolves.toBeArray();
  });

  it('Pool exposes map / race / pipeline / kill', () => {
    expectTypeOf<Pool['map']>().toBeFunction();
    expectTypeOf<Pool['race']>().toBeFunction();
    expectTypeOf<Pool['pipeline']>().toBeFunction();
    expectTypeOf<Pool['kill']>().toBeFunction();
  });

  it('SessionSnapshot has the documented fields', () => {
    expectTypeOf<SessionSnapshot>().toHaveProperty('sessionId').toEqualTypeOf<string>();
    expectTypeOf<SessionSnapshot>().toHaveProperty('exists').toEqualTypeOf<boolean>();
    expectTypeOf<SessionSnapshot>().toHaveProperty('inputTokens').toEqualTypeOf<number>();
    expectTypeOf<SessionSnapshot>().toHaveProperty('outputTokens').toEqualTypeOf<number>();
    expectTypeOf<SessionSnapshot>()
      .toHaveProperty('derivedStatus')
      .toEqualTypeOf<'completed' | 'active' | 'interrupted' | 'unknown'>();
  });

  it('ClaudeError carries a stable `code` string', () => {
    expectTypeOf<ClaudeError['code']>().toEqualTypeOf<string>();
  });
});
