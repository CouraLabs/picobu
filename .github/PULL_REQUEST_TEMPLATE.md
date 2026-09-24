---
name: Pull Request
about: Standard PR template for picobu
title: ''
labels: ''
assignees: ''
---

### Pull Request Type

<!-- For change type, change [ ] to [x]. -->

- [ ] ✨ feat (New feature)
- [ ] 🐛 fix (Bug fix)
- [ ] ♻️ refactor (Code refactoring without changing behavior)
- [ ] 💄 style (UI style changes)
- [ ] 🔨 chore (Build, CI, maintenance)
- [ ] 📝 docs (Documentation updates)

### Relevant Issues

<!-- Use "resolves #xxx" to auto resolve on merge. Otherwise, please use "connect #xxx" -->

resolves #

### Description

<!-- Describe the changes in this PR that are impactful to the repo. What problem does it solve? -->


### Visuals (if applicable)

<!-- Add screenshots or screen recordings to demonstrate the changes, especially for UI updates. -->


### Additional Information

<!-- Add any other context about the Pull Request here that was not captured above. -->

### Developer Validations

<!-- All of the applicable items should be checked. -->

- [ ] I ran `bun run lint` from the root of the repo & committed changes
- [ ] I ran `bun run tsc` from the root of the repo & there are no type errors
- [ ] I ran `bun test` and my changes do not introduce failures
- [ ] Relevant documentation has been updated (if applicable)
- [ ] I have tested my code functionality on the platform(s) I could test (Linux/macOS/Windows), and noted any limitations in the PR body
