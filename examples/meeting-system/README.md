# Meeting System — SpecCore Example

A meeting room management system built with SpecCore spec-driven development.

## Iteration: Iteration-001-meeting

### Requirements (010-requirements/)
- **app** — Mobile app (iOS/Android)
- **h5** — H5 mobile web
- **miniapp** — WeChat miniapp
- **admin** — Admin dashboard

### Specs (020-specs/)
- 6 API endpoints per platform (rooms CRUD + bookings)
- 3 data models: Room, Booking, User
- Tech: Spring Boot 3 + Vue 3

### Tasks
| Task | Platform | Assignee | Status |
|------|----------|----------|--------|
| Task-001 | app | Alice | pending |
| Task-002 | h5 | Alice | pending |
| Task-003 | miniapp | Bob | pending |
| Task-004 | admin | Bob | pending |

## Getting Started

```bash
cd examples/meeting-system
speccore init                              # Initialize SpecCore
speccore welcome                           # View project overview
speccore ask "analyze meeting requirements" # AI-powered routing
speccore dev --auto                        # Run full pipeline
```
