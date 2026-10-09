(() => {
    const socket = io();

    const screens = {
        lobby: document.getElementById('screen-lobby'),
        history: document.getElementById('screen-history'),
        waiting: document.getElementById('screen-waiting'),
        secret: document.getElementById('screen-secret'),
        play: document.getElementById('screen-play'),
    };

    const els = {
        toastRoot: document.getElementById('toast-root'),
        userCountNum: document.getElementById('user-count-num'),
        profileChip: document.getElementById('profile-chip'),
        profileName: document.getElementById('profile-name'),
        profileElo: document.getElementById('profile-elo'),
        sessionLoading: document.getElementById('session-loading'),
        authPanel: document.getElementById('auth-panel'),
        playPanel: document.getElementById('play-panel'),
        btnLoginTelegram: document.getElementById('btn-login-telegram'),
        authHint: document.getElementById('auth-hint'),
        btnLogout: document.getElementById('btn-logout'),
        btnHistory: document.getElementById('btn-history'),
        btnHistoryBack: document.getElementById('btn-history-back'),
        historyList: document.getElementById('history-list'),
        aiEloHint: document.getElementById('ai-elo-hint'),
        winEloHint: document.getElementById('win-elo-hint'),
        btnCreate: document.getElementById('btn-create'),
        btnVsAi: document.getElementById('btn-vs-ai'),
        btnJoin: document.getElementById('btn-join'),
        joinCodeInput: document.getElementById('join-code-input'),
        roomCodeText: document.getElementById('room-code-text'),
        btnCopyCode: document.getElementById('btn-copy-code'),
        btnLeaveWaiting: document.getElementById('btn-leave-waiting'),
        waitingStatus: document.getElementById('waiting-status'),
        secretInput: document.getElementById('secret-input'),
        secretStatus: document.getElementById('secret-status'),
        btnSetSecret: document.getElementById('btn-set-secret'),
        btnLeaveSecret: document.getElementById('btn-leave-secret'),
        guessInput: document.getElementById('guess-input'),
        btnResign: document.getElementById('btn-resign'),
        historyBoard: document.getElementById('history-board'),
        mySecretDisplay: document.getElementById('my-secret-display'),
        playStatus: document.getElementById('play-status'),
        sideRoom: document.getElementById('side-room'),
        sideRole: document.getElementById('side-role'),
        winOverlay: document.getElementById('win-overlay'),
        winText: document.getElementById('win-text'),
        btnWinContinue: document.getElementById('btn-win-continue'),
        gameCon: document.querySelector('.game-con'),
        playerOneTime: document.querySelector('.player-one-time'),
        playerTwoTime: document.querySelector('.player-two-time'),
        p1Label: document.getElementById('p1-label'),
        p2Label: document.getElementById('p2-label'),
    };

    const state = {
        screen: 'lobby',
        roomId: null,
        playerName: null,
        secret: null,
        canAddGuess: true,
        secretLocked: false,
        intentionalLeave: false,
        pendingWinMessage: null,
        user: null,
        config: null,
        gameEnded: false,
    };

    let playerOneTimeInterval = null;
    let playerTwoTimeInterval = null;
    let playerOneHeight = 600;
    let playerTwoHeight = 600;

    function validateNumber(input) {
        const value = String(input ?? '').trim();
        if (!/^\d{4}$/.test(value)) {
            return { ok: false, reason: 'Enter exactly 4 digits' };
        }
        if (value.includes('0')) {
            return { ok: false, reason: 'Digits cannot include 0' };
        }
        if (new Set(value).size !== 4) {
            return { ok: false, reason: 'Each digit must be unique' };
        }
        return { ok: true, value };
    }

    /**
     * Filter keystrokes: only 1-9, no duplicates. Toast on illegal attempt.
     */
    function filterDigitInput(raw, previous) {
        const cleaned = String(raw).replace(/\D/g, '');
        let result = '';
        for (const ch of cleaned) {
            if (ch === '0') {
                showToast('Digits cannot include 0', 'error');
                continue;
            }
            if (result.includes(ch)) {
                showToast('Each digit must be unique', 'error');
                continue;
            }
            result += ch;
            if (result.length >= 4) break;
        }
        if (result === previous) return previous;
        return result;
    }

    function showToast(message, type = 'error') {
        const el = document.createElement('div');
        el.className = `toast toast-${type} poppins-medium`;
        el.textContent = message;
        els.toastRoot.appendChild(el);
        requestAnimationFrame(() => el.classList.add('toast-show'));
        setTimeout(() => {
            el.classList.remove('toast-show');
            setTimeout(() => el.remove(), 280);
        }, 3000);
    }

    function showScreen(name) {
        state.screen = name;
        Object.entries(screens).forEach(([key, el]) => {
            el.classList.toggle('hide', key !== name);
        });
    }

    function stopYouWon() {
        els.winOverlay.classList.add('hide');
        els.winOverlay.classList.remove('win-outcome--won', 'win-outcome--lost');
        els.winText.classList.remove('animate-win-loss');
        els.gameCon?.classList.remove('game-ended');
        state.pendingWinMessage = null;
    }

    function showGameEndOverlay(text, didWin) {
        state.gameEnded = true;
        state.canAddGuess = false;
        els.winText.textContent = text;
        els.winOverlay.classList.remove('hide');
        els.winOverlay.classList.toggle('win-outcome--won', didWin);
        els.winOverlay.classList.toggle('win-outcome--lost', !didWin);
        els.winText.classList.add('animate-win-loss');
        els.gameCon?.classList.add('game-ended');
        els.guessInput.value = '';
        els.guessInput.disabled = true;
        els.btnResign.disabled = true;
        stopAllTimers();
    }

    function leaveAfterWin() {
        const msg = state.pendingWinMessage;
        stopYouWon();
        resetToLobby(msg ? { message: msg.text, type: msg.type } : {});
    }

    function getRandomGuess() {
        const digits = new Set();
        while (digits.size < 4) {
            const d = Math.floor(Math.random() * 9) + 1;
            digits.add(d);
        }
        return Array.from(digits).join('');
    }

    function startPlayerOneTime() {
        stopPlayerOneTime();
        playerOneHeight = 600;
        els.playerOneTime.style.height = '100%';
        playerOneTimeInterval = setInterval(() => {
            if (playerOneHeight > 4) {
                playerOneHeight -= 0.1;
                els.playerOneTime.style.height = `${playerOneHeight}px`;
            } else {
                stopPlayerOneTime();
                submitGuess(getRandomGuess());
            }
        }, 10);
    }

    function startPlayerTwoTime() {
        stopPlayerTwoTime();
        playerTwoHeight = 600;
        els.playerTwoTime.style.height = '100%';
        playerTwoTimeInterval = setInterval(() => {
            if (playerTwoHeight > 4) {
                playerTwoHeight -= 0.1;
                els.playerTwoTime.style.height = `${playerTwoHeight}px`;
            } else {
                stopPlayerTwoTime();
                submitGuess(getRandomGuess());
            }
        }, 10);
    }

    function stopPlayerOneTime() {
        clearInterval(playerOneTimeInterval);
        playerOneTimeInterval = null;
    }

    function stopPlayerTwoTime() {
        clearInterval(playerTwoTimeInterval);
        playerTwoTimeInterval = null;
    }

    function stopAllTimers() {
        stopPlayerOneTime();
        stopPlayerTwoTime();
        els.playerOneTime.style.height = '100%';
        els.playerTwoTime.style.height = '100%';
    }

    function startMyTimer() {
        if (state.playerName === 'Player One') startPlayerOneTime();
        else startPlayerTwoTime();
    }

    function stopMyTimer() {
        if (state.playerName === 'Player One') stopPlayerOneTime();
        else stopPlayerTwoTime();
    }

    function resetToLobby(options = {}) {
        const { message, type = 'info' } = options;
        stopAllTimers();
        stopYouWon();
        state.roomId = null;
        state.playerName = null;
        state.secret = null;
        state.canAddGuess = true;
        state.secretLocked = false;
        state.intentionalLeave = false;
        state.gameEnded = false;
        els.historyBoard.innerHTML = '';
        els.mySecretDisplay.textContent = '____';
        els.secretInput.value = '';
        els.guessInput.value = '';
        els.guessInput.disabled = false;
        els.btnResign.disabled = false;
        els.joinCodeInput.value = '';
        els.btnSetSecret.disabled = true;
        els.p1Label.classList.remove('you-label');
        els.p2Label.classList.remove('you-label');
        showScreen('lobby');
        if (message) showToast(message, type);
    }

    function goToSecretScreen(statusText) {
        state.secretLocked = false;
        els.secretInput.value = '';
        els.secretInput.disabled = false;
        els.btnSetSecret.disabled = true;
        els.secretStatus.textContent = statusText || 'Enter a 4-digit number (no 0, no repeats)';
        showScreen('secret');
        els.secretInput.focus();
    }

    function enterPlay() {
        state.gameEnded = false;
        els.mySecretDisplay.textContent = state.secret;
        els.sideRoom.textContent = `Room ${state.roomId}`;
        els.sideRole.textContent = state.playerName;
        els.guessInput.value = '';
        els.guessInput.disabled = false;
        els.btnResign.disabled = false;
        state.canAddGuess = true;
        els.playStatus.textContent = 'Your turn';

        els.p1Label.classList.toggle('you-label', state.playerName === 'Player One');
        els.p2Label.classList.toggle('you-label', state.playerName === 'Player Two');

        stopYouWon();
        showScreen('play');
        startMyTimer();
        els.guessInput.focus();
    }

    function submitGuess(guess) {
        if (!state.roomId || state.screen !== 'play' || state.gameEnded) return;
        if (!state.canAddGuess) {
            showToast('Wait for your opponent to guess', 'error');
            return;
        }
        const validation = validateNumber(guess);
        if (!validation.ok) {
            showToast(validation.reason, 'error');
            return;
        }
        socket.emit('guessput', {
            roomId: state.roomId,
            playerName: state.playerName,
            guess: validation.value,
        });
        els.guessInput.value = '';
    }

    function singleRound(p1, p2) {
        const cell = (arr, i) => (arr.length ? String(arr[i] ?? '') : '');
        return `<div class="singleGuess">
            <div class="player-one-con player-con">
                <div class="player-one-name-con player-name-con poppins-medium center p1-guess-con guess-con">
                    <div class="single-num center">${cell(p1, 0)}</div>
                    <div class="single-num center">${cell(p1, 1)}</div>
                    <div class="single-num center">${cell(p1, 2)}</div>
                    <div class="single-num center">${cell(p1, 3)}</div>
                </div>
                <div class="player-one-n poppins-medium center p1-number n-o">${cell(p1, 4)}</div>
                <div class="player-one-n poppins-medium center p1-order n-o">${cell(p1, 5)}</div>
            </div>
            <div class="player-two-con player-con">
                <div class="player-one-name-con player-name-con poppins-medium center p2-guess-con guess-con">
                    <div class="single-num center">${cell(p2, 0)}</div>
                    <div class="single-num center">${cell(p2, 1)}</div>
                    <div class="single-num center">${cell(p2, 2)}</div>
                    <div class="single-num center">${cell(p2, 3)}</div>
                </div>
                <div class="player-two-n poppins-medium center p2-number n-o">${cell(p2, 4)}</div>
                <div class="player-two-n poppins-medium center p2-order n-o">${cell(p2, 5)}</div>
            </div>
        </div>`;
    }

    function renderResults(playerOneHistory, playerTwoHistory) {
        const maxRounds = Math.max(playerOneHistory.length, playerTwoHistory.length);
        let html = '';
        for (let i = 0; i < maxRounds; i++) {
            html += singleRound(playerOneHistory[i] || [], playerTwoHistory[i] || []);
        }
        els.historyBoard.innerHTML = html;
        els.historyBoard.scrollTop = els.historyBoard.scrollHeight;
    }

    function leaveRoom() {
        if (state.roomId && state.playerName) {
            state.intentionalLeave = true;
            socket.emit('resigngame', {
                roomId: state.roomId,
                playerName: state.playerName,
            });
        }
        resetToLobby({ message: 'Left the room', type: 'info' });
    }

    function setLoggedInUI(user) {
        state.user = user;
        els.sessionLoading?.classList.add('hide');
        if (user) {
            els.authPanel.classList.add('hide');
            els.playPanel.classList.remove('hide');
            els.profileChip.classList.remove('hide');
            els.profileName.textContent = user.display_name;
            els.profileElo.textContent = String(user.elo);
        } else {
            els.authPanel.classList.remove('hide');
            els.playPanel.classList.add('hide');
            els.profileChip.classList.add('hide');
        }
    }

    function requireAuth() {
        if (state.user) return true;
        showToast('Log in with Telegram to play', 'error');
        return false;
    }

    async function loadConfigAndMe() {
        try {
            const cfgRes = await fetch('/api/config', { credentials: 'include' });
            state.config = await cfgRes.json();
            if (els.aiEloHint && state.config.ai_elo) {
                els.aiEloHint.textContent = String(state.config.ai_elo);
            }
            if (state.config.telegram_login_url) {
                els.btnLoginTelegram.href = state.config.telegram_login_url;
            } else {
                els.btnLoginTelegram.removeAttribute('href');
                els.btnLoginTelegram.addEventListener('click', (e) => {
                    e.preventDefault();
                    showToast('Set TELEGRAM_BOT_USERNAME in .env for the login link', 'error');
                });
                els.authHint.textContent =
                    'Ask your bot for a sign-in link (set TELEGRAM_BOT_USERNAME for a button).';
            }
        } catch {
            /* ignore */
        }

        try {
            const meRes = await fetch('/api/me', { credentials: 'include' });
            if (meRes.ok) {
                const me = await meRes.json();
                setLoggedInUI(me);
            } else {
                setLoggedInUI(null);
            }
        } catch {
            setLoggedInUI(null);
        }
    }

    async function openHistory() {
        if (!requireAuth()) return;
        els.historyList.innerHTML = '<p class="status-line poppins-regular">Loading…</p>';
        showScreen('history');
        try {
            const res = await fetch('/api/history', { credentials: 'include' });
            const data = await res.json();
            if (!res.ok) {
                els.historyList.innerHTML = `<p class="status-line">${data.error || 'Failed'}</p>`;
                return;
            }
            if (!data.games?.length) {
                els.historyList.innerHTML =
                    '<p class="status-line poppins-regular">No games yet — play vs AI or a friend.</p>';
                return;
            }
            els.historyList.innerHTML = data.games
                .map((g) => {
                    const delta =
                        g.elo_delta === 0
                            ? '—'
                            : g.elo_delta > 0
                              ? `+${g.elo_delta}`
                              : String(g.elo_delta);
                    const resultClass =
                        g.result === 'win'
                            ? 'hist-win'
                            : g.result === 'loss'
                              ? 'hist-loss'
                              : '';
                    const label = g.result_label || (g.result === 'win' ? 'You won' : g.result === 'loss' ? 'You lost' : 'Unknown');
                    const when = g.finished_at
                        ? new Date(g.finished_at).toLocaleString()
                        : '';
                    return `<div class="history-row ${resultClass}">
                        <div class="history-row-main">
                            <span class="poppins-semibold">${label}</span>
                            <span class="poppins-regular">vs ${g.opponent}${g.opponent_elo != null ? ` (${g.opponent_elo})` : ''}</span>
                        </div>
                        <div class="history-row-meta poppins-regular">
                            <span>${g.mode === 'ai' ? 'AI' : 'PvP'}</span>
                            <span class="elo-delta">${delta} Elo</span>
                            <span>${when}</span>
                        </div>
                    </div>`;
                })
                .join('');
        } catch {
            els.historyList.innerHTML = '<p class="status-line">Network error</p>';
        }
    }

    // ——— UI events ———

    els.btnCreate.addEventListener('click', () => {
        if (!requireAuth()) return;
        socket.emit('createRoom');
    });

    els.btnVsAi.addEventListener('click', () => {
        if (!requireAuth()) return;
        socket.emit('playVsAI');
    });

    els.btnJoin.addEventListener('click', () => {
        if (!requireAuth()) return;
        const code = els.joinCodeInput.value.trim().toUpperCase();
        if (!code) {
            showToast('Enter a room code', 'error');
            return;
        }
        socket.emit('joinRoom', { code });
    });

    els.btnHistory?.addEventListener('click', () => openHistory());
    els.btnHistoryBack?.addEventListener('click', () => showScreen('lobby'));

    els.btnLogout?.addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        } catch {
            /* ignore */
        }
        setLoggedInUI(null);
        showToast('Logged out', 'info');
        location.reload();
    });

    els.joinCodeInput.addEventListener('input', () => {
        els.joinCodeInput.value = els.joinCodeInput.value
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 6);
    });

    els.joinCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') els.btnJoin.click();
    });

    els.btnCopyCode.addEventListener('click', async () => {
        const code = state.roomId;
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            showToast('Code copied', 'info');
        } catch {
            showToast('Could not copy — select the code manually', 'error');
        }
    });

    els.btnLeaveWaiting.addEventListener('click', leaveRoom);
    els.btnLeaveSecret.addEventListener('click', leaveRoom);

    els.secretInput.addEventListener('input', () => {
        if (state.secretLocked) return;
        const next = filterDigitInput(els.secretInput.value, els.secretInput.dataset.last || '');
        els.secretInput.value = next;
        els.secretInput.dataset.last = next;
        const validation = validateNumber(next);
        els.btnSetSecret.disabled = !validation.ok;
    });

    els.btnSetSecret.addEventListener('click', () => {
        const validation = validateNumber(els.secretInput.value);
        if (!validation.ok) {
            showToast(validation.reason, 'error');
            return;
        }
        socket.emit('setSecret', { answer: validation.value });
    });

    els.guessInput.addEventListener('input', () => {
        if (state.screen !== 'play' || state.gameEnded) {
            if (state.gameEnded) els.guessInput.value = '';
            return;
        }
        if (!state.canAddGuess) {
            els.guessInput.value = '';
            showToast('Wait for your opponent to guess', 'error');
            return;
        }
        const next = filterDigitInput(els.guessInput.value, els.guessInput.dataset.last || '');
        els.guessInput.value = next;
        els.guessInput.dataset.last = next;
        if (next.length === 4) {
            submitGuess(next);
        }
    });

    els.btnResign.addEventListener('click', () => {
        if (!state.roomId) return;
        socket.emit('resigngame', {
            roomId: state.roomId,
            playerName: state.playerName,
        });
    });

    els.btnWinContinue.addEventListener('click', () => {
        leaveAfterWin();
    });

    // ——— Socket events ———

    socket.on('roomError', (msg) => {
        const reason = msg?.reason || 'Something went wrong';
        // Ignore late-game races (AI already won while user was typing)
        if (state.gameEnded) return;
        if (/game is not active/i.test(reason)) return;
        showToast(reason, 'error');
    });

    socket.on('statusMessage', (msg) => {
        // Avoid toast spam on matchmaking / secret lock — status text covers it
        if (!msg?.message) return;
        if (/share your code|playing vs ai|joined room|secret locked|set your secret/i.test(msg.message)) {
            return;
        }
        showToast(msg.message, msg.type || 'info');
    });

    socket.on('roomCreated', (msg) => {
        state.roomId = msg.roomId;
        state.playerName = msg.playerName;
        els.roomCodeText.textContent = msg.roomId;
        els.waitingStatus.textContent = 'Share this code with a friend';
        showScreen('waiting');
    });

    socket.on('authed', (msg) => {
        setLoggedInUI({
            id: msg.id,
            display_name: msg.display_name,
            elo: msg.elo,
            ai_elo: msg.ai_elo,
        });
        if (msg.ai_elo && els.aiEloHint) {
            els.aiEloHint.textContent = String(msg.ai_elo);
        }
    });

    socket.on('aiMatched', (msg) => {
        state.roomId = msg.roomId;
        state.playerName = msg.playerName;
        const eng = msg.engine === 'neural' ? 'trained model' : 'heuristic AI';
        const eloBit = msg.aiElo != null ? ` · ${msg.aiElo} Elo` : '';
        goToSecretScreen(`vs AI (${eng}${eloBit}) — set your secret number`);
    });

    socket.on('opponentJoined', (msg) => {
        if (msg?.message) showToast(msg.message, 'info');
        goToSecretScreen('Opponent joined — set your secret number');
    });

    socket.on('roomJoined', (msg) => {
        state.roomId = msg.roomId;
        state.playerName = msg.playerName;
        goToSecretScreen('Joined — set your secret number');
    });

    socket.on('secretAccepted', (msg) => {
        state.secret = msg.answer;
        state.secretLocked = true;
        els.secretInput.disabled = true;
        els.btnSetSecret.disabled = true;
        els.secretStatus.textContent = 'Secret locked in — waiting for opponent…';
    });

    socket.on('gamestarted', (msg) => {
        if (msg.roomId !== state.roomId) return;
        if (!state.secret) {
            showToast('Set your secret first', 'error');
            return;
        }
        enterPlay();
    });

    socket.on('historyUpdate', (msg) => {
        if (msg.roomId !== state.roomId || state.gameEnded) return;
        state.canAddGuess = msg.historiesAreEqual;
        renderResults(msg.playerOneHistory, msg.playerTwoHistory);

        if (state.canAddGuess) {
            els.playStatus.textContent = 'Your turn';
            stopMyTimer();
            startMyTimer();
            els.guessInput.focus();
        } else {
            els.playStatus.textContent = 'Waiting for opponent…';
            stopMyTimer();
        }
    });

    socket.on('gamewin', (msg) => {
        if (msg.roomId !== state.roomId) return;
        if (state.gameEnded) return;
        stopAllTimers();
        const winnerName = msg.winner === 'playerTwo' ? 'Player Two' : 'Player One';
        const didWin = winnerName === state.playerName;
        let eloLine = 'Your match history is below';
        if (msg.elo && state.playerName === 'Player One' && msg.elo.playerOneDelta != null) {
            const d = msg.elo.playerOneDelta;
            if (d !== 0) {
                eloLine = `Elo ${d > 0 ? '+' : ''}${d} → ${msg.elo.playerOneElo}`;
                if (state.user) {
                    state.user.elo = msg.elo.playerOneElo;
                    els.profileElo.textContent = String(msg.elo.playerOneElo);
                }
            } else if (msg.elo.aiElo != null) {
                eloLine = `vs AI (${msg.elo.aiElo} Elo) — rating unchanged`;
            }
        } else if (msg.elo && state.playerName === 'Player Two' && msg.elo.playerTwoDelta != null) {
            const d = msg.elo.playerTwoDelta;
            if (d !== 0) {
                eloLine = `Elo ${d > 0 ? '+' : ''}${d} → ${msg.elo.playerTwoElo}`;
                if (state.user) {
                    state.user.elo = msg.elo.playerTwoElo;
                    els.profileElo.textContent = String(msg.elo.playerTwoElo);
                }
            }
        }
        if (els.winEloHint) els.winEloHint.textContent = eloLine;
        state.pendingWinMessage = {
            text: didWin ? 'Victory!' : 'Defeat — try again',
            type: 'info',
        };
        showGameEndOverlay(didWin ? 'You Won!' : 'You Lost', didWin);
    });

    socket.on('eloUpdate', (msg) => {
        if (!msg?.elo || !state.user) return;
        if (state.playerName === 'Player One' && msg.elo.playerOneElo != null) {
            state.user.elo = msg.elo.playerOneElo;
            els.profileElo.textContent = String(msg.elo.playerOneElo);
            if (els.winEloHint && msg.elo.playerOneDelta) {
                const d = msg.elo.playerOneDelta;
                els.winEloHint.textContent = `Elo ${d > 0 ? '+' : ''}${d} → ${msg.elo.playerOneElo}`;
            }
        } else if (state.playerName === 'Player Two' && msg.elo.playerTwoElo != null) {
            state.user.elo = msg.elo.playerTwoElo;
            els.profileElo.textContent = String(msg.elo.playerTwoElo);
            if (els.winEloHint && msg.elo.playerTwoDelta) {
                const d = msg.elo.playerTwoDelta;
                els.winEloHint.textContent = `Elo ${d > 0 ? '+' : ''}${d} → ${msg.elo.playerTwoElo}`;
            }
        }
    });

    socket.on('gameresigned', () => {
        if (state.intentionalLeave || !state.roomId) return;
        resetToLobby({ message: 'Game ended — someone resigned', type: 'info' });
    });

    socket.on('partnerleft', () => {
        if (state.intentionalLeave || !state.roomId) return;
        resetToLobby({ message: 'Your partner left the room', type: 'error' });
    });

    socket.on('usercount', (count) => {
        els.userCountNum.textContent = String(count);
    });

    loadConfigAndMe();
})();
