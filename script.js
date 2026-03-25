// --- 核心變數 ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let isAppReady = false, playerName = "Player", playerRating = 1500, currentGameMode = 'learning';
let bgmBuffer = null, bgmSource = null;
let beatmap = [], BEAT_MS = 0, totalMeasures = 0, isPlaying = false, gameStartTime = 0, animationId;
let isPaused = false, pausedAt = 0;
let stats = { perfect: 0, miss: 0, score: 0, combo: 0, maxCombo: 0 };
let lastGameConfig = null; // For replay

const ROW_HEIGHT = 120, PADDING_X = 60, LINE_Y_OFFSET = 50, DOT_Y_OFFSET = 85;

// ===== FIREBASE CONFIGURATION =====
// To enable online leaderboard:
// 1. Go to https://console.firebase.google.com/
// 2. Create a new project (free)
// 3. Go to Build > Realtime Database > Create Database > Start in Test Mode
// 4. Go to Project Settings > General > Your apps > Add Web App
// 5. Copy your config values below
const FIREBASE_CONFIG = {
    apiKey: "",
    authDomain: "",
    databaseURL: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
};

let firebaseDB = null;
let firebaseReady = false;

function initFirebase() {
    if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.databaseURL) {
        console.log('Firebase not configured - using local leaderboard only');
        return;
    }
    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        firebaseDB = firebase.database();
        firebaseReady = true;
        const statusEl = document.getElementById('leaderboard-status');
        if (statusEl) statusEl.innerText = '🌐 線上排行';
        console.log('Firebase connected!');
    } catch (e) {
        console.error('Firebase init error:', e);
    }
}

// ===== STUDENT PROFILE =====
let studentProfile = null;

function loadStudentProfile() {
    try {
        const saved = localStorage.getItem('rhythmGame_student');
        if (saved) {
            studentProfile = JSON.parse(saved);
            playerName = studentProfile.name;
            return true;
        }
    } catch (e) { console.error('Profile load error:', e); }
    return false;
}

function saveStudentProfile(name, className, studentNo) {
    studentProfile = { name: name, className: className, studentNo: studentNo };
    playerName = name;
    localStorage.setItem('rhythmGame_student', JSON.stringify(studentProfile));
}

function submitStudentProfile() {
    const name = document.getElementById('input-student-name').value.trim();
    const cls = document.getElementById('input-student-class').value.trim();
    const no = document.getElementById('input-student-no').value.trim();
    if (!name) { showToast('❌ 請輸入姓名'); return; }
    if (!cls) { showToast('❌ 請輸入班級'); return; }
    if (!no) { showToast('❌ 請輸入學號'); return; }
    saveStudentProfile(name, cls, no);
    document.getElementById('student-profile-overlay').classList.add('hidden');
    showToast('✨ 歡迎 ' + cls + ' ' + name + '!');
    updateStudentBadge();
}

function showStudentProfileForm() {
    const overlay = document.getElementById('student-profile-overlay');
    if (studentProfile) {
        document.getElementById('input-student-name').value = studentProfile.name || '';
        document.getElementById('input-student-class').value = studentProfile.className || '';
        document.getElementById('input-student-no').value = studentProfile.studentNo || '';
    }
    overlay.classList.remove('hidden');
}

function updateStudentBadge() {
    const badges = document.querySelectorAll('.student-badge');
    badges.forEach(b => {
        if (studentProfile) {
            b.innerText = studentProfile.className + ' ' + studentProfile.name;
        }
    });
}

// ===== LEADERBOARD =====
let currentLeaderboardFilter = 'all';

function saveScoreToLeaderboard(score, accuracy, maxCombo, mode, levelOrSong) {
    if (!studentProfile) return;
    const entry = {
        name: studentProfile.name,
        className: studentProfile.className,
        studentNo: studentProfile.studentNo,
        score: score,
        accuracy: accuracy,
        maxCombo: maxCombo,
        mode: mode,
        levelOrSong: levelOrSong,
        timestamp: Date.now()
    };
    // Save locally
    try {
        const local = JSON.parse(localStorage.getItem('rhythmGame_leaderboard') || '[]');
        local.push(entry);
        local.sort(function(a, b) { return b.score - a.score; });
        localStorage.setItem('rhythmGame_leaderboard', JSON.stringify(local.slice(0, 200)));
    } catch (e) { console.error('Local save error:', e); }
    // Save to Firebase if available
    if (firebaseReady && firebaseDB) {
        firebaseDB.ref('leaderboard').push(entry).catch(function(e) {
            console.error('Firebase save error:', e);
        });
    }
}

function loadLeaderboard(callback) {
    if (firebaseReady && firebaseDB) {
        firebaseDB.ref('leaderboard').orderByChild('score').limitToLast(100).once('value').then(function(snapshot) {
            var entries = [];
            snapshot.forEach(function(child) { entries.push(child.val()); });
            entries.reverse();
            callback(entries);
        }).catch(function(e) {
            console.error('Firebase read error:', e);
            loadLocalLeaderboard(callback);
        });
    } else {
        loadLocalLeaderboard(callback);
    }
}

function loadLocalLeaderboard(callback) {
    try {
        var local = JSON.parse(localStorage.getItem('rhythmGame_leaderboard') || '[]');
        callback(local);
    } catch (e) { callback([]); }
}

function refreshLeaderboard() {
    renderLeaderboard();
    showToast('🔄 已更新排行榜');
}

function filterLeaderboard(filter) {
    currentLeaderboardFilter = filter;
    document.querySelectorAll('.lb-filter-btn').forEach(function(btn) { btn.classList.remove('active'); });
    event.target.classList.add('active');
    renderLeaderboard();
}

