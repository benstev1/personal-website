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

// Reveal each section's content the first time it scrolls into view
function initSectionReveal() {
  const sections = document.querySelectorAll('main > section[id]');
  if (!sections.length) return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const inner = entry.target.querySelector('.section-inner');
      if (inner) inner.classList.add('in-view');
    });
  }, { threshold: 0.3 });

  sections.forEach(section => observer.observe(section));
}

// Continuously blend + parallax-shift the fixed background layers based on
// scroll position, so adjacent photos dissolve into one another and drift
// with the page top-to-bottom instead of snapping at a fixed scroll point.
function initScrollBackgrounds() {
  const sections = document.querySelectorAll('main > section[id]');
  const bgLayers = {};
  document.querySelectorAll('.bg-layer').forEach(layer => {
    bgLayers[layer.dataset.bg] = layer;
  });
  if (!sections.length) return;

  let ticking = false;

  function update() {
    const viewportHeight = window.innerHeight;
    const maxShift = viewportHeight * 0.08;

    sections.forEach(section => {
      const layer = bgLayers[section.id];
      if (!layer) return;

      const rect = section.getBoundingClientRect();

      // Fade: how much of this section is currently on screen
      const visibleTop = Math.max(rect.top, 0);
      const visibleBottom = Math.min(rect.bottom, viewportHeight);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      const ratio = visibleHeight / Math.min(rect.height, viewportHeight);

      // Parallax: how far the section's center is from the viewport's
      // center, so the layer keeps drifting in the scroll direction while
      // it's fading in/out rather than sitting still
      const sectionCenter = rect.top + rect.height / 2;
      const viewportCenter = viewportHeight / 2;
      const progress = Math.max(-1, Math.min(1, (sectionCenter - viewportCenter) / viewportHeight));

      layer.style.opacity = ratio;
      layer.style.transform = `translateY(${(-progress * maxShift).toFixed(1)}px)`;
    });

    ticking = false;
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
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
  initSectionReveal();
  initScrollBackgrounds();
  loadProjects();
});
