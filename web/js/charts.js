/* Dziennik formy: weight, calorie and sleep charts (Chart.js). Colors come from the CSS variables in styles.css,
   so the charts match the rest of the page. */
(function (DF) {
  'use strict';

  const U = DF.utils;
  const S = DF.stats;
  const instances = {};

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Days shown for a range (30, 90 or 'all'), never before the first entry, at least a week.
  function chartDays(entries, range, today) {
    if (!entries.length) return [];
    const first = S.sorted(entries)[0].date;
    let from = range === 'all' ? first : U.addDays(today, -(range - 1));
    if (from < first) from = first;
    if (U.diffDays(from, today) < 6) from = U.addDays(today, -6);
    return U.dayRange(from, today);
  }

  function base(colors, days) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 6, right: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.ink,
          titleColor: colors.bg,
          bodyColor: colors.bg,
          padding: 10,
          cornerRadius: 8,
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          titleFont: { weight: '600' },
          filter: (item) => item.parsed.y != null,
          callbacks: { title: (items) => (items.length ? U.fmtDay(days[items[0].dataIndex]) : '') }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: colors.rule },
          ticks: {
            color: colors.muted,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: window.innerWidth < 640 ? 5 : 8,
            callback: (value) => (days[value] ? U.fmtShort(days[value]) : '')
          }
        },
        y: {
          grid: { color: colors.rule, drawTicks: false },
          border: { display: false },
          ticks: { color: colors.muted, padding: 8 }
        }
      }
    };
  }

  function draw(canvas, config, hasData) {
    if (instances[canvas.id]) instances[canvas.id].destroy();
    const empty = canvas.parentElement.querySelector('.chart-empty');
    if (empty) empty.hidden = hasData;
    instances[canvas.id] = new Chart(canvas, config);
  }

  function weight(canvas, vm, range) {
    const c = colors();
    const days = chartDays(vm.entries, range, vm.today);
    const byDay = new Map(S.weightEntries(vm.entries).map((e) => [e.date, e.weight]));
    const ma = S.movingAverage(vm.entries);
    const daily = days.map((d) => (byDay.has(d) ? byDay.get(d) : null));
    const trend = days.map((d) => (ma.has(d) ? Math.round(ma.get(d) * 100) / 100 : null));
    const plan = days.map((d) => (d >= vm.settings.startDate ? Math.round(S.planWeightAt(vm.settings, d) * 100) / 100 : null));
    const values = [...daily, ...trend, ...plan].filter((v) => v != null);
    const hasData = daily.some((v) => v != null);

    const options = base(c, days);
    if (values.length) {
      options.scales.y.suggestedMin = Math.floor(Math.min(...values) - 0.4);
      options.scales.y.suggestedMax = Math.ceil(Math.max(...values) + 0.4);
    }
    options.scales.y.ticks.callback = (v) => U.fmtWeight(v);
    const order = { Waga: 0, 'Średnia z 7 dni': 1, Plan: 2 };
    options.plugins.tooltip.itemSort = (a, b) => order[a.dataset.label] - order[b.dataset.label];
    options.plugins.tooltip.callbacks.label = (item) => {
      const v = item.dataset.label === 'Waga' ? U.fmtWeight(item.parsed.y) : U.fmt1(item.parsed.y);
      return ` ${item.dataset.label}: ${v} kg`;
    };

    draw(canvas, {
      type: 'line',
      data: {
        labels: days,
        datasets: [
          {
            label: 'Plan', data: plan, borderColor: c.muted, borderWidth: 1.5, borderDash: [6, 5],
            pointRadius: 0, pointHoverRadius: 0, pointStyle: 'line', fill: false, spanGaps: true
          },
          {
            label: 'Waga', data: daily, showLine: false, backgroundColor: c.steel, borderColor: c.steel,
            pointRadius: days.length > 120 ? 2 : 3, pointHoverRadius: 5, pointStyle: 'circle'
          },
          {
            label: 'Średnia z 7 dni', data: trend, borderColor: c.blue, backgroundColor: c.blue, borderWidth: 3,
            tension: 0.35, spanGaps: true, pointRadius: 0, pointHoverRadius: 4, pointStyle: 'circle',
            borderCapStyle: 'round', borderJoinStyle: 'round'
          }
        ]
      },
      options
    }, hasData);
  }

  function kcal(canvas, vm, range) {
    const c = colors();
    const target = vm.settings.kcalTarget;
    const days = chartDays(vm.entries, range, vm.today);
    const byDay = new Map(vm.entries.filter((e) => typeof e.kcal === 'number').map((e) => [e.date, e.kcal]));
    const values = days.map((d) => (byDay.has(d) ? byDay.get(d) : null));
    const stateColor = { ok: c.green, over: c.red, under: c.steel };
    const bars = values.map((v) => (v == null ? 'transparent' : stateColor[S.kcalState(v, target)]));
    const max = Math.max(target, ...values.filter((v) => v != null));
    const stateText = { ok: 'w celu', over: 'ponad cel', under: 'poniżej celu' };

    const options = base(c, days);
    options.scales.y.beginAtZero = true;
    options.scales.y.suggestedMax = Math.ceil((max * 1.08) / 500) * 500;
    options.scales.y.ticks.callback = (v) => U.fmtInt(v);
    options.scales.y.ticks.maxTicksLimit = 6;
    options.plugins.tooltip.callbacks.label = (item) => {
      if (item.dataset.type === 'line') return ` Cel: ${U.fmtInt(item.parsed.y)} kcal`;
      return ` ${U.fmtInt(item.parsed.y)} kcal, ${stateText[S.kcalState(item.parsed.y, target)]}`;
    };

    draw(canvas, {
      type: 'bar',
      data: {
        labels: days,
        datasets: [
          {
            type: 'line', label: 'Cel', data: days.map(() => target), borderColor: c.ink2, borderWidth: 1.5,
            borderDash: [6, 5], pointRadius: 0, pointHoverRadius: 0, pointStyle: 'line', order: 0
          },
          {
            type: 'bar', label: 'Kalorie', data: values, backgroundColor: bars, borderRadius: 3,
            maxBarThickness: 18, categoryPercentage: 0.82, barPercentage: 0.92, order: 1
          }
        ]
      },
      options
    }, values.some((v) => v != null));
  }

  // Calories from each macro, stacked, against the calorie target. Stacking works because all
  // three share one unit (kcal); the tooltip gives the grams.
  function macro(canvas, vm, range) {
    const c = colors();
    const target = vm.settings.kcalTarget;
    const days = chartDays(vm.entries, range, vm.today);
    const byDay = new Map(vm.entries.filter(S.hasMacros).map((e) => [e.date, e]));
    const fill = { protein: c.protein, fat: c.fat, carbs: c.carbs };
    const series = S.MACROS.map((m) => ({
      type: 'bar', label: m.label, key: m.key, stack: 'kcal', order: 1,
      data: days.map((d) => {
        const e = byDay.get(d);
        return e && typeof e[m.key] === 'number' ? e[m.key] * m.kcal : null;
      }),
      backgroundColor: fill[m.key],
      borderColor: c.bg,
      borderWidth: { top: 2, right: 0, bottom: 0, left: 0 },
      borderSkipped: false,
      borderRadius: 4,
      maxBarThickness: 18, categoryPercentage: 0.82, barPercentage: 0.92
    }));
    const totals = days.map((d) => {
      const e = byDay.get(d);
      return e ? S.MACROS.reduce((s, m) => s + (typeof e[m.key] === 'number' ? e[m.key] * m.kcal : 0), 0) : 0;
    });
    const max = Math.max(target, ...totals);

    const options = base(c, days);
    options.scales.x.stacked = true;
    options.scales.y.stacked = true;
    options.scales.y.beginAtZero = true;
    options.scales.y.suggestedMax = Math.ceil((max * 1.08) / 500) * 500;
    options.scales.y.ticks.callback = (v) => U.fmtInt(v);
    options.scales.y.ticks.maxTicksLimit = 6;
    options.plugins.tooltip.itemSort = (a, b) => a.datasetIndex - b.datasetIndex;
    options.plugins.tooltip.callbacks.label = (item) => {
      if (item.dataset.type === 'line') return ` Cel: ${U.fmtInt(item.parsed.y)} kcal`;
      const m = S.MACROS.find((x) => x.key === item.dataset.key);
      return ` ${m.label}: ${U.fmtInt(item.parsed.y / m.kcal)} g (${U.fmtInt(item.parsed.y)} kcal)`;
    };
    options.plugins.tooltip.callbacks.footer = (items) => {
      if (!items.length) return '';
      const e = byDay.get(days[items[0].dataIndex]);
      if (!e) return '';
      const lines = [`Z makro: ${U.fmtInt(totals[items[0].dataIndex])} kcal`];
      if (typeof e.kcal === 'number') lines.push(`Wpisane kalorie: ${U.fmtInt(e.kcal)}`);
      return lines;
    };
    options.plugins.tooltip.footerColor = c.bg;

    draw(canvas, {
      type: 'bar',
      data: {
        labels: days,
        datasets: [
          {
            type: 'line', label: 'Cel', data: days.map(() => target), borderColor: c.ink2, borderWidth: 1.5,
            borderDash: [6, 5], pointRadius: 0, pointHoverRadius: 0, pointStyle: 'line', order: 0
          },
          ...series
        ]
      },
      options
    }, totals.some((v) => v > 0));
  }

  // Hours of sleep as bars against the 7 h line. The score gets its own chart below:
  // hours and a 0–100 score never share an axis.
  function sleep(canvas, vm, range) {
    const c = colors();
    const days = chartDays(vm.entries, range, vm.today);
    const byDay = new Map(vm.entries.map((e) => [e.date, e]));
    const values = days.map((d) => (byDay.has(d) && typeof byDay.get(d).sleep === 'number' ? byDay.get(d).sleep : null));
    const bars = values.map((v) => (v == null ? 'transparent' : v >= S.SLEEP_GOOD ? c.blue : c.steel));
    const max = Math.max(S.SLEEP_GOOD, ...values.filter((v) => v != null));

    const options = base(c, days);
    options.scales.y.beginAtZero = true;
    options.scales.y.suggestedMax = Math.ceil(max + 0.5);
    options.scales.y.ticks.stepSize = 2;
    options.scales.y.ticks.callback = (v) => `${v} h`;
    options.plugins.tooltip.callbacks.label = (item) => {
      if (item.dataset.type === 'line') return ` Zalecane minimum: ${S.SLEEP_GOOD} h`;
      const e = byDay.get(days[item.dataIndex]);
      const score = e && typeof e.sleepScore === 'number' ? `, ocena ${e.sleepScore}/100` : '';
      return ` ${U.fmtHours(item.parsed.y)} h snu${score}`;
    };

    draw(canvas, {
      type: 'bar',
      data: {
        labels: days,
        datasets: [
          {
            type: 'line', label: 'Minimum', data: days.map(() => S.SLEEP_GOOD), borderColor: c.ink2, borderWidth: 1.5,
            borderDash: [6, 5], pointRadius: 0, pointHoverRadius: 0, pointStyle: 'line', order: 0
          },
          {
            type: 'bar', label: 'Sen', data: values, backgroundColor: bars, borderRadius: 3,
            maxBarThickness: 18, categoryPercentage: 0.82, barPercentage: 0.92, order: 1
          }
        ]
      },
      options
    }, values.some((v) => v != null));
  }

  function sleepScore(canvas, vm, range) {
    const c = colors();
    const days = chartDays(vm.entries, range, vm.today);
    const byDay = new Map(vm.entries.filter((e) => typeof e.sleepScore === 'number').map((e) => [e.date, e.sleepScore]));
    const values = days.map((d) => (byDay.has(d) ? byDay.get(d) : null));

    const options = base(c, days);
    options.scales.y.min = 0;
    options.scales.y.max = 100;
    options.scales.y.ticks.stepSize = 25;
    options.plugins.tooltip.displayColors = false;
    options.plugins.tooltip.callbacks.label = (item) => ` Ocena snu: ${item.parsed.y}/100`;

    draw(canvas, {
      type: 'line',
      data: {
        labels: days,
        datasets: [{
          label: 'Ocena snu', data: values, borderColor: c.blue, backgroundColor: c.blue, borderWidth: 2,
          tension: 0.3, spanGaps: true, pointRadius: days.length > 120 ? 2 : 4, pointHoverRadius: 6,
          pointBorderColor: c.bg, pointBorderWidth: 2, borderCapStyle: 'round', borderJoinStyle: 'round'
        }]
      },
      options
    }, values.some((v) => v != null));
  }

  function colors() {
    return {
      bg: cssVar('--surface'),
      ink: cssVar('--ink'),
      ink2: cssVar('--ink-2'),
      muted: cssVar('--muted'),
      steel: cssVar('--steel'),
      rule: cssVar('--rule'),
      blue: cssVar('--plate-blue'),
      green: cssVar('--plate-green'),
      red: cssVar('--plate-red'),
      protein: cssVar('--macro-protein'),
      fat: cssVar('--macro-fat'),
      carbs: cssVar('--macro-carbs')
    };
  }

  function setup() {
    if (typeof Chart === 'undefined') return false;
    Chart.defaults.font.family = "'Barlow', system-ui, sans-serif";
    Chart.defaults.font.size = 13;
    return true;
  }

  DF.charts = { setup, weight, kcal, macro, sleep, sleepScore, chartDays };
})(window.DF = window.DF || {});
