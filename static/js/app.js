/**
 * Real-Time Leaderboard Client Application
 * Handles:
 * - Real-time WebSocket synchronization with auto-reconnection
 * - REST API interactions with seamless offline / static GitHub Pages fallback
 * - Dynamic Olympic Top 3 podium and responsive table/cards view
 * - Quick score increment/decrement with floating indicators
 * - Synthetic Web Audio chime feedback
 * - Search, category filtering, export, and live activity ticker
 */

// -------------------------------------------------------------
// App State
// -------------------------------------------------------------
const state = {
  participants: [],
  previousRanks: new Map(), // id -> rank
  activeCategory: 'all',
  searchQuery: '',
  soundEnabled: localStorage.getItem('sound_enabled') !== 'false',
  currentView: localStorage.getItem('view_mode') || 'table',
  connected: false,
  viewerCount: 1,
  backendAvailable: true,
  activities: [],
};

// Default initial demo dataset if running standalone or offline
const DEMO_PARTICIPANTS = [
  { id: 1, name: "Elena Rostova", category: "Engineering", score: 940, badge: "🔥 Grandmaster", streak: 7, avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Elena", rank: 1 },
  { id: 2, name: "Kai Thorne", category: "Data Science", score: 885, badge: "⚡ Speedster", streak: 5, avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Kai", rank: 2 },
  { id: 3, name: "Aria Chen", category: "Design", score: 820, badge: "✨ Visionary", streak: 4, avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Aria", rank: 3 },
  { id: 4, name: "Mateo Silva", category: "Product", score: 760, badge: "🎯 Strategist", streak: 3, avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Mateo", rank: 4 },
  { id: 5, name: "Zoe Vance", category: "Security", score: 710, badge: "🛡️ Guardian", streak: 6, avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Zoe", rank: 5 },
  { id: 6, name: "Darius Knox", category: "Engineering", score: 680, badge: "🚀 Climber", streak: 2, avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Darius", rank: 6 },
  { id: 7, name: "Nova Miller", category: "Marketing", score: 630, badge: "🌟 Rising Star", streak: 4, avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Nova", rank: 7 },
  { id: 8, name: "Liam Gallagher", category: "Gaming", score: 590, badge: "🎮 Contender", streak: 1, avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Liam", rank: 8 },
];

// -------------------------------------------------------------
// Web Audio Synthesizer (Micro-Sounds)
// -------------------------------------------------------------
const audioCtx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
  ? new (window.AudioContext || window.webkitAudioContext)()
  : null;

function playSound(type) {
  if (!state.soundEnabled || !audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  if (type === 'up') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.12); // G5
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  } else if (type === 'down') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(329.63, now); // E4
    osc.frequency.exponentialRampToValueAtTime(220.00, now + 0.15); // A3
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.start(now);
    osc.stop(now + 0.18);
  } else if (type === 'podium') {
    // Fanfare triad
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g);
      g.connect(audioCtx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      const startTime = now + (i * 0.08);
      g.gain.setValueAtTime(0.1, startTime);
      g.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);
      o.start(startTime);
      o.stop(startTime + 0.25);
    });
  }
}

// -------------------------------------------------------------
// WebSocket & Network Synchronization
// -------------------------------------------------------------
let ws = null;
let reconnectTimer = null;

function initWebSocket() {
  if (window.location.protocol === 'file:') {
    setOfflineMode();
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      state.connected = true;
      state.backendAvailable = true;
      updateConnectionStatus(true);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleServerEvent(payload);
      } catch (err) {
        console.error("Failed to parse incoming WebSocket message:", err);
      }
    };

    ws.onclose = () => {
      state.connected = false;
      updateConnectionStatus(false);
      scheduleReconnect();
    };

    ws.onerror = () => {
      state.connected = false;
      updateConnectionStatus(false);
    };
  } catch (e) {
    console.warn("WebSocket connection could not be established; operating in fallback mode.", e);
    setOfflineMode();
  }
}

function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      initWebSocket();
    }, 3000);
  }
}

function updateConnectionStatus(isConnected) {
  const badge = document.getElementById('connection-status-badge');
  const dot = document.getElementById('connection-status-dot');
  const text = document.getElementById('connection-status-text');
  
  if (!badge || !dot || !text) return;

  if (isConnected) {
    dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 live-pulse-dot";
    text.textContent = `LIVE SYNC (${state.viewerCount} active)`;
    badge.className = "inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-500/30";
  } else {
    dot.className = "w-2.5 h-2.5 rounded-full bg-amber-400";
    text.textContent = state.backendAvailable ? "RECONNECTING..." : "LOCAL / STATIC MODE";
    badge.className = "inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-500/30";
  }
}

function setOfflineMode() {
  state.backendAvailable = false;
  state.connected = false;
  updateConnectionStatus(false);
  loadFromLocalStorage();
}

