/* Dziennik formy: confetti in plate colors for a new plate, a new badge or a new low. */
(function (DF) {
  'use strict';

  const DURATION = 2400;

  function burst(origin) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const css = getComputedStyle(document.documentElement);
    const palette = ['--plate-red', '--plate-blue', '--plate-yellow', '--plate-green', '--plate-white']
      .map((v) => css.getPropertyValue(v).trim());

    const canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const x0 = origin && Number.isFinite(origin.x) ? origin.x : w / 2;
    const y0 = origin && Number.isFinite(origin.y) ? origin.y : h * 0.3;
    const parts = Array.from({ length: 150 }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const speed = 380 + Math.random() * 520;
      return {
        x: x0, y: y0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 14,
        color: palette[Math.floor(Math.random() * palette.length)]
      };
    });

    const t0 = performance.now();
    let last = t0;
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const age = now - t0;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = age > DURATION - 600 ? Math.max(0, (DURATION - age) / 600) : 1;
      parts.forEach((p) => {
        p.vy += 900 * dt;
        p.vx *= 1 - 1.4 * dt;
        p.vy *= 1 - 0.6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.rot * 1.7)); // flutter
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (age < DURATION) requestAnimationFrame(frame);
      else canvas.remove();
    }
    requestAnimationFrame(frame);
  }

  DF.confetti = { burst };
})(window.DF = window.DF || {});
