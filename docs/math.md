# The maths behind hardcover

This is the companion to [How hardcover works](how-it-works.md). That article explains the ideas; this one derives every formula the code uses, says why each one has the form it has, and points at the line that implements it. Nothing here is advanced — trigonometry, one integral, a little linear algebra — but getting each piece exactly right is what makes the book feel solid.

## Contents

0. [Conventions](#0-conventions)
1. [Framing the camera](#1-framing-the-camera)
2. [From the pointer to the page](#2-from-the-pointer-to-the-page)
3. [Following the finger](#3-following-the-finger)
4. [Springs, and keeping them stable](#4-springs-and-keeping-them-stable)
5. [Letting go](#5-letting-go)
6. [A low-pass that ignores the frame rate](#6-a-low-pass-that-ignores-the-frame-rate)
7. [Bending a page](#7-bending-a-page)
8. [Smooth joins: smoothstep and the gutter](#8-smooth-joins-smoothstep-and-the-gutter)
9. [Heights in the stack](#9-heights-in-the-stack)
10. [The ordering, and what happens on contact](#10-the-ordering-and-what-happens-on-contact)
11. [The cover's moving hinge and its plane](#11-the-covers-moving-hinge-and-its-plane)
12. [The pages that follow a closing cover](#12-the-pages-that-follow-a-closing-cover)
13. [The fore-edge and the soft shadows](#13-the-fore-edge-and-the-soft-shadows)
14. [Putting HTML on the paper](#14-putting-html-on-the-paper)

---

## 0. Conventions

- **Units.** A page is 1 wide (`W = 1`) and `H` tall (1.48 in the demo). Every length is in page widths.
- **Axes.** In the book's own frame, x runs across the spread (−1 at the left fore-edge, +1 at the right), y along the spine, z up out of the table. The spine is the line x = 0.
- **Angles.** A sheet's hinge angle θ is measured about the spine from the +x axis toward +z: θ = 0 lying right, θ = π/2 standing up, θ = π lying left. In a side view (looking along −y) the sheet's direction is (cos θ, sin θ) in the (x, z) plane.
- **u** is the fraction of the way across a page, 0 at the spine, 1 at the fore-edge.
- Code references are to `src/engine/engine.ts` (the engine), `src/engine/spring.ts`, and `src/render/book.ts` (the renderer).

## 1. Framing the camera

A perspective camera with vertical field of view `fov` at distance d sees a slab of height 2·d·tan(fov/2) and width aspect times that. To make an object of size u_w × u_h fill a fraction f_w × f_h of the viewport, we need both

```math
d \ge \frac{u_h}{2\,f_h\tan(\mathrm{fov}/2)}, \qquad d \ge \frac{u_w}{2\,f_w\tan(\mathrm{fov}/2)\,\mathrm{aspect}}
```

so `fit()` takes the larger. The renderer computes three distances — shut book, open book, zoomed spread — and blends between them with the view's `cover` and `zoom` values (`frame` in `book.ts`). The narrow 24° field of view keeps perspective mild, which matters later: a flatter projection is kinder to HTML placed on the page (§14).

## 2. From the pointer to the page

The sheets are bent in the vertex shader, so the CPU does not know where their triangles are and cannot raycast them. It does not need to: the engine only wants the pointer's position on the book, in page units.

The pointer at canvas pixel (p_x, p_y) becomes normalised device coordinates

```math
n_x = \frac{2p_x}{w} - 1, \qquad n_y = 1 - \frac{2p_y}{h}
```

and three.js turns that into a world-space ray **o** + t**d**. Multiplying the ray by the inverse of the book group's world matrix puts it in the book's frame, where the top of the paper block is simply the plane z = z_top. The intersection is

```math
t = \frac{z_{top} - o_z}{d_z}, \qquad (x, y) = (o_x + t\,d_x,\; o_y + t\,d_y)
```

This is exact for a flat page and a good approximation for a lifted one, because the engine only uses x through the projection described next.

## 3. Following the finger

Seen from above, the fore-edge of a sheet at angle θ lies at

```math
x_{tip} = W\cos\theta
```

When a sheet is grabbed the engine records that projection, x₀ = W cos θ₀, and the pointer's x, p₀. When the pointer is at p, the sheet should be at the angle whose tip projects to x₀ + (p − p₀):

```math
\theta_{target} = \arccos\!\left(\operatorname{clamp}\!\left(\frac{x_0 + p - p_0}{W},\,-1,\,1\right)\right)
```

Three properties make this the right mapping:

- **It is relative.** Using x₀ + (p − p₀) instead of p means the sheet does not jump when you grab it somewhere other than its tip; the point you pressed keeps its offset.
- **It is unique.** arccos maps [−1, 1] one-to-one onto [0, π], exactly the range of a hinge. There is no ambiguity about which way up the page is.
- **It saturates.** Dragging past either fore-edge clamps to flat instead of producing NaN.

In code: `move()` sets `thetaTarget`, and `step()` chases it with the spring below (response `follow` = 40 ms, damping ratio 1).

## 4. Springs, and keeping them stable

Every motion in the book — following the pointer, settling, the cover, the pages riding with it, the camera — is the same damped spring:

```math
\ddot{x} + 2\zeta\omega_n\,\dot{x} + \omega_n^2\,(x - x^\ast) = 0
```

with target x\*. Designers do not think in stiffness and damping coefficients, so the parameters are Apple's: a **damping ratio** ζ (1 = critically damped, below 1 overshoots) and a **response** — the period of the undamped oscillation — from which

```math
\omega_n = \frac{2\pi}{\text{response}}, \qquad k = \omega_n^2, \qquad c = 2\zeta\omega_n
```

`springStep` integrates it with **semi-implicit (symplectic) Euler**: update the velocity with the current acceleration, then the position with the new velocity.

```math
v_{n+1} = v_n + h\,\big(k\,(x^\ast - x_n) - c\,v_n\big), \qquad x_{n+1} = x_n + h\,v_{n+1}
```

It is cheap and, unlike explicit Euler, does not slowly pump energy into an undamped spring. But it is only **conditionally** stable, and the condition matters here. Write the error e = x − x\* and the state (e, v). One step is the linear map

```math
\begin{pmatrix} e \\ v \end{pmatrix}_{n+1} =
\begin{pmatrix} 1 - h^2 k & h\,(1 - hc) \\ -hk & 1 - hc \end{pmatrix}
\begin{pmatrix} e \\ v \end{pmatrix}_n
```

whose trace is 2 − h²k − hc and whose determinant is 1 − hc. A 2 × 2 linear recurrence decays exactly when |det| < 1 and |trace| < 1 + det (the Jury conditions). With x = hω_n these become

```math
\zeta\,x < 1 \qquad\text{and}\qquad x^2 + 4\zeta\,x < 4
```

For a critically damped spring (ζ = 1) the second condition gives x < 2√2 − 2 ≈ 0.83. With the original fixed sub-step of h = 1/240 s, that means ω_n < 199 rad/s, i.e. **a response shorter than about 32 ms explodes**. That is not academic: the follow spring defaults to 40 ms and the demo's slider goes down to 1 ms. A quick sweep confirmed the prediction to the millisecond — stable at 32 ms, values of 10²⁹ at 30 ms, NaN at 10 ms.

The fix is to cap the sub-step as well:

```math
h = \min\!\left(\tfrac{1}{240},\ \frac{0.5}{\omega_n}\right) \quad\Rightarrow\quad x \le 0.5
```

At x = 0.5 the conditions hold for every ζ < 1.875, which covers every spring in the book. Long frames (a hiccup, a throttled tab) are simply split into more sub-steps; `dt` is also clamped to 50 ms before it reaches the engine. The unit tests sweep responses from 5 ms to 2 s, damping ratios from 0.3 to 1.2 and frames of 1/120 and 1/30 s.

**Declaring rest.** A settling sheet stops when |θ − target| < 0.0015 rad and |ω| < 0.02 rad/s, and snaps exactly to 0 or π. The snap keeps the stack exact, so the ordering in §10 compares clean numbers, and it is what lets the render loop go to sleep.

## 5. Letting go

**Estimating the release velocity.** The renderer keeps pointer samples from the last 80 ms, on the wall clock, and releases with

```math
v_x = \frac{x_{last} - x_{first}}{\max(t_{last} - t_{first},\ 8\,\text{ms})}
```

A window rather than the last two samples, because pointer events arrive unevenly and a single pair can be wildly wrong; 80 ms is long enough to average and short enough that a flick which stops before release reads as stopped.

**Deciding where it goes.** With progress p = θ/π for a page picked up on the right (or 1 − θ/π on the left):

```math
\text{target} =
\begin{cases}
\pi & v_x \le -v_{flick} \\
0 & v_x \ge v_{flick} \\
\text{the far side} & |v_x| < v_{flick},\ p \ge p_{threshold} \\
\text{where it came from} & \text{otherwise}
\end{cases}
```

with v_flick = 1.2 page widths per second and p_threshold = 0.5.

**Handing the speed to the spring.** Differentiate the tip projection of §3 with respect to time:

```math
\dot{x}_{tip} = -W\sin\theta\,\dot\theta \quad\Rightarrow\quad \omega_0 = -\frac{v_x}{W\sin\theta}
```

As θ → 0 or π this blows up: a nearly flat page barely moves its tip while it rotates, so a small pointer speed implies a huge angular one. The engine floors sin θ at 0.35 (about 20°) and caps the result at ±12 rad/s (±7.2 for the heavier cover). It only replaces the sheet's current ω if the new value is larger in magnitude, so releasing a page that is already flying fast does not brake it.

**Taps.** A press that did not move more than 0.02 page widths, released within 250 ms, is treated as a release at ±1.5 · v_flick — enough to pass the flick rule deterministically.

## 6. A low-pass that ignores the frame rate

The paper's lag is driven by a smoothed angular velocity ω̄. A naive smoother, `y += (x − y) · α`, depends on how often it runs: 60 steps a second smooth less than 240. The engine instead uses the exact solution of the first-order system ẏ = (x − y)/τ over a step of length Δt, holding x constant during the step:

```math
y_{n+1} = y_n + (x - y_n)\left(1 - e^{-\Delta t/\tau}\right)
```

Two steps of Δt/2 give exactly the same result as one step of Δt, so the bend looks the same at 60 Hz and 120 Hz. With τ = `bendResponse` = 90 ms. When a sheet is at rest the input is zero and this reduces to `bend *= exp(−Δt/τ)`.

## 7. Bending a page

**How much.** Each sheet has one bend value, an angle `c`:

```math
c = \text{curl}\cdot\sin 2\theta \;-\; \text{lag}\cdot\bar\omega
```

sin 2θ is zero lying flat on either side and largest half-way up, so the lift curl appears only while a page is in the air. The lag term bows the page against its motion and relaxes with ω̄.

**What shape.** Take one row of the page (fixed y) in the side view. Let its direction turn linearly from θ at the spine to θ + c at the fore-edge — a constant curvature, i.e. a circular arc of radius L/c. At arc length s ∈ [0, L], with L the page's length (W times its fore-edge `reach`, §13):

```math
\varphi(s) = \theta + c\,\frac{s}{L}
```

and the position is the integral of the unit tangent:

```math
\begin{aligned}
x(u) &= \int_0^{uL} \cos\varphi(s)\,ds = \frac{L}{c}\big(\sin(\theta + cu) - \sin\theta\big) \\
z(u) &= \int_0^{uL} \sin\varphi(s)\,ds = \frac{L}{c}\big(\cos\theta - \cos(\theta + cu)\big)
\end{aligned}
```

As c → 0 both expand to L·u·(cos θ, sin θ), the straight sheet; the shader switches to that form when |c| < 10⁻⁴ to avoid dividing by zero. The arc keeps the page's length exactly, which is why a bent page does not visibly stretch or shrink.

**The grabbed corner leads.** Each row gets its own multiple of c,

```math
c_{row} = c\,\big(1 + \text{spread}\cdot|y/H - y_{grab}|\big)
```

so the row under the pointer bends least and the far corner most.

**Never through the table.** If every row's c lies in [−θ, π − θ], then φ(s) — linear between θ and θ + c — stays in [0, π] for the whole row. Then sin φ ≥ 0, so z(u) is non-decreasing along the page: no part of the paper can dip below its own root, i.e. into the stack it is bound to. The shader clamps to 0.97 of that range to leave a hair of margin.

**Never through a neighbour.** The engine also limits c by the neighbours' angles: `bendMax = θ_outer − θ`, `bendMin = θ_inner − θ`. Here is why that works. Suppose the outer neighbour is a straight sheet at angle α sharing our root, and our tangent angle satisfies α − π ≤ φ(s) ≤ α for all s. Measure how far our point is on the inner side of the neighbour's line:

```math
D(s) = x(s)\sin\alpha - z(s)\cos\alpha, \qquad D'(s) = \cos\varphi\sin\alpha - \sin\varphi\cos\alpha = \sin(\alpha - \varphi) \ge 0
```

D starts at 0 and never decreases, so the curve never crosses to the neighbour's side. The same argument works for the inner neighbour. In the book the roots are 0.0025 apart and the neighbours bend too, so this is a very good approximation rather than a proof — and it is the reason the limits are applied to the *engine's* angles before the renderer draws anything. `bendOf` divides the limits by 1 + 0.85·spread — the largest row multiple when a page is grabbed at the default height — so the clamp holds for the most-bent row too; for grabs at the very top or bottom edge the shader's own clamp above is the backstop.

**Lighting the bend.** The normal must follow the arc, or the curve looks painted on. The shader evaluates the same `bent()` function one grid cell either side of the vertex and crosses the central differences:

```math
\mathbf{n} = \operatorname{normalize}\!\Big(\big(\mathbf{p}(x + \Delta x) - \mathbf{p}(x - \Delta x)\big) \times \big(\mathbf{p}(y + \Delta y) - \mathbf{p}(y - \Delta y)\big)\Big)
```

Central differences are second-order accurate (error ∝ Δ²), and using the grid spacing (W/56, H/24) means the normal matches the facets you actually see.

**Two faces, one plane.** Seen from behind, a page is mirrored left to right, so the back face samples its texture at (1 − u, v).

## 8. Smooth joins: smoothstep and the gutter

Several quantities blend between a "lying right" and a "lying left" value as a sheet turns: its height, its fore-edge reach, the cover's hinge. Blending linearly in θ would put a kink at both ends — the value would start and stop changing abruptly exactly when the sheet touches down. The engine uses Hermite smoothstep instead:

```math
m = S\!\left(\frac{\theta}{\pi}\right), \qquad S(t) = 3t^2 - 2t^3, \qquad S'(0) = S'(1) = 0
```

**The gutter.** Near the spine a lying page rises from where it is bound to the flat top of its stack. Over the first g = 0.22 of the width (`GUTTER_SPAN`) the rise follows a quadratic ease-out:

```math
P(u) = \begin{cases} 1 - (1 - u/g)^2 & u < g \\ 1 & u \ge g \end{cases}, \qquad P'(0) = \frac{2}{g},\quad P'(g) = 0
```

It leaves the binding steeply and meets the flat part with zero slope — a C¹ join, so the lighting (which depends on the normal, i.e. the slope) has no crease where the gutter ends. The height added to the arc is

```math
\text{dip}(u) = (z_{flat} - z_{root})\,|\cos\theta|\,P(u)
```

and |cos θ| fades it out as the page stands up: a page in the air has no gutter.

## 9. Heights in the stack

With board thickness b, sheet thickness t, f fixed sheets under the turnable ones, n turnable leaves and e endpapers:

```math
z_{bind}(i) = b + (f + n - i)\,t
```

Leaf 0 (the front) is bound highest, as in a real block, and its binding height never changes. Its flat height blends between the top of the right-hand stack and its own layer on the left-hand one:

```math
z_{flat}(i, \theta) = z_R + (z_L - z_R)\,S(\theta/\pi), \qquad z_R = z_{bind}(i) + \text{gutter}, \quad z_L = b + (e + i + 1)\,t + 0.0005
```

On the left the order reverses — the leaf turned first lies lowest — which is exactly what i + 1 layers above the endpapers gives.

## 10. The ordering, and what happens on contact

All sheets turn about the same axis, so for them "cannot pass through" is the chain of inequalities

```math
\theta_{cover} \ge \theta_{endpaper} \ge \theta_0 \ge \theta_1 \ge \dots \ge \theta_{n-1} \ge 0
```

After each physics step `resolveChain` sweeps the neighbouring pairs forward and then backward. For a pair (a, b) with a outside and b inside, if θ_b > θ_a:

**One of them is being dragged.** The hand is rigid. If a is dragged, b is pushed to θ_a and its velocity limited, ω_b ← min(ω_b, ω_a); symmetrically if b is dragged.

**Both are free.** They merge. Both turn about the same axis with the same shape, so their moments of inertia are proportional to their masses, and a perfectly inelastic collision that conserves angular momentum gives

```math
\theta' = \frac{m_a\theta_a + m_b\theta_b}{m_a + m_b}, \qquad \omega' = \frac{m_a\omega_a + m_b\omega_b}{m_a + m_b}
```

with a page counting 1 and the cover 8. Inelastic, not elastic, because paper does not bounce off paper; the 3D FlipBook plugin, which uses the same angular ordering, chooses elastic collisions instead.

**Waking and retargeting.** A resting sheet that gets pushed becomes a settling one, aimed at its nearer side. A settling sheet blocked by a resting one has its target moved to the blocker's angle. Without that, a spring would push against the blocker forever, never meet its rest condition (§4), and the loop would never sleep.

Why two sweeps: a single forward pass moves a push from the cover inward but not a push from a dragged inner page outward. Forward-then-back propagates both across any run of touching sheets in O(n).

## 11. The cover's moving hinge and its plane

The ordering assumes a shared axis, and the cover does not share it. Lying open, its board hinges on the table beside the block at h_open = (−0.035, b). Shut, it lies on top of the block, so its hinge is at h_shut = (−0.005, z_shut) where z_shut is the block's height plus the gutter. In between, with m = S(θ_c/π):

```math
\mathbf{h}(\theta_c) = \mathbf{h}_{shut} + (\mathbf{h}_{open} - \mathbf{h}_{shut})\,m + \beta\sin(\pi m)\,(-0.7,\ 0.7)
```

The last term (β = `bulge` = 0.02) pushes the hinge outward and upward half-way through, along the path a spine cloth takes round the back of the block. Without it the straight path passes *inside* the bindings and the cover's inner face slices through the pages mid-close.

**The cover's plane.** The board's inner face is the line through **h** with direction (cos θ_c, sin θ_c). Its normal pointing toward the pages is

```math
\mathbf{n} = (\sin\theta_c,\ -\cos\theta_c)
```

(check: standing up, θ_c = π/2, **n** = (1, 0) points right, toward the block). The signed distance of a point **p** from the inner face is (**p** − **h**) · **n**, positive on the pages' side.

**A point on a leaf.** Leaf i at angle θ, a fraction u of the way out, treated as straight (its bend is limited separately, §7), including the gutter lift from §8:

```math
\mathbf{p}(u) = \big(uW\cos\theta,\ \ z_{bind}(i) + uW\sin\theta + (z_{flat} - z_{bind})\,|\cos\theta|\,P(u)\big)
```

`clearance(i, θ, θ_c, u)` is (**p**(u) − **h**) · **n**.

**The limit.** `coverLimit(i, θ_c)` finds the largest θ ∈ [0, θ_c] for which the clearance at u = ¼, ½ and 1 is at least −10⁻⁴, by bisection. The leaf's clearance falls as it swings toward the cover, so the predicate is monotone and bisection applies; 14 halvings of an interval no wider than π leave

```math
\frac{\pi}{2^{14}} \approx 1.9\times10^{-4}\ \text{rad}
```

of uncertainty — 0.02 % of a page width at the fore-edge. This limit replaces θ_c wherever the ordering compares a leaf with the cover, and it caps those leaves' bend. The unit tests sample 40 points along every turned leaf through whole closes and find nothing deeper than 0.2 % of a page width.

## 12. The pages that follow a closing cover

When the cover moves, each sheet on its side (depth d = 0 next to the cover, increasing away from it) chases

```math
\theta_d^{target} = \operatorname{clamp}\!\big(\theta_c - \text{fan}\cdot d\cdot\sin\theta_c,\ 0,\ \text{coverLimit}\big)
```

on a critically damped spring with response 0.10 + 0.025·d seconds. sin θ_c is zero at both ends of the motion, so the fan opens mid-way and closes up by the time the cover lands; the offset lets the sheets furthest from the cover fall first, and their slightly slower springs soften the lead — like the pages of a book falling shut. The glued flyleaf copies the cover exactly.

## 13. The fore-edge and the soft shadows

**Reach.** A sheet with b sheets beneath it on its side reaches

```math
r(b) = 1 - 0.006\,b + j
```

of a page width, where j ∈ [−0.002, 0.002] is a fixed pseudo-random offset per sheet. A turning leaf i of n, with f fixed sheets, blends from b_R = f + n − 1 − i beneath it on the right to b_L = i on the left with S(θ/π). 0.006 is about 2.4 sheet thicknesses: deliberately more than a real book, so the stepping reads from above at screen resolution. The jitter keeps the steps from looking ruled.

**Shadow of a turning sheet.** A quad from the spine to the tip's projection W·r·cos θ, lying on the stack below, with opacity

```math
\alpha(v) = 0.42\,\sin^{0.6}\theta\;(1 - v)^{1.6}
```

where v runs from the spine (0) to the tip (1). sin θ makes the shadow appear as the page lifts and vanish as it lands; the exponent 0.6 makes it appear early (a lifted page shades the stack before it is high); (1 − v)^1.6 concentrates it near the spine, where a real page is closest to the paper under it.

## 14. Putting HTML on the paper

A DOM page of w × h CSS pixels is placed over a face with a scale and a translate. Take three points of the DOM page, A = (0.2w, 0), B = (0.8w, 0) and C = (0.2w, h). Map each to the page (u = x/w, or 1 − x/w on a back face; y_page = (½ − y/h)·H), push it through the CPU copy of the bend (`bentPoint`), the book's world matrix and the camera, and convert to canvas pixels:

```math
s_x = \frac{B'_x - A'_x}{0.6\,w}, \qquad s_y = \frac{C'_y - A'_y}{h}, \qquad t_x = A'_x - 0.2\,w\,s_x, \qquad t_y = A'_y
```

The DOM page gets `transform: translate(t_x, t_y) scale(s_x, s_y)` with `transform-origin: 0 0`.

This is exact only if the face maps to the screen by an axis-aligned scale — that is, if the page is **flat** and **parallel to the image plane**. A perspective camera maps a plane parallel to the image plane by a uniform scale, so the demo only brings HTML out in its reading view, where the book faces the camera straight on and the gutter is relaxed to 30 % of its depth. What remains is the relaxed gutter within 22 % of the spine; measured on the demo, the live page and its print differ by a mean of 1.6/255 per pixel, all of it at glyph edges.

A tilted but flat page would need a full homography (CSS `matrix3d`), and a bent page cannot be matched by any single transform of a flat element at all — which is why a moving page carries a *print* of the HTML. [Keeping HTML on a turning page](html-on-paper.md) covers that side.