// -------------------------------------------------------------
// Server Event Dispatcher
// -------------------------------------------------------------
function handleServerEvent(msg) {
  switch (msg.event) {
    case 'snapshot':
      updateLeaderboardData(msg.leaderboard);
      break;

    case 'viewer_count':
      state.viewerCount = msg.count || 1;
      updateConnectionStatus(state.connected);
      break;

    case 'score_updated':
      const delta = (msg.new_score || 0) - (msg.old_score || 0);
      addActivity(`${msg.participant.name} ${delta >= 0 ? '+' + delta : delta} pts`, delta >= 0 ? 'up' : 'down');
      if (delta > 0) playSound('up');
      else if (delta < 0) playSound('down');
      
      updateLeaderboardData(msg.leaderboard, msg.participant.id, delta);
      break;

    case 'participant_added':
      addActivity(`New challenger ${msg.participant.name} joined!`, 'join');
      playSound('podium');
      updateLeaderboardData(msg.leaderboard);
      break;

    case 'participant_updated':
      addActivity(`${msg.participant.name}'s profile was updated`, 'edit');
      updateLeaderboardData(msg.leaderboard);
      break;

    case 'participant_deleted':
      addActivity(`${msg.name || 'Participant'} left the arena`, 'delete');
      updateLeaderboardData(msg.leaderboard);
      break;

    case 'leaderboard_reset':
      addActivity(`Leaderboard reset to demo state`, 'reset');
      playSound('podium');
      updateLeaderboardData(msg.leaderboard);
      break;

    default:
      if (msg.leaderboard) {
        updateLeaderboardData(msg.leaderboard);
      }
  }
}

// -------------------------------------------------------------
// Data Fetching & Local Storage Fallback
// -------------------------------------------------------------
async function fetchLeaderboard() {
  if (!state.backendAvailable) {
    loadFromLocalStorage();
    return;
  }

  try {
    const res = await fetch('/api/participants');
    if (!res.ok) throw new Error("Failed to fetch from API");
    const data = await res.json();
    updateLeaderboardData(data);
  } catch (err) {
    console.warn("Could not connect to /api/participants, using cached/local store:", err);
    setOfflineMode();
  }
}

function loadFromLocalStorage() {
  const cached = localStorage.getItem('local_leaderboard');
  if (cached) {
    try {
      state.participants = JSON.parse(cached);
    } catch {
      state.participants = DEMO_PARTICIPANTS;
    }
  } else {
    state.participants = DEMO_PARTICIPANTS;
    saveToLocalStorage();
  }
  renderAll();
}

function saveToLocalStorage() {
  localStorage.setItem('local_leaderboard', JSON.stringify(state.participants));
}

// -------------------------------------------------------------
// Leaderboard Processing & Ranking
// -------------------------------------------------------------
function updateLeaderboardData(rawList, targetParticipantId = null, deltaValue = null) {
  // Store previous rank map to calculate rank shifts
  state.participants.forEach(p => {
    state.previousRanks.set(p.id, p.rank);
  });

  // Ensure items are properly sorted by score descending
  const sorted = [...rawList].sort((a, b) => b.score - a.score);
  state.participants = sorted.map((p, idx) => ({
    ...p,
    rank: idx + 1,
    rankDiff: state.previousRanks.has(p.id) ? state.previousRanks.get(p.id) - (idx + 1) : 0,
  }));

  if (!state.backendAvailable) {
    saveToLocalStorage();
  }

  renderAll();

  // Highlight updated row if applicable
  if (targetParticipantId && deltaValue !== null) {
    flashTargetRow(targetParticipantId, deltaValue);
  }
}

function flashTargetRow(participantId, delta) {
  requestAnimationFrame(() => {
    const rowEl = document.getElementById(`row-${participantId}`);
    if (rowEl) {
      rowEl.classList.remove('row-flash-green', 'row-flash-red');
      void rowEl.offsetWidth; // Force reflow
      rowEl.classList.add(delta >= 0 ? 'row-flash-green' : 'row-flash-red');

      // Create floating delta indicator
      const scoreEl = document.getElementById(`score-${participantId}`);
      if (scoreEl) {
        showFloatingDelta(scoreEl, delta);
      }
    }
  });
}

function showFloatingDelta(targetElement, delta) {
  const badge = document.createElement('div');
  badge.className = `floating-delta ${delta >= 0 ? 'positive' : 'negative'}`;
  badge.textContent = delta >= 0 ? `+${delta}` : `${delta}`;
  
  const rect = targetElement.getBoundingClientRect();
  badge.style.left = `${rect.left + rect.width / 2}px`;
  badge.style.top = `${rect.top}px`;
  
  document.body.appendChild(badge);
  setTimeout(() => {
    badge.remove();
  }, 1200);
}

// -------------------------------------------------------------
// Rendering Modules
// -------------------------------------------------------------
function renderAll() {
  renderPodium();
  renderLeaderboard();
  renderCategoryPills();
  renderStatsBar();
  renderActivityTicker();
}

/**
 * Renders the Olympic 3-place Podium at the top:
 * Order: [2nd (Silver - Left)]  [1st (Gold - Elevated Center)]  [3rd (Bronze - Right)]
 */
