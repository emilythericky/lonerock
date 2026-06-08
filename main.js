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
      d.category = d.category || 'pond';
      d._rust = (d.id === 'mine-g' || d.id === 'coal-fly-ash');
      if (d.category === 'creek') d._creekWords = (d.surfaceWords || []).slice(0, 8);
      else d._boundary = computeBoundary(d, i);   // ponds/pools/mine: word-ring shore
    });

    // ── SIMULATION ─────────────────────────────────
    // No link force: the watershed is no longer a fixed graph. Ponds
    // repel, collide, drift, and the *flow* between them is re-derived
    // from proximity every few ticks (updateThreads). Drag a pond and it
    // reconnects, rather than towing its old arcs across the others.
    simulation = d3.forceSimulation(data.nodes)
      // creeks repel and occupy little — they nestle between the ponds
      .force('charge', d3.forceManyBody().strength(d => d.category === 'creek' ? -240 : -680))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.035))
      .force('collision', d3.forceCollide(d => d.category === 'creek' ? 28 : d.radius * 1.18 + 46))
      .force('bounds', () => {
        data.nodes.forEach(d => {
          const pad = d.category === 'creek' ? 40 : d.radius * 1.18 + 50;
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

    const nodeSel = nodeGroup.selectAll('.pond-body')
      .data(data.nodes).join('g')
      .attr('class', d => 'pond-body'
        + (d.category === 'creek' ? ' creek-body' : '')
        + (d._rust ? ' rust' : ''))
      .on('click', (event, d) => {
        if (event.defaultPrevented) return;   // a drag happened
        event.stopPropagation();               // don't let svg-bg close it
        showNode(d);
      })
      .call(pondDrag(simulation));

    nodeSel.each(function (d, i) {
      const g = d3.select(this);
      d._g = g;

      if (d.category === 'creek') { buildCreek(g, d); return; }

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
      g.append('g').attr('class', 'boundary-words')
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

      redrawPond(d);
    });

    // ── INTERACTION: empty water closes the panel ──
    svg.on('click', () => closeGeology());

    // ── TICK ───────────────────────────────────────
    simulation.on('tick', () => {
      simTime++;
      nodeSel.each(function (d) {
        if (d.category === 'creek') redrawCreek(d);          // absolute ribbon
        else this.setAttribute('transform', `translate(${d.x},${d.y})`);
      });
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
  // murky pond water — green sludge over silt, more stops so it reads
  // organic rather than a clean two-colour ramp
  grad('water-a', [['0%', '#4f9e72', 0.32], ['34%', '#2e7256', 0.36], ['62%', '#163f30', 0.44], ['100%', '#0a1d14', 0.32]]);
  grad('water-b', [['0%', '#43936a', 0.30], ['30%', '#266048', 0.36], ['66%', '#143829', 0.44], ['100%', '#0b241a', 0.34]]);
  // deeper / mine-fed ponds — siltier, a warmer sediment tone in the deep
  grad('water-deep', [['0%', '#357a5c', 0.30], ['36%', '#16402e', 0.44], ['70%', '#22281a', 0.44], ['100%', '#070f0a', 0.46]]);
  // rusty, iron-stained water — the mine and the slurry spill
  grad('water-rust', [['0%', '#a85f37', 0.34], ['42%', '#5e3017', 0.46], ['100%', '#1d0d06', 0.44]]);
}

function waterFillFor(d) {
  if (d._rust) return 'url(#water-rust)';            // mine-g + slurry spill
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
  const cat = d.category;
  d._gradParity = i % 2;

  // shape per category: ponds = elongated valley lakes with lobes/fingers;
  // pools = small, gently irregular; mine = compact, squarish entrance.
  let aspectX, aspectY, rot;
  if (cat === 'pond') { aspectX = 0.74; aspectY = 1.48; rot = seed; }
  else if (cat === 'mine') { aspectX = 0.96; aspectY = 1.08; rot = 0; }
  else { aspectX = 1.0; aspectY = 0.96; rot = seed * 0.5; }   // pool
  const ca = Math.cos(rot), sa = Math.sin(rot);

  const out = [];
  for (let k = 0; k < N; k++) {
    const angle = (k / N) * Math.PI * 2 + seed * 0.3;
    let wob;
    if (cat === 'pond') {
      wob = 0.85
        + 0.22 * Math.sin(seed + angle)              // big lobe
        + 0.11 * Math.sin(seed * 1.7 + angle * 2.0)  // finger
        + 0.06 * Math.cos(angle * 3.0 + seed);       // shore ripple
    } else if (cat === 'mine') {
      wob = 0.9 + 0.06 * Math.sin(seed + angle * 2.0) + 0.04 * Math.cos(angle * 3.0);
    } else {
      wob = 0.9 + 0.12 * Math.sin(seed + angle * 1.8) + 0.06 * Math.cos(seed * 1.4 + angle * 3.1);
    }
    const rr = d.radius * wob;
    const ex = Math.cos(angle) * rr * aspectX;
    const ey = Math.sin(angle) * rr * aspectY;
    const ax = ex * ca - ey * sa;                    // rotate the silhouette
    const ay = ex * sa + ey * ca;
    out.push({ w: words[k] || '', angle: Math.atan2(ay, ax), ax, ay });
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

// ── CREEKS (flowing channels between the two nearest ponds) ───
// A creek grabs the two nearest pond/pool nodes *at the moment* and flows
// between them as a sinuous channel that bows through the creek's own
// (draggable) position. Words drift along the current. Still clickable.

function buildCreek(g, d) {
  g.append('path').attr('class', 'creek-channel');
  g.append('path').attr('class', 'creek-current');
  g.append('g').attr('class', 'creek-words')
    .selectAll('text').data(d._creekWords).join('text')
    .attr('class', 'boundary-word creek-word').text(w => w);
  g.append('text').attr('class', 'pond-label');
  g.append('text').attr('class', 'pond-sublabel');
  redrawCreek(d);
}

function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

function anchorTwoNearest(d) {
  const cands = nodeData.nodes
    .filter(n => n.category === 'pond' || n.category === 'pool')
    .sort((a, b) => dist2(a, d) - dist2(b, d));
  return [cands[0], cands[1]];
}

function quadAt(ax, ay, px, py, bx, by, t) {
  const u = 1 - t;
  return { x: u * u * ax + 2 * u * t * px + t * t * bx, y: u * u * ay + 2 * u * t * py + t * t * by };
}
function quadTangent(ax, ay, px, py, bx, by, t) {
  const u = 1 - t;
  return { x: 2 * u * (px - ax) + 2 * t * (bx - px), y: 2 * u * (py - ay) + 2 * t * (by - py) };
}

function redrawCreek(d) {
  const g = d._g;
  const [a, b] = anchorTwoNearest(d);
  if (!a || !b) return;

  // quadratic control so the channel bows through the creek's own position
  const px = 2 * d.x - (a.x + b.x) / 2;
  const py = 2 * d.y - (a.y + b.y) / 2;
  const path = `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${px.toFixed(1)},${py.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  g.select('.creek-channel').attr('d', path);
  g.select('.creek-current').attr('d', path);

  // rust bleeds in when the channel meets the mine or the slurry spill
  g.classed('rust', !!(a._rust || b._rust || d._rust));

  // words flow along the current, tangent to the curve
  const words = g.select('.creek-words').selectAll('text');
  const n = words.size();
  words.each(function (w, i) {
    const t = 0.2 + 0.6 * (n > 1 ? i / (n - 1) : 0.5);
    const pt = quadAt(a.x, a.y, px, py, b.x, b.y, t);
    const tan = quadTangent(a.x, a.y, px, py, b.x, b.y, t);
    let deg = Math.atan2(tan.y, tan.x) * 180 / Math.PI;
    const norm = ((deg % 360) + 360) % 360;
    if (norm > 90 && norm < 270) deg += 180;       // keep words upright
    this.setAttribute('transform', `translate(${pt.x.toFixed(1)},${(pt.y - 9).toFixed(1)}) rotate(${deg.toFixed(1)})`);
  });

  // label rides at the creek's own position
  g.select('.pond-label').attr('x', d.x.toFixed(1)).attr('y', (d.y + 16).toFixed(1)).text(d.title);
  g.select('.pond-sublabel').attr('x', d.x.toFixed(1)).attr('y', (d.y + 30).toFixed(1)).text(d.subtitle);
}

// ── MUTABLE FLOW (proximity-derived threads) ──────────

function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

function updateThreads() {
  if (!nodeData) return;
  const ns = nodeData.nodes;
  // only ponds + pools take part in the general drainage; creeks ARE
  // channels, and the mine stands apart (its one link is forced below).
  const flow = ns.filter(n => n.category === 'pond' || n.category === 'pool');
  const deg = {};
  flow.forEach(n => deg[n.id] = 0);

  // pairs a creek currently occupies — don't also draw a thread there
  const creekPairs = new Set();
  ns.filter(n => n.category === 'creek').forEach(c => {
    const [a, b] = anchorTwoNearest(c);
    if (a && b) creekPairs.add(pairKey(a.id, b.id));
  });

  const pairs = [];
  for (let i = 0; i < flow.length; i++)
    for (let j = i + 1; j < flow.length; j++)
      pairs.push({ a: flow[i], b: flow[j], dist: Math.hypot(flow[i].x - flow[j].x, flow[i].y - flow[j].y) });
  pairs.sort((p, q) => p.dist - q.dist);

  const edges = [];
  pairs.forEach(p => {
    if (creekPairs.has(pairKey(p.a.id, p.b.id))) return;   // the creek is the channel here
    const lim = p.a.radius + p.b.radius + 240;
    if (p.dist <= lim && deg[p.a.id] < 3 && deg[p.b.id] < 3) {
      edges.push(p); deg[p.a.id]++; deg[p.b.id]++;
    }
  });
  // never strand a pool
  flow.forEach(n => {
    if (deg[n.id] > 0) return;
    let best = null, bd = Infinity;
    flow.forEach(m => { if (m === n) return; const dd = dist2(n, m); if (dd < bd) { bd = dd; best = m; } });
    if (best) { edges.push({ a: n, b: best, dist: Math.sqrt(bd) }); deg[n.id]++; deg[best.id]++; }
  });

  // the mine's one fixed, rusty channel to the slurry spill
  const mine = ns.find(n => n.id === 'mine-g');
  const spill = ns.find(n => n.id === 'coal-fly-ash');
  if (mine && spill) edges.push({ a: mine, b: spill, dist: Math.hypot(mine.x - spill.x, mine.y - spill.y) });

  // rust bleeds into any thread touching the mine or the spill
  edges.forEach(e => { e.rust = !!(e.a._rust || e.b._rust); });

  const key = e => pairKey(e.a.id, e.b.id);

  threadGlowSel = threadGlowSel.data(edges, key);
  threadGlowSel.exit().transition().duration(800).style('opacity', 0).remove();
  threadGlowSel = threadGlowSel.enter().append('path')
    .attr('class', 'drainage-thread-glow').style('opacity', 0)
    .call(s => s.transition().duration(900).style('opacity', 0.3))
    .merge(threadGlowSel)
    .classed('rust', e => !!e.rust);

  threadSel = threadSel.data(edges, key);
  threadSel.exit().transition().duration(800).style('opacity', 0).remove();
  threadSel = threadSel.enter().append('path')
    .attr('class', 'drainage-thread').style('opacity', 0)
    .call(s => s.transition().duration(900).style('opacity', 1))
    .merge(threadSel)
    .classed('rust', e => !!e.rust);
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
