# Draws the First Return icons: a person made of lidar scan lines, standing in the scanner's floor rings.
# Design:
#  - an adult pictogram in a relaxed stance (weight on one leg), no face, so it is friendly and plain;
#  - horizontal scan rows that bend over the body's surface the way a spinning scanner's lines wrap a
#    person, which is what gives it volume (and is the signature of lidar imagery);
#  - dot size and a single teal-to-white ramp for light, from the upper left; a soft glow like the Void look;
#  - floor rings in perspective (larger dots in front), quieter than the figure.
#   python tools/make_icon.py   ->  docs/icon.svg (app icon) and docs/mark.svg (tab and top bar)
import math, pathlib, random
ROOT = pathlib.Path(__file__).resolve().parent.parent

def d_circle(x, y, cx, cy, r): return math.hypot(x-cx, y-cy) - r
def d_seg(x, y, ax, ay, bx, by, ra, rb):
    """A tapered capsule from (ax, ay) radius ra to (bx, by) radius rb."""
    dx, dy = bx-ax, by-ay; t = max(0, min(1, ((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)))
    return math.hypot(x-(ax+t*dx), y-(ay+t*dy)) - (ra+(rb-ra)*t)
def smin(a, b, k): h = max(0, min(1, 0.5+0.5*(b-a)/k)); return b*(1-h)+a*h - k*h*(1-h)
def figure(x, y):
    head  = d_circle(x, y, 50.4, 16.8, 6.2)
    chest = d_seg(x, y, 50, 30.5, 50, 41, 8.6, 7.0)                     # shoulders to waist, tapering
    hips  = d_seg(x, y, 50, 43, 50.4, 50, 6.8, 7.0)
    torso = smin(chest, hips, 3.0)
    arms  = min(d_seg(x, y, 42.4, 29.2, 38.6, 51.5, 2.6, 1.9), d_seg(x, y, 57.6, 29.2, 61.2, 50.8, 2.6, 1.9))
    # weight on the left leg (straight); the right leg eased out a little
    legs  = min(d_seg(x, y, 46.8, 52, 46.1, 83, 3.5, 2.3), d_seg(x, y, 53.8, 52, 57.0, 82.5, 3.4, 2.2))
    body  = smin(smin(torso, arms, 1.8), legs, 2.2)
    neck  = d_seg(x, y, 50.3, 22.5, 50.2, 28.5, 1.9, 2.3)
    return min(head, smin(body, neck, 1.2))
R0 = 6.5
def height(x, y):
    d = -figure(x, y)
    return math.sqrt(max(0.0, 1-(1-min(1.0, d/R0))**2)) if d > 0 else 0.0
LIGHT = (-0.5, -0.66, 0.56)
def shade(x, y):
    h = height(x, y)
    if h <= 0: return None, 0
    e = 0.6; gx = (height(x+e,y)-height(x-e,y))/(2*e)*R0; gy = (height(x,y+e)-height(x,y-e))/(2*e)*R0
    n = (-gx, -gy, 1.0); l = math.sqrt(sum(c*c for c in n)); n = tuple(c/l for c in n)
    return min(1.0, 0.07 + 0.93*max(0.0, sum(n[i]*LIGHT[i] for i in range(3)))**1.45), h
def mix(c1, c2, t): return tuple(round(c1[i]+(c2[i]-c1[i])*t) for i in range(3))
DEEP, TEAL, PALE = (20, 88, 82), (114, 232, 203), (236, 255, 250)
def colour(b): return '#%02x%02x%02x' % (mix(DEEP, TEAL, b/0.6) if b < 0.6 else mix(TEAL, PALE, (b-0.6)/0.4))

def build(S, row, step, rmax, detail, zoom=1.0):
    k = S/100.0
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}">', '<defs>',
         '<radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#0d1b1b"/><stop offset=".55" stop-color="#071010"/><stop offset="1" stop-color="#020303"/></radialGradient>',
         '<radialGradient id="pool" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#72e8cb" stop-opacity=".30"/><stop offset=".6" stop-color="#72e8cb" stop-opacity=".07"/><stop offset="1" stop-color="#72e8cb" stop-opacity="0"/></radialGradient>',
         f'<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="{S*0.012:.2f}"/></filter>',
         f'<clipPath id="tile"><rect width="{S}" height="{S}" rx="{S*0.225:.1f}"/></clipPath>',
         '</defs>', f'<rect width="{S}" height="{S}" rx="{S*0.225:.1f}" fill="url(#bg)"/>',
         # small sizes: the figure is enlarged to fill the tile (the rings crop at the edges)
         f'<g clip-path="url(#tile)"><g transform="translate({S/2:.1f},{S*0.5:.1f}) scale({zoom}) translate({-S/2:.1f},{-S*0.5:.1f})">']
    fx, fy = 51*k, 84.5*k
    o.append(f'<ellipse cx="{fx:.1f}" cy="{fy:.1f}" rx="{26*k:.1f}" ry="{6.2*k:.1f}" fill="url(#pool)"/>')
    # floor rings in perspective: dots larger and brighter in front, fainter behind the figure
    rings = [(19, 4.4), (29, 6.9), (39, 9.4)] if detail else [(21, 5.0), (33, 7.8)]
    for ri, (rx, ry) in enumerate(rings):
        n = int(rx*(3.0 if detail else 1.25))
        for i in range(n):
            a = 2*math.pi*(i+0.5)/n; x, y = fx+rx*k*math.cos(a), fy+ry*k*math.sin(a)
            front = 0.5+0.5*math.sin(a)                                  # 1 nearest the viewer
            if front < 0.5 and abs(x-fx) < 10*k: continue               # hidden by the legs
            r = rmax*(0.26+0.22*front)*(1-0.12*ri); op = (0.2+0.55*front)*(1-0.22*ri)
            o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.2f}" fill="#72e8cb" opacity="{op:.2f}"/>')
    if detail:
        rnd = random.Random(11)
        for _ in range(22):
            a = rnd.uniform(0, 2*math.pi); rr = rnd.uniform(0.35, 1.05)
            x, y = fx+46*k*rr*math.cos(a), fy+11*k*rr*math.sin(a)
            if abs(x-fx) < 12*k and y < fy+3*k: continue
            o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rmax*0.2:.2f}" fill="#9fb2b8" opacity="{rnd.uniform(0.2,0.5):.2f}"/>')
    # the figure: scan rows that bend over the surface (seen from a little above, a row sits lower where
    # the body comes toward you), dots sized and coloured by the light
    dots = []; yrow = 9*k
    while yrow < 85*k:
        x = 30*k
        while x < 72*k:
            yy = yrow/k
            b, h = shade(x/k, yy)
            if b is not None:
                y = yrow + h*1.15*k                                       # the row wraps over the form
                dots.append((x, y, rmax*(0.34 + 0.66*b), b))
            x += step
        yrow += row
    # a dot with no neighbour (a row just grazing the top of the head) reads as a stray, so it goes
    dots = [d for d in dots if sum(1 for e in dots if e is not d and abs(e[0]-d[0]) < step*1.6 and abs(e[1]-d[1]) < row*1.6) >= 2]
    if detail:                                                           # a soft glow under the dots, like the Void look
        o.append('<g filter="url(#glow)" opacity=".55">' + ''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r*1.25:.2f}" fill="{colour(b)}"/>' for x, y, r, b in dots) + '</g>')
    o.append(''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.2f}" fill="{colour(b)}"/>' for x, y, r, b in dots))
    if detail:                                                           # the first return: where the light lands brightest
        x, y, r, b = max(dots, key=lambda d: d[3])
        o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r*3:.1f}" fill="#eafff9" opacity=".14"/><circle cx="{x:.1f}" cy="{y:.1f}" r="{r*1.1:.1f}" fill="#fff"/>')
    o.append('</g></g></svg>')
    return '\n'.join(o)

(ROOT/'docs'/'icon.svg').write_text(build(512, row=8.6, step=4.3, rmax=2.35, detail=True), encoding='utf-8')
(ROOT/'docs'/'mark.svg').write_text(build(64, row=3.0, step=2.2, rmax=1.2, detail=False, zoom=1.3), encoding='utf-8')
print('icon.svg and mark.svg written')
