# Release checklist

Run from the repository root. Record evidence in the release notes or release handoff; do not check an item based on assumption.

## Repository and package

- [ ] clean Git status
- [ ] package version correct
- [ ] intended repository, homepage, and issue URLs verified if present
- [ ] changelog updated
- [ ] license intentional and dependency licenses compatible
- [ ] README links verified with `npm run check:links`

## Validation

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:coverage`
- [ ] `npm run build`
- [ ] `npm run demo`
- [ ] `npm run benchmark`
- [ ] `npm run scan:secrets`

## Distribution proof

- [ ] `npm pack --dry-run`
- [ ] final tarball contents inspected
- [ ] built CLI and shebang present
- [ ] package has no secrets, private paths, or development junk
- [ ] `npm run release:verify`
- [ ] fresh rollback scenario passes
- [ ] fresh dirty-repository commit scenario passes
- [ ] concurrent-change refusal passes without overwrite
- [ ] package name checked immediately before publication

## Publication

- [ ] GitHub CI green on the final release commit
- [ ] release commit SHA recorded
- [ ] annotated release tag prepared from that exact commit without moving an existing tag
- [ ] package tarball SHA-256 recorded
- [ ] GitHub repository publication verified
- [ ] npm publication verified from the public registry
- [ ] GitHub release created from the verified tag

Never publish when ownership, authentication, repository namespace, or release intent is ambiguous.
