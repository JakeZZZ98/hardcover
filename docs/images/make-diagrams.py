"""Generate the article's diagrams (plain SVG, no dependencies). Run: python3 docs/images/make-diagrams.py"""
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PAPER = "#F6F1E6"
INK = "#2B2620"
SOFT = "#8A7F70"
FAINT = "#D9CFBD"
ACCENT = "#8A2F3A"
BLUE = "#3E6A8A"
SERIF = "Georgia, 'Times New Roman', serif"
MONO = "ui-monospace, Menlo, Consolas, monospace"


def svg(name, w, h, body):
    head = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
        f'font-family="{SERIF}" font-size="14" fill="{INK}">\n'
        f'<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0,0 L10,5 L0,10 z" fill="{INK}"/></marker>'
        f'<marker id="arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0,0 L10,5 L0,10 z" fill="{ACCENT}"/></marker></defs>\n'
        f'<rect width="{w}" height="{h}" rx="14" fill="{PAPER}"/>\n'
    )
    with open(os.path.join(HERE, name), "w") as f:
        f.write(head + "\n".join(body) + "\n</svg>\n")


def text(x, y, s, size=14, fill=INK, anchor="start", family=None, style="", weight=""):
    fam = f' font-family="{family}"' if family else ""
    st = f' font-style="{style}"' if style else ""
    wt = f' font-weight="{weight}"' if weight else ""
    return f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}"{fam}{st}{wt}>{s}</text>'


def line(x1, y1, x2, y2, stroke=INK, width=2, dash="", marker="", cap="round"):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    m = f' marker-end="url(#{marker})"' if marker else ""
    return f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{stroke}" stroke-width="{width}" stroke-linecap="{cap}"{d}{m}/>'


def path(d, stroke=INK, width=2, fill="none", dash="", marker=""):
    ds = f' stroke-dasharray="{dash}"' if dash else ""
    m = f' marker-end="url(#{marker})"' if marker else ""
    return f'<path d="{d}" stroke="{stroke}" stroke-width="{width}" fill="{fill}" stroke-linecap="round" stroke-linejoin="round"{ds}{m}/>'


def dot(x, y, r=4, fill=INK):
    return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{fill}"/>'


def arc_path(cx, cy, r, a0, a1):
    """Arc in math angles (radians, counter-clockwise, z up) around (cx, cy) in SVG space."""
    x0, y0 = cx + r * math.cos(a0), cy - r * math.sin(a0)
    x1, y1 = cx + r * math.cos(a1), cy - r * math.sin(a1)
    large = 1 if abs(a1 - a0) > math.pi else 0
    sweep = 0 if a1 > a0 else 1
    return f"M{x0:.1f},{y0:.1f} A{r},{r} 0 {large} {sweep} {x1:.1f},{y1:.1f}"


def sheet_arc(cx, cy, L, theta, c, n=40):
    pts = []
    for i in range(n + 1):
        u = i / n
        if abs(c) < 1e-4:
            x, z = L * u * math.cos(theta), L * u * math.sin(theta)
        else:
            x = L * (math.sin(theta + c * u) - math.sin(theta)) / c
            z = L * (math.cos(theta) - math.cos(theta + c * u)) / c
        pts.append((cx + x, cy - z))
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts), pts


