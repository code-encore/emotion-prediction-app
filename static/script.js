/* ========================================
   Configuration & State
======================================== */
const EMOTION_META = {
    sadness:  { emoji: '😢', color: '#5b8fb9', glow: 'rgba(91,143,185,0.25)' },
    joy:      { emoji: '😄', color: '#e8a849', glow: 'rgba(232,168,73,0.25)' },
    love:     { emoji: '❤️', color: '#d45d6e', glow: 'rgba(212,93,110,0.25)' },
    anger:    { emoji: '😠', color: '#c94432', glow: 'rgba(201,68,50,0.25)' },
    fear:     { emoji: '😨', color: '#8b7ec8', glow: 'rgba(139,126,200,0.25)' },
    surprise: { emoji: '😲', color: '#4ecdc4', glow: 'rgba(78,205,196,0.25)' }
};

const emotionOrder = ['sadness', 'joy', 'love', 'anger', 'fear', 'surprise'];

let isPredicting = false;

/* ========================================
   DOM References
======================================== */
const textInput = document.getElementById('text-input');
const charCount = document.getElementById('char-count');
const predictBtn = document.getElementById('predict-btn');
const resultSection = document.getElementById('result-section');
const emotionOrb = document.getElementById('emotion-orb');
const emotionName = document.getElementById('emotion-name');
const emotionConfidence = document.getElementById('emotion-confidence');
const analyzedText = document.getElementById('analyzed-text');
const emotionDisplay = document.getElementById('emotion-display');
const probBarsContainer = document.getElementById('prob-bars');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toast-msg');
const glow1 = document.getElementById('glow1');
const glow2 = document.getElementById('glow2');

/* ========================================
   Background Particles
======================================== */
(function initParticles() {
    const canvas = document.getElementById('bg-canvas');
    const ctx = canvas.getContext('2d');
    let particles = [];
    const PARTICLE_COUNT = 40;
    let w, h;
    let animId;

    function resize() {
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
            x: Math.random() * w,
            y: Math.random() * h,
            r: Math.random() * 1.5 + 0.5,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.5) * 0.3,
            alpha: Math.random() * 0.4 + 0.1
        });
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);

        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0) p.x = w;
            if (p.x > w) p.x = 0;
            if (p.y < 0) p.y = h;
            if (p.y > h) p.y = 0;

            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(0.1, p.r), 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(232,168,73,' + p.alpha + ')';
            ctx.fill();
        }

        // Faint connection lines between nearby particles
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 150) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    const lineAlpha = 0.04 * (1 - dist / 150);
                    ctx.strokeStyle = 'rgba(232,168,73,' + lineAlpha + ')';
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }

        animId = requestAnimationFrame(draw);
    }
    draw();

    // Respect reduced motion preference
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) {
        cancelAnimationFrame(animId);
        ctx.clearRect(0, 0, w, h);
    }
    mq.addEventListener('change', function(e) {
        if (e.matches) {
            cancelAnimationFrame(animId);
            ctx.clearRect(0, 0, w, h);
        } else {
            draw();
        }
    });
})();

/* ========================================
   Health Check
======================================== */
async function checkHealth() {
    try {
        const res = await fetch('/health');
        const data = await res.json();
        if (data.model_loaded) {
            statusDot.classList.add('active');
            statusText.textContent = 'Model ready';
        } else {
            statusDot.classList.remove('active');
            statusText.textContent = 'Model loading...';
            setTimeout(checkHealth, 3000);
        }
    } catch (e) {
        statusDot.classList.remove('active');
        statusText.textContent = 'Offline';
        setTimeout(checkHealth, 5000);
    }
}
checkHealth();

/* ========================================
   Text Input Handling
======================================== */
textInput.addEventListener('input', function() {
    const len = textInput.value.length;
    charCount.textContent = len + ' / 2000';
    charCount.classList.toggle('warn', len > 1800);
    predictBtn.disabled = len === 0 || isPredicting;
});

// Sample hint chips
document.querySelectorAll('.hint-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
        textInput.value = chip.dataset.text;
        textInput.dispatchEvent(new Event('input'));
        textInput.focus();
    });
});

// Ctrl/Cmd + Enter shortcut to predict
textInput.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !predictBtn.disabled) {
        predictBtn.click();
    }
});

