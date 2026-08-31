# QM Deployment Workflow (authoritative)

This document is the single source of truth for deploying QM. `SKILL.md`
defers to it. Do not improvise steps that contradict this file.

## 0. Preconditions

- You are inside the **organization-owned deployment repository** (the one
  holding `@yc-software/qm` as an installed dependency).
- QM is invoked only via `npm exec qm -- <command>`. Never clone, require, or
  vendor the QM source.

## 1. Credentials — collect both in the same pass

A deployment needs exactly two secrets, gathered together before any command:

1. **Base model key** — the key for the model backend QM will call.
2. **Sign-in method** — how the administrator will authenticate (SSO
   redirect, magic-link domain, or basic-auth bootstrap).

Ask for both in one message. Do not start infrastructure work with only one.

## 2. Provider deployment

Pick the provider the user names and read only that reference:

- Fly.io → `references/fly.md`
- AWS → `references/aws.md`

Complete infrastructure bring-up, but **do not stop at health checks**.

## 3. Acceptance checks (all required)

1. `npm exec qm -- status` reports every component healthy.
2. The sign-in flow round-trips: open the login URL, authenticate with the
   bootstrap method, land on the admin dashboard.
3. One connector can be listed and one connector can be created.
4. The base model responds to a `qm models ping`.

If any check fails, stop, report the failing check with its raw output, and
hand back — do not silently retry more than once.

## 4. Handoff (mandatory closing)

Return a handoff block containing:

- deployment URL and region
- admin sign-in method (never the credential values themselves)
- the exact `npm exec qm --` commands that were run
- acceptance-check results, one line each
- rollback one-liner for the provider used