# 1 ---------------------------------------------------------------------------------------------
def hinge_angle():
    w, h = 720, 320
    cx, cy, L = 360, 250, 240
    b = []
    b.append(f'<rect x="{cx - L - 20}" y="{cy + 4}" width="{2 * L + 40}" height="16" rx="3" fill="{FAINT}"/>')
    b.append(text(cx, cy + 44, "the block, seen from its tail", 12, SOFT, "middle", style="italic"))
    b.append(line(cx, cy, cx + L, cy, INK, 3))
    b.append(line(cx, cy, cx - L, cy, INK, 3))
    t = math.radians(48)
    b.append(line(cx, cy, cx + L * 0.78 * math.cos(t), cy - L * 0.78 * math.sin(t), ACCENT, 3))
    b.append(path(arc_path(cx, cy, 70, 0, t), ACCENT, 1.5))
    b.append(text(cx + 82, cy - 34, "θ", 18, ACCENT, family=SERIF, style="italic"))
    b.append(dot(cx, cy, 6))
    b.append(text(cx, cy + 28, "spine", 12, SOFT, "middle"))
    b.append(text(cx + L - 4, cy - 12, "θ = 0  (lying right)", 14, INK, "end", family=MONO))
    b.append(text(cx - L + 4, cy - 12, "θ = π  (lying left)", 14, INK, "start", family=MONO))
    b.append(text(cx + L * 0.78 * math.cos(t) + 12, cy - L * 0.78 * math.sin(t) + 6, "a turning leaf", 14, ACCENT))
    b.append(text(24, 36, "Every sheet is one angle about the spine", 17, INK, weight="bold"))
    b.append(text(24, 58, "leaves, the flyleaf and the cover alike: θ, its velocity ω, and a mode", 13, SOFT))
    svg("hinge-angle.svg", w, h, b)


# 2 ---------------------------------------------------------------------------------------------
def drag_mapping():
    w, h = 720, 370
    cx, cy, L = 120, 290, 210
    b = []
    b.append(f'<rect x="{cx - 20}" y="{cy + 4}" width="{L + 40}" height="14" rx="3" fill="{FAINT}"/>')
    t0 = math.radians(35)
    x0 = cx + L * math.cos(t0)
    b.append(line(cx, cy, x0, cy - L * math.sin(t0), SOFT, 3))
    b.append(line(x0, cy - L * math.sin(t0), x0, cy + 30, SOFT, 1.5, "5 5"))
    b.append(dot(x0, cy - L * math.sin(t0), 5, SOFT))
    t1 = math.radians(66)
    x1 = cx + L * math.cos(t1)
    b.append(line(cx, cy, x1, cy - L * math.sin(t1), ACCENT, 3))
    b.append(line(x1, cy - L * math.sin(t1), x1, cy + 30, ACCENT, 1.5, "5 5"))
    b.append(dot(x1, cy - L * math.sin(t1), 5, ACCENT))
    b.append(dot(cx, cy, 6))
    b.append(line(x0, cy + 42, x1 + 6, cy + 42, INK, 1.5, marker="arrow"))
    b.append(text((x0 + x1) / 2, cy + 62, "pointer moves Δx", 13, INK, "middle"))
    b.append(text(x0 + 8, cy - L * math.sin(t0) - 8, "at grab: x₀ = W cos θ", 13, SOFT, family=MONO))
    b.append(text(x1 + 12, cy - L * math.sin(t1) + 4, "θ_target", 13, ACCENT, family=MONO))
    rx = 470
    b.append(text(rx, 200, "The tip's shadow stays", 14, INK))
    b.append(text(rx, 218, "under the finger:", 14, INK))
    b.append(text(rx, 250, "acos((x₀ + Δx) / W)", 14, ACCENT, family=MONO))
    b.append(text(rx, 284, "θ chases it on a critically", 13, SOFT))
    b.append(text(rx, 302, "damped spring (40 ms response).", 13, SOFT))
    b.append(text(24, 36, "Following the hand", 17, INK, weight="bold"))
    b.append(text(24, 58, "side view; W = page width", 13, SOFT))
    svg("drag-mapping.svg", w, h, b)


