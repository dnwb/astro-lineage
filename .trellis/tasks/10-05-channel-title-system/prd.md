# Channel title system and post presentation

## Goal

Centralize title rules across Tencent Channel and QQ summaries; remove duplicate body titles; safely attach verified website figures to Must Read posts; audit old post differences without publishing unapproved changes.

## Requirements

- One pure title policy is the only source for daily brief, paper, weekly report, and QQ group summary titles.
- A daily brief title starts with `「MM-DD」` and names one source-bound progress. It must not list topics or repeat a paper title.
- A paper title names the object and one complete question or result. It must preserve qualifiers that change the claim.
- A weekly title uses `Wxx周报：<specific progress>`. It must not add `AstroLineage`, `论文更新`, or a topic list.
- The Top 5 post keeps its stable `瞬变源 Top 5` title.
- A long post body must not begin with the same H1 as its platform title. The first screen starts with useful reading information.
- A Must Read post can attach at most one website figure when the paper ID, revision, caption, local build asset, and recorded visual review all match. Missing proof means no image and no publication block.
- Historical title comparison is read-only and uses current source-bound archives. A title-only live edit must preserve the original body, media, feed identity, and section.
- The user approved the candidate titles shown for 2026-10-04 and 2026-W40 only if the automation produces exact matches. No other historical title has approval for live change.

## Acceptance Criteria

- [ ] A shared pure module produces deterministic title candidates and source diagnostics; Tencent Channel publisher and QQ summary use it.
- [ ] Daily, paper, and weekly title formats satisfy the rules above. Invalid or unsupported candidates are blocked instead of clipped or invented.
- [ ] Daily brief, weekly, single-paper, and Top 5 bodies do not repeat the platform title as an H1.
- [ ] Existing reading scope, evidence, paper versions, body links, channel routing, publication ledger, and build binding remain intact.
- [ ] Figure selection rejects wrong revision, missing file, unsafe path, missing caption, and unreviewed file; duplicate media is not appended on reentry.
- [ ] A local preview classifies all registered history rows and reports title/body/media differences and blockers without writing the ledger or remote channel.
- [ ] The generated 2026-10-04 and 2026-W40 titles are compared byte-for-byte with the approved candidates before any title-only remote edit.
- [ ] Only those exact approved title fields may be updated in this task. Do not edit existing bodies or media, create posts, or change any other historical title.
- [ ] Targeted tests, `npm run verify`, and `npm run build` pass. A fresh Sol review checks the exact task diff and preview before any remote edit.
- [ ] If exact generation, source binding, original identity, or live read-back fails, leave the affected post unchanged and report it as pending.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
- Detailed ticket breakdown: `.scratch/channel-title-system/map.md` and `.scratch/channel-title-system/issues/`.
- Canonical content, arXiv analysis, scheduler, QQ proactive messages, and all unapproved live title changes remain out of scope.
