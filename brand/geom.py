"""Parametric geometry for the Squirrel mark.

Hand-guessed bezier control points read lumpy. These build shapes from real
curves — log spirals, tapered strokes, circle blends — so the curvature is
continuous and the result looks designed rather than drawn.
"""
import math

# ----------------------------------------------------------------- utilities
def catmull_rom(points, closed=True, tension=1.0):
    """Smooth a polyline into a cubic bezier path 'd' string."""
    p = list(points)
    n = len(p)
    if n < 3:
        return ""
    def get(i):
        if closed:
            return p[i % n]
        return p[max(0, min(n - 1, i))]
    d = [f"M{p[0][0]:.2f},{p[0][1]:.2f}"]
    last = n if closed else n - 1
    for i in range(last):
        p0, p1, p2, p3 = get(i - 1), get(i), get(i + 1), get(i + 2)
        c1 = (p1[0] + (p2[0] - p0[0]) / (6 * tension),
              p1[1] + (p2[1] - p0[1]) / (6 * tension))
        c2 = (p2[0] - (p3[0] - p1[0]) / (6 * tension),
              p2[1] - (p3[1] - p1[1]) / (6 * tension))
        d.append(f"C{c1[0]:.2f},{c1[1]:.2f} {c2[0]:.2f},{c2[1]:.2f} {p2[0]:.2f},{p2[1]:.2f}")
    if closed:
        d.append("Z")
    return " ".join(d)


def tapered_stroke(centerline, widths, cap_steps=14):
    """Thick curve with round caps -> closed smooth path.

    centerline: [(x,y)...]   widths: half-width at each point
    """
    n = len(centerline)
    normals = []
    for i in range(n):
        if i == 0:
            dx = centerline[1][0] - centerline[0][0]
            dy = centerline[1][1] - centerline[0][1]
        elif i == n - 1:
            dx = centerline[-1][0] - centerline[-2][0]
            dy = centerline[-1][1] - centerline[-2][1]
        else:
            dx = centerline[i + 1][0] - centerline[i - 1][0]
            dy = centerline[i + 1][1] - centerline[i - 1][1]
        L = math.hypot(dx, dy) or 1.0
        normals.append((-dy / L, dx / L))

    left = [(centerline[i][0] + normals[i][0] * widths[i],
             centerline[i][1] + normals[i][1] * widths[i]) for i in range(n)]
    right = [(centerline[i][0] - normals[i][0] * widths[i],
              centerline[i][1] - normals[i][1] * widths[i]) for i in range(n)]

    def cap(center, radius, from_pt, to_pt, steps):
        a0 = math.atan2(from_pt[1] - center[1], from_pt[0] - center[0])
        a1 = math.atan2(to_pt[1] - center[1], to_pt[0] - center[0])
        while a1 - a0 > math.pi:
            a1 -= 2 * math.pi
        while a0 - a1 > math.pi:
            a1 += 2 * math.pi
        return [(center[0] + radius * math.cos(a0 + (a1 - a0) * k / steps),
                 center[1] + radius * math.sin(a0 + (a1 - a0) * k / steps))
                for k in range(1, steps)]

    poly = list(left)
    poly += cap(centerline[-1], widths[-1], left[-1], right[-1], cap_steps)
    poly += list(reversed(right))
    poly += cap(centerline[0], widths[0], right[0], left[0], cap_steps)
    return catmull_rom(poly, closed=True)


def log_spiral(cx, cy, a, b, t0, t1, steps=90, rot=0.0):
    """Points along r = a*e^(b*theta) — the natural curve of a squirrel tail."""
    pts = []
    for i in range(steps + 1):
        th = t0 + (t1 - t0) * i / steps
        r = a * math.exp(b * th)
        pts.append((cx + r * math.cos(th + rot), cy + r * math.sin(th + rot)))
    return pts


def width_profile(steps, base, peak, tip, peak_at=0.42):
    """Half-widths: narrow where the tail meets the body, full through the
    plume, tapering to a rounded tip."""
    out = []
    for i in range(steps + 1):
        t = i / steps
        if t <= peak_at:
            u = t / peak_at
            w = base + (peak - base) * (u * u * (3 - 2 * u))
        else:
            u = (t - peak_at) / (1 - peak_at)
            w = peak + (tip - peak) * (u * u * (3 - 2 * u))
        out.append(w)
    return out


def circle(cx, cy, r):
    return f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}"/>'


def blob(points, tension=1.0):
    return f'<path d="{catmull_rom(points, closed=True, tension=tension)}"/>'


def path(d):
    return f'<path d="{d}"/>'
