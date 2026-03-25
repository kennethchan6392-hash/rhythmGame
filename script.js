// --- 核心變數 ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let isAppReady = false, playerName = "Player", playerRating = 1500, currentGameMode = 'learning';
let bgmBuffer = null, bgmSource = null;
let beatmap = [], BEAT_MS = 0, totalMeasures = 0, isPlaying = false, gameStartTime = 0, animationId;
let stats = { perfect: 0, miss: 0, score: 0, combo: 0, maxCombo: 0 };

const ROW_HEIGHT = 120, PADDING_X = 60, LINE_Y_OFFSET = 50, DOT_Y_OFFSET = 85;

// --- 關卡與歌曲資料 ---
const LEARNING_LEVELS = [
    { id: 1, title: '🎵 四個四分音符', bpm: 90, measures: 4, pattern: [{b:0, t:'quarter'}, {b:1, t:'quarter'}, {b:2, t:'quarter'}, {b:3, t:'quarter'}] },
    { id: 2, title: '♪ 八分組合', bpm: 90, measures: 4, pattern: [{b:0, t:'quarter'}, {b:1, t:'eighth'}, {b:1.5, t:'eighth'}, {b:2, t:'quarter'}, {b:3, t:'quarter'}] },
    { id: 3, title: '⏸️ 四分休止符', bpm: 90, measures: 4, pattern: [{b:0, t:'quarter'}, {b:1, t:'quarter'}, {b:2, t:'quarter'}, {b:3, t:'rest', subtype: 'quarter'}] },
    { id: 4, title: '⏹️ 二分休止符', bpm: 90, measures: 4, pattern: [{b:0, t:'half'}, {b:2, t:'half'}] },
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
    renderLevelList();
    renderSongList();
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
    else if(tabId === 'competition') { document.querySelectorAll('.nav-item')[2].classList.add('active'); if(!document.getElementById('player-name').value.trim()) document.getElementById('view-comp-login').classList.remove('hidden'); else startCompetitionMatch(); }
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
function launchGameEngine(pattern, bpm, measures, titleText, songId, difficulty, audioOffset = 0) {
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
            // Eighth notes
            if (n1.type === 'eighth' && n2.type === 'eighth' && Math.floor(n1.beatInMeasure) === Math.floor(n2.beatInMeasure)) {
                n1.beamWithNext = true; n2.beamWithPrev = true;
            }
            // Sixteenth notes (group of 4)
            if (n1.type === 'sixteenth' && n2.type === 'sixteenth' && Math.floor(n1.beatInMeasure * 4) === Math.floor(n2.beatInMeasure * 4)) {
                n1.beamWithNext = true; n2.beamWithPrev = true;
            }
        }
    }

    document.getElementById('game-title-display').innerText = titleText;
    document.getElementById('game-bpm-display').innerText = `${bpm} bpm`;
    document.querySelectorAll('.view-panel').forEach(el => el.classList.add('hidden'));
    document.getElementById('bottom-nav').classList.add('hidden');
    document.getElementById('view-game').classList.remove('hidden');

    setTimeout(() => {
        gameStartTime = audioCtx.currentTime + 1.5; isPlaying = true;
        if (bgmBuffer && currentGameMode !== 'learning') {
            bgmSource = audioCtx.createBufferSource(); bgmSource.buffer = bgmBuffer; bgmSource.connect(audioCtx.destination);
            bgmSource.start(gameStartTime + (audioOffset > 0 ? audioOffset : 0), audioOffset < 0 ? Math.abs(audioOffset) : 0);
        }
        animationId = requestAnimationFrame(gameLoop);
    }, 500);
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

function loginCompetition() { playerName = document.getElementById('player-name').value.trim(); if(playerName) startCompetitionMatch(); }
function startCompetitionMatch() {
    currentGameMode = 'competition';
    const loginView = document.getElementById('view-comp-login');
    const resultView = document.getElementById('view-result-comp');
    if (loginView) loginView.classList.add('hidden');
    if (resultView) resultView.classList.add('hidden');
    const song = SONGS[0];
    if (!song) { showToast("❌ 無法開始競技"); return; }
    launchGameEngine(generateSongPattern(song.id, '簡單'), song.bpm, 6, "競技挑戰", song.id, '簡單', song.offset);
}

