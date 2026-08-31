# Fly.io provider reference

Read only after `deployment.md` §2 selects Fly.io.

## App layout

- One app per environment: `<project>-qm-<env>` (e.g. `acme-qm-prod`).
- Region defaults to the nearest `fly` edge with `shared-cpu-1x@512MB`;
  scale up only if acceptance checks time out.

## Steps

1. `fly launch --name <app> --no-deploy` — answer **no** to every add-on
   prompt; the repository's `fly.toml` is authoritative.
2. `fly secrets set QM_BASE_MODEL_KEY=... QM_SIGNIN_METHOD=...` — the two
   credentials collected in `deployment.md` §1.
3. `fly deploy` — wait for the release to finish; a red release is a stop,
   not a retry loop.
4. Health: `fly status` then `fly checks list` — every check green.

## Post-deploy

- Run `deployment.md` §3 acceptance checks against the app URL.
- Rollback one-liner: `fly releases rollback <previous-version>`.
- Never store secrets in `fly.toml` or the handoff block.
