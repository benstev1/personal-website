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

      if (inner) inner.classList.add('in-view');
    });
  }, { threshold: 0.4 });

  sections.forEach(section => observer.observe(section));
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

// Load and render projects from data/projects.json
async function loadProjects() {
  const grid = document.getElementById('projectsGrid');
  if (!grid) return;

  try {
    const res = await fetch('data/projects.json');
    const projects = await res.json();

    grid.innerHTML = projects.map(p => `
      <div class="project-card">
        <div class="project-header">
          <span class="project-name">${p.name}</span>
          <div class="project-links">
            ${p.github ? `<a href="${p.github}" target="_blank" rel="noopener">GitHub ↗</a>` : ''}
            ${p.live ? `<a href="${p.live}" target="_blank" rel="noopener">Live ↗</a>` : ''}
          </div>
        </div>
        <p class="project-desc">${p.description}</p>
        <div class="project-tags">
          ${p.tags.map(t => `<span class="tag">${t}</span>`).join('')}
        </div>
      </div>
    `).join('');
  } catch (err) {
    grid.innerHTML = '<p class="section-body">Could not load projects.</p>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('loaded');
  initMagnetic();
  initNavToggle();
  initSectionTransitions();
  initTether();
  loadProjects();
});
