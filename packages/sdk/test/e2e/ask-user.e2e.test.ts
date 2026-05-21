import { describe, expect, it, vi } from 'vitest';
import { type AskUserHandler, claude } from '../../src';
import { useTempCwd, withTimeout } from './_helpers';

describe('e2e: AskUserQuestion bridge', () => {
  const cwd = useTempCwd();

  it('invokes onAskUser when Claude calls the AskUserQuestion tool', async () => {
    const ac = withTimeout(180_000);
    const onAskUser = vi.fn<AskUserHandler>(async ({ questions }) => {
      const answers: Record<string, string> = {};
      for (const q of questions) {
        answers[q.question] = q.options[0]?.label ?? 'unknown';
      }
      return { answers };
    });

    const r = claude.run({
      // Sonnet is more reliable at following tool-use instructions than Haiku.
      model: 'claude-sonnet-4-6',
      maxTurns: 5,
      permissionMode: 'default',
      // Lock the model down to ONLY AskUserQuestion so it has no escape hatch.
      allowedTools: ['AskUserQuestion'],
      cwd: cwd(),
      abortController: ac,
      prompt:
        'You MUST use the AskUserQuestion tool to ask the user which color they prefer. ' +
        'The question is "Which color?" with header "Color" and two options: ' +
        '"blue" (description: "Cool color") and "red" (description: "Warm color"). ' +
        'multiSelect: false. You may not answer without the tool. After the user responds, ' +
        'reply with exactly one word: the chosen color.',
      onAskUser,
    });

    await r;
    expect(onAskUser).toHaveBeenCalled();
    const callArg = onAskUser.mock.calls[0]?.[0];
    expect(callArg?.questions.length).toBeGreaterThanOrEqual(1);
  });
});
