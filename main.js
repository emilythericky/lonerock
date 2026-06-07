// ── STATE ─────────────────────────────────────────────

let lakeInitialized = false;
let simulation = null;
let nodeData = null;        // the loaded {nodes, links}
let W = 0, H = 0;
let simTime = 0;            // tick counter, drives drift + thread throttle
let threadSel = null;       // live drainage-thread selection (mutable flow)
let threadGlowSel = null;

// ── MEMBRANE → LAKE ───────────────────────────────────

document.getElementById('enter-btn').addEventListener('click', () => {
  document.getElementById('membrane').style.display = 'none';
  const lakeView = document.getElementById('lake-view');
  lakeView.classList.add('visible');
  // Wait for the browser to lay out the now-visible container before
  // measuring it — otherwise clientWidth/Height read 0 and every node
  // collapses into the top-left corner.
  requestAnimationFrame(() => requestAnimationFrame(initLake));
});

document.getElementById('back-link').addEventListener('click', (e) => {
  e.preventDefault();
  closeGeology();
  document.getElementById('lake-view').classList.remove('visible');
  document.getElementById('membrane').style.display = 'flex';
});

// ── GEOLOGY PANEL ─────────────────────────────────────

document.getElementById('panel-close').addEventListener('click', closeGeology);

function openGeology() {
  document.getElementById('geology-panel').classList.add('open');
}

function closeGeology() {
  document.getElementById('geology-panel').classList.remove('open');
}

// ── MARKDOWN PARSING ──────────────────────────────────

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  match[1].split('\n').forEach(line => {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) meta[key.trim()] = rest.join(':').trim();
  });
  return { meta, body: match[2] };
}

function parseNodeSections(body) {
  const sections = { surface: '', geology: '', depth: '' };
  const parts = body.split(/^## /m).filter(Boolean);
  parts.forEach(part => {
    const [heading, ...rest] = part.split('\n');
    const key = heading.trim().toLowerCase();
    if (key === 'surface') sections.surface = rest.join('\n').trim();
    else if (key === 'geology') sections.geology = rest.join('\n').trim();
    else if (key === 'depth') sections.depth = rest.join('\n').trim();
  });
  return sections;
}

// ── MARKED CONFIGURATION ──────────────────────────────

marked.setOptions({ breaks: true, gfm: true });

// Author's-hand markup, applied after marked():
//   [[redacted]]      → a blacked-out bar (adversarial editorial hand)
//   ~~struck~~        → handled natively by marked as <del>
//   (((  )))          → an archive-silence gap, the held empty space
//   [clip: Headline | body text | source]
//                     → a Mrs. Grundy newspaper scrap (parataxis)
function applyAuthorsHand(html) {
  // archive-silence gap — must run before redaction so empty parens survive
  html = html.replace(/\(\(\(\s*\)\)\)/g, '<span class="archive-gap"></span>');
  // redaction bars
  html = html.replace(/\[\[(.+?)\]\]/g, '<span class="redacted">$1</span>');
  // found-text clippings
  html = html.replace(/\[clip:\s*([^|]*?)\s*\|\s*([\s\S]*?)\s*\|\s*([^\]]*?)\s*\]/g,
    (_, head, bodyTxt, source) =>
      `<aside class="clipping"><span class="clipping-head">${head}</span>${bodyTxt}<span class="clipping-source">${source}</span></aside>`);
  return html;
}

function render(md) {
  return applyAuthorsHand(marked.parse(md || ''));
}

// ── SHOW NODE (vertical descent) ──────────────────────

async function showNode(nodeDatum) {
  document.getElementById('panel-title').textContent = nodeDatum.title;
  document.getElementById('panel-subtitle').textContent = nodeDatum.subtitle || '';

  const col = document.getElementById('strata-column');
  const water = document.getElementById('stratum-water');
  const sediment = document.getElementById('stratum-sediment');
  const bedrock = document.getElementById('stratum-bedrock');

  // reset scroll to the surface each time we open a node
  col.scrollTop = 0;
  const panel = document.getElementById('geology-panel');
  panel.scrollTop = 0;

  water.innerHTML = '<div class="loading-shimmer">descending through the water column…</div>';
  sediment.innerHTML = '';
  bedrock.innerHTML = '';
  openGeology();

  try {
    const response = await fetch(nodeDatum.contentPath);
    if (!response.ok) throw new Error('fetch failed');
    const text = await response.text();
    const { body } = parseFrontmatter(text);
    const sections = parseNodeSections(body);

    water.innerHTML = render(sections.surface);
    sediment.innerHTML = render(sections.geology);
    bedrock.innerHTML = render(sections.depth);

    // The deeper strata are empty until real material (clippings, texts,
    // images) is placed there. Hide a stratum — and the descent cue —
    // rather than show an empty labelled band.
    const hasSediment = !!sections.geology.trim();
    const hasDepth = !!sections.depth.trim();
    setStratumVisible(sediment, hasSediment);
    setStratumVisible(bedrock, hasDepth);
    const hint = document.querySelector('.descent-hint');
    if (hint) hint.style.display = (hasSediment || hasDepth) ? '' : 'none';
  } catch (err) {
    water.innerHTML = `<p style="color: var(--text-muted); font-style: italic;">Could not load node. If running locally, start a server:<br><code>python3 -m http.server 8000</code></p>`;
  }
}

