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
        userCountNumMobile: document.getElementById('user-count-num-mobile'),
        profileChip: document.getElementById('profile-chip'),
        profileChipMobile: document.getElementById('profile-chip-mobile'),
        profileName: document.getElementById('profile-name'),
        profileElo: document.getElementById('profile-elo'),
        profileNameMobile: document.getElementById('profile-name-mobile'),
        profileEloMobile: document.getElementById('profile-elo-mobile'),
        sessionLoading: document.getElementById('session-loading'),
        authPanel: document.getElementById('auth-panel'),
        playPanel: document.getElementById('play-panel'),
        btnLoginTelegram: document.getElementById('btn-login-telegram'),
        authHint: document.getElementById('auth-hint'),
        btnLogout: document.getElementById('btn-logout'),
        btnLogoutMobile: document.getElementById('btn-logout-mobile'),
        navBrand: document.getElementById('nav-brand'),
        navPlay: document.getElementById('nav-play'),
        navHistory: document.getElementById('nav-history'),
        btnHistoryBack: document.getElementById('btn-history-back'),
        historyList: document.getElementById('history-list'),
        aiEloHint: document.getElementById('ai-elo-hint'),
        playEloLine: document.getElementById('play-elo-line'),
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
        playActions: document.getElementById('play-actions'),
        endActions: document.getElementById('end-actions'),
        btnEndHome: document.getElementById('btn-end-home'),
        btnPlayAgain: document.getElementById('btn-play-again'),
        rematchInviteBar: document.getElementById('rematch-invite-bar'),
        rematchInviteText: document.getElementById('rematch-invite-text'),
        btnRematchAccept: document.getElementById('btn-rematch-accept'),
        btnRematchDecline: document.getElementById('btn-rematch-decline'),
        historyBoard: document.getElementById('history-board'),
        mySecretDisplay: document.getElementById('my-secret-display'),
        playStatus: document.getElementById('play-status'),
        sideRoom: document.getElementById('side-room'),
        sideRole: document.getElementById('side-role'),
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
        vsAI: false,
        rematchFromSocketId: null,
        rematchWaiting: false,
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

    function setNavActive(which) {
        els.navPlay?.classList.toggle('nav-link-active', which === 'play');
        els.navHistory?.classList.toggle('nav-link-active', which === 'history');
    }

    function showScreen(name) {
        state.screen = name;
        Object.entries(screens).forEach(([key, el]) => {
            el.classList.toggle('hide', key !== name);
        });
        setNavActive(name === 'history' ? 'history' : 'play');
    }

    function syncProfileElo(elo) {
        const text = String(elo);
        if (els.profileElo) els.profileElo.textContent = text;
        if (els.profileEloMobile) els.profileEloMobile.textContent = text;
    }

    function syncUserCount(count) {
        const text = String(count);
        if (els.userCountNum) els.userCountNum.textContent = text;
        if (els.userCountNumMobile) els.userCountNumMobile.textContent = text;
    }

    function inActiveMatch() {
        return Boolean(state.roomId) && !state.gameEnded &&
            (state.screen === 'waiting' || state.screen === 'secret' || state.screen === 'play');
    }

    function goNavPlay() {
        if (state.screen === 'history') {
            showScreen('lobby');
            return;
        }
        if (state.gameEnded && state.screen === 'play') {
            leaveAfterWin();
            return;
        }
        if (inActiveMatch()) {
            showToast('Finish or leave the current game first', 'info');
            return;
        }
        showScreen('lobby');
    }

    function goNavHistory() {
        if (inActiveMatch()) {
            showToast('Finish or leave the current game first', 'info');
            return;
        }
        if (state.gameEnded && state.screen === 'play') {
            showToast('Go Home first, or use Play again', 'info');
            return;
        }
        openHistory();
    }

    function playEndSound(didWin) {
        const sources = didWin
            ? ['GameStart.mp3', 'GameStart.wav']
            : ['GameOver.mp3', 'GameOver.wav'];
        const tryPlay = (i) => {
            if (i >= sources.length) return;
            try {
                const audio = new Audio(sources[i]);
                audio.volume = 0.45;
                const p = audio.play();
                if (p && typeof p.catch === 'function') {
                    p.catch(() => tryPlay(i + 1));
                }
            } catch {
                tryPlay(i + 1);
            }
        };
        tryPlay(0);
    }

    function clearEndBanner() {
        els.playStatus.classList.remove('status-win', 'status-lose', 'animate-win-loss');
        if (els.playEloLine) {
            els.playEloLine.textContent = '';
            els.playEloLine.classList.add('hide');
        }
        els.gameCon?.classList.remove('game-ended');
        els.endActions?.classList.add('hide');
        els.playActions?.classList.remove('hide');
        els.rematchInviteBar?.classList.add('hide');
        if (els.btnPlayAgain) {
            els.btnPlayAgain.textContent = 'Play again';
            els.btnPlayAgain.disabled = false;
        }
        state.pendingWinMessage = null;
        state.rematchWaiting = false;
        state.rematchFromSocketId = null;
    }

    function showGameEndBanner(text, didWin, eloLine) {
        state.gameEnded = true;
        state.canAddGuess = false;
        els.playStatus.textContent = text;
        els.playStatus.classList.remove('status-win', 'status-lose');
        els.playStatus.classList.add(didWin ? 'status-win' : 'status-lose', 'animate-win-loss');
        if (els.playEloLine) {
            if (eloLine) {
                els.playEloLine.textContent = eloLine;
                els.playEloLine.classList.remove('hide');
            } else {
                els.playEloLine.textContent = '';
                els.playEloLine.classList.add('hide');
            }
        }
        els.gameCon?.classList.add('game-ended');
        els.playActions?.classList.add('hide');
        els.endActions?.classList.remove('hide');
        if (els.btnPlayAgain) {
            els.btnPlayAgain.textContent = 'Play again';
            els.btnPlayAgain.disabled = false;
        }
        els.guessInput.value = '';
        els.guessInput.disabled = true;
        els.btnResign.disabled = true;
        stopAllTimers();
        playEndSound(didWin);
    }

    function leaveAfterWin() {
        const msg = state.pendingWinMessage;
        socket.emit('clearRematch');
        clearEndBanner();
        resetToLobby(msg ? { message: msg.text, type: msg.type } : {});
    }

    function playAgain() {
        if (state.vsAI) {
            clearEndBanner();
            state.roomId = null;
            state.playerName = null;
            state.secret = null;
            state.secretLocked = false;
            state.gameEnded = false;
            state.canAddGuess = true;
            els.historyBoard.innerHTML = '';
            els.guessInput.disabled = false;
            els.btnResign.disabled = false;
            socket.emit('playVsAI');
            return;
        }
        if (state.rematchWaiting) {
            showToast('Waiting for opponent…', 'info');
            return;
        }
        state.rematchWaiting = true;
        if (els.btnPlayAgain) {
            els.btnPlayAgain.textContent = 'Waiting…';
            els.btnPlayAgain.disabled = true;
        }
        socket.emit('rematchRequest');
    }

    function hideRematchInvite() {
        state.rematchFromSocketId = null;
        els.rematchInviteBar?.classList.add('hide');
    }

    function showRematchInvite(fromName, fromSocketId) {
        state.rematchFromSocketId = fromSocketId;
        if (els.rematchInviteText) {
            els.rematchInviteText.textContent = `${fromName || 'Opponent'} wants a rematch`;
        }
        els.rematchInviteBar?.classList.remove('hide');
        showToast(`${fromName || 'Opponent'} wants a rematch`, 'info');
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
        clearEndBanner();
        state.roomId = null;
        state.playerName = null;
        state.secret = null;
        state.canAddGuess = true;
        state.secretLocked = false;
        state.intentionalLeave = false;
        state.gameEnded = false;
        state.vsAI = false;
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
        els.playStatus.classList.remove('status-win', 'status-lose', 'animate-win-loss');
        if (els.playEloLine) {
            els.playEloLine.textContent = '';
            els.playEloLine.classList.add('hide');
        }

        els.p1Label.classList.toggle('you-label', state.playerName === 'Player One');
        els.p2Label.classList.toggle('you-label', state.playerName === 'Player Two');

        clearEndBanner();
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
            els.profileChip?.classList.remove('hide');
            els.profileChipMobile?.classList.remove('hide');
            els.btnLogout?.classList.remove('hide');
            if (els.profileName) els.profileName.textContent = user.display_name;
            if (els.profileNameMobile) els.profileNameMobile.textContent = user.display_name;
            syncProfileElo(user.elo);
        } else {
            els.authPanel.classList.remove('hide');
            els.playPanel.classList.add('hide');
            els.profileChip?.classList.add('hide');
            els.profileChipMobile?.classList.add('hide');
            els.btnLogout?.classList.add('hide');
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
        state.vsAI = false;
        socket.emit('createRoom');
    });

    els.btnVsAi.addEventListener('click', () => {
        if (!requireAuth()) return;
        state.vsAI = true;
        socket.emit('playVsAI');
    });

    els.btnJoin.addEventListener('click', () => {
        if (!requireAuth()) return;
        state.vsAI = false;
        const code = els.joinCodeInput.value.trim().toUpperCase();
        if (!code) {
            showToast('Enter a room code', 'error');
            return;
        }
        socket.emit('joinRoom', { code });
    });

    els.btnHistoryBack?.addEventListener('click', () => showScreen('lobby'));
    els.navPlay?.addEventListener('click', () => goNavPlay());
    els.navHistory?.addEventListener('click', () => goNavHistory());
    els.navBrand?.addEventListener('click', (e) => {
        e.preventDefault();
        goNavPlay();
    });

    async function doLogout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        } catch {
            /* ignore */
        }
        setLoggedInUI(null);
        showToast('Logged out', 'info');
        location.reload();
    }

    els.btnLogout?.addEventListener('click', () => doLogout());
    els.btnLogoutMobile?.addEventListener('click', () => doLogout());

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

    els.btnEndHome?.addEventListener('click', () => {
        leaveAfterWin();
    });

    els.btnPlayAgain?.addEventListener('click', () => {
        playAgain();
    });

    els.btnRematchAccept?.addEventListener('click', () => {
        if (!state.rematchFromSocketId) return;
        socket.emit('rematchAccept', { fromSocketId: state.rematchFromSocketId });
        hideRematchInvite();
    });

    els.btnRematchDecline?.addEventListener('click', () => {
        if (state.rematchFromSocketId) {
            socket.emit('rematchDecline', { fromSocketId: state.rematchFromSocketId });
        }
        hideRematchInvite();
        showToast('Rematch declined', 'info');
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
        state.vsAI = false;
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
        state.vsAI = true;
        state.gameEnded = false;
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
        state.vsAI = false;
        goToSecretScreen('Joined — set your secret number');
    });

    socket.on('rematchStarted', (msg) => {
        hideRematchInvite();
        clearEndBanner();
        state.roomId = msg.roomId;
        state.playerName = msg.playerName;
        state.vsAI = false;
        state.secret = null;
        state.secretLocked = false;
        state.gameEnded = false;
        state.canAddGuess = true;
        state.rematchWaiting = false;
        els.historyBoard.innerHTML = '';
        els.guessInput.disabled = false;
        els.btnResign.disabled = false;
        goToSecretScreen('Rematch — set your secret number');
    });

    socket.on('rematchInvite', (msg) => {
        showRematchInvite(msg.fromName, msg.fromSocketId);
    });

    socket.on('rematchBusy', (msg) => {
        state.rematchWaiting = false;
        if (els.btnPlayAgain) {
            els.btnPlayAgain.textContent = 'Play again';
            els.btnPlayAgain.disabled = false;
        }
        showToast(msg?.reason || 'Opponent is busy', 'error');
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
        if (msg.vsAI != null) state.vsAI = !!msg.vsAI;
        const winnerName = msg.winner === 'playerTwo' ? 'Player Two' : 'Player One';
        const didWin = winnerName === state.playerName;
        let eloLine = state.vsAI ? 'vs AI · rating unchanged' : '';
        if (msg.elo && state.playerName === 'Player One' && msg.elo.playerOneDelta != null) {
            const d = msg.elo.playerOneDelta;
            if (d !== 0) {
                eloLine = `Elo ${d > 0 ? '+' : ''}${d} → ${msg.elo.playerOneElo}`;
                if (state.user) {
                    state.user.elo = msg.elo.playerOneElo;
                    syncProfileElo(msg.elo.playerOneElo);
                }
            } else if (msg.elo.aiElo != null || state.vsAI) {
                eloLine = 'vs AI · rating unchanged';
            }
        } else if (msg.elo && state.playerName === 'Player Two' && msg.elo.playerTwoDelta != null) {
            const d = msg.elo.playerTwoDelta;
            if (d !== 0) {
                eloLine = `Elo ${d > 0 ? '+' : ''}${d} → ${msg.elo.playerTwoElo}`;
                if (state.user) {
                    state.user.elo = msg.elo.playerTwoElo;
                    syncProfileElo(msg.elo.playerTwoElo);
                }
            }
        }
        state.pendingWinMessage = {
            text: didWin ? 'Victory!' : 'Defeat — try again',
            type: 'info',
        };
        showGameEndBanner(didWin ? 'You win' : 'You lose', didWin, eloLine);
    });

    socket.on('eloUpdate', (msg) => {
        if (!msg?.elo || !state.user) return;
        if (state.playerName === 'Player One' && msg.elo.playerOneElo != null) {
            state.user.elo = msg.elo.playerOneElo;
            syncProfileElo(msg.elo.playerOneElo);
            if (els.playEloLine && msg.elo.playerOneDelta) {
                const d = msg.elo.playerOneDelta;
                els.playEloLine.textContent = `Elo ${d > 0 ? '+' : ''}${d} → ${msg.elo.playerOneElo}`;
                els.playEloLine.classList.remove('hide');
            }
        } else if (state.playerName === 'Player Two' && msg.elo.playerTwoElo != null) {
            state.user.elo = msg.elo.playerTwoElo;
            syncProfileElo(msg.elo.playerTwoElo);
            if (els.playEloLine && msg.elo.playerTwoDelta) {
                const d = msg.elo.playerTwoDelta;
                els.playEloLine.textContent = `Elo ${d > 0 ? '+' : ''}${d} → ${msg.elo.playerTwoElo}`;
                els.playEloLine.classList.remove('hide');
            }
        }
    });

    socket.on('gameresigned', () => {
        // Mid-play resign now ends via gamewin; this is only for pre-game leave races
        if (state.intentionalLeave || !state.roomId) return;
        if (state.screen === 'play' && !state.gameEnded) return;
        resetToLobby({ message: 'Left the room', type: 'info' });
    });

    socket.on('partnerleft', (msg) => {
        if (state.intentionalLeave || !state.roomId) return;
        // Mid-play disconnect is handled by server finishGame → gamewin
        if (state.screen === 'play') {
            if (state.gameEnded) return;
            if (msg?.asWin) return;
            showToast('Opponent left', 'info');
            return;
        }
        resetToLobby({ message: 'Your partner left the room', type: 'error' });
    });

    socket.on('usercount', (count) => {
        syncUserCount(count);
    });

    loadConfigAndMe();
})();
