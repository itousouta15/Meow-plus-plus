export class LangError extends Error {
  constructor(phase, message, span, frames = []) {
    super(message);
    this.name = 'LangError';
    this.phase = phase;
    this.span = span ?? { start: 0, end: 0, line: 1, column: 1 };
    this.frames = frames;
  }
  toJSON() {
    return { phase: this.phase, message: this.message, span: this.span, frames: this.frames };
  }
}

export function fail(message, span, phase = 'runtime') {
  throw new LangError(phase, message, span);
}

export function formatDiagnostic(error, source, filename = '<source>') {
  const { line, column, start, end } = error.span ?? { line: 1, column: 1, start: 0, end: 0 };
  const lines = source.split(/\r?\n/);
  const original = lines[line - 1] ?? '';
  const left = Math.max(0, column - 61);
  const excerpt = original.slice(left, left + 140).replaceAll('\t', ' ');
  const width = Math.max(1, Math.min(end - start, 60, excerpt.length - (column - 1 - left)));
  const prefix = `${line} | `;
  let result = `${filename}:${line}:${column}: ${error.phase ?? 'runtime'}: ${error.message}\n`;
  result += `${prefix}${left ? '…' : ''}${excerpt}\n`;
  result += ' '.repeat(prefix.length + column - 1 - left + (left ? 1 : 0)) + '^'.repeat(width);
  for (const frame of [...(error.frames ?? [])].reverse()) {
    result += `\n  at ${frame.name} (${filename}:${frame.span.line}:${frame.span.column})`;
  }
  return result;
}