// Show/hide a stratum band by toggling its parent <section>.
function setStratumVisible(bodyEl, visible) {
  const section = bodyEl.closest('.stratum');
  if (section) section.style.display = visible ? '' : 'none';
}

// ── LAKE INITIALIZATION ───────────────────────────────

function initLake() {
  if (lakeInitialized) return;

  const svgEl = document.getElementById('lake-svg');
  // Robust dimensions: prefer the measured box, fall back to the
  // viewport, and if somehow still zero, retry on the next frame.
  W = svgEl.clientWidth || svgEl.getBoundingClientRect().width || window.innerWidth;
  H = svgEl.clientHeight || svgEl.getBoundingClientRect().height || window.innerHeight;
  if (!W || !H) { requestAnimationFrame(initLake); return; }

  lakeInitialized = true;

  const svg = d3.select('#lake-svg');
  buildDefs(svg);

  d3.json('data/nodes.json').then(data => {
    nodeData = data;

    // Seed positions from proportional values; precompute each pond's
    // word-boundary (the ring of words that *is* the pond's outline).
    data.nodes.forEach((d, i) => {
      d.x = d.x * W;
      d.y = d.y * H;
      d.fx = null; d.fy = null;
      d._phase = i * 1.7 + Math.random() * 6.28;   // drift phase
      d._boundary = computeBoundary(d, i);
    });

    // ── SIMULATION ─────────────────────────────────
    // No link force: the watershed is no longer a fixed graph. Ponds
    // repel, collide, drift, and the *flow* between them is re-derived
    // from proximity every few ticks (updateThreads). Drag a pond and it
    // reconnects, rather than towing its old arcs across the others.
    simulation = d3.forceSimulation(data.nodes)
      .force('charge', d3.forceManyBody().strength(-680))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.035))
      .force('collision', d3.forceCollide(d => d.radius * 1.18 + 46))
      .force('bounds', () => {
        data.nodes.forEach(d => {
          const pad = d.radius * 1.18 + 50;
          if (d.x < pad) d.vx += (pad - d.x) * 0.09;
          if (d.x > W - pad) d.vx += (W - pad - d.x) * 0.09;
          if (d.y < pad) d.vy += (pad - d.y) * 0.09;
          if (d.y > H - pad) d.vy += (H - pad - d.y) * 0.09;
        });
      })
      // Perpetual slip — the lake never fully stills.
      .force('drift', () => {
        data.nodes.forEach(d => {
          if (d.fx != null) return;
          d.vx += Math.sin(simTime * 0.016 + d._phase) * 0.013;
          d.vy += Math.cos(simTime * 0.013 + d._phase * 1.3) * 0.013;
        });
      })
      .alphaDecay(0.012)
      .velocityDecay(0.78);

    // ── DRAINAGE THREAD LAYER (mutable flow) ───────
    const threadGroup = svg.append('g').attr('class', 'threads');
    threadGlowSel = threadGroup.append('g').attr('class', 'thread-glows').selectAll('path');
    threadSel = threadGroup.append('g').attr('class', 'thread-lines').selectAll('path');

    // ── POND NODES ─────────────────────────────────
    const nodeGroup = svg.append('g').attr('class', 'nodes');

    const ponds = nodeGroup.selectAll('.pond-body')
      .data(data.nodes).join('g')
      .attr('class', 'pond-body')
      .on('click', (event, d) => {
        if (event.defaultPrevented) return;   // a drag happened
        event.stopPropagation();               // don't let svg-bg close it
        showNode(d);
      })
      .call(pondDrag(simulation));

    ponds.each(function (d, i) {
      const g = d3.select(this);

      // faint aura under the water
      g.append('ellipse')
        .attr('class', 'pond-aura')
        .attr('rx', d.radius * 1.5)
        .attr('ry', d.radius * 1.15)
        .attr('filter', 'url(#pond-glow)');

      // the translucent water body — its outline is the word ring
      g.append('path')
        .attr('class', 'pond-water')
        .attr('fill', waterFillFor(d))
        .attr('filter', 'url(#water-shimmer)');

      // ripple rings
      for (let r = 0; r < 2; r++) {
        g.append('circle')
          .attr('class', 'ripple-ring')
          .attr('r', 8 + r * 26)
          .style('animation-delay', `${r * 1.9 + i * 0.6}s`);
      }

      // mycelial filaments joining word-end → next word-start
      g.append('g').attr('class', 'filaments');

      // the boundary words themselves
      const wordSel = g.append('g').attr('class', 'boundary-words')
        .selectAll('text')
        .data(d._boundary).join('text')
        .attr('class', 'boundary-word')
        .text(b => b.w)
        .call(wordDrag(d));

      // labels below the pond
      g.append('text')
        .attr('class', 'pond-label')
        .attr('dy', d.radius * 1.18 + 20)
        .text(d.title);
      g.append('text')
        .attr('class', 'pond-sublabel')
        .attr('dy', d.radius * 1.18 + 34)
        .text(d.subtitle);

      d._g = g;
      redrawPond(d);
    });

    // ── INTERACTION: empty water closes the panel ──
    svg.on('click', () => closeGeology());

    // ── TICK ───────────────────────────────────────
    simulation.on('tick', () => {
      simTime++;
      ponds.attr('transform', d => `translate(${d.x},${d.y})`);
      // re-derive the flow topology every few ticks; redraw geometry each tick
      if (simTime % 10 === 0) updateThreads();
      drawThreadGeometry();
    });

    // keep a low simmer so the water keeps slipping
    simulation.alphaTarget(0.012).restart();
    updateThreads();
  });
}