/* ========================================
   Toast Notifications
======================================== */
let toastTimer = null;

function showToast(msg) {
    toastMsg.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() {
        toast.classList.remove('show');
    }, 4000);
}

/* ========================================
   Build Probability Bars (once on load)
======================================== */
emotionOrder.forEach(function(emotion) {
    const meta = EMOTION_META[emotion];
    const row = document.createElement('div');
    row.className = 'prob-row';
    row.innerHTML =
        '<div class="prob-label">' +
            '<span class="emoji">' + meta.emoji + '</span>' +
            '<span>' + emotion + '</span>' +
        '</div>' +
        '<div class="prob-bar-track">' +
            '<div class="prob-bar-fill" id="bar-' + emotion + '" style="background:' + meta.color + '"></div>' +
        '</div>' +
        '<div class="prob-value" id="val-' + emotion + '">0%</div>';
    probBarsContainer.appendChild(row);
});

/* ========================================
   Dynamic Style Injection Helpers
======================================== */
function getOrCreateStyle(id) {
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('style');
        el.id = id;
        document.head.appendChild(el);
    }
    return el;
}

/* ========================================
   Predict
======================================== */
predictBtn.addEventListener('click', predict);

async function predict() {
    if (isPredicting) return;
    const text = textInput.value.trim();
    if (!text) return;

    isPredicting = true;
    predictBtn.disabled = true;
    predictBtn.classList.add('loading');

    // Hide previous result
    resultSection.classList.remove('visible');

    try {
        const res = await fetch('/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });

        if (!res.ok) {
            var err = await res.json().catch(function() {
                return { detail: 'Something went wrong' };
            });
            throw new Error(err.detail || 'Prediction failed');
        }

        var data = await res.json();
        renderResult(data);

    } catch (e) {
        showToast(e.message || 'Failed to connect to the server');
    } finally {
        isPredicting = false;
        predictBtn.classList.remove('loading');
        predictBtn.disabled = textInput.value.trim().length === 0;
    }
}

/* ========================================
   Render Result
======================================== */
function renderResult(data) {
    var emotion = data.predicted_emotion;
    var confidence = data.confidence;
    var probs = data.all_probabilites;
    var meta = EMOTION_META[emotion];

    // Orb appearance
    emotionOrb.textContent = meta.emoji;
    emotionOrb.style.background = meta.color + '18';
    emotionOrb.style.boxShadow = '0 0 40px ' + meta.glow + ', 0 0 80px ' + meta.glow;

    // Orbiting ring colors
    var ringStyle = getOrCreateStyle('ring-dot-style');
    ringStyle.textContent = '.emotion-orb-ring { border-color: ' + meta.color + '40; }' +
                            '.emotion-orb-ring::after { background: ' + meta.color + ' !important; }';

    // Top accent line on the card
    var beforeStyle = getOrCreateStyle('display-before-style');
    beforeStyle.textContent = '.emotion-display::before { background: linear-gradient(90deg, transparent, ' + meta.color + ', transparent); }';

    // Name & confidence
    emotionName.textContent = emotion;
    emotionName.style.color = meta.color;
    emotionConfidence.innerHTML = 'Confidence: <strong>' + (confidence * 100).toFixed(1) + '%</strong>';

    // Analyzed text preview
    analyzedText.textContent = data.text;

    // Ambient background glows shift to detected emotion
    glow1.style.background = meta.color + '10';
    glow2.style.background = meta.color + '08';

    // Animate probability bars with staggered delay
    emotionOrder.forEach(function(em, i) {
        var bar = document.getElementById('bar-' + em);
        var val = document.getElementById('val-' + em);
        var pct = (probs[em] || 0) * 100;

        // Reset first
        bar.style.width = '0%';
        val.textContent = '0%';
        val.style.color = '';
        val.style.fontWeight = '600';

        setTimeout(function() {
            bar.style.width = Math.max(pct, 0.5) + '%';
            val.textContent = pct.toFixed(1) + '%';

            // Highlight the winning emotion
            if (em === emotion) {
                val.style.color = EMOTION_META[em].color;
                val.style.fontWeight = '700';
            }
        }, 100 + i * 60);
    });

    // Reveal the result section
    setTimeout(function() {
        resultSection.classList.add('visible');
        resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
}