function renderPodium() {
  const podiumContainer = document.getElementById('podium-view');
  if (!podiumContainer) return;

  const top3 = state.participants.slice(0, 3);
  if (top3.length === 0) {
    podiumContainer.innerHTML = `<div class="text-slate-400 py-6 text-sm">No participants registered yet. Add some below!</div>`;
    return;
  }

  const first = top3[0];
  const second = top3.length > 1 ? top3[1] : null;
  const third = top3.length > 2 ? top3[2] : null;

  let html = `<div class="grid grid-cols-1 md:grid-cols-3 gap-5 items-end max-w-4xl mx-auto pt-4 pb-2">`;

  // 2nd Place (Silver)
  if (second) {
    html += `
      <div class="podium-card podium-2 order-2 md:order-1 flex flex-col items-center">
        <div class="relative mb-3">
          <img src="${second.avatar}" alt="${second.name}" class="w-16 h-16 rounded-2xl bg-slate-800 p-1 border-2 border-slate-400 shadow-lg object-cover" />
          <span class="badge-silver absolute -bottom-2.5 -right-2 w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shadow-md">
            #2
          </span>
        </div>
        <h3 class="text-base font-bold text-slate-100 truncate max-w-[180px] text-center" title="${second.name}">${second.name}</h3>
        <span class="text-xs px-2.5 py-0.5 mt-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">${second.category}</span>
        <div class="text-2xl font-black text-slate-200 mt-2 font-heading" id="score-${second.id}">${second.score.toLocaleString()} <span class="text-xs font-medium text-slate-400">pts</span></div>
        <div class="flex items-center gap-1.5 mt-3">
          <button onclick="handleQuickScore(${second.id}, 5, event)" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-800/80 hover:bg-emerald-600 text-slate-200 hover:text-white transition">+5</button>
          <button onclick="handleQuickScore(${second.id}, 1, event)" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-800/80 hover:bg-emerald-600 text-slate-200 hover:text-white transition">+1</button>
          <button onclick="handleQuickScore(${second.id}, -1, event)" class="px-2 py-1 text-xs font-semibold rounded-lg bg-slate-800/80 hover:bg-rose-600 text-slate-200 hover:text-white transition">-1</button>
        </div>
      </div>
    `;
  } else {
    html += `<div class="hidden md:block order-1"></div>`;
  }

  // 1st Place (Gold - Center)
  if (first) {
    html += `
      <div class="podium-card podium-1 order-1 md:order-2 flex flex-col items-center">
        <div class="text-3xl mb-1 animated-crown" title="Leader">👑</div>
        <div class="relative mb-3">
          <img src="${first.avatar}" alt="${first.name}" class="w-20 h-20 rounded-2xl bg-slate-800 p-1 border-2 border-amber-400 shadow-xl object-cover" />
          <span class="badge-gold absolute -bottom-3 -right-2.5 w-8 h-8 rounded-full flex items-center justify-center font-extrabold text-sm shadow-lg">
            #1
          </span>
        </div>
        <h3 class="text-lg font-extrabold text-amber-200 truncate max-w-[200px] text-center" title="${first.name}">${first.name}</h3>
        <span class="text-xs px-3 py-0.5 mt-1 rounded-full bg-amber-950/80 text-amber-300 border border-amber-500/40">${first.category}</span>
        <div class="text-3xl font-black text-amber-300 mt-2 font-heading" id="score-${first.id}">${first.score.toLocaleString()} <span class="text-xs font-medium text-amber-400/80">pts</span></div>
        <div class="flex items-center gap-1.5 mt-3">
          <button onclick="handleQuickScore(${first.id}, 10, event)" class="px-3 py-1 text-xs font-bold rounded-lg bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/40 transition">+10</button>
          <button onclick="handleQuickScore(${first.id}, 5, event)" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-800/90 hover:bg-emerald-600 text-slate-200 hover:text-white transition">+5</button>
          <button onclick="handleQuickScore(${first.id}, 1, event)" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-800/90 hover:bg-emerald-600 text-slate-200 hover:text-white transition">+1</button>
          <button onclick="handleQuickScore(${first.id}, -1, event)" class="px-2 py-1 text-xs font-semibold rounded-lg bg-slate-800/90 hover:bg-rose-600 text-slate-200 hover:text-white transition">-1</button>
        </div>
      </div>
    `;
  }

  // 3rd Place (Bronze)
  if (third) {
    html += `
      <div class="podium-card podium-3 order-3 flex flex-col items-center">
        <div class="relative mb-3">
          <img src="${third.avatar}" alt="${third.name}" class="w-16 h-16 rounded-2xl bg-slate-800 p-1 border-2 border-amber-700 shadow-lg object-cover" />
          <span class="badge-bronze absolute -bottom-2.5 -right-2 w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shadow-md">
            #3
          </span>
        </div>
        <h3 class="text-base font-bold text-slate-100 truncate max-w-[180px] text-center" title="${third.name}">${third.name}</h3>
        <span class="text-xs px-2.5 py-0.5 mt-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">${third.category}</span>
        <div class="text-2xl font-black text-amber-500 mt-2 font-heading" id="score-${third.id}">${third.score.toLocaleString()} <span class="text-xs font-medium text-slate-400">pts</span></div>
        <div class="flex items-center gap-1.5 mt-3">
          <button onclick="handleQuickScore(${third.id}, 5, event)" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-800/80 hover:bg-emerald-600 text-slate-200 hover:text-white transition">+5</button>
          <button onclick="handleQuickScore(${third.id}, 1, event)" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-800/80 hover:bg-emerald-600 text-slate-200 hover:text-white transition">+1</button>
          <button onclick="handleQuickScore(${third.id}, -1, event)" class="px-2 py-1 text-xs font-semibold rounded-lg bg-slate-800/80 hover:bg-rose-600 text-slate-200 hover:text-white transition">-1</button>
        </div>
      </div>
    `;
  } else {
    html += `<div class="hidden md:block order-3"></div>`;
  }

  html += `</div>`;
  podiumContainer.innerHTML = html;
}