// ── DEFS (gradients + filters) ────────────────────────

function buildDefs(svg) {
  const defs = svg.append('defs');

  // water displacement — gives the pond body a living wobble
  const wf = defs.append('filter').attr('id', 'water-shimmer')
    .attr('x', '-30%').attr('y', '-30%').attr('width', '160%').attr('height', '160%');
  wf.append('feTurbulence')
    .attr('type', 'fractalNoise')
    .attr('baseFrequency', '0.012 0.018')
    .attr('numOctaves', 2).attr('seed', 7).attr('result', 'noise');
  wf.append('feDisplacementMap')
    .attr('in', 'SourceGraphic').attr('in2', 'noise')
    .attr('scale', 7).attr('xChannelSelector', 'R').attr('yChannelSelector', 'G');

  const glow = defs.append('filter').attr('id', 'pond-glow')
    .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%');
  glow.append('feGaussianBlur').attr('stdDeviation', '14');

  // translucent water gradients — opacity is the point
  const grad = (id, stops) => {
    const g = defs.append('radialGradient').attr('id', id)
      .attr('cx', '42%').attr('cy', '38%').attr('r', '68%');
    stops.forEach(s => g.append('stop')
      .attr('offset', s[0]).attr('stop-color', s[1]).attr('stop-opacity', s[2]));
  };
  grad('water-a', [['0%', '#3f97c0', 0.34], ['55%', '#123c54', 0.42], ['100%', '#07182a', 0.30]]);
  grad('water-b', [['0%', '#2f86ad', 0.32], ['60%', '#0f3147', 0.42], ['100%', '#081e30', 0.32]]);
  // deeper / mine-fed ponds — colder, with a faint carbide warmth at the core
  grad('water-deep', [['0%', '#2a6f92', 0.30], ['40%', '#0e2c40', 0.44], ['100%', '#05101c', 0.46]]);
}

function waterFillFor(d) {
  if (/mine|coal|fiery|karst|charge/.test(d.id)) return 'url(#water-deep)';
  return d._gradParity ? 'url(#water-b)' : 'url(#water-a)';
}

// ── POND BOUNDARY FROM WORDS ──────────────────────────
// Each surfaceWord sits on the rim. The pond's silhouette is the closed
// curve through those word anchors, so dragging a word deforms the pond.
// Consecutive words are stitched end-letter → start-letter with a
// mycelial filament — the usnea-fruiting boundary the authors wanted.