function renderLeaderboard() {
    var listEl = document.getElementById('leaderboard-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="text-center text-white/50 py-8">載入中...</div>';
    loadLeaderboard(function(entries) {
        if (currentLeaderboardFilter !== 'all') {
            entries = entries.filter(function(e) { return e.mode === currentLeaderboardFilter; });
        }
        if (entries.length === 0) {
            listEl.innerHTML = '<div class="text-center text-white/50 py-12"><div class="text-4xl mb-3">📭</div><div>暫無記錄<br><span class="text-xs">完成遊戲後會出現在這裡</span></div></div>';
            return;
        }
        var html = '';
        var modeLabels = { learning: '學習', performance: '表演', competition: '競技' };
        entries.forEach(function(entry, idx) {
            var rankClass = idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : 'normal';
            var rankText = idx < 3 ? ['🥇','🥈','🥉'][idx] : (idx + 1);
            var isSelf = studentProfile && entry.name === studentProfile.name && entry.className === studentProfile.className && entry.studentNo === studentProfile.studentNo;
            var dateStr = entry.timestamp ? new Date(entry.timestamp).toLocaleDateString('zh-TW') : '';
            var modeLabel = modeLabels[entry.mode] || entry.mode || '';
            html += '<div class="lb-entry' + (isSelf ? ' self' : '') + '">' +
                '<div class="lb-rank ' + rankClass + '">' + rankText + '</div>' +
                '<div class="lb-info">' +
                    '<div class="lb-name">' + escapeHTML(entry.name) + '</div>' +
                    '<div class="lb-detail">' + escapeHTML(entry.className || '') + ' #' + escapeHTML(entry.studentNo || '') + ' · ' + modeLabel + ' · ' + escapeHTML(entry.levelOrSong || '') + ' · ' + dateStr + '</div>' +
                '</div>' +
                '<div class="lb-score">' +
                    '<div class="lb-score-num">' + (entry.score || 0) + '</div>' +
                    '<div class="lb-score-label">' + (entry.accuracy || 0) + '% 正確</div>' +
                '</div>' +
            '</div>';
        });
        listEl.innerHTML = html;
    });
}

function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// ===== MUSIC NOTE/REST IMAGES (SVG Data URIs) =====
var NOTE_IMAGES = {};

var NOTE_SVG_STRINGS = {
    headFilled: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14"><ellipse cx="10" cy="7" rx="8" ry="5.5" fill="#1a1a2e" transform="rotate(-20,10,7)"/></svg>',
    headHollow: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14"><ellipse cx="10" cy="7" rx="8" ry="5.5" fill="none" stroke="#1a1a2e" stroke-width="2.2" transform="rotate(-20,10,7)"/></svg>',
    whole: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16"><ellipse cx="12" cy="8" rx="10" ry="6.5" fill="none" stroke="#1a1a2e" stroke-width="2.5" transform="rotate(-15,12,8)"/><ellipse cx="12" cy="8" rx="4" ry="6.5" fill="none" stroke="#1a1a2e" stroke-width="1.5" transform="rotate(35,12,8)"/></svg>',
    quarter: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 62"><line x1="19" y1="4" x2="19" y2="48" stroke="#1a1a2e" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="10" cy="48" rx="9" ry="6" fill="#1a1a2e" transform="rotate(-20,10,48)"/></svg>',
    half: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 62"><line x1="19" y1="4" x2="19" y2="48" stroke="#1a1a2e" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="10" cy="48" rx="9" ry="6" fill="none" stroke="#1a1a2e" stroke-width="2.2" transform="rotate(-20,10,48)"/></svg>',
    eighth: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 62"><line x1="19" y1="4" x2="19" y2="48" stroke="#1a1a2e" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="10" cy="48" rx="9" ry="6" fill="#1a1a2e" transform="rotate(-20,10,48)"/><path d="M19,4 C25,9 27,18 22,26" fill="none" stroke="#1a1a2e" stroke-width="2.8" stroke-linecap="round"/></svg>',
    sixteenth: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 62"><line x1="19" y1="4" x2="19" y2="48" stroke="#1a1a2e" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="10" cy="48" rx="9" ry="6" fill="#1a1a2e" transform="rotate(-20,10,48)"/><path d="M19,4 C25,9 27,16 22,22" fill="none" stroke="#1a1a2e" stroke-width="2.8" stroke-linecap="round"/><path d="M19,12 C25,17 27,24 22,30" fill="none" stroke="#1a1a2e" stroke-width="2.8" stroke-linecap="round"/></svg>',
    rest_quarter: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 44"><path d="M10,4 L4,13 L12,22 L5,33" fill="none" stroke="#1a1a2e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="37" r="3.5" fill="#1a1a2e"/></svg>',
    rest_half: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 14"><line x1="0" y1="13" x2="22" y2="13" stroke="#1a1a2e" stroke-width="2"/><rect x="3" y="5" width="16" height="8" rx="1" fill="#1a1a2e"/></svg>',
    rest_whole: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 14"><line x1="0" y1="1" x2="22" y2="1" stroke="#1a1a2e" stroke-width="2"/><rect x="3" y="1" width="16" height="8" rx="1" fill="#1a1a2e"/></svg>',
    rest_eighth: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 36"><circle cx="11" cy="8" r="3.5" fill="#1a1a2e"/><path d="M8.5,10 L5,32" stroke="#1a1a2e" stroke-width="2.5" stroke-linecap="round"/></svg>',
    rest_sixteenth: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 40"><circle cx="11" cy="6" r="3" fill="#1a1a2e"/><circle cx="13" cy="14" r="3" fill="#1a1a2e"/><path d="M8.5,8 L3,36" stroke="#1a1a2e" stroke-width="2.5" stroke-linecap="round"/></svg>'
};

function preloadNoteImages() {
    // Create images synchronously with proper loading checks
    Object.keys(NOTE_SVG_STRINGS).forEach(function(key) {
        var img = new Image();
        img.onload = function() { 
            // Image loaded, safe to use
        };
        img.onerror = function() {
            console.warn('Failed to load note image:', key);
        };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(NOTE_SVG_STRINGS[key]);
        NOTE_IMAGES[key] = img;
    });
}

// --- 關卡與歌曲資料 ---
const LEARNING_LEVELS = [
    { id: 1, title: '🎵 四個四分音符', bpm: 90, measures: 4, pattern: [{b:0, t:'quarter'}, {b:1, t:'quarter'}, {b:2, t:'quarter'}, {b:3, t:'quarter'}] },
    { id: 2, title: '♪ 八分組合', bpm: 90, measures: 4, pattern: [{b:0, t:'quarter'}, {b:1, t:'eighth'}, {b:1.5, t:'eighth'}, {b:2, t:'quarter'}, {b:3, t:'quarter'}] },
    { id: 3, title: '⏸️ 四分休止符', bpm: 90, measures: 4, pattern: [{b:0, t:'quarter'}, {b:1, t:'quarter'}, {b:2, t:'quarter'}, {b:3, t:'rest', subtype: 'quarter'}] },
    { id: 4, title: '⏹️ 二分休止符', bpm: 90, measures: 4, pattern: [{b:0, t:'rest', subtype: 'half'}, {b:2, t:'rest', subtype: 'half'}] },
    { id: 5, title: '🎼 全音符', bpm: 90, measures: 4, pattern: [{b:0, t:'whole'}] },
    { id: 6, title: '♫ 十六分音符', bpm: 90, measures: 4, pattern: [{b:0, t:'sixteenth'}, {b:0.25, t:'sixteenth'}, {b:0.5, t:'sixteenth'}, {b:0.75, t:'sixteenth'}, {b:1, t:'quarter'}, {b:2, t:'quarter'}, {b:3, t:'quarter'}] }
];

const SONGS = [
    { id: 's_rhythm_stars', title: '⭐ Rhythm Stars', bpm: 126, offset: 0.1, url: './Rhythm_Stars_.mp3', theme: 'stars', emoji: '⭐✨🌟' },
    { id: 's1', title: '🏜️ Hotel California', bpm: 75, offset: 0, url: '', theme: 'desert', emoji: '🏜️🌅🎸' },
    { id: 's2', title: '🎵 用背脊唱情歌', bpm: 76, offset: 0, url: './用背脊唱情歌-official-video.mp3', theme: 'love', emoji: '💝🎤🌹' }
];

// --- 初始化 ---
function initApp() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    document.getElementById('start-overlay').classList.add('hidden');
    isAppReady = true;
    preloadNoteImages();
    initFirebase();
    renderLevelList();
    renderSongList();
    // Check for student profile
    if (!loadStudentProfile()) {
        showStudentProfileForm();
    } else {
        updateStudentBadge();
    }
}

