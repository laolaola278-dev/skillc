# AWS provider reference

Read only after `deployment.md` §2 selects AWS.

## Stack layout

- One CloudFormation stack per environment: `<project>-qm-<env>`.
- ECS Fargate service behind an ALB; parameters live in SSM
  `/qm/<project>/<env>/`.

## Steps

1. Put the two credentials from `deployment.md` §1 into SSM as
   `SecureString` parameters (`base-model-key`, `signin-method`).
2. `aws cloudformation deploy --template-file aws/qm-stack.yml
   --stack-name <project>-qm-<env> --capabilities CAPABILITY_IAM`.
3. Wait for `CREATE_COMPLETE` / `UPDATE_COMPLETE`; a `ROLLBACK_*` state is a
   hard stop — report the failing event, do not redeploy blindly.
4. Health: ALB target group must show all targets healthy.

## Post-deploy

- Run `deployment.md` §3 acceptance checks against the ALB DNS name.
- Rollback one-liner: `aws cloudformation cancel-update-stack --stack-name
  <stack>` (in-flight) or redeploy the previous template version.
