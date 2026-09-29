/* Dziennik formy: the barbell. Every kilogram of the goal is one plate. Earned plates are loaded
   on both sleeves, the next one fills from the bottom, the rest are dashed outlines. */
(function (DF) {
  'use strict';

  const U = DF.utils;

  const W = 720;
  const H = 176;
  const CY = 88;
  const GAP = 3;
  const LEFT_COLLAR = 236; // inner face of the left collar; left plates stack leftwards from here
  const RIGHT_COLLAR = 484; // outer face of the right collar; right plates stack rightwards
  const PLATES = [
    { h: 150, w: 26, c: 'red' },
    { h: 150, w: 22, c: 'blue' },
    { h: 150, w: 18, c: 'yellow' },
    { h: 150, w: 15, c: 'green' },
    { h: 124, w: 13, c: 'white' },
    { h: 100, w: 11, c: 'red' },
    { h: 86, w: 9, c: 'steel' },
    { h: 74, w: 8, c: 'white' },
    { h: 64, w: 7, c: 'steel' },
    { h: 56, w: 6, c: 'steel' }
  ];

  const r1 = (n) => Math.round(n * 10) / 10;

  function plate(p, x, side, kind, fill, order) {
    const y = CY - p.h / 2;
    const box = `x="${x}" y="${y}" width="${p.w}" height="${p.h}" rx="3"`;
    const anim = order >= 0 ? ` style="--i:${order}"` : '';
    if (kind === 'ghost') return `<rect class="ghost" ${box}/>`;
    if (kind === 'partial') {
      const fh = r1(p.h * fill);
      return `<rect class="ghost" ${box}/>` +
        `<rect class="level p-${p.c}${order >= 0 ? ' grow' : ''}"${anim} x="${x}" y="${r1(y + p.h - fh)}" width="${p.w}" height="${fh}" rx="2"/>`;
    }
    const edgeX = side === 'l' ? x + 2 : x + p.w - 4;
    return `<g class="plate${order >= 0 ? ` slide-${side}` : ''}"${anim}>` +
      `<rect class="face p-${p.c}" ${box}/>` +
      `<rect class="hub" x="${x}" y="${CY - 17}" width="${p.w}" height="34"/>` +
      `<rect class="edge" x="${edgeX}" y="${y + 6}" width="2" height="${p.h - 12}" rx="1"/>` +
      '</g>';
  }

  // pl: result of DF.stats.plates(). opts.animateFrom: index of the first plate that slides in
  // (0 on page load, the old count after a save, omitted for no animation).
  function markup(pl, opts = {}) {
    const from = opts.animateFrom == null ? Infinity : opts.animateFrom;
    const count = Math.min(pl.count, PLATES.length);
    let nextLeft = LEFT_COLLAR - GAP;
    let nextRight = RIGHT_COLLAR + GAP;
    let order = 0;
    const plates = [];
    for (let i = 0; i < count; i++) {
      const p = PLATES[i];
      const kind = i < pl.full ? 'earned' : i === pl.full && pl.partial > 0.02 ? 'partial' : 'ghost';
      const lx = nextLeft - p.w;
      nextLeft = lx - GAP;
      const rx = nextRight;
      nextRight = rx + p.w + GAP;
      const o = kind !== 'ghost' && i >= from ? order++ : -1;
      plates.push(plate(p, lx, 'l', kind, pl.partial, o), plate(p, rx, 'r', kind, pl.partial, o));
    }

    const kg = pl.per === 1 ? '1 kg' : `${U.fmt1(pl.per)} kg`;
    const label = `Sztanga: ${pl.full} z ${pl.count} ${pl.count === 1 ? 'talerza' : 'talerzy'}. Jeden talerz to ${kg} w dół.`;
    const base = opts.delay ? ` style="--base:${opts.delay}ms"` : '';

    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${U.escapeHtml(label)}"${base} xmlns="http://www.w3.org/2000/svg">` +
      '<defs>' +
        '<linearGradient id="bb-steel" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#F2F4F6"/><stop offset=".42" stop-color="#C3C9D0"/>' +
          '<stop offset=".58" stop-color="#9AA2AC"/><stop offset="1" stop-color="#DCE0E5"/>' +
        '</linearGradient>' +
        '<linearGradient id="bb-shaft" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#D5DAE0"/><stop offset=".5" stop-color="#8E96A0"/><stop offset="1" stop-color="#B8BFC7"/>' +
        '</linearGradient>' +
        '<pattern id="bb-knurl" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
          '<rect width="3" height="3" fill="#9CA4AE"/><path d="M0 0H3M0 0V3" stroke="#5F6771" stroke-width=".9"/>' +
        '</pattern>' +
      '</defs>' +
      `<rect class="floor" x="0" y="${CY + 75}" width="${W}" height="2"/>` +
      `<rect x="14" y="${CY - 11}" width="222" height="22" rx="2" fill="url(#bb-steel)"/>` +
      `<rect x="484" y="${CY - 11}" width="222" height="22" rx="2" fill="url(#bb-steel)"/>` +
      `<rect x="8" y="${CY - 14}" width="8" height="28" rx="2" fill="url(#bb-steel)"/>` +
      `<rect x="704" y="${CY - 14}" width="8" height="28" rx="2" fill="url(#bb-steel)"/>` +
      `<rect x="250" y="${CY - 6}" width="220" height="12" fill="url(#bb-shaft)"/>` +
      `<rect x="268" y="${CY - 6}" width="72" height="12" fill="url(#bb-knurl)"/>` +
      `<rect x="380" y="${CY - 6}" width="72" height="12" fill="url(#bb-knurl)"/>` +
      `<rect x="236" y="${CY - 23}" width="14" height="46" rx="2" fill="url(#bb-steel)"/>` +
      `<rect x="470" y="${CY - 23}" width="14" height="46" rx="2" fill="url(#bb-steel)"/>` +
      plates.join('') +
      '</svg>';
  }

  function render(el, pl, opts) {
    el.innerHTML = markup(pl, opts);
  }

  DF.barbell = { render, markup, PLATES };
})(window.DF = window.DF || {});