function showToast(msg) {
    const t = document.getElementById('toast-msg');
    t.innerText = msg; t.classList.replace('opacity-0', 'opacity-100');
    setTimeout(() => t.classList.replace('opacity-100', 'opacity-0'), 3000);
}

function renderLevelList() {
    const list = document.getElementById('level-list');
    const emojis = ['🎵', '🎶', '♪', '♫', '🎼', '🎹'];
    list.innerHTML = LEARNING_LEVELS.map(lvl => {
        const emoji = emojis[lvl.id % emojis.length];
        return `
        <div class="level-card cursor-pointer hover:scale-105 transition-transform" onclick="startLearning(${lvl.id})">
            <div class="level-num-badge">${lvl.id}</div>
            <div class="level-card-header p-5 pl-10 flex justify-between items-center">
                <div class="font-black text-slate-800 text-xl">${lvl.title}</div>
                <div class="text-4xl">${emoji}</div>
            </div>
        </div>`;
    }).join('');
}

function renderSongList() {
    const list = document.getElementById('song-list');
    list.innerHTML = SONGS.map(song => {
        const themeEmojis = {
            stars: '⭐✨🌟💫',
            desert: '🏜️🌅🎸🤠',
            love: '💝🎤🌹💕',
        };
        const themeEmoji = themeEmojis[song.theme]?.split('')[Math.floor(Math.random() * themeEmojis[song.theme]?.length)] || '🎵';
        return `
        <div class="song-card hover:shadow-lg transition-all">
            <div class="song-card-title text-slate-800 flex items-center gap-2">
                <span class="text-2xl">${themeEmoji}</span>
                <span>${song.title}</span>
            </div>
            <div class="song-card-diffs">
                <div class="diff-btn" onclick="startSong('${song.id}', '簡單')">簡單</div>
                <div class="diff-btn border-l border-r border-slate-100" onclick="startSong('${song.id}', '中等')">中等</div>
                <div class="diff-btn" onclick="startSong('${song.id}', '困難')">困難</div>
            </div>
        </div>`;
    }).join('');
}

function switchTab(tabId) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.view-panel').forEach(el => el.classList.add('hidden'));
    if(tabId === 'learning') { document.getElementById('view-learning').classList.remove('hidden'); document.querySelectorAll('.nav-item')[0].classList.add('active'); }
    else if(tabId === 'performance') { document.getElementById('view-performance').classList.remove('hidden'); document.querySelectorAll('.nav-item')[1].classList.add('active'); }
    else if(tabId === 'competition') { document.querySelectorAll('.nav-item')[2].classList.add('active'); document.getElementById('view-comp-login').classList.remove('hidden'); if (studentProfile) { document.getElementById('comp-player-info').innerText = studentProfile.className + ' ' + studentProfile.name + ' (#' + studentProfile.studentNo + ')'; } }
    else if(tabId === 'leaderboard') { document.getElementById('view-leaderboard').classList.remove('hidden'); document.querySelectorAll('.nav-item')[3].classList.add('active'); renderLeaderboard(); }
}

function generateSongPattern(songId, difficulty) {
    // Rhythm Stars patterns
    if (songId === 's_rhythm_stars') {
        if (difficulty === '簡單') return [{b:0,t:'quarter'},{b:1,t:'quarter'},{b:2,t:'quarter'},{b:3,t:'quarter'}];
        if (difficulty === '中等') return [{b:0,t:'quarter'},{b:1,t:'eighth'},{b:1.5,t:'eighth'},{b:2,t:'quarter'},{b:3,t:'quarter'}];
        if (difficulty === '困難') return [{b:0,t:'eighth'},{b:0.5,t:'eighth'},{b:1,t:'eighth'},{b:1.5,t:'eighth'},{b:2,t:'quarter'},{b:3,t:'quarter'}];
    }
    // 用背脊唱情歌 patterns with VARIED rhythms (76 BPM ballad)
    if (songId === 's2') {
        if (difficulty === '簡單') return 'VARIED_EASY_S2';
        if (difficulty === '中等') return 'VARIED_MEDIUM_S2';
        if (difficulty === '困難') return 'VARIED_HARD_S2';
    }
    // Default pattern
    return [{b:0,t:'quarter'},{b:1,t:'eighth'},{b:1.5,t:'eighth'},{b:2,t:'quarter'},{b:3,t:'quarter'}];
}

