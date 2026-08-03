// Subtle magnetic pull toward the cursor for buttons/nav links
function initMagnetic() {
  const items = document.querySelectorAll('.magnetic');

  items.forEach(el => {
    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      el.style.transform = `translate(${x * 0.25}px, ${y * 0.35}px)`;
    });

    el.addEventListener('mouseleave', () => {
      el.style.transform = '';
    });
  });
}

// Mobile nav open/close
function initNavToggle() {
  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('mainNav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    toggle.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  nav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

// Float the spaceman to a new spot and reveal each section's content at the
// same instant, on one shared observer — using separate observers with
// different thresholds made them fire at different scroll points, so the
// two motions looked sequential instead of one cohesive movement.
// `rotate` is his resting orientation once he settles on that section.
const SPACEMAN_POSITIONS = {
  home: { left: '50%', top: '45%', rotate: 0 },
  about: { left: '12%', top: '22%', rotate: -25 },
  'ci-healer': { left: '85%', top: '20%', rotate: 15 },
  'open-source': { left: '12%', top: '20%', rotate: -18 },
  projects: { left: '12%', top: '78%', rotate: 20 },
  contact: { left: '85%', top: '75%', rotate: -15 },
};

function initSectionTransitions() {
  const spaceman = document.getElementById('spaceman');
  const orient = document.getElementById('spacemanOrient');
  const sections = document.querySelectorAll('main > section[id]');
  if (!sections.length) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let spinCount = 0;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const inner = entry.target.querySelector('.section-inner');

      if (!entry.isIntersecting) {
        if (inner) inner.classList.remove('in-view');
        if (spaceman && entry.target.id === 'home') spaceman.classList.remove('draggable');
        return;
      }

      const pos = SPACEMAN_POSITIONS[entry.target.id];
      if (spaceman && pos) {
        spaceman.style.left = pos.left;
        spaceman.style.top = pos.top;
      }

      if (orient && pos) {
        // Add a full spin on top of his target angle each time he moves, so
        // the same transition duration as the move itself reads as tumbling
        // in transit before he settles facing this section's orientation.
        spinCount += 1;
        const spin = reduceMotion ? 0 : spinCount * 360;
        orient.style.transform = `rotate(${spin + pos.rotate}deg)`;
      }

      if (spaceman) spaceman.classList.toggle('draggable', entry.target.id === 'home');
      if (inner) inner.classList.add('in-view');
    });
  }, { threshold: 0.4 });

  sections.forEach(section => observer.observe(section));
}