/**
 * Filters the participants list based on active category and search text
 */
function getFilteredParticipants() {
  return state.participants.filter(p => {
    const matchesCat = state.activeCategory === 'all' || p.category.toLowerCase() === state.activeCategory.toLowerCase();
    const matchesSearch = !state.searchQuery || 
      p.name.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
      p.category.toLowerCase().includes(state.searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });
}

/**
 * Renders the main leaderboard rows (Table View or Card Grid View)
 */
function renderLeaderboard() {
  const container = document.getElementById('leaderboard-content');
  if (!container) return;

  const items = getFilteredParticipants();

  if (items.length === 0) {
    container.innerHTML = `
      <div class="p-12 text-center text-slate-400 glass-card rounded-2xl">
        <div class="text-4xl mb-3">🔍</div>
        <p class="text-base font-medium text-slate-300">No participants match your criteria</p>
        <p class="text-xs text-slate-500 mt-1">Try clearing your search query or choosing another category</p>
        <button onclick="resetFilters()" class="mt-4 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition">Reset Filters</button>
      </div>
    `;
    return;
  }

  if (state.currentView === 'cards') {
    renderCardsView(container, items);
  } else {
    renderTableView(container, items);
  }
}

function renderTableView(container, items) {
  let html = `
    <div class="overflow-x-auto rounded-2xl glass-panel border border-slate-700/60 shadow-2xl">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="border-b border-slate-700/70 bg-slate-900/60 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <th class="py-3.5 px-4 text-center w-16">Rank</th>
            <th class="py-3.5 px-4">Participant</th>
            <th class="py-3.5 px-4 hidden sm:table-cell">Category</th>
            <th class="py-3.5 px-4 text-right">Score</th>
            <th class="py-3.5 px-4 text-center">Quick Adjust</th>
            <th class="py-3.5 px-4 text-center w-24">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/80 text-sm">
  `;

  items.forEach(p => {
    let rankBadge = '';
    if (p.rank === 1) {
      rankBadge = `<span class="badge-gold w-7 h-7 rounded-full inline-flex items-center justify-center font-black text-xs">🥇 1</span>`;
    } else if (p.rank === 2) {
      rankBadge = `<span class="badge-silver w-7 h-7 rounded-full inline-flex items-center justify-center font-black text-xs">🥈 2</span>`;
    } else if (p.rank === 3) {
      rankBadge = `<span class="badge-bronze w-7 h-7 rounded-full inline-flex items-center justify-center font-black text-xs">🥉 3</span>`;
    } else {
      rankBadge = `<span class="text-slate-400 font-bold text-sm">#${p.rank}</span>`;
    }

    // Rank trend indicator
    let trend = '';
    if (p.rankDiff > 0) {
      trend = `<span class="text-emerald-400 text-xs font-bold" title="Rose ${p.rankDiff} spots">▲${p.rankDiff}</span>`;
    } else if (p.rankDiff < 0) {
      trend = `<span class="text-rose-400 text-xs font-bold" title="Fell ${Math.abs(p.rankDiff)} spots">▼${Math.abs(p.rankDiff)}</span>`;
    }

    // Highlight search match
    const highlightedName = highlightMatch(p.name, state.searchQuery);

    html += `
      <tr id="row-${p.id}" class="leaderboard-table-row hover:bg-slate-800/40 transition">
        <td class="py-3 px-4 text-center whitespace-nowrap">
          <div class="flex items-center justify-center gap-1.5">
            ${rankBadge}
            ${trend}
          </div>
        </td>
        <td class="py-3 px-4 whitespace-nowrap">
          <div class="flex items-center gap-3">
            <img src="${p.avatar}" alt="${p.name}" class="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700/80 p-0.5 object-cover" />
            <div>
              <div class="font-semibold text-slate-100 flex items-center gap-2">
                ${highlightedName}
                ${p.badge ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-700/50">${p.badge}</span>` : ''}
              </div>
              <div class="text-xs text-slate-400 sm:hidden mt-0.5">${p.category}</div>
            </div>
          </div>
        </td>
        <td class="py-3 px-4 whitespace-nowrap hidden sm:table-cell">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
            ${p.category}
          </span>
        </td>
        <td class="py-3 px-4 text-right whitespace-nowrap">
          <div class="text-lg font-black font-heading text-slate-100" id="score-${p.id}">
            ${p.score.toLocaleString()}
            <span class="text-xs font-normal text-slate-400">pts</span>
          </div>
          ${p.streak > 1 ? `<div class="text-[10px] text-amber-400 font-bold">🔥 ${p.streak} streak</div>` : ''}
        </td>
        <td class="py-3 px-4 whitespace-nowrap text-center">
          <div class="inline-flex items-center gap-1 bg-slate-900/60 p-1 rounded-xl border border-slate-800">
            <button onclick="handleQuickScore(${p.id}, 10, event)" class="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-emerald-600 text-emerald-400 hover:text-white transition" title="Add 10">+10</button>
            <button onclick="handleQuickScore(${p.id}, 5, event)" class="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-emerald-600 text-emerald-400 hover:text-white transition" title="Add 5">+5</button>
            <button onclick="handleQuickScore(${p.id}, 1, event)" class="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-emerald-600 text-emerald-400 hover:text-white transition" title="Add 1">+1</button>
            <button onclick="handleQuickScore(${p.id}, -1, event)" class="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-rose-600 text-rose-400 hover:text-white transition" title="Subtract 1">-1</button>
            <button onclick="handleQuickScore(${p.id}, -5, event)" class="px-2 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-rose-600 text-rose-400 hover:text-white transition" title="Subtract 5">-5</button>
          </div>
        </td>
        <td class="py-3 px-4 whitespace-nowrap text-center">
          <div class="inline-flex items-center gap-2">
            <button onclick="openSetScoreModal(${p.id})" class="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded-lg transition" title="Set exact score">
              🎯
            </button>
            <button onclick="openEditParticipantModal(${p.id})" class="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-lg transition" title="Edit Participant">
              ✏️
            </button>
            <button onclick="confirmDeleteParticipant(${p.id}, '${escapeHtml(p.name)}')" class="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition" title="Delete Participant">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </div>
  `;
  container.innerHTML = html;
}

function renderCardsView(container, items) {
  let html = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">`;

  items.forEach(p => {
    let cardBorder = 'border-slate-800 hover:border-slate-700';
    let badgeHtml = '';

    if (p.rank === 1) {
      cardBorder = 'border-amber-500/50 shadow-amber-500/10 shadow-lg';
      badgeHtml = `<span class="badge-gold px-2.5 py-0.5 rounded-full text-xs font-extrabold">🥇 Rank 1</span>`;
    } else if (p.rank === 2) {
      cardBorder = 'border-slate-400/50 shadow-slate-400/10 shadow-lg';
      badgeHtml = `<span class="badge-silver px-2.5 py-0.5 rounded-full text-xs font-extrabold">🥈 Rank 2</span>`;
    } else if (p.rank === 3) {
      cardBorder = 'border-amber-700/50 shadow-amber-700/10 shadow-lg';
      badgeHtml = `<span class="badge-bronze px-2.5 py-0.5 rounded-full text-xs font-extrabold">🥉 Rank 3</span>`;
    } else {
      badgeHtml = `<span class="text-xs font-bold text-slate-400 bg-slate-800 px-2.5 py-0.5 rounded-full border border-slate-700">#${p.rank}</span>`;
    }

    html += `
      <div id="row-${p.id}" class="glass-card rounded-2xl p-4 flex flex-col justify-between border ${cardBorder} transition">
        <div>
          <div class="flex items-center justify-between gap-2 mb-3">
            ${badgeHtml}
            <span class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">${p.category}</span>
          </div>

          <div class="flex items-center gap-3 mb-3">
            <img src="${p.avatar}" alt="${p.name}" class="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 p-0.5 object-cover" />
            <div class="min-w-0">
              <h4 class="font-bold text-slate-100 truncate">${p.name}</h4>
              ${p.badge ? `<span class="text-[10px] text-indigo-400 font-medium">${p.badge}</span>` : ''}
            </div>
          </div>

          <div class="bg-slate-900/60 rounded-xl p-3 text-center border border-slate-800/80 mb-3">
            <div class="text-2xl font-black font-heading text-slate-100" id="score-${p.id}">
              ${p.score.toLocaleString()} <span class="text-xs font-normal text-slate-400">pts</span>
            </div>
            ${p.streak > 1 ? `<div class="text-[10px] text-amber-400 font-bold">🔥 ${p.streak} streak</div>` : ''}
          </div>
        </div>

        <div>
          <div class="flex items-center justify-center gap-1 mb-2.5">
            <button onclick="handleQuickScore(${p.id}, 5, event)" class="flex-1 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-emerald-600 text-emerald-400 hover:text-white transition">+5</button>
            <button onclick="handleQuickScore(${p.id}, 1, event)" class="flex-1 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-emerald-600 text-emerald-400 hover:text-white transition">+1</button>
            <button onclick="handleQuickScore(${p.id}, -1, event)" class="flex-1 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-rose-600 text-rose-400 hover:text-white transition">-1</button>
            <button onclick="handleQuickScore(${p.id}, -5, event)" class="flex-1 py-1 text-xs font-bold rounded-lg bg-slate-800 hover:bg-rose-600 text-rose-400 hover:text-white transition">-5</button>
          </div>

          <div class="flex items-center justify-between border-t border-slate-800 pt-2 text-xs text-slate-400">
            <button onclick="openSetScoreModal(${p.id})" class="hover:text-indigo-400 transition">🎯 Set</button>
            <button onclick="openEditParticipantModal(${p.id})" class="hover:text-blue-400 transition">✏️ Edit</button>
            <button onclick="confirmDeleteParticipant(${p.id}, '${escapeHtml(p.name)}')" class="hover:text-rose-400 transition">🗑️ Delete</button>
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

/**
 * Category filter pills with dynamic count badges
 */
function renderCategoryPills() {
  const container = document.getElementById('category-pills');
  if (!container) return;

  const categories = {};
  state.participants.forEach(p => {
    const cat = p.category || 'General';
    categories[cat] = (categories[cat] || 0) + 1;
  });

  const total = state.participants.length;
  let html = `
    <button onclick="setCategory('all')" class="px-3 py-1.5 rounded-full text-xs font-semibold transition ${
      state.activeCategory === 'all'
        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
        : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
    }">
      All (${total})
    </button>
  `;

  Object.entries(categories).forEach(([cat, count]) => {
    const isActive = state.activeCategory.toLowerCase() === cat.toLowerCase();
    html += `
      <button onclick="setCategory('${cat}')" class="px-3 py-1.5 rounded-full text-xs font-semibold transition ${
        isActive
          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
          : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
      }">
        ${cat} (${count})
      </button>
    `;
  });

  container.innerHTML = html;
}

/**
 * Top statistics bar: Total Competitors, Top Score, Average Score, Top Category
 */
function renderStatsBar() {
  const totalEl = document.getElementById('stat-total');
  const topScoreEl = document.getElementById('stat-top-score');
  const avgScoreEl = document.getElementById('stat-avg-score');
  const topCategoryEl = document.getElementById('stat-top-category');

  const total = state.participants.length;
  if (total === 0) {
    if (totalEl) totalEl.textContent = '0';
    if (topScoreEl) topScoreEl.textContent = '0';
    if (avgScoreEl) avgScoreEl.textContent = '0';
    if (topCategoryEl) topCategoryEl.textContent = 'None';
    return;
  }

  const scores = state.participants.map(p => p.score);
  const top = Math.max(...scores);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / total);

  const catCounts = {};
  state.participants.forEach(p => {
    catCounts[p.category] = (catCounts[p.category] || 0) + 1;
  });
  let topCat = 'General';
  let maxCount = 0;
  for (const [k, v] of Object.entries(catCounts)) {
    if (v > maxCount) {
      maxCount = v;
      topCat = k;
    }
  }

  if (totalEl) totalEl.textContent = total;
  if (topScoreEl) topScoreEl.textContent = top.toLocaleString();
  if (avgScoreEl) avgScoreEl.textContent = avg.toLocaleString();
  if (topCategoryEl) topCategoryEl.textContent = topCat;
}

/**
 * Live Activity Ticker Feed (Recent 5 events)
 */
function addActivity(text, type = 'info') {
  const item = {
    id: Date.now() + Math.random(),
    text,
    type,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };
  state.activities.unshift(item);
  if (state.activities.length > 5) {
    state.activities.pop();
  }
  renderActivityTicker();
}

function renderActivityTicker() {
  const container = document.getElementById('activity-feed');
  if (!container) return;

  if (state.activities.length === 0) {
    container.innerHTML = `<span class="text-xs text-slate-500 italic">No recent score updates yet.</span>`;
    return;
  }

  container.innerHTML = state.activities.map(act => {
    let icon = '⚡';
    if (act.type === 'up') icon = '📈';
    else if (act.type === 'down') icon = '📉';
    else if (act.type === 'join') icon = '🎉';
    else if (act.type === 'reset') icon = '🔄';

    return `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300">
        <span>${icon}</span>
        <span class="font-medium">${act.text}</span>
        <span class="text-[10px] text-slate-500">${act.time}</span>
      </span>
    `;
  }).join('');
}

// -------------------------------------------------------------
// Participant Actions & Handlers
// -------------------------------------------------------------
async function handleQuickScore(id, delta, event) {
  if (event) event.stopPropagation();

  if (state.backendAvailable) {
    try {
      const res = await fetch(`/api/participants/${id}/score`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: delta >= 0 ? 'increment' : 'decrement',
          delta: Math.abs(delta)
        })
      });
      if (!res.ok) throw new Error("API score update failed");
      // Note: WebSocket will broadcast update to everyone
    } catch (err) {
      console.warn("Backend update failed, falling back to local action", err);
      applyScoreLocally(id, delta);
    }
  } else {
    applyScoreLocally(id, delta);
  }
}

function applyScoreLocally(id, delta) {
  const p = state.participants.find(x => x.id === id);
  if (!p) return;

  p.score = Math.max(0, p.score + delta);
  if (delta > 0) {
    p.streak = (p.streak || 0) + 1;
    playSound('up');
  } else {
    p.streak = 0;
    playSound('down');
  }
  p.updated_at = new Date().toISOString();

  addActivity(`${p.name} ${delta >= 0 ? '+' + delta : delta} pts`, delta >= 0 ? 'up' : 'down');
  updateLeaderboardData(state.participants, id, delta);
}

// -------------------------------------------------------------
// Modals & UI Controls
// -------------------------------------------------------------
function openAddParticipantModal() {
  const modal = document.getElementById('add-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.getElementById('input-name').focus();
  updateAvatarPreview();
}

function closeAddParticipantModal() {
  const modal = document.getElementById('add-modal');
  if (modal) modal.classList.add('hidden');
}

function updateAvatarPreview() {
  const name = document.getElementById('input-name').value.trim() || 'NewChallenger';
  const preview = document.getElementById('avatar-preview');
  if (preview) {
    preview.src = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`;
  }
}

async function submitAddParticipant(event) {
  event.preventDefault();
  const name = document.getElementById('input-name').value.trim();
  const category = document.getElementById('input-category').value.trim() || 'General';
  const initialScore = parseInt(document.getElementById('input-score').value, 10) || 0;
  const badge = document.getElementById('input-badge').value.trim();

  if (!name) return;

  const avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`;

  if (state.backendAvailable) {
    try {
      const res = await fetch('/api/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          category,
          initial_score: initialScore,
          avatar,
          badge
        })
      });
      if (!res.ok) throw new Error("Could not create participant");
      closeAddParticipantModal();
      document.getElementById('add-form').reset();
      return;
    } catch (err) {
      console.warn("Backend failed to create participant; adding locally:", err);
    }
  }

  // Local creation fallback
  const newId = Date.now();
  const newParticipant = {
    id: newId,
    name,
    category,
    score: initialScore,
    avatar,
    badge,
    streak: initialScore > 0 ? 1 : 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  state.participants.push(newParticipant);
  addActivity(`New challenger ${name} joined!`, 'join');
  playSound('podium');
  updateLeaderboardData(state.participants);
  closeAddParticipantModal();
  document.getElementById('add-form').reset();
}

// Set Score Modal
let targetScoreParticipantId = null;

function openSetScoreModal(id) {
  const p = state.participants.find(x => x.id === id);
  if (!p) return;
  targetScoreParticipantId = id;

  document.getElementById('set-score-name').textContent = p.name;
  document.getElementById('set-score-current').textContent = p.score.toLocaleString();
  document.getElementById('input-exact-score').value = p.score;
  document.getElementById('set-score-modal').classList.remove('hidden');
}

function closeSetScoreModal() {
  const modal = document.getElementById('set-score-modal');
  if (modal) modal.classList.add('hidden');
  targetScoreParticipantId = null;
}

async function submitSetScore(event) {
  event.preventDefault();
  if (!targetScoreParticipantId) return;

  const newScore = Math.max(0, parseInt(document.getElementById('input-exact-score').value, 10) || 0);

  if (state.backendAvailable) {
    try {
      const res = await fetch(`/api/participants/${targetScoreParticipantId}/score`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'set',
          value: newScore
        })
      });
      if (!res.ok) throw new Error("Failed to set score");
      closeSetScoreModal();
      return;
    } catch (err) {
      console.warn("Backend set score failed, setting locally:", err);
    }
  }

  // Local fallback
  const p = state.participants.find(x => x.id === targetScoreParticipantId);
  if (p) {
    const delta = newScore - p.score;
    p.score = newScore;
    p.updated_at = new Date().toISOString();
    addActivity(`${p.name} score set to ${newScore}`, delta >= 0 ? 'up' : 'down');
    updateLeaderboardData(state.participants, p.id, delta);
  }
  closeSetScoreModal();
}

// Edit Participant Modal
let targetEditParticipantId = null;

function openEditParticipantModal(id) {
  const p = state.participants.find(x => x.id === id);
  if (!p) return;
  targetEditParticipantId = id;

  document.getElementById('edit-name').value = p.name;
  document.getElementById('edit-category').value = p.category;
  document.getElementById('edit-badge').value = p.badge || '';
  document.getElementById('edit-avatar').value = p.avatar || '';
  document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditParticipantModal() {
  const modal = document.getElementById('edit-modal');
  if (modal) modal.classList.add('hidden');
  targetEditParticipantId = null;
}

async function submitEditParticipant(event) {
  event.preventDefault();
  if (!targetEditParticipantId) return;

  const name = document.getElementById('edit-name').value.trim();
  const category = document.getElementById('edit-category').value.trim();
  const badge = document.getElementById('edit-badge').value.trim();
  const avatar = document.getElementById('edit-avatar').value.trim();

  if (state.backendAvailable) {
    try {
      const res = await fetch(`/api/participants/${targetEditParticipantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, badge, avatar })
      });
      if (!res.ok) throw new Error("Failed to update participant");
      closeEditParticipantModal();
      return;
    } catch (err) {
      console.warn("Backend edit failed, applying locally:", err);
    }
  }

  // Local fallback
  const p = state.participants.find(x => x.id === targetEditParticipantId);
  if (p) {
    p.name = name || p.name;
    p.category = category || p.category;
    p.badge = badge;
    if (avatar) p.avatar = avatar;
    addActivity(`${p.name}'s profile was updated`, 'edit');
    updateLeaderboardData(state.participants);
  }
  closeEditParticipantModal();
}