function getVariedMeasurePattern(songId, difficulty, measureIndex) {
    // Get a different rhythm for each measure - 8 varied patterns for richness
    if (songId === 's2' && difficulty === '簡單') {
        const patterns = [
            [{b:0,t:'quarter'},{b:1,t:'quarter'},{b:2,t:'quarter'},{b:3,t:'rest'}],
            [{b:0,t:'quarter'},{b:1,t:'quarter'},{b:2,t:'rest'},{b:3,t:'quarter'}],
            [{b:0,t:'quarter'},{b:1,t:'rest'},{b:2,t:'quarter'},{b:3,t:'quarter'}],
            [{b:0,t:'rest'},{b:1,t:'quarter'},{b:2,t:'quarter'},{b:3,t:'quarter'}],
            [{b:0,t:'quarter'},{b:1,t:'quarter'},{b:2,t:'quarter'},{b:3,t:'quarter'}],
            [{b:0,t:'half'},{b:2,t:'half'}],
            [{b:0,t:'quarter'},{b:2,t:'quarter'},{b:3,t:'quarter'},{b:3.5,t:'eighth'}],
            [{b:0.5,t:'eighth'},{b:1,t:'quarter'},{b:2,t:'quarter'},{b:3,t:'quarter'}]
        ];
        return patterns[measureIndex % patterns.length];
    }
    if (songId === 's2' && difficulty === '中等') {
        const patterns = [
            [{b:0,t:'quarter'},{b:1,t:'eighth'},{b:1.5,t:'eighth'},{b:2,t:'quarter'},{b:3,t:'quarter'}],
            [{b:0,t:'eighth'},{b:0.5,t:'eighth'},{b:1,t:'quarter'},{b:2,t:'eighth'},{b:2.5,t:'eighth'},{b:3,t:'quarter'}],
            [{b:0,t:'quarter'},{b:1,t:'quarter'},{b:2,t:'eighth'},{b:2.5,t:'eighth'},{b:3,t:'quarter'}],
            [{b:0,t:'eighth'},{b:0.5,t:'eighth'},{b:1,t:'eighth'},{b:1.5,t:'eighth'},{b:2,t:'quarter'},{b:3,t:'rest', subtype:'quarter'}],
            [{b:0,t:'quarter'},{b:1,t:'quarter'},{b:2,t:'quarter'},{b:3,t:'quarter'}],
            [{b:0,t:'half'},{b:2,t:'eighth'},{b:2.5,t:'eighth'},{b:3,t:'quarter'}],
            [{b:0,t:'eighth'},{b:0.5,t:'eighth'},{b:1,t:'eighth'},{b:1.5,t:'eighth'},{b:2,t:'eighth'},{b:2.5,t:'eighth'},{b:3,t:'quarter'}],
            [{b:0,t:'quarter'},{b:1,t:'quarter'},{b:2,t:'quarter'},{b:3,t:'quarter'}]
        ];
        return patterns[measureIndex % patterns.length];
    }
    if (songId === 's2' && difficulty === '困難') {
        const patterns = [
            [{b:0,t:'sixteenth'},{b:0.25,t:'sixteenth'},{b:0.5,t:'sixteenth'},{b:0.75,t:'sixteenth'},{b:1,t:'quarter'},{b:2,t:'quarter'},{b:3,t:'quarter'}],
            [{b:0,t:'quarter'},{b:1,t:'eighth'},{b:1.5,t:'eighth'},{b:2,t:'eighth'},{b:2.5,t:'eighth'},{b:3,t:'eighth'}],
            [{b:0,t:'eighth'},{b:0.5,t:'eighth'},{b:1,t:'eighth'},{b:1.5,t:'eighth'},{b:2,t:'eighth'},{b:2.5,t:'eighth'},{b:3,t:'quarter'}],
            [{b:0,t:'quarter'},{b:1,t:'eighth'},{b:1.5,t:'eighth'},{b:2,t:'quarter'},{b:3,t:'eighth'}],
            [{b:0,t:'eighth'},{b:0.5,t:'eighth'},{b:1,t:'eighth'},{b:1.5,t:'eighth'},{b:2,t:'eighth'},{b:2.5,t:'eighth'},{b:3,t:'eighth'}],
            [{b:0,t:'quarter'},{b:1,t:'quarter'},{b:2,t:'eighth'},{b:2.5,t:'eighth'},{b:3,t:'eighth'}],
            [{b:0,t:'eighth'},{b:0.5,t:'eighth'},{b:1,t:'quarter'},{b:2,t:'quarter'},{b:3,t:'eighth'}],
            [{b:0,t:'quarter'},{b:1,t:'sixteenth'},{b:1.25,t:'sixteenth'},{b:1.5,t:'sixteenth'},{b:1.75,t:'sixteenth'},{b:2,t:'quarter'},{b:3,t:'quarter'}]
        ];
        return patterns[measureIndex % patterns.length];
    }
    return [{b:0,t:'quarter'},{b:1,t:'quarter'},{b:2,t:'quarter'},{b:3,t:'quarter'}];
}

// --- 遊戲引擎核心 ---
const CANVAS_CACHE = { scoreDisp: null, comboDisp: null, progressEl: null };