# 3 ---------------------------------------------------------------------------------------------
def bend_arc():
    w, h = 720, 370
    b = []
    cx, cy, L = 80, 300, 210
    t, c = math.radians(58), -0.9
    b.append(f'<rect x="{cx - 20}" y="{cy + 4}" width="{L + 50}" height="14" rx="3" fill="{FAINT}"/>')
    b.append(line(cx, cy, cx + L * math.cos(t), cy - L * math.sin(t), SOFT, 1.5, "6 6"))
    d, pts = sheet_arc(cx, cy, L, t, c)
    b.append(path(d, ACCENT, 3))
    b.append(dot(cx, cy, 6))
    tx, ty = pts[-1]
    b.append(path(arc_path(cx, cy, 46, 0, t), INK, 1.2))
    b.append(text(cx + 54, cy - 18, "φ(0) = θ", 13, INK, family=MONO))
    b.append(text(tx + 12, ty + 4, "φ(1) = θ + c", 13, ACCENT, family=MONO))
    b.append(text(cx + L * math.cos(t) - 8, cy - L * math.sin(t) + 4, "rigid", 12, SOFT, "end", style="italic"))
    b.append(text(24, 36, "One row of paper is a circular arc", 17, INK, weight="bold"))
    b.append(text(24, 58, "c = curl·sin 2θ − lag·ω̄, clamped so the tip stays between its neighbours", 13, SOFT))
    # top view: rows bend more away from the grabbed row
    ox, oy, pw, ph = 450, 100, 220, 200
    b.append(f'<rect x="{ox}" y="{oy}" width="{pw}" height="{ph}" rx="4" fill="#FFFDF7" stroke="{INK}" stroke-width="1.5"/>')
    b.append(line(ox, oy - 8, ox, oy + ph + 8, INK, 3))
    b.append(text(ox - 10, oy + 8, "spine", 12, SOFT, "end"))
    grab = 0.25
    for i in range(9):
        yy = i / 8
        y = oy + yy * ph
        k = 1 + 0.7 * abs(yy - grab)
        b.append(line(ox + pw - 8, y, ox + pw - 8 - 38 * k, y, ACCENT, 1.6, marker="arrow-accent"))
    gy = oy + grab * ph
    b.append(dot(ox + pw - 70, gy, 7, INK))
    b.append(text(ox + pw - 84, gy + 5, "grab", 12, INK, "end"))
    b.append(text(ox + pw / 2, oy + ph + 30, "top view: c × (1 + spread·|y − grabY|)", 12, SOFT, "middle", family=MONO))
    b.append(text(ox + pw / 2, oy + ph + 48, "the corner you hold leads", 12, SOFT, "middle", style="italic"))
    svg("bend-arc.svg", w, h, b)


# 4 ---------------------------------------------------------------------------------------------
def angle_chain():
    w, h = 720, 370
    cx, cy, L = 360, 300, 215
    b = []
    b.append(f'<rect x="{cx - L - 20}" y="{cy + 4}" width="{2 * L + 40}" height="14" rx="3" fill="{FAINT}"/>')
    sheets = [
        (168, "cover", INK, 4),
        (160, "flyleaf", SOFT, 2),
        (126, "leaf 0", SOFT, 2),
        (70, "leaf 1 (dragged)", ACCENT, 3),
        (0, "leaf 2 … (resting)", SOFT, 2),
    ]
    for deg, label, col, wd in sheets:
        t = math.radians(deg)
        ex, ey = cx + L * math.cos(t), cy - L * math.sin(t)
        b.append(line(cx, cy, ex, ey, col, wd))
        anchor = "end" if math.cos(t) < -0.2 else "start"
        dx = -8 if anchor == "end" else 8
        b.append(text(ex + dx, ey - 6, label, 13, col, anchor))
    # a violation being fixed: leaf 2 pushed ahead of the dragged leaf
    t = math.radians(78)
    b.append(line(cx, cy, cx + (L - 30) * math.cos(t), cy - (L - 30) * math.sin(t), BLUE, 2, "6 5"))
    b.append(path(arc_path(cx, cy, L - 60, math.radians(79), math.radians(71)), BLUE, 1.8, marker="arrow"))
    b.append(text(cx + 92, cy - L + 60, "leaf 2 overtook → pushed back", 12, BLUE))
    b.append(dot(cx, cy, 6))
    b.append(text(24, 36, "Nothing collides in 3D: an ordering instead", 17, INK, weight="bold"))
    b.append(text(24, 58, "θ_cover ≥ θ_flyleaf ≥ θ_0 ≥ θ_1 ≥ … ≥ 0, enforced after every step", 13, SOFT, family=MONO))
    b.append(text(w - 24, h - 16, "dragged = rigid, pushes · free pairs merge by mass (cover = 8) · blocked settles retarget", 12, SOFT, "end"))
    svg("angle-chain.svg", w, h, b)