// Delete Participant
async function confirmDeleteParticipant(id, name) {
  if (!confirm(`Are you sure you want to remove "${name}" from the leaderboard?`)) return;

  if (state.backendAvailable) {
    try {
      const res = await fetch(`/api/participants/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error("Delete failed");
      return;
    } catch (err) {
      console.warn("Backend delete failed, removing locally:", err);
    }
  }

  state.participants = state.participants.filter(x => x.id !== id);
  addActivity(`${name} was removed`, 'delete');
  updateLeaderboardData(state.participants);
}

// Reset to Sample Data
async function resetLeaderboard() {
  if (!confirm("Reset leaderboard back to the initial sample participants?")) return;

  if (state.backendAvailable) {
    try {
      const res = await fetch('/api/reset', { method: 'POST' });
      if (!res.ok) throw new Error("Reset failed");
      return;
    } catch (err) {
      console.warn("Backend reset failed, resetting locally:", err);
    }
  }

  state.participants = JSON.parse(JSON.stringify(DEMO_PARTICIPANTS));
  saveToLocalStorage();
  addActivity("Leaderboard reset to sample state", 'reset');
  playSound('podium');
  updateLeaderboardData(state.participants);
}

// Export Leaderboard (JSON / CSV)
function exportData(format) {
  if (state.backendAvailable) {
    window.location.href = `/api/export?format=${format}`;
    return;
  }

  // Client-side export
  if (format === 'csv') {
    let csv = "Rank,ID,Name,Category,Score,Badge,Streak\n";
    state.participants.forEach(p => {
      csv += `"${p.rank}","${p.id}","${p.name}","${p.category}","${p.score}","${p.badge || ''}","${p.streak || 0}"\n`;
    });
    downloadBlob(csv, "text/csv", "leaderboard.csv");
  } else {
    const json = JSON.stringify(state.participants, null, 2);
    downloadBlob(json, "application/json", "leaderboard.json");
  }
}

function downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -------------------------------------------------------------
// Filters, Search, Views, & Toggles
// -------------------------------------------------------------
function setCategory(cat) {
  state.activeCategory = cat;
  renderCategoryPills();
  renderLeaderboard();
}

function handleSearchInput(e) {
  state.searchQuery = e.target.value;
  renderLeaderboard();
}

function resetFilters() {
  state.activeCategory = 'all';
  state.searchQuery = '';
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  renderCategoryPills();
  renderLeaderboard();
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem('sound_enabled', state.soundEnabled);
  updateSoundButton();
  if (state.soundEnabled) playSound('up');
}

function updateSoundButton() {
  const btn = document.getElementById('sound-toggle-btn');
  if (btn) {
    btn.innerHTML = state.soundEnabled ? '🔊 <span class="hidden sm:inline">Audio On</span>' : '🔇 <span class="hidden sm:inline">Audio Off</span>';
  }
}

function setViewMode(mode) {
  state.currentView = mode;
  localStorage.setItem('view_mode', mode);
  updateViewModeButtons();
  renderLeaderboard();
}

function updateViewModeButtons() {
  const btnTable = document.getElementById('btn-view-table');
  const btnCards = document.getElementById('btn-view-cards');
  if (!btnTable || !btnCards) return;

  if (state.currentView === 'table') {
    btnTable.className = "px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white shadow transition";
    btnCards.className = "px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition";
  } else {
    btnTable.className = "px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition";
    btnCards.className = "px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white shadow transition";
  }
}

// Helper utilities
function highlightMatch(text, query) {
  if (!query || !query.trim()) return escapeHtml(text);
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escapeHtml(text).replace(regex, '<span class="bg-amber-400/30 text-amber-200 px-0.5 rounded font-bold">$1</span>');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

// -------------------------------------------------------------
// App Initialization
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  updateSoundButton();
  updateViewModeButtons();
  initWebSocket();
  fetchLeaderboard();

  // Search input listener
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearchInput);
  }

  // Name input live avatar preview
  const nameInput = document.getElementById('input-name');
  if (nameInput) {
    nameInput.addEventListener('input', updateAvatarPreview);
  }

  // Global keybindings (Esc to close modals)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAddParticipantModal();
      closeSetScoreModal();
      closeEditParticipantModal();
    }
  });
});
