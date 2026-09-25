# Draws the First Return icons: a standing figure made of scan dots, on a speckled floor ring.
# Design rules: a friendly pictogram silhouette (round head with a clear gap above the shoulders, no face),
# one even hexagonal dot grid, dot size doing the shading (light from the upper left, so the figure reads
# as rounded rather than flat), a single colour ramp from deep teal to near white, and a floor that is
# quieter than the figure. The small mark keeps the same shape with fewer, bigger dots.
#   python tools/make_icon.py   ->  docs/icon.svg (app icon) and docs/mark.svg (tab and top bar)
import math, pathlib, random
ROOT = pathlib.Path(__file__).resolve().parent.parent

# the figure, as distances (negative inside) on a 100 x 100 box, y down
def d_circle(x, y, cx, cy, r): return math.hypot(x-cx, y-cy) - r
def d_capsule(x, y, ax, ay, bx, by, r):
    dx, dy = bx-ax, by-ay; t = max(0, min(1, ((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)))
    return math.hypot(x-(ax+t*dx), y-(ay+t*dy)) - r
def d_rrect(x, y, cx, cy, hw, hh, r):
    qx, qy = abs(x-cx)-hw+r, abs(y-cy)-hh+r
    return math.hypot(max(qx,0), max(qy,0)) + min(max(qx,qy),0) - r
def smin(a, b, k):                                          # a soft union, so parts flow into one another
    h = max(0, min(1, 0.5+0.5*(b-a)/k)); return b*(1-h)+a*h - k*h*(1-h)
def figure(x, y):
    head = d_circle(x, y, 50, 20.5, 8.2)
    torso = d_rrect(x, y, 50, 44.5, 10.5, 13.5, 7.5)
    # arms hang a little away from the body and taper toward the hands; legs taper toward the feet
    arms = min(d_capsule(x, y, 40, 35.5, 35, 57, 3.1) + 0.03*(y-36), d_capsule(x, y, 60, 35.5, 65, 57, 3.1) + 0.03*(y-36))
    legs = min(d_capsule(x, y, 45.5, 55, 44, 81, 4.3) + 0.045*(y-55), d_capsule(x, y, 54.5, 55, 56, 81, 4.3) + 0.045*(y-55))
    body = smin(smin(torso, arms, 2.5), legs, 2.5)
    return min(head, body)
LIGHT = (-0.55, -0.62, 0.56)
def height(x, y): return math.sqrt(max(0, 1-(1-min(1.0, max(0, -figure(x, y))/7.5))**2))
def shade(x, y):
    if figure(x, y) > 0: return None
    e = 0.7; gx = (height(x+e,y)-height(x-e,y))/(2*e)*6.5; gy = (height(x,y+e)-height(x,y-e))/(2*e)*6.5
    n = (-gx, -gy, 1.0); l = math.sqrt(sum(c*c for c in n)); n = tuple(c/l for c in n)
    return min(1.0, 0.16 + 0.84*max(0.0, sum(n[i]*LIGHT[i] for i in range(3)))**1.1)
def mix(c1, c2, t): return tuple(round(c1[i]+(c2[i]-c1[i])*t) for i in range(3))
DEEP, TEAL, PALE = (22, 92, 84), (114, 232, 203), (232, 255, 249)
def colour(b): return '#%02x%02x%02x' % (mix(DEEP, TEAL, b/0.62) if b < 0.62 else mix(TEAL, PALE, (b-0.62)/0.38))

def build(S, pitch, rmax, detail):
    k = S/100.0
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}">',
           '<defs><radialGradient id="bg" cx="50%" cy="40%" r="72%"><stop offset="0" stop-color="#0c1818"/><stop offset="1" stop-color="#030405"/></radialGradient>'
           '<radialGradient id="pool" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#72e8cb" stop-opacity=".22"/><stop offset="1" stop-color="#72e8cb" stop-opacity="0"/></radialGradient></defs>',
           f'<rect width="{S}" height="{S}" rx="{S*0.22:.1f}" fill="url(#bg)"/>']
    fx, fy = 50*k, 84*k                                     # where the feet meet the floor
    # a soft pool of light on the floor, then the scan ring, then a few loose returns
    out.append(f'<ellipse cx="{fx:.1f}" cy="{fy:.1f}" rx="{30*k:.1f}" ry="{7.5*k:.1f}" fill="url(#pool)"/>')
    rings = [(24, 5.6, 0.55), (36, 8.6, 0.28)] if detail else [(25, 6, 0.6)]
    for rx, ry, op in rings:
        n = int(rx*(2.4 if detail else 1.1))
        for i in range(n):
            a = 2*math.pi*(i+0.5)/n; x, y = fx+rx*k*math.cos(a), fy+ry*k*math.sin(a)
            if y < fy and abs(x-fx) < 13*k: continue        # behind the legs
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rmax*(0.36 if detail else 0.5):.2f}" fill="#72e8cb" opacity="{op}"/>')
    if detail:
        rnd = random.Random(7)
        for _ in range(26):
            a = rnd.uniform(0, 2*math.pi); rr = rnd.uniform(0.2, 1.0)**0.5
            x, y = fx+44*k*rr*math.cos(a), fy+10*k*rr*math.sin(a)
            if abs(x-fx) < 14*k and y < fy+2*k: continue
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rmax*0.26:.2f}" fill="#8fa0a8" opacity="{rnd.uniform(0.25,0.6):.2f}"/>')
    # the figure, on a hexagonal grid
    rowh = pitch*math.sqrt(3)/2; row = 0; y = 8*k; brightest = None
    while y < 86*k:
        x = (pitch/2 if row % 2 else 0) + 20*k
        while x < 80*k:
            b = shade(x/k, y/k)
            if b is not None:
                r = rmax*(0.42 + 0.58*b)
                out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.2f}" fill="{colour(b)}"/>')
                if brightest is None or b > brightest[0]: brightest = (b, x, y, r)
            x += pitch
        y += rowh; row += 1
    if brightest and detail:                                # the first return: where the light lands brightest
        _, x, y, r = brightest
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r*2.6:.1f}" fill="#eafff9" opacity=".16"/><circle cx="{x:.1f}" cy="{y:.1f}" r="{r*1.15:.1f}" fill="#fff"/>')
    out.append('</svg>')
    return '\n'.join(out)

(ROOT/'docs'/'icon.svg').write_text(build(512, pitch=10.2, rmax=3.7, detail=True), encoding='utf-8')
(ROOT/'docs'/'mark.svg').write_text(build(64, pitch=3.3, rmax=1.55, detail=False), encoding='utf-8')
print('icon.svg and mark.svg written')
