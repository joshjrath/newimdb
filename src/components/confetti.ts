/**
 * A short, light confetti burst on a full-screen canvas (no library). Two cannons fire
 * from the bottom corners, then a shower falls from the top; it cleans itself up after
 * ~4 seconds. With "reduce motion" on, nothing moves (the caller shows a message instead).
 */
const COLORS = ["#f2a79c", "#f3e96c", "#c7b6f6", "#57d48c", "#ffffff", "#ffb347"];

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  spin: number;
  w: number;
  h: number;
  color: string;
  shape: "rect" | "circle" | "ribbon";
  life: number;
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function burstConfetti() {
  if (typeof document === "undefined" || prefersReducedMotion()) return;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "9999" });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas.remove();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const bits: Bit[] = [];
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const make = (x: number, y: number, angle: number, speed: number): Bit => ({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: rand(0, Math.PI * 2),
    spin: rand(-0.3, 0.3),
    w: rand(6, 11),
    h: rand(8, 16),
    color: COLORS[(Math.random() * COLORS.length) | 0],
    shape: Math.random() < 0.15 ? "circle" : Math.random() < 0.3 ? "ribbon" : "rect",
    life: 1,
  });
  // Two cannons from the bottom corners…
  for (let i = 0; i < 90; i++) {
    bits.push(make(0, H, rand(-Math.PI * 0.42, -Math.PI * 0.22), rand(11, 19)));
    bits.push(make(W, H, rand(-Math.PI * 0.78, -Math.PI * 0.58), rand(11, 19)));
  }
  // …and a gentle shower a moment later.
  setTimeout(() => {
    for (let i = 0; i < 70; i++) bits.push(make(rand(0, W), rand(-60, -10), rand(Math.PI * 0.4, Math.PI * 0.6), rand(2, 5)));
  }, 350);

  const start = performance.now();
  const frame = (t: number) => {
    const elapsed = t - start;
    ctx.clearRect(0, 0, W, H);
    for (const b of bits) {
      b.vy += 0.32; // gravity
      b.vx *= 0.985; // air
      b.vy *= 0.985;
      b.x += b.vx + Math.sin((t + b.w * 50) / 260) * 0.6; // a little flutter
      b.y += b.vy;
      b.r += b.spin;
      if (elapsed > 2600) b.life = Math.max(0, b.life - 0.02);
      ctx.save();
      ctx.globalAlpha = b.life;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.fillStyle = b.color;
      if (b.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, b.w / 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (b.shape === "ribbon") {
        ctx.fillRect(-b.w / 2, -b.h, b.w / 3, b.h * 2);
      } else {
        // a flat piece turning in the air: squash its height with the spin
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 1.7)));
      }
      ctx.restore();
    }
    if (elapsed < 4200) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