function launchGameEngine(pattern, bpm, measures, titleText, songId, difficulty, audioOffset = 0) {
    lastGameConfig = { pattern, bpm, measures, titleText, songId, difficulty, audioOffset };
    totalMeasures = measures;
    BEAT_MS = (60 / bpm) * 1000;
    stats = { perfect: 0, miss: 0, score: 0, combo: 0, maxCombo: 0 };
    beatmap = [];
    for (let m = 0; m < totalMeasures; m++) {
        let measurePattern = pattern;
        if (typeof pattern === 'string' && pattern.startsWith('VARIED_')) {
            measurePattern = getVariedMeasurePattern(songId, difficulty, m);
        }
        measurePattern.forEach(n => {
            beatmap.push({
                measure: m,
                beatInMeasure: n.b,
                absoluteBeat: m * 4 + n.b,
                type: n.t,
                hitState: n.t === 'rest' ? 'rest' : 'pending'
            });
        });
    }
    // Note Beaming (eighth and sixteenth notes)
    for (let i = 0; i < beatmap.length - 1; i++) {
        let n1 = beatmap[i], n2 = beatmap[i+1];
        if (n1.measure === n2.measure && n1.hitState !== 'rest' && n2.hitState !== 'rest') {
            if (n1.type === 'eighth' && n2.type === 'eighth' && Math.floor(n1.beatInMeasure) === Math.floor(n2.beatInMeasure)) {
                n1.beamWithNext = true; n2.beamWithPrev = true;
            }
            if (n1.type === 'sixteenth' && n2.type === 'sixteenth' && Math.floor(n1.beatInMeasure * 4) === Math.floor(n2.beatInMeasure * 4)) {
                n1.beamWithNext = true; n2.beamWithPrev = true;
            }
        }
    }
    
    // Pre-group beatmap by measure for faster rendering
    beatmap.measureGroups = {};
    for (let i = 0; i < totalMeasures; i++) beatmap.measureGroups[i] = [];
    beatmap.forEach(n => beatmap.measureGroups[n.measure].push(n));

    document.getElementById('game-title-display').innerText = titleText;
    document.getElementById('game-bpm-display').innerText = `${bpm} BPM`;
    document.getElementById('game-score-display').innerText = '0';
    document.getElementById('game-combo-display').innerText = '';
    document.getElementById('game-combo-display').style.color = 'transparent';
    const progressEl = document.getElementById('game-progress');
    if (progressEl) progressEl.style.width = '0%';
    document.querySelectorAll('.view-panel').forEach(el => el.classList.add('hidden'));
    document.getElementById('bottom-nav').classList.add('hidden');
    document.getElementById('view-game').classList.remove('hidden');

    // Cache DOM elements for gameLoop
    CANVAS_CACHE.scoreDisp = document.getElementById('game-score-display');
    CANVAS_CACHE.comboDisp = document.getElementById('game-combo-display');
    CANVAS_CACHE.progressEl = document.getElementById('game-progress');

    // Countdown then start
    showCountdown(() => {
        gameStartTime = audioCtx.currentTime + 0.3; isPlaying = true;
        if (bgmBuffer && currentGameMode !== 'learning') {
            bgmSource = audioCtx.createBufferSource(); bgmSource.buffer = bgmBuffer; bgmSource.connect(audioCtx.destination);
            bgmSource.start(gameStartTime + (audioOffset > 0 ? audioOffset : 0), audioOffset < 0 ? Math.abs(audioOffset) : 0);
        }
        animationId = requestAnimationFrame(gameLoop);
    });
}

function showCountdown(callback) {
    const nums = ['3', '2', '1', '🎵'];
    let i = 0;
    const overlay = document.createElement('div');
    overlay.className = 'countdown-overlay';
    document.body.appendChild(overlay);

    function showNext() {
        if (i >= nums.length) {
            overlay.remove();
            callback();
            return;
        }
        overlay.innerHTML = `<div class="countdown-num">${nums[i]}</div>`;
        i++;
        setTimeout(showNext, 700);
    }
    showNext();
}

function replayGame() {
    if (!lastGameConfig) { exitGame(); return; }
    const c = lastGameConfig;
    // Hide result views
    const resultNormal = document.getElementById('view-result-normal');
    const resultComp = document.getElementById('view-result-comp');
    if (resultNormal) resultNormal.classList.add('hidden');
    if (resultComp) resultComp.classList.add('hidden');

    if (currentGameMode === 'learning') {
        launchGameEngine(c.pattern, c.bpm, c.measures, c.titleText, c.songId, c.difficulty, c.audioOffset);
    } else if (bgmBuffer) {
        launchGameEngine(c.pattern, c.bpm, c.measures, c.titleText, c.songId, c.difficulty, c.audioOffset);
    } else if (c.songId) {
        startSong(c.songId, c.difficulty);
    } else {
        exitGame();
    }
}

function startLearning(id) {
    const lvl = LEARNING_LEVELS.find(l => l.id === id);
    currentGameMode = 'learning'; bgmBuffer = null;
    launchGameEngine(lvl.pattern, lvl.bpm, lvl.measures, `Lv.${lvl.id} ${lvl.title}`, null, null);
}

function startSong(id, diff) {
    const song = SONGS.find(s => s.id === id);
    if (!song) { showToast("❌ 曲目不存在"); return; }
    const pattern = generateSongPattern(id, diff);
    currentGameMode = 'performance';
    const measures = id === 's2' ? 50 : 8; // Full song duration for s2
    if (song.url) {
        showToast("🎵 載入中...");
        fetch(song.url)
            .then(r => {
                if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
                return r.arrayBuffer();
            })
            .then(ab => audioCtx.decodeAudioData(ab))
            .then(buf => {
                if (!buf) throw new Error('Failed to decode audio');
                bgmBuffer = buf;
                launchGameEngine(pattern, song.bpm, measures, song.title, id, diff, song.offset);
            })
            .catch(err => {
                console.error('Audio loading error:', err);
                showToast("❌ 無法載入音樂，請檢查檔案");
                launchGameEngine(pattern, song.bpm, measures, song.title, id, diff);
            });
    } else {
        bgmBuffer = null;
        launchGameEngine(pattern, song.bpm, measures, song.title, id, diff);
    }
}

function loginCompetition() { if(studentProfile) startCompetitionMatch(); else showStudentProfileForm(); }
function startCompetitionMatch() {
    currentGameMode = 'competition';
    const loginView = document.getElementById('view-comp-login');
    const resultView = document.getElementById('view-result-comp');
    if (loginView) loginView.classList.add('hidden');
    if (resultView) resultView.classList.add('hidden');
    const song = SONGS[0];
    if (!song) { showToast("❌ 無法開始競技"); return; }
    const pattern = generateSongPattern(song.id, '簡單');
    bgmBuffer = null;
    if (song.url) {
        showToast("🎵 載入中...");
        fetch(song.url)
            .then(r => {
                if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
                return r.arrayBuffer();
            })
            .then(ab => audioCtx.decodeAudioData(ab))
            .then(buf => {
                if (!buf) throw new Error('Failed to decode audio');
                bgmBuffer = buf;
                launchGameEngine(pattern, song.bpm, 6, "競技挑戰", song.id, '簡單', song.offset);
            })
            .catch(err => {
                console.error('Competition audio loading error:', err);
                showToast("❌ 無法載入競技音樂，改為靜音模式");
                launchGameEngine(pattern, song.bpm, 6, "競技挑戰", song.id, '簡單', song.offset);
            });
        return;
    }
    launchGameEngine(pattern, song.bpm, 6, "競技挑戰", song.id, '簡單', song.offset);
}

function exitGame() {
    isPlaying = false;
    isPaused = false;
    pausedAt = 0;
    cancelAnimationFrame(animationId);
    
    if (bgmSource) {
        try {
            bgmSource.stop();
        } catch (e) {
            console.warn('Audio stop error:', e);
        }
        bgmSource = null;
    }
    
    const pauseOverlay = document.getElementById('pause-overlay');
    if (pauseOverlay) pauseOverlay.classList.add('hidden');
    
    const views = [
        document.getElementById('view-game'),
        document.getElementById('view-result-normal'),
        document.getElementById('view-result-comp')
    ];
    
    views.forEach(view => {
        if (view) view.classList.add('hidden');
    });
    
    const navBar = document.getElementById('bottom-nav');
    if (navBar) navBar.classList.remove('hidden');
    
    switchTab(currentGameMode === 'learning' ? 'learning' : (currentGameMode === 'performance' ? 'performance' : 'competition'));
}