function computeBoundary(d, i) {
  const words = (d.surfaceWords || []).slice(0, Math.min((d.surfaceWords || []).length, 11));
  const N = Math.max(words.length, 1);
  const seed = i * 1.618 + 0.5;
  const shape = d.shape;
  const aspectX = shape === 'elongated' ? 1.45 : shape === 'wide' ? 1.7 : shape === 'narrow' ? 0.62 : 1.0;
  const aspectY = shape === 'elongated' ? 0.7 : shape === 'wide' ? 0.6 : shape === 'narrow' ? 1.25 : 1.0;
  d._gradParity = i % 2;

  const out = [];
  for (let k = 0; k < N; k++) {
    const angle = (k / N) * Math.PI * 2 + seed * 0.3;
    const wob = 0.92
      + 0.13 * Math.sin(seed + angle * 1.8)
      + 0.06 * Math.cos(seed * 1.4 + angle * 3.1);
    const rr = d.radius * wob;
    out.push({
      w: words[k] || '',
      angle,
      ax: Math.cos(angle) * rr * aspectX,
      ay: Math.sin(angle) * rr * aspectY,
    });
  }
  return out;
}

function redrawPond(d) {
  const g = d._g;
  const B = d._boundary;

  // 1) place + measure each word, derive its first/last-letter anchors
  g.select('.boundary-words').selectAll('text').each(function (b) {
    const t = d3.select(this);
    let deg = (b.angle + Math.PI / 2) * 180 / Math.PI;   // tangent to the ring
    // keep words from reading upside-down
    let flip = 0;
    const norm = ((deg % 360) + 360) % 360;
    if (norm > 90 && norm < 270) { deg += 180; flip = Math.PI; }
    t.attr('transform', `translate(${b.ax},${b.ay}) rotate(${deg})`);

    const w = (this.getComputedTextLength && this.getComputedTextLength()) || (b.w.length * 6);
    const rot = b.angle + Math.PI / 2 + flip;
    const hw = w / 2;
    b.sx = b.ax + Math.cos(rot) * (-hw);   // start (first letter)
    b.sy = b.ay + Math.sin(rot) * (-hw);
    b.ex = b.ax + Math.cos(rot) * (hw);    // end (last letter)
    b.ey = b.ay + Math.sin(rot) * (hw);
  });

  // 2) mycelial filaments: end of word k → start of word k+1
  const fil = [];
  for (let k = 0; k < B.length; k++) {
    const a = B[k], c = B[(k + 1) % B.length];
    if (!a.w || !c.w) continue;
    const mx = (a.ex + c.sx) / 2, my = (a.ey + c.sy) / 2;
    const nl = Math.hypot(mx, my) || 1;
    const bow = 5 + ((k * 5) % 9);
    const cx = mx + (mx / nl) * bow + Math.sin(k * 1.3) * 3;
    const cy = my + (my / nl) * bow + Math.cos(k * 1.7) * 3;
    fil.push(`M${a.ex.toFixed(1)},${a.ey.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${c.sx.toFixed(1)},${c.sy.toFixed(1)}`);
  }
  g.select('.filaments').selectAll('path')
    .data(fil).join('path')
    .attr('class', 'filament')
    .attr('d', p => p);

  // tiny usnea "fruiting" tips where the letters meet
  const tips = [];
  B.forEach(b => { if (b.w) { tips.push([b.sx, b.sy]); tips.push([b.ex, b.ey]); } });
  g.select('.filaments').selectAll('circle')
    .data(tips).join('circle')
    .attr('class', 'fruiting-tip')
    .attr('cx', p => p[0].toFixed(1))
    .attr('cy', p => p[1].toFixed(1))
    .attr('r', 1.3);

  // 3) the water body — a smooth closed curve through the word anchors
  g.select('.pond-water').attr('d', closedBlob(B.map(b => [b.ax, b.ay])));
}

