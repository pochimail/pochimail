# Design material

Reference screens and design-tool fonts only. Tokens, fonts, brand and mascot live in the code (`packages/ui`, `apps/desktop/build`); the rules are in [design.md](../design.md).

| Path | What |
|---|---|
| `screens/{light,dark}/` | Every screen at 2x |
| `screens/{phone,narrow-window}/` | 390px phone and 860px icon-rail layouts |
| `screens/html/` | Static HTML and CSS with mock data: exact spacing, colors, copy |
| `screens/source/` | Original canvas files; `Motion.dc.html` is the source of truth for board-sourced timings; idle-flourish timings live in `motion.ts` |
| `fonts/ttf/` | Full variable fonts for Figma and Sketch |

The **light desktop screens** are canonical. Dark, phone and narrow exports show theme and layout only; their export glitches (empty percentages, blank Pause, missing checkboxes, crushed segmented labels, outlines on unselected modes) are not reproduced. Mascot PNGs are placeholders for the 3D render.

Screen references that say mail is never deleted predate [ADR 0012](../adr/0012-delete-moves-to-trash-with-approval.md) and will be replaced by the maintainer's copy design issue.

Brand assets (name, logo, icon, mascot) are not under the code license: see [TRADEMARKS.md](../../TRADEMARKS.md).