function pauseGame() {
    if (!isPlaying || isPaused) return;
    isPaused = true;
    isPlaying = false;
    cancelAnimationFrame(animationId);
    pausedAt = audioCtx.currentTime - gameStartTime;
    if (bgmSource) {
        try { bgmSource.stop(); } catch (e) {}
        bgmSource = null;
    }
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.classList.remove('hidden');
}

function resumeGame() {
    if (!isPaused) return;
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.classList.add('hidden');
    isPaused = false;
    isPlaying = true;
    gameStartTime = audioCtx.currentTime - pausedAt;
    if (bgmBuffer && currentGameMode !== 'learning' && lastGameConfig) {
        const ao = lastGameConfig.audioOffset || 0;
        // buffer position at pause = pausedAt - ao
        const bufferPos = Math.max(0, pausedAt - ao);
        bgmSource = audioCtx.createBufferSource();
        bgmSource.buffer = bgmBuffer;
        bgmSource.connect(audioCtx.destination);
        bgmSource.start(0, bufferPos);
    }
    animationId = requestAnimationFrame(gameLoop);
}

// --- 繪圖邏輯 ---
const canvas = document.getElementById('gameCanvas'), ctx = canvas.getContext('2d');

function drawRest(x, yTop, restType) {
    const ly = yTop + LINE_Y_OFFSET;
    const imgKey = 'rest_' + restType;
    const img = NOTE_IMAGES[imgKey];
    
    // Try image first, fall back to canvas if needed
    if (img && img.naturalWidth > 0) {
        try {
            switch (restType) {
                case 'whole': ctx.drawImage(img, x - 11, ly - 4, 22, 14); break;
                case 'half': ctx.drawImage(img, x - 11, ly - 12, 22, 14); break;
                case 'quarter': ctx.drawImage(img, x - 8, ly - 22, 16, 44); break;
                case 'eighth': ctx.drawImage(img, x - 8, ly - 18, 16, 36); break;
                case 'sixteenth': ctx.drawImage(img, x - 9, ly - 20, 18, 40); break;
            }
            return;
        } catch (e) { /* fallback */ }
    }
    
    // Fallback: simple canvas drawing
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    switch (restType) {
        case 'whole': ctx.fillRect(x - 7, ly, 14, 7); break;
        case 'half': ctx.fillRect(x - 7, ly - 7, 14, 7); break;
        case 'quarter':
            ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath(); ctx.moveTo(x + 4, ly - 12); ctx.lineTo(x - 4, ly - 5);
            ctx.lineTo(x + 4, ly + 1); ctx.lineTo(x - 3, ly + 8); ctx.stroke();
            ctx.beginPath(); ctx.arc(x - 4, ly + 11, 2.5, 0, Math.PI * 2); ctx.fill();
            break;
        case 'eighth':
            ctx.beginPath(); ctx.moveTo(x, ly - 10); ctx.lineTo(x, ly + 4); ctx.stroke();
            ctx.beginPath(); ctx.arc(x + 3, ly - 8, 3, 0, Math.PI*2); ctx.stroke();
            break;
        case 'sixteenth':
            ctx.beginPath(); ctx.moveTo(x, ly - 12); ctx.lineTo(x, ly + 4); ctx.stroke();
            ctx.beginPath(); ctx.arc(x + 3, ly - 9, 2.5, 0, Math.PI*2);
            ctx.arc(x + 3, ly - 5, 2.5, 0, Math.PI*2); ctx.stroke();
            break;
    }
}

function drawNote(x, yTop, note, measureWidth) {
    // Handle rest symbols
    if (note.type === 'rest') {
        drawRest(x, yTop, note.subtype || 'quarter');
        return;
    }
    
    const ly = yTop + LINE_Y_OFFSET, sy = ly - 40;
    const noteHeadW = 18, noteHeadH = 12;

    // --- WHOLE NOTE ---
    if (note.type === 'whole') {
        const img = NOTE_IMAGES.whole;
        if (img && img.naturalWidth > 0) {
            try { ctx.drawImage(img, x - 12, ly - 8, 24, 16); return; } catch (e) { }
        }
        ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, ly, 7, 5.5, 0.1, 0, Math.PI*2); ctx.stroke();
        return;
    }

    // --- HALF NOTE ---
    if (note.type === 'half') {
        const headImg = NOTE_IMAGES.headHollow;
        if (headImg && headImg.naturalWidth > 0) {
            try { ctx.drawImage(headImg, x - noteHeadW/2, ly - noteHeadH/2, noteHeadW, noteHeadH); } catch (e) {
                ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.ellipse(x, ly, 7, 5.5, 0.1, 0, Math.PI*2); ctx.stroke();
            }
        } else {
            ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(x, ly, 7, 5.5, 0.1, 0, Math.PI*2); ctx.stroke();
        }
        // Stem
        const stemX = x + noteHeadW/2;
        ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(stemX, ly); ctx.lineTo(stemX, sy); ctx.stroke();
        return;
    }

    // --- QUARTER, EIGHTH, SIXTEENTH ---
    const headImg = NOTE_IMAGES.headFilled;
    if (headImg && headImg.naturalWidth > 0) {
        try { ctx.drawImage(headImg, x - noteHeadW/2, ly - noteHeadH/2, noteHeadW, noteHeadH); } catch (e) {
            ctx.fillStyle = '#1a1a2e';
            ctx.beginPath(); ctx.ellipse(x, ly, 7, 5.5, 0.1, 0, Math.PI*2); ctx.fill();
        }
    } else {
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.ellipse(x, ly, 7, 5.5, 0.1, 0, Math.PI*2); ctx.fill();
    }
    
    // Stem
    const stemX = x + noteHeadW/2;
    ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(stemX, ly); ctx.lineTo(stemX, sy); ctx.stroke();
    
    // Flags or beams for eighth/sixteenth
    if (note.type === 'eighth' || note.type === 'sixteenth') {
        if (note.beamWithNext) {
            const beamCount = note.type === 'sixteenth' ? 2 : 1;
            const beatStep = note.type === 'sixteenth' ? 0.25 : 0.5;
            const nStemX = x + (beatStep / 4) * measureWidth + noteHeadW/2;
            ctx.lineWidth = 5;
            for (let b = 0; b < beamCount; b++) {
                ctx.beginPath();
                ctx.moveTo(stemX, sy + b * 8);
                ctx.lineTo(nStemX, sy + b * 8);
                ctx.stroke();
            }
        } else if (!note.beamWithPrev) {
            // Single flag(s)
            const flagCount = note.type === 'sixteenth' ? 2 : 1;
            ctx.lineWidth = 3;
            for (let f = 0; f < flagCount; f++) {
                ctx.beginPath();
                ctx.moveTo(stemX, sy + f * 10);
                ctx.quadraticCurveTo(stemX + 10, sy + f * 10 + 6, stemX + 8, sy + f * 10 + 16);
                ctx.stroke();
            }
        }
    }
}