function exitGame() {
    isPlaying = false;
    cancelAnimationFrame(animationId);
    
    if (bgmSource) {
        try {
            bgmSource.stop();
        } catch (e) {
            console.warn('Audio stop error:', e);
        }
        bgmSource = null;
    }
    
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

// --- 繪圖邏輯 ---
const canvas = document.getElementById('gameCanvas'), ctx = canvas.getContext('2d');

function drawRest(x, yTop, restType) {
    const ly = yTop + LINE_Y_OFFSET;
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    
    switch (restType) {
        case 'whole':
            // Whole rest: filled rectangle on middle line
            ctx.fillRect(x - 6, ly + 5, 12, 6);
            break;
        case 'half':
            // Half rest: filled rectangle below middle line
            ctx.fillRect(x - 6, ly - 5, 12, 6);
            break;
        case 'quarter':
            // Quarter rest: proper sheet music symbol
            ctx.lineWidth = 2;
            ctx.beginPath();
            // Main stem down center
            ctx.moveTo(x, ly - 8);
            ctx.lineTo(x, ly + 8);
            ctx.stroke();
            // Upper curves (decorative top)
            ctx.beginPath();
            ctx.arc(x - 3, ly - 4, 2.5, 0, Math.PI, false);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x + 3, ly - 1, 2.5, Math.PI, 0, false);
            ctx.stroke();
            // Lower curve (decorative bottom)
            ctx.beginPath();
            ctx.arc(x - 3, ly + 4, 2.5, Math.PI, 0, false);
            ctx.stroke();
            break;
        case 'eighth':
            // Eighth rest: quarter rest with flag
            ctx.beginPath();
            ctx.moveTo(x, ly - 10);
            ctx.lineTo(x, ly + 4);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x + 3, ly - 8, 3, 0, Math.PI*2);
            ctx.stroke();
            break;
        case 'sixteenth':
            // Sixteenth rest: two flags
            ctx.beginPath();
            ctx.moveTo(x, ly - 12);
            ctx.lineTo(x, ly + 4);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x + 3, ly - 9, 2.5, 0, Math.PI*2);
            ctx.arc(x + 3, ly - 5, 2.5, 0, Math.PI*2);
            ctx.stroke();
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
    const noteRadius = 7;
    const stemX = x + noteRadius + 2;
    const stemWidth = 2;
    
    // Professional note head (filled oval for all note types)
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.ellipse(x, ly, noteRadius, noteRadius - 1.5, 0.1, 0, Math.PI*2);
    ctx.fill();
    
    // Professional stem
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = stemWidth;
    ctx.lineCap = 'round';
    
    if (note.type === 'whole') {
        // Whole notes: hollow head, no stem
        ctx.fillStyle = 'rgba(30, 41, 59, 0)';
        ctx.beginPath();
        ctx.ellipse(x, ly, noteRadius, noteRadius - 1.5, 0.1, 0, Math.PI*2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x, ly, noteRadius, noteRadius - 1.5, 0.1, 0, Math.PI*2);
        ctx.stroke();
    } else if (note.type === 'half') {
        // Half notes: hollow head with stem
        ctx.fillStyle = 'rgba(30, 41, 59, 0)';
        ctx.beginPath();
        ctx.ellipse(x, ly, noteRadius, noteRadius - 1.5, 0.1, 0, Math.PI*2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x, ly, noteRadius, noteRadius - 1.5, 0.1, 0, Math.PI*2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(stemX, ly);
        ctx.lineTo(stemX, sy);
        ctx.stroke();
    } else {
        // Quarter, eighth, sixteenth notes: filled head with stem
        ctx.beginPath();
        ctx.moveTo(stemX, ly);
        ctx.lineTo(stemX, sy);
        ctx.stroke();
        
        if (note.type === 'eighth' || note.type === 'sixteenth') {
            if (note.beamWithNext) {
                // Connect to next note with beam
                const beamCount = note.type === 'sixteenth' ? 2 : 1;
                const nx = x + ((note.type === 'sixteenth' ? 0.25 : 0.5) / 4) * measureWidth + stemX - x;
                ctx.beginPath();
                ctx.moveTo(stemX, sy);
                ctx.lineTo(nx, sy);
                ctx.lineWidth = 5;
                ctx.stroke();
            } else if (!note.beamWithPrev) {
                // Single flag
                const flagHeight = note.type === 'sixteenth' ? 18 : 12;
                ctx.beginPath();
                ctx.moveTo(stemX, sy);
                ctx.quadraticCurveTo(stemX + 8, sy + 5, stemX + 8, sy + flagHeight);
                ctx.lineWidth = 5;
                ctx.lineCap = 'round';
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

    // Display score and combo at top
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 18px Arial';
    ctx.fillText(`Score: ${stats.score}`, PADDING_X, 30);
    ctx.fillText(`Combo: ${stats.combo}`, PADDING_X + 200, 30);
    if (stats.maxCombo > 0) ctx.fillText(`Max: ${stats.maxCombo}`, PADDING_X + 400, 30);

    for (let i = 0; i < rows; i++) {
        const midx = curMIdx + i; if (midx >= totalMeasures) break;
        const yTop = i * ROW_HEIGHT + vOff, ly = yTop + LINE_Y_OFFSET;
        ctx.beginPath(); ctx.moveTo(PADDING_X - 20, ly); ctx.lineTo(800 - PADDING_X + 20, ly); ctx.lineWidth = 2; ctx.strokeStyle = '#cbd5e1'; ctx.stroke();
        beatmap.forEach(n => {
            if (n.measure === midx) {
                const nx = PADDING_X + (n.beatInMeasure / 4) * mWidth;
                drawNote(nx, yTop, n, mWidth);
                
                // Only show hit indicators for notes, not rests
                if (n.hitState !== 'rest') {
                    const dy = yTop + DOT_Y_OFFSET;
                    if (n.hitState === 'pending' && absBeat > n.absoluteBeat + 0.3) { n.hitState = 'miss'; stats.miss++; stats.combo = 0; }
                    ctx.beginPath(); ctx.arc(nx, dy, 6, 0, Math.PI*2);
                    if (n.hitState === 'pending') { ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2; ctx.stroke(); }
                    else if (n.hitState === 'perfect') { ctx.fillStyle = '#22c55e'; ctx.fill(); }
                    else if (n.hitState === 'miss') { ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.stroke(); }
                    else { ctx.fillStyle = '#ef4444'; ctx.fill(); }
                }
            }
        });
        if (midx === curMIdx) {
            const px = PADDING_X + (Math.max(0, Math.min(4, absBeat - midx * 4)) / 4) * mWidth;
            ctx.beginPath(); ctx.moveTo(px, yTop + 10); ctx.lineTo(px, yTop + ROW_HEIGHT - 10); ctx.lineWidth = 4; ctx.strokeStyle = '#3b82f6'; ctx.stroke();
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
    }
}

function finishGame() {
    isPlaying = false;
    cancelAnimationFrame(animationId);
    
    // Safely stop audio
    if (bgmSource) {
        try {
            bgmSource.stop();
        } catch (e) {
            console.warn('Audio already stopped:', e);
        }
        bgmSource = null;
    }
    
    // Prevent division by zero
    const totalBeats = beatmap.length || 1;
    
    if (currentGameMode === 'competition') {
        const pPct = beatmap.length > 0 ? Math.round((stats.perfect / totalBeats) * 100) : 0;
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
        const perfEl = document.getElementById('res-perfect');
        const missEl = document.getElementById('res-miss');
        const scoreEl = document.getElementById('res-score');
        const comboEl = document.getElementById('res-combo');
        const gameViewEl = document.getElementById('view-game');
        const resultViewEl = document.getElementById('view-result-normal');
        
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
        handleHit();
    }
});
