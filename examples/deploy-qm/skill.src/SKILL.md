# Deploy QM

Read `deployment.md` completely and follow it as the authoritative workflow.
Read only the selected provider reference.

A deployment needs a base model key and a way for people to sign in. Collect
both in the same pass.

Use the repository's installed `@yc-software/qm` dependency through
`npm exec qm -- <command>`. Do not require or clone the QM source repository.
Do not stop at infrastructure health: complete the acceptance checks and return
the handoff required by `deployment.md`.
