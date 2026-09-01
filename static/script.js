(() => {
  'use strict';

  /* =====================================================
     1. Emotion palette — the whole UI re-tints to the
        emotion the model predicts.
     ===================================================== */
  const EMOTIONS = {
    sadness:  { emoji: '😢', color: '#6aa5f8', deep: '#2b4bd4' },
    joy:      { emoji: '😄', color: '#ffc94d', deep: '#b45309' },
    love:     { emoji: '❤️', color: '#fb7185', deep: '#be123c' },
    anger:    { emoji: '😠', color: '#ff7a59', deep: '#b91c1c' },
    fear:     { emoji: '😨', color: '#a78bfa', deep: '#6d28d9' },
    surprise: { emoji: '😲', color: '#4fd8e8', deep: '#0e7490' },
  };

  const NEUTRAL = { emoji: '🙂', color: '#8b9dff', deep: '#3237ab' };
  const MAX_LEN = 2000; // keep in sync with the pydantic field
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =====================================================
     2. Network layer — talks to the FastAPI backend.
        (This block is swapped for a mock in the offline
         demo build of this page.)
     ===================================================== */
  /* [API:BEGIN] */
  const API = {
    async health() {
      const res = await fetch('/health', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },

    async predict(text) {
      const res = await fetch('/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        let detail = `The server responded with ${res.status}`;
        try {
          const body = await res.json();
          if (body && body.detail) detail = String(body.detail);
        } catch (_) { /* body wasn't json — keep default detail */ }
        throw new Error(detail);
      }
      return res.json();
    },
  };
  /* [API:END] */

  /* =====================================================
     3. DOM references
     ===================================================== */
  const $ = (id) => document.getElementById(id);
  const els = {
    status: $('status'),
    statusText: $('statusText'),
    form: $('composer'),
    input: $('input'),
    count: $('count'),
    btn: $('analyzeBtn'),
    btnIdle: $('btnIdle'),
    btnBusy: $('btnBusy'),
    error: $('error'),
    errorMsg: $('errorMsg'),
    retry: $('retryBtn'),
    result: $('result'),
    resEmoji: $('resEmoji'),
    resEmotion: $('resEmotion'),
    resConf: $('resConf'),
    resQuote: $('resQuote'),
    resMs: $('resMs'),
    bars: $('bars'),
    kbdMod: $('kbdMod'),
    bg: document.querySelector('.bg'),
  };

  let busy = false;
  let lastText = '';

  /* =====================================================
     4. Small helpers
     ===================================================== */
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  function countUp(el, target, duration = 1000, decimals = 1) {
    if (REDUCED_MOTION || !Number.isFinite(target)) {
      el.textContent = target.toFixed(decimals);
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      el.textContent = (target * eased).toFixed(decimals);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function setTheme(emotion) {
    const m = EMOTIONS[emotion] || NEUTRAL;
    const s = document.documentElement.style;
    s.setProperty('--accent', m.color);
    s.setProperty('--glow-1', m.deep);
    s.setProperty('--glow-2', m.color);
  }

  function updateCount() {
    const n = els.input.value.length;
    els.count.textContent = `${n} / ${MAX_LEN}`;
    els.count.classList.toggle('warn', n >= MAX_LEN * 0.9 && n < MAX_LEN);
    els.count.classList.toggle('over', n >= MAX_LEN);
  }

  function nudge() {
    els.form.classList.remove('shake');
    void els.form.offsetWidth; // restart the animation
    els.form.classList.add('shake');
    els.input.focus();
  }

  function setLoading(loading) {
    busy = loading;
    els.btn.disabled = loading;
    els.btn.setAttribute('aria-busy', String(loading));
    els.btnIdle.hidden = loading;
    els.btnBusy.hidden = !loading;
    els.form.classList.toggle('is-scanning', loading);
    document.querySelectorAll('.chip').forEach((c) => { c.disabled = loading; });
  }

  function showError(msg) {
    els.errorMsg.textContent = msg;
    els.error.hidden = false;
  }

  function hideError() { els.error.hidden = true; }

  function hideResult() {
    els.result.hidden = true;
    els.result.classList.remove('shown');
  }

  /* =====================================================
     5. Render the prediction
     ===================================================== */
  function render(data, fallbackText, elapsedMs) {
    const probsRaw = (data && (data.all_probabilites || data.all_probabilities)) || {};
    const probs = {};
    for (const [k, v] of Object.entries(probsRaw)) {
      if (typeof v === 'number' && Number.isFinite(v)) probs[k] = v;
    }
    for (const k of Object.keys(EMOTIONS)) if (!(k in probs)) probs[k] = 0;

    let emotion = data && data.predicted_emotion;
    if (!EMOTIONS[emotion]) {
      emotion = Object.keys(probs).sort((a, b) => probs[b] - probs[a])[0] || 'joy';
    }
    const meta = EMOTIONS[emotion] || NEUTRAL;
    const confidence =
      data && typeof data.confidence === 'number' ? data.confidence : (probs[emotion] || 0);

    setTheme(emotion);

    /* --- headline --- */
    els.resEmoji.textContent = meta.emoji;
    els.resEmotion.textContent = emotion;
    els.resQuote.textContent = `“${(data && data.text) || fallbackText}”`;
    els.resMs.textContent = String(Math.max(1, Math.round(elapsedMs)));

    /* --- probability bars, strongest first --- */
    const entries = Object.keys(EMOTIONS)
      .map((k) => [k, probs[k] || 0])
      .sort((a, b) => b[1] - a[1]);

    els.bars.replaceChildren();
    entries.forEach(([label, p], i) => {
      const m = EMOTIONS[label] || NEUTRAL;
      const pct = Math.min(100, Math.max(0, p * 100));
      const delay = 0.42 + i * 0.07;

      const row = document.createElement('div');
      row.className = 'bar-row r-anim' + (label === emotion ? ' top' : '');
      row.style.setProperty('--d', `${delay.toFixed(2)}s`);
      row.style.setProperty('--c', m.color);
      row.style.setProperty('--p', `${pct}%`);
      row.innerHTML =
        `<span class="bar-emoji">${m.emoji}</span>` +
        `<span class="bar-label">${escapeHtml(label)}</span>` +
        `<div class="bar-track"><div class="bar-fill"></div></div>`;

      const pctEl = document.createElement('span');
      pctEl.className = 'bar-pct';
      pctEl.dataset.target = pct.toFixed(1);
      pctEl.textContent = '0.0%';
      row.appendChild(pctEl);

      els.bars.appendChild(row);
    });

    /* --- reveal --- */
    hideError();
    els.result.hidden = false;
    els.result.classList.remove('shown');
    void els.result.offsetWidth; // restart entrance animations
    els.result.classList.add('shown');

    /* --- number count-ups, synced with the bar delays --- */
    countUp(els.resConf, Math.min(100, confidence * 100), 1200);
    els.bars.querySelectorAll('.bar-pct').forEach((el, i) => {
      const target = parseFloat(el.dataset.target) || 0;
      const delay = REDUCED_MOTION ? 0 : (0.42 + i * 0.07) * 1000;
      window.setTimeout(() => countUp(el, target, 850, 1), delay);
    });

    /* --- bring into view if it landed below the fold --- */
    window.setTimeout(() => {
      const rect = els.result.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        els.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 80);
  }

  /* =====================================================
     6. Analyze
     ===================================================== */
  async function run(raw) {
    if (busy) return;
    const text = String(raw || '').trim();
    lastText = text;
    if (!text || text.length > MAX_LEN) { nudge(); return; }

    setLoading(true);
    hideError();
    const t0 = performance.now();
    try {
      const data = await API.predict(text);
      render(data, text, performance.now() - t0);
    } catch (err) {
      hideResult();
      const msg = err && err.name === 'TypeError'
        ? 'Could not reach the server — is the FastAPI backend running?'
        : (err && err.message) || 'Something went wrong while analyzing.';
      showError(msg);
    } finally {
      setLoading(false);
    }
  }

  /* =====================================================
     7. Health pill
     ===================================================== */
  async function pollHealth() {
    const set = (text, cls) => {
      els.status.className = 'status' + (cls ? ` ${cls}` : '');
      els.statusText.textContent = text;
    };
    try {
      const h = await API.health();
      if (h && h.model_loaded) set('Model online', 'online');
      else set('Model loading', 'warn');
    } catch (_) {
      set('Server offline', 'offline');
    }
  }

  /* =====================================================
     8. Wiring
     ===================================================== */
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    run(els.input.value);
  });

  els.input.addEventListener('input', updateCount);

  els.input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (busy) return;
      els.input.value = chip.dataset.text || chip.textContent.trim();
      updateCount();
      els.form.requestSubmit();
    });
  });

  els.retry.addEventListener('click', () => {
    if (lastText) { els.input.value = lastText; updateCount(); }
    els.form.requestSubmit();
  });

  /* platform-correct shortcut hint */
  const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  els.kbdMod.textContent = isApple ? '⌘' : 'Ctrl';

  /* gentle background parallax (desktop pointers only) */
  if (!REDUCED_MOTION && els.bg && window.matchMedia('(pointer: fine)').matches) {
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = null;
    const tick = () => {
      cx += (tx - cx) * 0.055;
      cy += (ty - cy) * 0.055;
      els.bg.style.transform = `translate3d(${(cx * 22).toFixed(2)}px, ${(cy * 16).toFixed(2)}px, 0)`;
      raf = (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001)
        ? requestAnimationFrame(tick)
        : null;
    };
    window.addEventListener('pointermove', (e) => {
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
  }

  updateCount();
  pollHealth();
})();
