#!/usr/bin/env python3
"""Render the verified AgentTX demo output into launch-safe terminal assets."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


WIDTH = 1200
HEIGHT = 760
BACKGROUND = "#0d1117"
PANEL = "#161b22"
BORDER = "#30363d"
TEXT = "#e6edf3"
MUTED = "#8b949e"
BLUE = "#58a6ff"
GREEN = "#3fb950"
RED = "#ff7b72"
YELLOW = "#d29922"

ANSI = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")
PRIVATE_PATHS = re.compile(
    r"(?:[A-Za-z]:\\Users\\|/Users/|/home/|files-mentioned-by-the-user|Codex[\\/]20\d\d)",
    re.IGNORECASE,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--gif", required=True, type=Path)
    parser.add_argument("--png", required=True, type=Path)
    parser.add_argument("--transcript", required=True, type=Path)
    parser.add_argument("--font", type=Path)
    return parser.parse_args()


def load_font(size: int, bold: bool, requested: Path | None) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates: list[Path] = []
    if requested:
        candidates.append(requested)
        if bold and requested.name.lower() == "consola.ttf":
            candidates.insert(0, requested.with_name("consolab.ttf"))
    candidates.extend(
        Path(path)
        for path in (
            "C:/Windows/Fonts/consolab.ttf" if bold else "C:/Windows/Fonts/consola.ttf",
            "/System/Library/Fonts/Menlo.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
            if bold
            else "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        )
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


def validate_source(source: str) -> None:
    required = (
        "editing src/auth.ts",
        "creating src/session.ts",
        "deleting src/legacy.ts",
        "adding a package dependency",
        "changing .github/workflows/ci.yml",
        "attempting simulated external write: git push origin main",
        "git push can modify a remote repository [BLOCKED]",
        "7 files",
        "+21 / -5",
        "HIGH (7)",
        "7 files changed",
        "Transaction rolled back",
        "7 transaction changes discarded",
        "Original workspace unchanged",
    )
    missing = [marker for marker in required if marker not in source]
    if missing:
        raise SystemExit(f"Demo output is missing required evidence: {', '.join(missing)}")
    if PRIVATE_PATHS.search(source):
        raise SystemExit("Demo output contains a private machine path; refusing to render.")


def line(text: str, color: str = TEXT, bold: bool = False) -> tuple[str, str, bool]:
    return (text, color, bold)


STAGES: list[list[tuple[str, str, bool]]] = [
    [
        line("$ agenttx demo", GREEN, True),
        line(""),
        line("Starting demo transaction..."),
        line("The agent runs in an isolated repository workspace.", MUTED),
    ],
    [
        line("Agent:", BLUE, True),
        line("  editing src/auth.ts"),
        line("  creating src/session.ts"),
        line("  deleting src/legacy.ts"),
        line("  adding a package dependency"),
        line("  changing .github/workflows/ci.yml"),
        line("  attempting simulated external write: git push origin main"),
    ],
    [
        line("AgentTX Transaction", BLUE, True),
        line("State         REVIEW"),
        line("Changes       7 files   +21 / -5"),
        line(""),
        line("Side Effects", BLUE, True),
        line("[BLOCKED] git push can modify a remote repository", RED, True),
        line("Evidence  git push origin main", MUTED),
    ],
    [
        line("$ agenttx inspect", GREEN, True),
        line(""),
        line("Risk", BLUE, True),
        line("HIGH (7)", RED, True),
        line("  • Dependency manifest changed (+2)", YELLOW),
        line("  • Dependency lockfile changed (+2)", YELLOW),
        line("  • External side effect detected (+3)", YELLOW),
        line(""),
        line("Detection is heuristic; this is not an OS sandbox.", MUTED),
    ],
    [
        line("$ agenttx diff", GREEN, True),
        line(""),
        line("7 files changed   +21 -5", BLUE, True),
        line("Modified  4", TEXT),
        line("Added     2", GREEN),
        line("Deleted   1", RED),
        line(""),
        line("Review the transaction before accepting it.", MUTED),
    ],
    [
        line("$ agenttx rollback", GREEN, True),
        line(""),
        line("[OK] Transaction rolled back", GREEN, True),
        line("[OK] 7 transaction changes discarded", GREEN),
        line(""),
        line("[OK] Original workspace unchanged", GREEN, True),
        line(""),
        line("Make AI agents undoable.", TEXT, True),
    ],
]

DURATIONS_MS = [1200, 2600, 2400, 2400, 2000, 3200]


def draw_frame(
    lines: list[tuple[str, str, bool]],
    stage_index: int,
    regular: ImageFont.ImageFont,
    bold: ImageFont.ImageFont,
    small: ImageFont.ImageFont,
    line_height: int = 39,
    blank_height: int = 44,
) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((1, 1, WIDTH - 2, HEIGHT - 2), radius=20, fill=PANEL, outline=BORDER, width=2)
    draw.ellipse((26, 25, 40, 39), fill=RED)
    draw.ellipse((50, 25, 64, 39), fill=YELLOW)
    draw.ellipse((74, 25, 88, 39), fill=GREEN)
    draw.text((108, 20), "agenttx demo", font=small, fill=MUTED)
    draw.text((WIDTH - 330, 20), "v0.1.0 • local • no credentials", font=small, fill=MUTED)
    draw.line((0, 58, WIDTH, 58), fill=BORDER, width=1)

    y = 92
    for value, color, is_bold in lines:
        draw.text((42, y), value, font=bold if is_bold else regular, fill=color)
        y += blank_height if not value else line_height

    labels = ("RUN", "CHANGE", "REVIEW", "INSPECT", "DIFF", "ROLLBACK")
    positions = (42, 210, 390, 575, 755, 935)
    for index, (label, x) in enumerate(zip(labels, positions, strict=True)):
        active = index == stage_index
        completed = index < stage_index
        color = GREEN if completed else BLUE if active else MUTED
        draw.text((x, 708), label, font=small, fill=color)
        if index < len(labels) - 1:
            draw.text((positions[index + 1] - 45, 708), "→", font=small, fill=MUTED)
    return image


def draw_static(
    regular: ImageFont.ImageFont,
    bold: ImageFont.ImageFont,
    small: ImageFont.ImageFont,
) -> Image.Image:
    lines = [
        line("$ agenttx demo", GREEN, True),
        line("Agent edits auth, sessions, dependencies, CI, and legacy code.", MUTED),
        line(""),
        line("AgentTX Transaction   REVIEW", BLUE, True),
        line("Changes  7 files   +21 / -5"),
        line("[BLOCKED] git push can modify a remote repository", RED, True),
        line(""),
        line("$ agenttx inspect", GREEN, True),
        line("Risk  HIGH (7)", RED, True),
        line("  • dependency manifest + lockfile changed", YELLOW),
        line("  • external side effect detected", YELLOW),
        line(""),
        line("$ agenttx diff", GREEN, True),
        line("7 files changed   4 modified · 2 added · 1 deleted"),
        line(""),
        line("$ agenttx rollback", GREEN, True),
        line("[OK] Transaction rolled back", GREEN),
        line("[OK] Original workspace unchanged", GREEN, True),
    ]
    return draw_frame(lines, 5, regular, bold, small, line_height=31, blank_height=22)


def transcript_text() -> str:
    return """$ agenttx demo