// smooth closed path through points (quadratic-midpoint blending)
function closedBlob(pts) {
  const n = pts.length;
  if (n < 3) {
    // degenerate: just a small circle so a sparse pond still reads
    const r = 40;
    return `M${-r},0 a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`;
  }
  let d = `M${(pts[0][0] + pts[n - 1][0]) / 2},${(pts[0][1] + pts[n - 1][1]) / 2}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    d += ` Q${p[0].toFixed(1)},${p[1].toFixed(1)} ${((p[0] + q[0]) / 2).toFixed(1)},${((p[1] + q[1]) / 2).toFixed(1)}`;
  }
  return d + ' Z';
}

// ── MUTABLE FLOW (proximity-derived threads) ──────────

function updateThreads() {
  if (!nodeData) return;
  const ns = nodeData.nodes;
  const deg = {};
  ns.forEach(n => deg[n.id] = 0);

  const pairs = [];
  for (let a = 0; a < ns.length; a++) {
    for (let b = a + 1; b < ns.length; b++) {
      const dx = ns[a].x - ns[b].x, dy = ns[a].y - ns[b].y;
      pairs.push({ a: ns[a], b: ns[b], dist: Math.hypot(dx, dy) });
    }
  }
  pairs.sort((p, q) => p.dist - q.dist);

  const edges = [];
  pairs.forEach(p => {
    const lim = p.a.radius + p.b.radius + 240;
    if (p.dist <= lim && deg[p.a.id] < 3 && deg[p.b.id] < 3) {
      edges.push(p); deg[p.a.id]++; deg[p.b.id]++;
    }
  });
  // never strand a pond: link any isolated node to its nearest neighbour
  ns.forEach(n => {
    if (deg[n.id] > 0) return;
    let best = null, bd = Infinity;
    ns.forEach(m => {
      if (m === n) return;
      const dd = Math.hypot(n.x - m.x, n.y - m.y);
      if (dd < bd) { bd = dd; best = m; }
    });
    if (best) { edges.push({ a: n, b: best, dist: bd }); deg[n.id]++; deg[best.id]++; }
  });

  const key = e => e.a.id < e.b.id ? `${e.a.id}|${e.b.id}` : `${e.b.id}|${e.a.id}`;

  threadGlowSel = threadGlowSel.data(edges, key);
  threadGlowSel.exit().transition().duration(800).style('opacity', 0).remove();
  threadGlowSel = threadGlowSel.enter().append('path')
    .attr('class', 'drainage-thread-glow').style('opacity', 0)
    .call(s => s.transition().duration(900).style('opacity', 0.3))
    .merge(threadGlowSel);

  threadSel = threadSel.data(edges, key);
  threadSel.exit().transition().duration(800).style('opacity', 0).remove();
  threadSel = threadSel.enter().append('path')
    .attr('class', 'drainage-thread').style('opacity', 0)
    .call(s => s.transition().duration(900).style('opacity', 1))
    .merge(threadSel);
}

function drawThreadGeometry() {
  if (!threadSel) return;
  threadSel.attr('d', e => drainagePath(e, threadOffset(e, 1)));
  threadGlowSel.attr('d', e => drainagePath(e, threadOffset(e, -0.5)));
}

function threadOffset(e, mult) {
  // deterministic per-pair wobble so curves don't all bow the same way
  const h = (e.a.id.length * 7 + e.b.id.length * 13) % 7;
  return ((h % 2 === 0 ? 1 : -1) * (0.06 + h * 0.015)) * mult;
}

// fluid S-curve between two pond centres
function drainagePath(e, offset) {
  const sx = e.a.x, sy = e.a.y, tx = e.b.x, ty = e.b.y;
  const dx = tx - sx, dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / len, py = dx / len;
  const o = len * offset;
  const c1x = sx + dx * 0.28 + px * o * 1.2;
  const c1y = sy + dy * 0.28 + py * o * 1.2;
  const c2x = sx + dx * 0.72 - px * o * 0.8;
  const c2y = sy + dy * 0.72 - py * o * 0.8;
  return `M${sx.toFixed(1)},${sy.toFixed(1)} C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}`;
}

// ── DRAG BEHAVIORS ────────────────────────────────────

function pondDrag(sim) {
  return d3.drag()
    .on('start', (event, d) => {
      if (!event.active) sim.alphaTarget(0.25).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on('drag', (event, d) => {
      event.sourceEvent.preventDefault();
      d.fx = event.x; d.fy = event.y;
    })
    .on('end', (event, d) => {
      if (!event.active) sim.alphaTarget(0.012);   // return to the low simmer
      d.fx = null; d.fy = null;
    });
}

// Word dragging reshapes the pond boundary; a click (no movement) dives in.
function wordDrag(d) {
  let moved = false;
  return d3.drag()
    .on('start', function (event) {
      event.sourceEvent.stopPropagation();
      moved = false;
      d3.select(this).classed('dragging', true);
    })
    .on('drag', function (event, b) {
      moved = true;
      // event.x/y are already in the pond group's local space (relative
      // to its centre), because d3.drag measures against the parent <g>.
      b.ax = event.x; b.ay = event.y;
      b.angle = Math.atan2(b.ay, b.ax);
      redrawPond(d);
    })
    .on('end', function (event) {
      event.sourceEvent.stopPropagation();
      d3.select(this).classed('dragging', false);
      if (!moved) showNode(d);   // a word is clickable too
    });
}

// ── RESIZE ────────────────────────────────────────────

window.addEventListener('resize', () => {
  if (!lakeInitialized || !simulation) return;
  const svgEl = document.getElementById('lake-svg');
  W = svgEl.clientWidth || W;
  H = svgEl.clientHeight || H;
  simulation.force('center', d3.forceCenter(W / 2, H / 2).strength(0.035));
  simulation.alpha(0.3).restart();
});