// Let the user click-and-drag the spaceman around while the home section is
// in view (initSectionTransitions toggles the .draggable class, which is
// what actually enables pointer-events and raises his z-index above the
// page — otherwise the home section's own content sits above him and
// swallows every click before it reaches him). On release he sits for a
// moment where dropped, then spins back to his resting spot.
function initSpacemanDrag() {
  const spaceman = document.getElementById('spaceman');
  const orient = document.getElementById('spacemanOrient');
  if (!spaceman || !orient) return;

  const homePos = SPACEMAN_POSITIONS.home;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dragMargin = 40;
  const spinSpeed = 130; // degrees per second while actively held
  const coastDuration = 900; // ms to ease the spin down to a stop after release

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  let returnTimer = null;
  let returnSpins = 0;

  // The spin during a drag is driven frame-by-frame (rather than a CSS
  // animation) specifically so release can ease the speed down to zero
  // instead of cutting off instantly — a CSS animation has no way to
  // decelerate on its way out.
  let spinAngle = 0;
  let spinRafId = null;
  let spinLastTime = null;
  let coastStart = null;
  let coastFromSpeed = 0;

  function clearReturnTimer() {
    if (!returnTimer) return;
    clearTimeout(returnTimer);
    returnTimer = null;
  }

  function scheduleReturn() {
    clearReturnTimer();
    returnTimer = setTimeout(() => {
      returnSpins += 1;
      const spin = reduceMotion ? 0 : returnSpins * 360;
      spaceman.style.left = homePos.left;
      spaceman.style.top = homePos.top;
      orient.style.transform = `rotate(${spin + homePos.rotate}deg)`;
      returnTimer = null;
    }, 600);
  }

  function spinTick(time) {
    if (spinLastTime === null) spinLastTime = time;
    const dt = (time - spinLastTime) / 1000;
    spinLastTime = time;

    let speed;
    if (dragging) {
      speed = spinSpeed;
    } else {
      if (coastStart === null) {
        coastStart = time;
        coastFromSpeed = spinSpeed;
      }
      const t = Math.min((time - coastStart) / coastDuration, 1);
      speed = coastFromSpeed * (1 - Math.pow(1 - t, 3)); // ease-out cubic

      if (t >= 1) {
        spinRafId = null;
        spinLastTime = null;
        coastStart = null;
        spaceman.classList.remove('spinning');
        scheduleReturn();
        return;
      }
    }

    spinAngle += speed * dt;
    orient.style.transform = `rotate(${spinAngle}deg)`;
    spinRafId = requestAnimationFrame(spinTick);
  }

  function startSpin() {
    if (reduceMotion || spinRafId) return;
    spaceman.classList.add('spinning');
    spinLastTime = null;
    coastStart = null;
    spinRafId = requestAnimationFrame(spinTick);
  }

  spaceman.addEventListener('pointerdown', e => {
    if (!spaceman.classList.contains('draggable')) return;

    dragging = true;
    clearReturnTimer();
    spaceman.classList.add('dragging');
    startSpin();

    const rect = spaceman.getBoundingClientRect();
    offsetX = e.clientX - (rect.left + rect.width / 2);
    offsetY = e.clientY - (rect.top + rect.height / 2);

    try {
      spaceman.setPointerCapture(e.pointerId);
    } catch (err) {
      // Capture is a nice-to-have for tracking outside the element's
      // bounds; if it's unavailable for some reason, dragging still works
      // as long as the cursor stays over the moving element.
    }
  });

  spaceman.addEventListener('pointermove', e => {
    if (!dragging) return;

    const x = Math.min(Math.max(e.clientX - offsetX, dragMargin), window.innerWidth - dragMargin);
    const y = Math.min(Math.max(e.clientY - offsetY, dragMargin), window.innerHeight - dragMargin);
    spaceman.style.left = `${x}px`;
    spaceman.style.top = `${y}px`;
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    spaceman.classList.remove('dragging');
    if (spaceman.hasPointerCapture(e.pointerId)) {
      spaceman.releasePointerCapture(e.pointerId);
    }
    // If reduced motion skipped the spin loop entirely, go straight to the
    // return; otherwise the coasting phase inside spinTick will call
    // scheduleReturn() itself once it eases to a stop.
    if (!spinRafId) scheduleReturn();
  }

  spaceman.addEventListener('pointerup', endDrag);
  spaceman.addEventListener('pointercancel', endDrag);
}

// Draw a tether line from the fixed top-center anchor down to the spaceman
// every frame, so it follows him as he glides between sections and bobs in
// place, with a gentle sway to read as a slack spacewalk cable rather than
// a rigid rod.
function initTether() {
  const anchor = document.querySelector('.tether-anchor');
  const box = document.querySelector('.spaceman-box');
  const path = document.getElementById('tetherPath');
  if (!anchor || !box || !path) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function update(time) {
    const anchorRect = anchor.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();

    const x1 = anchorRect.left + anchorRect.width / 2;
    const y1 = anchorRect.top + anchorRect.height / 2;
    const x2 = boxRect.left + boxRect.width / 2;
    const y2 = boxRect.top + boxRect.height / 2;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const perpX = -dy / length;
    const perpY = dx / length;

    // Walk along the line in several segments. Each interior point's
    // perpendicular offset combines three independent functions — a slow
    // primary sway, a faster secondary ripple running at its own speed and
    // direction, and a position-based sag that peaks at the middle of the
    // rope — so no single repeating pattern is visible along its length.
    const segments = 5;
    const points = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      let px = x1 + dx * t;
      let py = y1 + dy * t;

      if (!reduceMotion && i !== 0 && i !== segments) {
        const primary = Math.sin(t * Math.PI * 2 * 1.4 + time / 900) * 22;
        const ripple = Math.sin(t * Math.PI * 2 * 2.7 - time / 550 + 1.3) * 13;
        const sag = Math.sin(t * Math.PI) * 16;
        const offset = primary + ripple + sag;
        px += perpX * offset;
        py += perpY * offset;
      }

      points.push([px, py]);
    }

    // Smooth curve through the points: quadratic segments that curve toward
    // each interior point and meet at the midpoints between them.
    let d = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length - 1; i++) {
      const [cx, cy] = points[i];
      const [nx, ny] = points[i + 1];
      d += ` Q ${cx} ${cy} ${(cx + nx) / 2} ${(cy + ny) / 2}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last[0]} ${last[1]}`;

    path.setAttribute('d', d);

    requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

// Animated pipeline diagram for the CI Healer section
function initPipeline() {
  const section = document.getElementById('ci-healer');
  if (!section) return;

  const nodes = Array.from(section.querySelectorAll('.pipeline-node'));
  const dots = Array.from(section.querySelectorAll('.pipeline-dot'));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion) {
    nodes.forEach(n => n.classList.add('pn-active'));
    return;
  }

  // When each node lights up (ms into cycle). The 1500ms pause at FAILED
  // gives recruiters a moment to register "oh, it broke" before the fix fires.
  const NODE_TIMES = [0, 1000, 2000, 3500, 4500, 5500];
  // Duration each traveling dot takes to cross its connector
  const DOT_DURATIONS = [950, 950, 1400, 950, 950];
  const CYCLE = 9500;
  let timers = [];

  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  function animateDot(dot, duration) {
    if (!dot) return;
    const width = dot.parentElement.offsetWidth;
    dot.style.transition = 'none';
    dot.style.left = '0px';
    dot.style.opacity = '1';
    dot.getBoundingClientRect(); // force reflow so next transition fires
    dot.style.transition = `left ${duration}ms linear`;
    dot.style.left = `${width}px`;
    // Fade out first, then snap position — avoids the visible teleport that
    // occurs when left resets while the dot is still partially visible.
    const fadeTimer = setTimeout(() => {
      dot.style.transition = 'opacity 0.15s';
      dot.style.opacity = '0';
      const resetTimer = setTimeout(() => {
        dot.style.transition = 'none';
        dot.style.left = '0px';
      }, 160);
      timers.push(resetTimer);
    }, duration - 60);
    timers.push(fadeTimer);
  }

  function runCycle() {
    clearTimers();
    nodes.forEach(n => n.classList.remove('pn-active'));
    dots.forEach(d => { d.style.transition = 'none'; d.style.left = '0px'; d.style.opacity = '0'; });

    NODE_TIMES.forEach((t, i) => {
      const timer = setTimeout(() => {
        nodes[i]?.classList.add('pn-active');
        if (i < dots.length) animateDot(dots[i], DOT_DURATIONS[i]);
      }, t);
      timers.push(timer);
    });

    const dimTimer = setTimeout(() => nodes.forEach(n => n.classList.remove('pn-active')), 7800);
    timers.push(dimTimer);
  }

  // Only animate once the section scrolls into view — avoids wasting cycles
  const pipelineObserver = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    runCycle();
    setInterval(runCycle, CYCLE);
    pipelineObserver.disconnect();
  }, { threshold: 0.25 });
  pipelineObserver.observe(section);
}

