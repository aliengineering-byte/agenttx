# AgentTX launch plan

The repository and npm package are already public. The launch goal is genuine usage and technical feedback, not synchronized noise across every channel.

## Pre-flight

- Use the current public `main` branch only after exact-SHA CI is green.
- Attach `docs/assets/agenttx-demo.gif`; keep `docs/assets/agenttx-demo.png` as the static fallback.
- Confirm the GitHub README and npm package links render before posting.
- Use the prepared channel copy as a starting point, then answer in the founder's own voice.
- Do not claim named-agent smoke tests that are not recorded in `docs/AGENT_COMPATIBILITY.md`.

## Phase 1 — initial activity

Start with one founder-controlled social channel, preferably X with the demo-focused option. Follow with LinkedIn and one relevant Reddit community only when the copy fits that community's rules.

Goals:

- the first external install and successful `agenttx demo` run;
- the first real compatibility report;
- questions that reveal which guarantee or limitation is unclear;
- a small amount of genuine repository activity before broader exposure.

Do not post identical copy everywhere on the same minute. Reply to questions before opening another channel.

## Phase 2 — Show HN

Launch Show HN after the first wave has produced a small amount of genuine activity and the founder can be available to answer technical comments. The delay should be short—measured in hours or a few days, not weeks. No numerical star or install threshold is required.

Use the repository as the submission URL and the prepared HN body as the first comment if necessary. Lead with the problem, workflow, demo, and limitations.

## Phase 3 — follow-up

- Answer comments with the precise material in `launch/RESPONSES.md`.
- Ask successful users for agent, OS, Node, Git, and AgentTX versions in a compatibility report.
- Convert repeated questions or reproducible defects into issues.
- Share technical details only when they advance the discussion; do not repost the launch announcement as a reply.
- Update `launch/LAUNCH_METRICS.md` manually after each meaningful checkpoint.

## Channel assets

| Channel | Copy | Visual |
|---|---|---|
| X | `launch/X.md` Option B | Animated GIF |
| LinkedIn | `launch/LINKEDIN.md` | Animated GIF or static PNG |
| Reddit | `launch/REDDIT.md` relevant variant | Repository link; demo linked naturally |
| Hacker News | `launch/HACKER_NEWS.md` | Repository URL |

Product Hunt is not part of the first wave. Revisit it only if real users provide a clearer use-case story than the current developer-community launch.