function gameLoop() {
    if (!isPlaying) return;
    const now = audioCtx.currentTime, absBeat = (now - gameStartTime) / (BEAT_MS / 1000);
    ctx.clearRect(0, 0, 800, 360);
    const mWidth = 800 - PADDING_X * 2, rows = currentGameMode === 'learning' ? 1 : 3, vOff = currentGameMode === 'learning' ? 120 : 0;
    const curMIdx = Math.max(0, Math.floor(absBeat / 4));

    // === UPDATE HUD (only if changed) ===
    if (CANVAS_CACHE.scoreDisp && CANVAS_CACHE.scoreDisp.innerText !== stats.score.toString()) {
        CANVAS_CACHE.scoreDisp.innerText = stats.score;
    }
    
    let comboText = '';
    if (stats.combo >= 3) {
        comboText = `🔥 ${stats.combo} combo`;
        const newColor = stats.combo >= 20 ? '#FFD700' : stats.combo >= 10 ? '#FF69B4' : 'rgba(255,255,255,0.8)';
        if (CANVAS_CACHE.comboDisp && CANVAS_CACHE.comboDisp.innerText !== comboText) {
            CANVAS_CACHE.comboDisp.innerText = comboText;
            CANVAS_CACHE.comboDisp.style.color = newColor;
        }
    } else if (CANVAS_CACHE.comboDisp && CANVAS_CACHE.comboDisp.innerText !== '') {
        CANVAS_CACHE.comboDisp.innerText = '';
        CANVAS_CACHE.comboDisp.style.color = 'transparent';
    }
    
    // Progress bar
    if (CANVAS_CACHE.progressEl) {
        const pct = Math.min(100, (absBeat / (totalMeasures * 4)) * 100);
        const newWidth = pct + '%';
        if (CANVAS_CACHE.progressEl.style.width !== newWidth) {
            CANVAS_CACHE.progressEl.style.width = newWidth;
        }
    }

    // === RENDER NOTES (use pre-grouped beatmap) ===
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#cbd5e1';
    ctx.fillStyle = '#1a1a2e';
    ctx.strokeStyle = '#1e293b';
    
    for (let i = 0; i < rows; i++) {
        const midx = curMIdx + i; 
        if (midx >= totalMeasures) break;
        
        const yTop = i * ROW_HEIGHT + vOff, ly = yTop + LINE_Y_OFFSET;
        
        // Draw measure line
        ctx.beginPath(); 
        ctx.moveTo(PADDING_X - 20, ly); 
        ctx.lineTo(800 - PADDING_X + 20, ly); 
        ctx.lineWidth = 2; 
        ctx.strokeStyle = '#cbd5e1'; 
        ctx.stroke();
        
        // Draw notes from pre-grouped beatmap (much faster)
        const measureNotes = beatmap.measureGroups[midx] || [];
        for (let n of measureNotes) {
            const nx = PADDING_X + (n.beatInMeasure / 4) * mWidth;
            drawNote(nx, yTop, n, mWidth);
            
            // Only show hit indicators for notes, not rests
            if (n.hitState !== 'rest') {
                const dy = yTop + DOT_Y_OFFSET;
                if (n.hitState === 'pending' && absBeat > n.absoluteBeat + 0.3) { 
                    n.hitState = 'miss'; 
                    stats.miss++; 
                    if (stats.combo >= 3) showHitFeedback('Miss...', '#ef4444');
                    stats.combo = 0; 
                }
                
                ctx.beginPath(); 
                ctx.arc(nx, dy, 6, 0, Math.PI*2);
                if (n.hitState === 'pending') { 
                    ctx.strokeStyle = '#94a3b8'; 
                    ctx.lineWidth = 2; 
                    ctx.stroke(); 
                }
                else if (n.hitState === 'perfect') { 
                    ctx.fillStyle = '#22c55e'; 
                    ctx.fill(); 
                }
                else if (n.hitState === 'miss') { 
                    ctx.strokeStyle = '#ef4444'; 
                    ctx.lineWidth = 2; 
                    ctx.stroke(); 
                }
                else { 
                    ctx.fillStyle = '#ef4444'; 
                    ctx.fill(); 
                }
            }
        }
        
        // Draw playhead
        if (midx === curMIdx) {
            const px = PADDING_X + (Math.max(0, Math.min(4, absBeat - midx * 4)) / 4) * mWidth;
            ctx.beginPath(); 
            ctx.moveTo(px, yTop + 10); 
            ctx.lineTo(px, yTop + ROW_HEIGHT - 10); 
            ctx.lineWidth = 4; 
            ctx.strokeStyle = '#3b82f6'; 
            ctx.stroke();
        }
    }
    
    if (absBeat > totalMeasures * 4 + 0.5) { finishGame(); return; }
    animationId = requestAnimationFrame(gameLoop);
}