# 5 ---------------------------------------------------------------------------------------------
def cover_plane():
    w, h = 720, 400
    b = []
    s = 400  # px per page width
    sx, sy = 250, 336  # spine at table level
    Z = lambda z: sy - z * s
    X = lambda x: sx + x * s
    boardT, leafT, n = 0.03, 0.006, 8
    top = boardT + n * leafT
    b.append(f'<rect x="{X(-0.01):.1f}" y="{Z(boardT):.1f}" width="{0.95 * s:.1f}" height="{boardT * s:.1f}" fill="{FAINT}"/>')
    for k in range(n):
        z = boardT + (k + 1) * leafT
        b.append(line(X(0.0), Z(z - 0.003), X(0.9 - 0.012 * k), Z(z), SOFT, 1.5))
    b.append(text(X(0.6), Z(0) + 22, "the block (right-hand pages)", 12, SOFT, "middle", style="italic"))
    # hinge path: open (table, left of spine) → shut (on top of the block), bulging outward
    ho = (-0.11, boardT)
    hc = (-0.012, top + 0.006)
    pts = []
    for i in range(41):
        m = i / 40
        bb = 0.12 * math.sin(math.pi * m)
        pts.append((hc[0] + (ho[0] - hc[0]) * m - 0.7 * bb, hc[1] + (ho[1] - hc[1]) * m + 0.7 * bb))
    b.append(path("M" + " L".join(f"{X(x):.1f},{Z(z):.1f}" for x, z in pts), BLUE, 2, dash="5 4"))
    b.append(dot(X(ho[0]), Z(ho[1]), 5, BLUE))
    b.append(text(X(ho[0]) - 10, Z(ho[1]) + 4, "hinge, open", 12, BLUE, "end"))
    b.append(dot(X(hc[0]), Z(hc[1]), 5, BLUE))
    b.append(line(X(hc[0]) + 3, Z(hc[1]) + 5, X(hc[0]) + 30, sy + 26, BLUE, 1))
    b.append(text(X(hc[0]) + 34, sy + 38, "hinge, shut", 12, BLUE))
    # the cover half-way, and a leaf riding under it
    m = 0.5
    bb = 0.12 * math.sin(math.pi * m)
    hm = (hc[0] + (ho[0] - hc[0]) * m - 0.7 * bb, hc[1] + (ho[1] - hc[1]) * m + 0.7 * bb)
    tc = math.radians(62)
    cw = 0.56
    b.append(line(X(hm[0]), Z(hm[1]), X(hm[0] + cw * math.cos(tc)), Z(hm[1] + cw * math.sin(tc)), INK, 6))
    b.append(text(X(hm[0] + cw * math.cos(tc)) + 10, Z(hm[1] + cw * math.sin(tc)) + 4, "cover (θc)", 13, INK))
    tl = math.radians(56)
    lz = top
    L = 0.6
    b.append(line(X(0), Z(lz), X(L * math.cos(tl)), Z(lz + L * math.sin(tl)), ACCENT, 2.5))
    for u, lab in ((0.25, "¼"), (0.5, "½"), (1.0, "1")):
        px, pz = L * u * math.cos(tl), lz + L * u * math.sin(tl)
        b.append(dot(X(px), Z(pz), 4.5, ACCENT))
        b.append(text(X(px) + 10, Z(pz) + 14, f"u = {lab}", 12, ACCENT))
    b.append(text(24, 36, "The cover hinges on a moving point", 17, INK, weight="bold"))
    b.append(text(24, 58, "so a leaf is limited by the cover's plane, not its angle (hinge path exaggerated)", 13, SOFT))
    rx = 470
    b.append(text(rx, 110, "clearance(u) = signed distance", 13, INK, family=MONO))
    b.append(text(rx, 128, "to the cover's inner plane", 13, INK, family=MONO))
    b.append(text(rx, 158, "coverLimit: bisect for the", 13, SOFT))
    b.append(text(rx, 176, "largest leaf angle with", 13, SOFT))
    b.append(text(rx, 194, "clearance ≥ 0 at u = ¼, ½, 1", 13, SOFT))
    b.append(text(rx, 230, "The hinge path bulges round the", 13, BLUE))
    b.append(text(rx, 248, "back of the block, like spine cloth.", 13, BLUE))
    svg("cover-plane.svg", w, h, b)