// Fetch the most recent AI suggestion comment from the CI repo and display it
async function loadLastHeal() {
  const meta = document.getElementById('healMeta');
  const body = document.getElementById('healBody');
  if (!meta || !body) return;

  try {
    const res = await fetch(
      'https://api.github.com/repos/benstev1/SH-CI-Pipeline/issues/comments?per_page=100&sort=created&direction=desc',
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const comments = await res.json();

    const suggestion = comments.find(c => c.body && c.body.includes('AI Suggestion'));
    if (!suggestion) {
      meta.textContent = 'no heals yet';
      body.innerHTML = '<span class="heal-error">No heals recorded yet — trigger a CI failure and run /heal.</span>';
      return;
    }

    const prMatch = suggestion.html_url.match(/pull\/(\d+)/);
    meta.textContent = (prMatch ? `PR #${prMatch[1]} · ` : '') + timeAgo(new Date(suggestion.created_at));

    const diffMatch = suggestion.body.match(/```diff\n([\s\S]*?)```/);
    if (diffMatch) {
      const lines = diffMatch[1].trim().split('\n');
      const html = lines.map(line => {
        let cls = 'heal-diff-line--ctx';
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) cls = 'heal-diff-line--meta';
        else if (line.startsWith('+')) cls = 'heal-diff-line--add';
        else if (line.startsWith('-')) cls = 'heal-diff-line--del';
        return `<span class="heal-diff-line ${cls}">${escapeHtml(line)}</span>`;
      }).join('\n');
      body.innerHTML = `
        <div class="heal-diff">${html}</div>
        <div class="heal-footer">
          <span class="heal-footer-pass">✓</span>
          <span>ci: apply AI-suggested fix [skip ci]</span>
        </div>`;
    } else {
      body.innerHTML = `<span class="heal-error">Suggestion posted (no diff block found).</span>`;
    }
  } catch (_err) {
    meta.textContent = 'github offline';
    body.innerHTML = '<span class="heal-error">Could not reach GitHub API.</span>';
  }
}

function timeAgo(date) {
  const s = (Date.now() - date.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('loaded');
  initMagnetic();
  initNavToggle();
  initSectionTransitions();
  initSpacemanDrag();
  initTether();
  initPipeline();
  loadLastHeal();
});