function handleHit() {
    if (!isPlaying || gameStartTime === 0 || !beatmap || beatmap.length === 0) return;
    
    const pad = document.getElementById('hit-pad');
    if (pad) {
        pad.classList.add('active-hit');
        setTimeout(() => pad.classList.remove('active-hit'), 100);
        // Ripple effect
        const ripple = document.createElement('div');
        ripple.className = 'hit-ripple';
        ripple.style.width = ripple.style.height = '80px';
        ripple.style.left = '50%';
        ripple.style.top = '50%';
        ripple.style.marginLeft = '-40px';
        ripple.style.marginTop = '-40px';
        pad.appendChild(ripple);
        setTimeout(() => ripple.remove(), 500);
    }
    
    const now = audioCtx.currentTime;
    const absBeat = (now - gameStartTime) / (BEAT_MS / 1000);
    
    const pendingNotes = beatmap.filter(n => n.hitState === 'pending');
    if (pendingNotes.length === 0) return;
    
    let closest = pendingNotes[0];
    for (let n of pendingNotes) {
        if (Math.abs(n.absoluteBeat - absBeat) < Math.abs(closest.absoluteBeat - absBeat)) {
            closest = n;
        }
    }
    
    if (closest && Math.abs(closest.absoluteBeat - absBeat) < 0.3) {
        closest.hitState = 'perfect';
        stats.perfect++;
        stats.combo++;
        stats.score += 10 + (Math.floor(stats.combo / 5) * 5);
        if (stats.combo > stats.maxCombo) stats.maxCombo = stats.combo;
        
        // Visual feedback
        showHitFeedback('Perfect!', '#22c55e');
        if (stats.combo > 0 && stats.combo % 10 === 0) {
            spawnStarParticles();
        }
    }
}

function showHitFeedback(text, color) {
    const el = document.createElement('div');
    el.className = 'hit-feedback';
    el.innerText = text;
    el.style.color = color;
    el.style.left = '50%';
    el.style.top = '40%';
    el.style.transform = 'translateX(-50%)';
    document.getElementById('view-game').appendChild(el);
    setTimeout(() => el.remove(), 600);
}

function spawnStarParticles() {
    const stars = ['⭐', '✨', '🌟', '💫'];
    for (let i = 0; i < 6; i++) {
        const el = document.createElement('div');
        el.className = 'star-particle';
        el.innerText = stars[Math.floor(Math.random() * stars.length)];
        const angle = (Math.PI * 2 / 6) * i;
        el.style.left = '50%';
        el.style.top = '45%';
        el.style.setProperty('--dx', Math.cos(angle) * 80 + 'px');
        el.style.setProperty('--dy', Math.sin(angle) * 80 + 'px');
        document.getElementById('view-game').appendChild(el);
        setTimeout(() => el.remove(), 800);
    }
}

function getGrade(accuracy) {
    if (accuracy >= 95) return { emoji: '👑', text: 'S 完美!', color: '#FFD700' };
    if (accuracy >= 85) return { emoji: '🌟', text: 'A 太棒了!', color: '#FF69B4' };
    if (accuracy >= 70) return { emoji: '✨', text: 'B 不錯!', color: '#87CEEB' };
    if (accuracy >= 50) return { emoji: '💪', text: 'C 繼續努力', color: '#DDA0DD' };
    return { emoji: '🎯', text: 'D 再試試', color: '#FFB6D9' };
}

function finishGame() {
    isPlaying = false;
    cancelAnimationFrame(animationId);
    
    if (bgmSource) {
        try { bgmSource.stop(); } catch (e) { console.warn('Audio already stopped:', e); }
        bgmSource = null;
    }
    
    const totalBeats = beatmap.filter(n => n.hitState !== 'rest').length || 1;
    const accuracy = Math.round((stats.perfect / totalBeats) * 100);
    
    // Save score to leaderboard
    var levelOrSong = lastGameConfig ? (lastGameConfig.titleText || '') : '';
    saveScoreToLeaderboard(stats.score, accuracy, stats.maxCombo, currentGameMode, levelOrSong);
    
    if (currentGameMode === 'competition') {
        const pPct = accuracy;
        const bPct = 60 + Math.floor(Math.random() * 30);
        
        const playerPctEl = document.getElementById('comp-player-pct');
        const botPctEl = document.getElementById('comp-bot-pct');
        const resultTextEl = document.getElementById('comp-result-text');
        const gameViewEl = document.getElementById('view-game');
        const resultViewEl = document.getElementById('view-result-comp');
        
        if (playerPctEl) playerPctEl.innerText = pPct + "%";
        if (botPctEl) botPctEl.innerText = bPct + "%";
        
        setTimeout(() => {
            const playerRingEl = document.getElementById('comp-player-ring');
            const botRingEl = document.getElementById('comp-bot-ring');
            if (playerRingEl) playerRingEl.setAttribute('stroke-dasharray', `${pPct}, 100`);
            if (botRingEl) botRingEl.setAttribute('stroke-dasharray', `${bPct}, 100`);
        }, 100);
        
        if (resultTextEl) resultTextEl.innerText = pPct >= bPct ? "你贏了" : "你輸了";
        if (gameViewEl) gameViewEl.classList.add('hidden');
        if (resultViewEl) resultViewEl.classList.remove('hidden');
    } else {
        const grade = getGrade(accuracy);
        
        const gradeEl = document.getElementById('result-grade');
        const titleEl = document.getElementById('result-title');
        const accEl = document.getElementById('result-accuracy');
        const perfEl = document.getElementById('res-perfect');
        const missEl = document.getElementById('res-miss');
        const scoreEl = document.getElementById('res-score');
        const comboEl = document.getElementById('res-combo');
        const gameViewEl = document.getElementById('view-game');
        const resultViewEl = document.getElementById('view-result-normal');
        
        if (gradeEl) gradeEl.innerText = grade.emoji;
        if (titleEl) { titleEl.innerText = grade.text; titleEl.style.color = grade.color; }
        if (accEl) accEl.innerText = `正確率 ${accuracy}%`;
        if (perfEl) perfEl.innerText = stats.perfect;
        if (missEl) missEl.innerText = stats.miss;
        if (scoreEl) scoreEl.innerText = stats.score;
        if (comboEl) comboEl.innerText = stats.maxCombo;
        if (gameViewEl) gameViewEl.classList.add('hidden');
        if (resultViewEl) resultViewEl.classList.remove('hidden');
    }
}

// Event listeners with error handling
const hitPad = document.getElementById('hit-pad');
if (hitPad) {
    hitPad.addEventListener('mousedown', handleHit);
    hitPad.addEventListener('touchstart', e => { e.preventDefault(); handleHit(); }, {passive: false});
}

window.addEventListener('keydown', e => {
    if (e.code === 'Space') {
        e.preventDefault();
        if (isPaused) resumeGame();
        else handleHit();
    }
    if (e.code === 'Escape') {
        if (isPlaying && !isPaused) pauseGame();
        else if (isPaused) resumeGame();
    }
});
