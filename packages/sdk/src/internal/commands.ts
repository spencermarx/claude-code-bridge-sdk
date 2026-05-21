import type {
  ModelInfo as UpstreamModelInfo,
  SlashCommand as UpstreamSlashCommand,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * Bridge-side normalized shape for a discovered slash command / skill.
 *
 * NOTE: upstream's `SlashCommand` is intentionally minimal — it does NOT
 * carry source classification (builtin/user/project/plugin/skill) or a
 * `userInvocable` flag. Until upstream exposes those, this type carries
 * only the fields actually available. We surface `aliases` and
 * `argumentHint` when upstream provides them.
 */
export interface SlashCommand {
  name: string;
  description: string;
  argumentHint?: string;
  aliases?: string[];
}

/** Bridge-side normalized shape for a switchable model. */
export interface ModelInfo {
  id: string;
  displayName: string;
  description?: string;
  supportsEffort?: boolean;
}

export function normalizeSlashCommand(c: UpstreamSlashCommand): SlashCommand {
  return {
    name: c.name,
    description: c.description,
    ...(c.argumentHint ? { argumentHint: c.argumentHint } : {}),
    ...(c.aliases ? { aliases: c.aliases } : {}),
  };
}

export function normalizeModelInfo(m: UpstreamModelInfo): ModelInfo {
  return {
    id: m.value,
    displayName: m.displayName,
    ...(m.description ? { description: m.description } : {}),
    ...(m.supportsEffort !== undefined ? { supportsEffort: m.supportsEffort } : {}),
  };
}

const VALID_COMMAND_NAME = /^[A-Za-z0-9_\-:.]+$/;

/**
 * Format a slash-command invocation for the upstream streaming input.
 * Mirrors the user-facing convention of typing `/<name> [args]`.
 *
 * @throws Error when `name` contains characters that could fragment the
 *   upstream protocol (newlines, NULs, embedded slashes, etc.). `args` is
 *   passed through as free text — it's a message body, not a shell argument.
 */
export function formatInvocation(name: string, args?: string): string {
  const trimmedName = name.startsWith('/') ? name.slice(1) : name;
  if (!VALID_COMMAND_NAME.test(trimmedName)) {
    throw new Error(
      `Invalid slash-command name "${name}". Names must match ${VALID_COMMAND_NAME.source}.`,
    );
  }
  return args && args.length > 0 ? `/${trimmedName} ${args}` : `/${trimmedName}`;
}
