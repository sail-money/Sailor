/**
 * Routes command output to either a human-readable console rendering or a
 * single machine-readable JSON line, based on the `--json` flag. Agents pass
 * `--json` and parse stdout; humans get the prose form.
 */
export function emit(json: boolean | undefined, human: () => void, payload: unknown): void {
  if (json) {
    console.log(JSON.stringify(payload));
  } else {
    human();
  }
}