Starting demo transaction...

Agent:
  editing src/auth.ts
  creating src/session.ts
  deleting src/legacy.ts
  adding a package dependency
  changing .github/workflows/ci.yml
  attempting simulated external write: git push origin main

AgentTX Transaction
  State: REVIEW
  Changes: 7 files (+21 / -5)

Side Effects
  [BLOCKED] git push can modify a remote repository

$ agenttx inspect
  Risk: HIGH (7)
  • Dependency manifest changed
  • Dependency lockfile changed
  • External side effect detected

$ agenttx diff
  7 files changed — 4 modified · 2 added · 1 deleted

$ agenttx rollback
  ✓ Transaction rolled back
  ✓ 7 transaction changes discarded
  ✓ Original workspace unchanged
"""


def main() -> None:
    args = parse_args()
    source = ANSI.sub("", args.source.read_text(encoding="utf-8", errors="replace"))
    validate_source(source)

    for output in (args.gif, args.png, args.transcript):
        output.parent.mkdir(parents=True, exist_ok=True)

    transcript = transcript_text()
    if PRIVATE_PATHS.search(transcript):
        raise SystemExit("Generated transcript contains a private path; refusing to write assets.")
    args.transcript.write_text(transcript, encoding="utf-8", newline="\n")

    regular = load_font(22, False, args.font)
    bold = load_font(22, True, args.font)
    small = load_font(17, False, args.font)
    frames = [draw_frame(stage, index, regular, bold, small) for index, stage in enumerate(STAGES)]
    palette_frames = [frame.quantize(colors=128, dither=Image.Dither.NONE) for frame in frames]
    palette_frames[0].save(
        args.gif,
        save_all=True,
        append_images=palette_frames[1:],
        duration=DURATIONS_MS,
        loop=0,
        optimize=True,
        disposal=2,
    )
    static_regular = load_font(19, False, args.font)
    static_bold = load_font(19, True, args.font)
    draw_static(static_regular, static_bold, small).save(args.png, optimize=True)

    duration = sum(DURATIONS_MS) / 1000
    print(f"Rendered {args.gif} ({duration:.1f}s, {len(frames)} frames)")
    print(f"Rendered {args.png}")
    print(f"Wrote {args.transcript}")


if __name__ == "__main__":
    main()
