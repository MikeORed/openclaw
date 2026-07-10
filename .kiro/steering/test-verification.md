# Test Verification

## Running Tests with Output Capture

When running tests during task execution, always capture output to a log file so results can be reviewed reliably regardless of terminal streaming issues.

### Procedure

1. **Run tests with output redirect and post-flush wait:**

   ```
   pnpm test <path-or-filter> > .kiro/test-output.log 2>&1 & ping -n 3 127.0.0.1 >nul
   ```

   The trailing `ping` adds a ~2 second delay after the test process exits, ensuring the OS has fully flushed and closed the log file before the shell returns.

2. **Read the log file** to confirm pass/fail status and review any errors:

   ```
   .kiro/test-output.log
   ```

3. **Delete the log file** after confirming results:
   ```
   del .kiro\test-output.log
   ```

### Rules

- Always use `pnpm test`, never raw `vitest` or `npx vitest`
- The log file is ephemeral — delete it after every read
- If tests fail, read the full log to diagnose before retrying
- Do not commit `.kiro/test-output.log` (it is gitignored by `.kiro/` patterns)
- Report the actual test results (pass count, fail count, duration) from the log file in your response
- **Do not read the log file in the same tool-call response that ran the tests.** The test command and the file read must be separate sequential steps to guarantee the file is fully written.
- If the log file appears truncated (no final summary line with pass/fail counts), wait and re-read it — the process may not have finished flushing

### Terminal Output Is Unreliable — Ignore It

- **Never** interpret, trust, or act on the terminal/command output returned by the shell execution tool. It may be garbled, truncated, interleaved, or completely missing.
- The **only** source of truth for test results is the log file (`.kiro/test-output.log`). Always read it with the file-reading tool.
- Even if the terminal output appears to show passing tests, failing tests, or errors — disregard it entirely. Read the log file.
- Even if the terminal output is empty or shows a zero exit code — still read the log file to confirm actual results.
- Do not summarize, quote, or reference terminal output when reporting test results. Only report what the log file contains.
