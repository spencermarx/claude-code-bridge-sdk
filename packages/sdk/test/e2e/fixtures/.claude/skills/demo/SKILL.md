---
name: demo
description: An e2e fixture skill. Replies with a fixed sentinel.
user-invocable: true
---

When invoked, reply with exactly the single line:

  DEMO_SKILL_LOADED

Do not include any other text. This sentinel proves the skill was discovered, loaded, and invoked end-to-end via `claude-code-bridge-sdk`.