# 6 ---------------------------------------------------------------------------------------------
def fore_edge():
    w, h = 720, 330
    b = []
    sx, sy = 70, 250
    n, gap, L = 12, 11, 520
    for k in range(n):
        z = sy - k * gap
        reach = L * (1 - 0.0065 * 6 * k / 6 * 1.8)
        end = sx + reach
        flat_start = sx + 90
        d = f"M{sx:.1f},{sy + 4:.1f} C{sx + 40:.1f},{sy + 4:.1f} {sx + 50:.1f},{z:.1f} {flat_start:.1f},{z:.1f} L{end:.1f},{z:.1f}"
        b.append(path(d, ACCENT if k == n - 1 else INK, 2 if k == n - 1 else 1.4))
        b.append(dot(end, z, 2.5, ACCENT if k == n - 1 else INK))
    b.append(dot(sx, sy + 4, 6))
    b.append(text(sx - 8, sy + 30, "binding", 12, SOFT, "end"))
    ex = sx + L
    b.append(line(ex + 30, sy, ex + 30, sy - (n - 1) * gap, SOFT, 1.2, "4 4"))
    b.append(text(ex + 40, sy - (n - 1) * gap / 2 + 4, "the steps show", 12, SOFT))
    b.append(text(ex + 40, sy - (n - 1) * gap / 2 + 20, "from above", 12, SOFT))
    b.append(text(sx + 120, sy - (n - 1) * gap - 16, "reach = 1 − 0.006 × (sheets below) + jitter", 13, ACCENT, family=MONO))
    b.append(text(24, 36, "Making it look thick: the fore-edge steps back", 17, INK, weight="bold"))
    b.append(text(24, 58, "a higher sheet wraps round more of the stack, so it ends a little sooner (side view, exaggerated)", 13, SOFT))
    b.append(text(sx + 30, sy + 30, "gutter", 12, SOFT, "start", style="italic"))
    svg("fore-edge.svg", w, h, b)


# 7 ---------------------------------------------------------------------------------------------
def rest_and_move():
    w, h = 720, 300
    b = []
    boxes = [
        (24, "at rest", ["paper: blank", "HTML: on the page,", "interactive"]),
        (262, "moving", ["paper: printed", "from the HTML", "HTML: opacity 0, inert"]),
        (500, "landed", ["swap to blank paper,", "show the HTML,", "draw ONE more frame"]),
    ]
    for x, title, lines in boxes:
        b.append(f'<rect x="{x}" y="96" width="196" height="120" rx="10" fill="#FFFDF7" stroke="{INK}" stroke-width="1.5"/>')
        b.append(text(x + 16, 124, title, 15, ACCENT, weight="bold"))
        for i, l in enumerate(lines):
            b.append(text(x + 16, 150 + i * 20, l, 13, INK))
    b.append(line(222, 156, 258, 156, INK, 1.8, marker="arrow"))
    b.append(text(240, 244, "pointer down", 12, SOFT, "middle"))
    b.append(text(240, 262, "or a key", 12, SOFT, "middle"))
    b.append(line(460, 156, 496, 156, INK, 1.8, marker="arrow"))
    b.append(text(478, 244, "engine idle,", 12, SOFT, "middle"))
    b.append(text(478, 262, "camera still", 12, SOFT, "middle"))
    b.append(path("M598,96 C598,70 122,70 122,92", SOFT, 1.5, dash="5 4", marker="arrow"))
    b.append(text(360, 66, "then the loop sleeps", 12, SOFT, "middle", style="italic"))
    b.append(text(24, 36, "Real HTML on the paper", 17, INK, weight="bold"))
    b.append(text(w - 24, h - 14, "blank paper under the HTML avoids printing every letter twice", 12, SOFT, "end"))
    svg("rest-and-move.svg", w, h, b)


for fn in (hinge_angle, drag_mapping, bend_arc, angle_chain, cover_plane, fore_edge, rest_and_move):
    fn()
print("ok")
