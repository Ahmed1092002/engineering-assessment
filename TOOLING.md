# Tooling

## Tools Used

- Codex desktop agent with GPT-5.
- PowerShell for repository inspection and local commands.
- Git to fetch the public assessment repository into the workspace.
- Local file search and reads via shell commands.

## How AI Was Used

I used the coding agent to inspect the repository, identify risks against `docs/DOMAIN.md`, implement a focused vertical slice, add regression tests, and write the deliverable documents. I kept the implementation narrow and checked it against the domain contract rather than broadening into unrelated cleanup.

## Verification of AI Output

I reviewed the affected service, route, schema, and tests directly. After switching to Node `22.18.0` and pnpm `9.15.4`, I ran `pnpm run setup` and `pnpm check`. Lint, typecheck, tests, and the Next.js production build all passed.

## Tradeoff

The agent was useful for quickly mapping the code and producing a coherent patch. I treated its output as a draft requiring review against the domain rules, especially around transaction boundaries, idempotency, and authorization behavior.
