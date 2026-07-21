# 3. 非功能需求 — Deployment Checklist

## Pre-Deploy

- [ ] All tests pass (`speccore lifecycle --task=3. 非功能需求 --check`)
- [ ] Code review approved (REVIEW.md all checked)
- [ ] PR merged to main
- [ ] CI/CD pipeline green


## Deploy Steps

1. [ ] Merge to release branch
2. [ ] Tag version: `git tag vX.Y.Z`
3. [ ] Deploy to staging
4. [ ] Smoke test on staging
5. [ ] Deploy to production

## Post-Deploy

- [ ] Monitor error logs (first 30 min)
- [ ] Monitor performance metrics
- [ ] Run `speccore archive --task=3. 非功能需求`

## Rollback Plan

- [ ] `git revert` the merge commit
- [ ] Notify team on rollback
