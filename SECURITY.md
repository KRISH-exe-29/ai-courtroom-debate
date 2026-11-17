# Security Policy

## Supported versions

Security fixes go to the latest release on `main`.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through
[GitHub Security Advisories](https://github.com/KRISH-exe-29/ai-courtroom-debate/security/advisories/new).
Include what is affected, how to reproduce it and the impact you expect. You will get a reply within a week.

## Scope

Of particular interest:

- **API key handling.** Keys are read from the environment or `.env.local` and must never be logged, written to trial files or sent anywhere except the chosen provider.
- **Prompt injection through case text.** The idea and context are user input and must never be able to change the rules the lawyers or the judge follow.
- **Agent mode.** Claude Code and Codex are started with tools, plugins and settings switched off. Any way for trial content to make an agent run commands or read files is a vulnerability.

## Your own keys

Never commit `.env.local`; it is in `.gitignore`. If you leak a key, revoke it with your provider immediately.
