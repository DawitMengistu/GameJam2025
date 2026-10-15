(() => {
    const socket = io();

    const PLAY_STATE_KEY = 'atp-play-state';
    const SESSION_KEY = 'atp-session-id';

    function getOrCreateSessionId() {
        try {
            let id = localStorage.getItem(SESSION_KEY);
            if (!id) {
                id =
                    typeof crypto !== 'undefined' && crypto.randomUUID
                        ? crypto.randomUUID()
                        : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                localStorage.setItem(SESSION_KEY, id);
            }
            return id;
        } catch {
            return `s-${Date.now()}`;
        }
    }

    const sessionId = getOrCreateSessionId();

    const queryClient =
        typeof createQueryClient === 'function'
            ? createQueryClient({ defaultStaleTime: 60_000 })
            : null;
    const FRIENDS_QUERY_KEY = 'friends';

    function persistPlayState() {
        try {
            const payload = {
                sessionId,
                cupCode: state.cupId || null,
                roomId: state.roomId || null,
                playerName: state.playerName || null,
                cupMatchId: state.cupMatchId || null,
                screenHint: state.screen || null,
                vsAI: !!state.vsAI,
                updatedAt: Date.now(),
            };
            if (!payload.cupCode && !payload.roomId) {
                localStorage.removeItem(PLAY_STATE_KEY);
                return;
            }
            localStorage.setItem(PLAY_STATE_KEY, JSON.stringify(payload));
        } catch {
            /* ignore */
        }
    }

    function clearPlayState() {
        try {
            localStorage.removeItem(PLAY_STATE_KEY);
        } catch {
            /* ignore */
        }
    }

    function readPlayState() {
        try {
            const raw = localStorage.getItem(PLAY_STATE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    const screens = {
        lobby: document.getElementById('screen-lobby'),
        cups: document.getElementById('screen-cups'),
        cupLobby: document.getElementById('screen-cup-lobby'),
        friends: document.getElementById('screen-friends'),
        history: document.getElementById('screen-history'),
        rules: document.getElementById('screen-rules'),
        profile: document.getElementById('screen-profile'),
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
        lobbyHero: document.getElementById('lobby-hero'),
        lobbyMe: document.getElementById('lobby-me'),
        lobbyMeName: document.getElementById('lobby-me-name'),
        lobbyMeElo: document.getElementById('lobby-me-elo'),
        navFriendsPeek: document.getElementById('nav-friends-peek'),
        lobbyFriendsList: document.getElementById('lobby-friends-list'),
        authPanel: document.getElementById('auth-panel'),
        playPanel: document.getElementById('play-panel'),
        btnLoginTelegram: document.getElementById('btn-login-telegram'),
        authHint: document.getElementById('auth-hint'),
        btnLogout: document.getElementById('btn-logout'),
        btnLogoutMobile: document.getElementById('btn-logout-mobile'),
        navBrand: document.getElementById('nav-brand'),
        navPlay: document.getElementById('nav-play'),
        navCups: document.getElementById('nav-cups'),
        navFriends: document.getElementById('nav-friends'),
        friendsBadge: document.getElementById('friends-badge'),
        navHistory: document.getElementById('nav-history'),
        navRules: document.getElementById('nav-rules'),
        navProfile: document.getElementById('nav-profile'),
        btnHistoryBack: document.getElementById('btn-history-back'),
        btnRulesBack: document.getElementById('btn-rules-back'),
        profileGuest: document.getElementById('profile-guest'),
        profileForm: document.getElementById('profile-form'),
        profileDisplayName: document.getElementById('profile-display-name'),
        profileTelegramHint: document.getElementById('profile-telegram-hint'),
        btnProfileSave: document.getElementById('btn-profile-save'),
        historyListPanel: document.getElementById('history-list-panel'),
        historyDetailPanel: document.getElementById('history-detail-panel'),
        historyDetailTitle: document.getElementById('history-detail-title'),
        historyDetailMeta: document.getElementById('history-detail-meta'),
        historyDetailBoard: document.getElementById('history-detail-board'),
        histP1Label: document.getElementById('hist-p1-label'),
        histP2Label: document.getElementById('hist-p2-label'),
        btnFriendsBack: document.getElementById('btn-friends-back'),
        friendsSearchInput: document.getElementById('friends-search-input'),
        btnFriendsSearch: document.getElementById('btn-friends-search'),
        friendsSearchResults: document.getElementById('friends-search-results'),
        friendsPending: document.getElementById('friends-pending'),
        friendsAccepted: document.getElementById('friends-accepted'),
        friendInviteBar: document.getElementById('friend-invite-bar'),
        friendInviteText: document.getElementById('friend-invite-text'),
        btnFriendInviteAccept: document.getElementById('btn-friend-invite-accept'),
        btnFriendInviteDecline: document.getElementById('btn-friend-invite-decline'),
        btnCupsBack: document.getElementById('btn-cups-back'),
        btnCupCreate: document.getElementById('btn-cup-create'),
        btnCupJoin: document.getElementById('btn-cup-join'),
        cupJoinInput: document.getElementById('cup-join-input'),
        cupCodeText: document.getElementById('cup-code-text'),
        cupLobbyStatus: document.getElementById('cup-lobby-status'),
        cupPlayerList: document.getElementById('cup-player-list'),
        btnCupCopy: document.getElementById('btn-cup-copy'),
        btnCupStart: document.getElementById('btn-cup-start'),
        btnCupLeave: document.getElementById('btn-cup-leave'),
        cupBracketMini: document.getElementById('cup-bracket-mini'),
        spectateActions: document.getElementById('spectate-actions'),
        btnSpectateBack: document.getElementById('btn-spectate-back'),
        btnTheme: document.getElementById('btn-theme'),
        btnThemeMobile: document.getElementById('btn-theme-mobile'),
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
        playShell: document.querySelector('.play-shell'),
        myTime: document.getElementById('my-time-bar'),
        oppTime: document.getElementById('opp-time-bar'),
        p1Label: document.getElementById('p1-label'),
        p2Label: document.getElementById('p2-label'),
        digitTracker: document.getElementById('digit-tracker'),
        answerCon: document.querySelector('.answer-con'),
        resultPopup: document.getElementById('result-popup'),
        resultPopupText: document.getElementById('result-popup-text'),
        matchChat: document.getElementById('match-chat'),
        matchChatLog: document.getElementById('match-chat-log'),
        matchChatInput: document.getElementById('match-chat-input'),
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
        cupId: null,
        cupAdminId: null,
        cupStatus: null,
        cupBracket: null,
        cupMatchId: null,
        intentionalCupLeave: false,
        spectating: false,
        spectateMatchId: null,
        spectateRoomId: null,
        pendingFriendInvite: null,
        historyDetailId: null,
        opponentName: null,
        lastP1History: [],
        lastP2History: [],
        highlightGuesses: false,
        /** Secrets under review: P1's number / P2's number (targets of opponent guesses) */
        reviewP1Secret: null,
        reviewP2Secret: null,
    };

    let myTimeInterval = null;
    let myTurnEndsAt = 0;
    let resultPopupTimer = null;
    const TURN_MS_CLIENT = 60_000;
    const DIGIT_STATES = ['default', 'out', 'in', 'maybe'];
    const digitNotes = Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [String(i + 1), 'default'])
    );

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
     * @param {number} [maxLen=4] — use 3 while waiting so players can brainstorm
     */
    function filterDigitInput(raw, previous, maxLen = 4) {
        const limit = Math.max(1, Math.min(4, Number(maxLen) || 4));
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
            if (result.length >= limit) break;
            result += ch;
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
        els.navCups?.classList.toggle('nav-link-active', which === 'cups');
        els.navFriends?.classList.toggle('nav-link-active', which === 'friends');
        els.navHistory?.classList.toggle('nav-link-active', which === 'history');
        els.navRules?.classList.toggle('nav-link-active', which === 'rules');
        els.navProfile?.classList.toggle('nav-link-active', which === 'profile');
    }

    function showScreen(name) {
        state.screen = name;
        Object.entries(screens).forEach(([key, el]) => {
            el?.classList.toggle('hide', key !== name);
        });
        if (name === 'history') setNavActive('history');
        else if (name === 'friends') setNavActive('friends');
        else if (name === 'cups' || name === 'cupLobby') setNavActive('cups');
        else if (name === 'rules') setNavActive('rules');
        else if (name === 'profile') setNavActive('profile');
        else setNavActive('play');
        persistPlayState();
    }

    function applyTheme(theme) {
        const dark = theme === 'dark';
        document.documentElement.classList.toggle('dark', dark);
        try {
            localStorage.setItem('atp-theme', dark ? 'dark' : 'light');
        } catch {
            /* ignore */
        }
    }

    function toggleTheme() {
        const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
        applyTheme(next);
    }

    function inCupLobby() {
        return Boolean(state.cupId) && state.screen === 'cupLobby';
    }

    function goNavCups() {
        if (state.spectating) {
            exitSpectate();
            return;
        }
        if (inLivePlay()) {
            showToast('Finish the current game first', 'info');
            return;
        }
        if (inSetupMatch()) {
            showToast('Finish or leave the current game first', 'info');
            return;
        }
        if (state.cupId && state.cupStatus === 'lobby') {
            showScreen('cupLobby');
            return;
        }
        if (state.cupId && (state.cupStatus === 'running' || state.cupStatus === 'finished')) {
            showScreen('cupLobby');
            return;
        }
        showScreen('cups');
    }

    function canSpectateMatch(m) {
        if (!m) return false;
        const inMatch = (m.playerIds || []).includes(sessionId);
        if (inMatch && (m.status === 'ready' || m.status === 'playing')) return false;
        return m.status === 'playing' || m.status === 'done' || m.status === 'ready';
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    const CUP_CROWN_SVG =
        '<svg class="cup-crown-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5 16h14l1.2-7.2-3.7 2.5L12 6l-4.5 5.3L3.8 8.8 5 16zm-1 2h16v2H4v-2z"/></svg>';

    function cupMatchStatusHtml(m, { isChampion = false } = {}) {
        if (m.status === 'done') {
            const name = escapeHtml(m.winnerName || '—');
            const label = isChampion ? 'Cup champion' : 'Match winner';
            return `<div class="cup-match-status is-winner${
                isChampion ? ' is-champion' : ''
            }" title="${label}">
                <span class="cup-crown">${CUP_CROWN_SVG}</span>
                <span class="cup-winner-name">${name}</span>
            </div>`;
        }
        const text =
            m.status === 'playing'
                ? 'Live'
                : m.status === 'ready'
                  ? 'Setting secrets'
                  : 'Pending';
        return `<div class="cup-match-status">${text}</div>`;
    }

    function cupRoundTitle(roundKey) {
        if (roundKey === 'final') return 'Final';
        if (roundKey === 'r4') return 'Semifinals';
        if (roundKey === 'r8') return 'Quarterfinals';
        if (typeof roundKey === 'string' && roundKey.startsWith('r')) {
            return `Round of ${roundKey.slice(1)}`;
        }
        return roundKey || 'Round';
    }

    function renderCupBracketMini(bracket, { cupStatus = null } = {}) {
        if (!els.cupBracketMini) return;
        if (!bracket?.matches) {
            els.cupBracketMini.classList.add('hide');
            els.cupBracketMini.innerHTML = '';
            return;
        }

        const cupDone = cupStatus === 'finished';
        const championId = bracket.championId || null;
        const rounds =
            Array.isArray(bracket.rounds) && bracket.rounds.length
                ? bracket.rounds
                : [...new Set(Object.values(bracket.matches).map((m) => m.round))];

        const card = (m) => {
            if (!m) return '';
            const names = escapeHtml((m.playerNames || ['TBD', 'TBD']).join(' vs '));
            const isChampion =
                cupDone &&
                m.id === 'final' &&
                m.status === 'done' &&
                Boolean(m.winnerName || championId);
            const rowClass = [
                'cup-match-row',
                m.status === 'playing' ? 'is-live' : '',
                m.status === 'done' ? 'is-done' : '',
                isChampion ? 'is-champion' : '',
            ]
                .filter(Boolean)
                .join(' ');
            const watch =
                canSpectateMatch(m) && (m.status === 'playing' || m.status === 'done')
                    ? `<button type="button" class="cup-watch-btn" data-cup-watch="${escapeHtml(
                          m.id
                      )}">${m.status === 'done' ? 'View board' : 'Watch'}</button>`
                    : '';
            return `<div class="${rowClass}">
                <div class="cup-match-label">${escapeHtml(m.label || m.id)}</div>
                <div class="cup-match-names">${names}</div>
                ${cupMatchStatusHtml(m, { isChampion })}
                ${watch}
            </div>`;
        };

        const columns = rounds
            .map((roundKey) => {
                const matches = Object.values(bracket.matches)
                    .filter((m) => m.round === roundKey)
                    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
                if (!matches.length) return '';
                return `<div class="cup-bracket-round" data-round="${escapeHtml(roundKey)}">
                    <div class="cup-bracket-round-title">${escapeHtml(
                        cupRoundTitle(roundKey)
                    )}</div>
                    <div class="cup-bracket-round-matches">
                        ${matches.map(card).join('')}
                    </div>
                </div>`;
            })
            .join('');

        els.cupBracketMini.innerHTML = columns;
        els.cupBracketMini.classList.remove('hide');

        els.cupBracketMini.querySelectorAll('[data-cup-watch]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const matchId = btn.getAttribute('data-cup-watch');
                if (!matchId || !state.cupId) return;
                socket.emit('cupSpectate', { matchId, cupCode: state.cupId });
            });
        });
    }

    /** Clear stuck "Live view" when a spectated match (or the cup) ends. */
    function markSpectateMatchEnded({ winnerName = null, label = 'Match' } = {}) {
        if (!state.spectating) return;
        state.highlightGuesses = true;
        if (els.playEloLine) {
            els.playEloLine.textContent = winnerName
                ? `Final · ${winnerName} won`
                : 'Match finished';
            els.playEloLine.classList.remove('hide');
        }
        els.playStatus.textContent = `Ended · ${label}`;
    }

    function syncSpectateFromCupPayload(payload) {
        if (!state.spectating || !payload) return;
        const match =
            state.spectateMatchId && payload.bracket?.matches
                ? payload.bracket.matches[state.spectateMatchId]
                : null;
        const ended =
            match?.status === 'done' ||
            payload.status === 'finished' ||
            Boolean(payload.championName);
        if (!ended) return;
        markSpectateMatchEnded({
            winnerName:
                match?.winnerName ||
                payload.championName ||
                payload.bracket?.championName ||
                null,
            label: match?.label || (payload.status === 'finished' ? 'Final' : 'Match'),
        });
    }

    function setSpectateShell(on) {
        els.playShell?.classList.toggle('spectating', on);
        els.gameCon?.classList.toggle('spectating', on);
        if (!on) {
            els.digitTracker?.classList.remove('hide');
            els.answerCon?.classList.remove('hide');
        }
    }

    function exitSpectate() {
        state.spectating = false;
        state.spectateMatchId = null;
        state.spectateRoomId = null;
        setSpectateShell(false);
        els.gameCon?.classList.remove('game-ended');
        els.spectateActions?.classList.add('hide');
        els.playActions?.classList.remove('hide');
        els.endActions?.classList.add('hide');
        els.playStatus.classList.remove('status-win', 'status-lose', 'animate-win-loss');
        if (els.playEloLine) {
            els.playEloLine.textContent = '';
            els.playEloLine.classList.add('hide');
        }
        els.historyBoard.innerHTML = '';
        els.mySecretDisplay.textContent = '____';
        els.p1Label?.classList.remove('you-label', 'secret-reveal');
        els.p2Label?.classList.remove('you-label', 'secret-reveal');
        showScreen('cupLobby');
    }

    function enterSpectate(snapshot) {
        if (!snapshot) return;
        state.spectating = true;
        state.spectateMatchId = snapshot.matchId;
        state.spectateRoomId = snapshot.roomId || null;
        state.gameEnded = false;
        stopAllTimers();

        setSpectateShell(true);
        els.gameCon?.classList.remove('game-ended');
        els.playActions?.classList.add('hide');
        els.endActions?.classList.add('hide');
        els.spectateActions?.classList.remove('hide');
        els.digitTracker?.classList.add('hide');
        els.answerCon?.classList.add('hide');

        els.playStatus.textContent = `Spectating · ${snapshot.label || 'Match'}`;
        els.playStatus.classList.remove('status-win', 'status-lose', 'animate-win-loss');
        if (els.playEloLine) {
            els.playEloLine.textContent = snapshot.live
                ? 'Live view · read only'
                : snapshot.winnerName
                  ? `Final · ${snapshot.winnerName} won`
                  : 'Match board';
            els.playEloLine.classList.remove('hide');
        }

        els.mySecretDisplay.textContent = '····';
        els.sideRoom.textContent = `Cup ${snapshot.cupCode || state.cupId || '—'}`;
        els.sideRole.textContent = 'Spectator';
        els.matchChat?.classList.add('hide');

        state.highlightGuesses =
            !snapshot.live || snapshot.status === 'done' || Boolean(snapshot.winnerName);
        state.reviewP1Secret = snapshot.playerOneSecret || null;
        state.reviewP2Secret = snapshot.playerTwoSecret || null;
        applyBoardLabels({
            p1Name: snapshot.playerOneName || 'Player One',
            p2Name: snapshot.playerTwoName || 'Player Two',
        });
        renderResults(
            snapshot.playerOneHistory || [],
            snapshot.playerTwoHistory || []
        );
        showScreen('play');
    }

    function renderCupLobby(payload, { forceScreen = true } = {}) {
        if (!payload) return;
        state.cupId = payload.code;
        state.cupAdminId = payload.adminId;
        state.cupStatus = payload.status;
        state.cupBracket = payload.bracket || null;
        const max = payload.maxPlayers || 64;
        const count = payload.players?.length || 0;
        const isAdmin = payload.adminId === sessionId;
        const minStart = 4;

        if (els.cupCodeText) els.cupCodeText.textContent = payload.code;
        if (els.cupLobbyStatus) {
            if (payload.status === 'finished') {
                els.cupLobbyStatus.textContent = payload.championName
                    ? `Champion: ${payload.championName}`
                    : 'Cup finished';
            } else if (payload.status === 'running') {
                els.cupLobbyStatus.textContent = 'Cup in progress';
            } else {
                els.cupLobbyStatus.textContent = `${count} / ${max} players${
                    isAdmin ? ' · you are host' : ''
                }`;
            }
        }

        if (els.cupPlayerList) {
            els.cupPlayerList.innerHTML = (payload.players || [])
                .map((p) => {
                    const you =
                        p.sessionId === sessionId || p.id === socket.id;
                    const offline = p.online === false;
                    const badges = [
                        p.isAdmin
                            ? '<span class="cup-player-badge">Host</span>'
                            : '',
                        offline
                            ? '<span class="cup-player-badge cup-player-offline">Offline</span>'
                            : '',
                    ].join('');
                    return `<li class="cup-player-row${you ? ' cup-player-you' : ''}${
                        offline ? ' cup-player-away' : ''
                    }">
                        <span class="font-medium truncate">${p.displayName}${
                        you ? ' (you)' : ''
                    }</span>
                        ${badges}
                    </li>`;
                })
                .join('');
        }

        renderCupBracketMini(payload.bracket, { cupStatus: payload.status });
        syncSpectateFromCupPayload(payload);

        if (els.btnCupStart) {
            const canStart =
                isAdmin &&
                payload.status === 'lobby' &&
                count >= minStart &&
                count <= max;
            els.btnCupStart.classList.toggle(
                'hide',
                !isAdmin || payload.status !== 'lobby'
            );
            els.btnCupStart.disabled = !canStart;
            els.btnCupStart.textContent = canStart
                ? `Start Cup (${count})`
                : `Start Cup (${count}/${minStart}+)`;
        }

        if (els.btnCupLeave) {
            const canLeave =
                payload.status === 'lobby' || payload.status === 'finished';
            els.btnCupLeave.classList.toggle('hide', !canLeave);
            els.btnCupLeave.textContent =
                payload.status === 'finished' ? 'Exit cup' : 'Leave cup';
        }

        if (
            forceScreen &&
            (payload.status === 'lobby' ||
                payload.status === 'running' ||
                payload.status === 'finished') &&
            state.screen !== 'play' &&
            state.screen !== 'secret'
        ) {
            showScreen('cupLobby');
        }
    }

    function returnToCupHub() {
        if (state.spectating) {
            exitSpectate();
            return;
        }
        clearEndBanner();
        state.roomId = null;
        state.playerName = null;
        state.secret = null;
        state.secretLocked = false;
        state.gameEnded = false;
        state.canAddGuess = true;
        state.cupMatchId = null;
        els.historyBoard.innerHTML = '';
        els.guessInput.disabled = false;
        els.btnResign.disabled = false;
        setSpectateShell(false);
        els.spectateActions?.classList.add('hide');
        resetDigitTracker();
        clearMatchChat();
        els.matchChat?.classList.add('hide');
        showScreen('cupLobby');
    }

    function clearCupState() {
        state.cupId = null;
        state.cupAdminId = null;
        state.cupStatus = null;
        state.cupBracket = null;
        state.cupMatchId = null;
        state.intentionalCupLeave = false;
        state.spectating = false;
        state.spectateMatchId = null;
        state.spectateRoomId = null;
        if (els.cupPlayerList) els.cupPlayerList.innerHTML = '';
        if (els.cupCodeText) els.cupCodeText.textContent = '------';
        if (els.cupJoinInput) els.cupJoinInput.value = '';
        if (els.cupBracketMini) {
            els.cupBracketMini.classList.add('hide');
            els.cupBracketMini.innerHTML = '';
        }
        els.btnCupStart?.classList.add('hide');
        setSpectateShell(false);
        els.spectateActions?.classList.add('hide');
        if (els.btnCupLeave) {
            els.btnCupLeave.classList.remove('hide');
            els.btnCupLeave.textContent = 'Leave cup';
        }
        clearPlayState();
    }

    function leaveCup() {
        if (!state.cupId) {
            showScreen('cups');
            return;
        }
        if (state.cupStatus === 'finished') {
            state.intentionalCupLeave = true;
            socket.emit('cupLeave');
            clearCupState();
            showScreen('cups');
            showToast('Left the cup', 'info');
            return;
        }
        if (state.cupStatus !== 'lobby') {
            showToast('Cannot leave after the cup has started', 'info');
            return;
        }
        state.intentionalCupLeave = true;
        socket.emit('cupLeave');
        clearCupState();
        showScreen('cups');
        showToast('Left the cup', 'info');
    }

    function syncProfileElo(elo) {
        const text = String(elo);
        if (els.profileElo) els.profileElo.textContent = text;
        if (els.profileEloMobile) els.profileEloMobile.textContent = text;
        if (els.lobbyMeElo) els.lobbyMeElo.textContent = text;
    }

    function syncUserCount(count) {
        const text = String(count);
        if (els.userCountNum) els.userCountNum.textContent = text;
        if (els.userCountNumMobile) els.userCountNumMobile.textContent = text;
    }

    function inLivePlay() {
        return state.screen === 'play' && Boolean(state.roomId) && !state.gameEnded;
    }

    function inSetupMatch() {
        return Boolean(state.roomId) && !state.gameEnded &&
            (state.screen === 'waiting' || state.screen === 'secret');
    }

    function goNavPlay() {
        if (
            state.screen === 'history' ||
            state.screen === 'friends' ||
            state.screen === 'cups' ||
            state.screen === 'cupLobby'
        ) {
            if (inCupLobby() && state.cupStatus === 'lobby') {
                showToast('Leave the cup first, or stay on Cups', 'info');
                return;
            }
            // Return to endgame board if still there; else lobby
            if (state.gameEnded && state.roomId) {
                showScreen('play');
                return;
            }
            showScreen('lobby');
            return;
        }
        if (state.gameEnded && state.screen === 'play') {
            leaveAfterWin();
            return;
        }
        if (inLivePlay() || inSetupMatch() || inCupLobby()) {
            showToast('Finish or leave the current game first', 'info');
            return;
        }
        showScreen('lobby');
    }

    function goNavHistory() {
        // Only block during an active live match
        if (inLivePlay()) {
            showToast('Finish the current game first', 'info');
            return;
        }
        if (inCupLobby() && state.cupStatus === 'lobby') {
            showToast('Leave the cup lobby first', 'info');
            return;
        }
        openHistory();
    }

    function goNavFriends() {
        if (inLivePlay()) {
            showToast('Finish the current game first', 'info');
            return;
        }
        if (inCupLobby() && state.cupStatus === 'lobby') {
            showToast('Leave the cup lobby first', 'info');
            return;
        }
        openFriends();
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

    function playChatSound() {
        try {
            const audio = new Audio(
                'universfield-message-notification-199577.mp3'
            );
            audio.volume = 0.5;
            const p = audio.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch {
            /* ignore */
        }
    }

    function clearEndBanner() {
        hideResultPopup();
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

    function buildDigitTracker() {
        if (!els.digitTracker) return;
        els.digitTracker.innerHTML = '';
        for (let i = 1; i <= 9; i++) {
            const digit = String(i);
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'digit-chip';
            chip.dataset.digit = digit;
            chip.textContent = digit;
            els.digitTracker.appendChild(chip);
        }
    }

    function resetDigitTracker() {
        for (const d of Object.keys(digitNotes)) digitNotes[d] = 'default';
        if (!els.digitTracker?.querySelector('.digit-chip')) {
            buildDigitTracker();
            return;
        }
        els.digitTracker.querySelectorAll('.digit-chip').forEach((btn) => {
            btn.classList.remove('state-in', 'state-out', 'state-maybe');
        });
    }

    function cycleDigitChip(btn) {
        const digit = btn?.dataset?.digit;
        if (!digit || digitNotes[digit] === undefined) return;
        const idx = DIGIT_STATES.indexOf(digitNotes[digit]);
        const next = DIGIT_STATES[(idx + 1) % DIGIT_STATES.length];
        digitNotes[digit] = next;
        btn.classList.toggle('state-out', next === 'out');
        btn.classList.toggle('state-in', next === 'in');
        btn.classList.toggle('state-maybe', next === 'maybe');
    }

    function escapeChatHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function clearMatchChat() {
        if (els.matchChatLog) els.matchChatLog.innerHTML = '';
        if (els.matchChatInput) els.matchChatInput.value = '';
    }

    function syncMatchChatVisibility() {
        const show =
            state.screen === 'play' &&
            !!state.roomId &&
            !state.vsAI &&
            !state.spectating;
        els.matchChat?.classList.toggle('hide', !show);
    }

    function appendChatMessage({ from, text, isMe, playSound = false }) {
        if (!els.matchChatLog || !text) return;
        const row = document.createElement('div');
        row.className = `match-chat-msg ${isMe ? 'is-me' : 'is-them'}`;
        row.innerHTML = `<div class="match-chat-bubble">${escapeChatHtml(
            text
        )}</div><span class="chat-from">${escapeChatHtml(
            from || (isMe ? 'You' : 'Opponent')
        )}</span>`;
        els.matchChatLog.appendChild(row);
        els.matchChatLog.scrollTop = els.matchChatLog.scrollHeight;
        if (playSound) playChatSound();
    }

    function sendMatchChat() {
        if (!state.roomId || state.vsAI || state.spectating || state.gameEnded) return;
        const raw = (els.matchChatInput?.value || '').slice(0, 100);
        const text = raw.replace(/\r/g, '').trimEnd();
        if (!text.trim()) return;
        socket.emit('chatSend', { roomId: state.roomId, text, sessionId });
        if (els.matchChatInput) els.matchChatInput.value = '';
    }

    function hideResultPopup() {
        clearTimeout(resultPopupTimer);
        resultPopupTimer = null;
        els.resultPopup?.classList.add('hide');
    }

    function showResultPopup(didWin) {
        if (!els.resultPopup || !els.resultPopupText) return;
        hideResultPopup();
        els.resultPopupText.textContent = didWin ? 'You win' : 'You lost';
        els.resultPopupText.classList.toggle('is-win', didWin);
        els.resultPopupText.classList.toggle('is-lose', !didWin);
        // Restart CSS animation
        els.resultPopupText.style.animation = 'none';
        void els.resultPopupText.offsetWidth;
        els.resultPopupText.style.animation = '';
        els.resultPopup.classList.remove('hide');
        resultPopupTimer = setTimeout(() => {
            els.resultPopup.classList.add('hide');
            resultPopupTimer = null;
            if (state.gameEnded && !state.spectating) {
                els.endActions?.classList.remove('hide');
            }
        }, 1400);
    }

    function showGameEndBanner(text, didWin, eloLine) {
        state.gameEnded = true;
        state.canAddGuess = false;
        state.highlightGuesses = true;
        els.playStatus.textContent = 'Match over';
        els.playStatus.classList.remove('status-win', 'status-lose', 'animate-win-loss');
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
        els.endActions?.classList.add('hide');
        if (els.btnPlayAgain) {
            els.btnPlayAgain.textContent = state.cupId ? 'Back to cup' : 'Play again';
            els.btnPlayAgain.disabled = false;
        }
        if (els.btnEndHome) {
            els.btnEndHome.textContent = state.cupId ? 'Cup lobby' : 'Home';
        }
        els.guessInput.value = '';
        els.guessInput.disabled = true;
        els.btnResign.disabled = true;
        stopAllTimers();
        applyBoardLabels();
        refreshHistoryHighlights();
        playEndSound(didWin);
        showResultPopup(didWin);
        void text;
    }

    function leaveAfterWin() {
        const msg = state.pendingWinMessage;
        socket.emit('clearRematch');
        if (state.cupId) {
            returnToCupHub();
            if (msg) showToast(msg.text, msg.type || 'info');
            return;
        }
        clearEndBanner();
        resetToLobby(msg ? { message: msg.text, type: msg.type } : {});
    }

    function playAgain() {
        if (state.cupId) {
            returnToCupHub();
            return;
        }
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
            socket.emit('playVsAI', { sessionId });
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

    function stopMyTimer() {
        clearInterval(myTimeInterval);
        myTimeInterval = null;
        myTurnEndsAt = 0;
    }

    function stopAllTimers() {
        stopMyTimer();
        if (els.myTime) els.myTime.style.height = '100%';
        if (els.oppTime) els.oppTime.style.height = '100%';
    }

    function paintMyTimerBar(msLeft) {
        if (!els.myTime) return;
        const frac = Math.max(0, Math.min(1, msLeft / TURN_MS_CLIENT));
        els.myTime.style.height = `${Math.max(2, frac * 100)}%`;
    }

    /** Server-authoritative remaining ms — refresh must not reset to full. */
    function startMyTimer(turnMsRemaining) {
        if (state.spectating || state.gameEnded) return;
        stopMyTimer();
        const remaining = Math.max(
            0,
            Math.min(
                TURN_MS_CLIENT,
                turnMsRemaining == null ? TURN_MS_CLIENT : Number(turnMsRemaining)
            )
        );
        myTurnEndsAt = Date.now() + remaining;
        paintMyTimerBar(remaining);
        myTimeInterval = setInterval(() => {
            const left = Math.max(0, myTurnEndsAt - Date.now());
            paintMyTimerBar(left);
            if (left <= 0) {
                stopMyTimer();
                // Server also expires this turn; client nudge for snappy UX
                if (state.canAddGuess && !state.gameEnded) {
                    submitGuess(getRandomGuess());
                }
            }
        }, 50);
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
        state.highlightGuesses = false;
        state.lastP1History = [];
        state.lastP2History = [];
        state.reviewP1Secret = null;
        state.reviewP2Secret = null;
        state.vsAI = false;
        state.opponentName = null;
        state.cupMatchId = null;
        els.historyBoard.innerHTML = '';
        els.mySecretDisplay.textContent = '____';
        els.secretInput.value = '';
        els.guessInput.value = '';
        els.guessInput.disabled = false;
        els.btnResign.disabled = false;
        els.joinCodeInput.value = '';
        els.btnSetSecret.disabled = true;
        els.p1Label.classList.remove('you-label', 'secret-reveal');
        els.p2Label.classList.remove('you-label', 'secret-reveal');
        if (els.p1Label) els.p1Label.textContent = 'You';
        if (els.p2Label) els.p2Label.textContent = 'Opponent';
        if (!state.cupId) clearPlayState();
        resetDigitTracker();
        clearMatchChat();
        els.matchChat?.classList.add('hide');
        hideResultPopup();
        showScreen('lobby');
        if (message) showToast(message, type);
    }

    function applyRoomResume(room) {
        if (!room?.roomId) return;
        state.roomId = room.roomId;
        state.playerName = room.playerName;
        state.vsAI = !!room.vsAI;
        state.opponentName = room.vsAI
            ? 'AI'
            : room.opponentName || state.opponentName;
        state.cupId = room.cupId || state.cupId;
        state.cupMatchId = room.cupMatchId || state.cupMatchId;
        state.gameEnded = false;
        state.spectating = false;
        clearEndBanner();

        if (room.status === 'playing' && room.secretLocked && room.secret) {
            state.secret = room.secret;
            state.secretLocked = true;
            els.historyBoard.innerHTML = '';
            const canGuess = room.canAddGuess !== false;
            enterPlay({
                turnMsRemaining: room.turnMsRemaining,
                startTimer: canGuess,
            });
            renderResults(room.playerOneHistory || [], room.playerTwoHistory || []);
            state.canAddGuess = canGuess;
            els.playStatus.textContent = canGuess
                ? 'Your turn'
                : 'Waiting for opponent…';
            showToast('Rejoined match', 'info');
            return;
        }

        if (room.status === 'waiting') {
            els.roomCodeText.textContent = room.roomId;
            els.waitingStatus.textContent = 'Rejoined — waiting for opponent';
            showScreen('waiting');
            showToast('Rejoined room', 'info');
            return;
        }

        // ready / secret setup
        if (room.secretLocked && room.secret) {
            state.secret = room.secret;
            state.secretLocked = true;
            els.secretInput.value = room.secret;
            els.secretInput.disabled = true;
            els.btnSetSecret.disabled = true;
            els.secretStatus.textContent = 'Secret locked in — waiting for opponent…';
            showScreen('secret');
        } else {
            goToSecretScreen('Rejoined — set your secret number');
        }
        showToast('Rejoined room', 'info');
    }

    function applySessionRestored(msg) {
        if (!msg) return;
        if (!msg.cup && !msg.room) return;
        if (msg.cup) {
            renderCupLobby(msg.cup, { forceScreen: !msg.room });
            if (!msg.room) {
                showToast('Rejoined cup', 'info');
            }
        }
        if (msg.room) {
            applyRoomResume(msg.room);
        }
        persistPlayState();
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

    function enterPlay(opts = {}) {
        state.gameEnded = false;
        state.highlightGuesses = false;
        state.reviewP1Secret = null;
        state.reviewP2Secret = null;
        state.spectating = false;
        state.spectateMatchId = null;
        state.spectateRoomId = null;
        setSpectateShell(false);
        els.spectateActions?.classList.add('hide');
        els.mySecretDisplay.textContent = state.secret;
        els.sideRoom.textContent = `Room ${state.roomId}`;
        els.sideRole.textContent = 'You';
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

        applyBoardLabels();
        resetDigitTracker();
        clearMatchChat();
        clearEndBanner();
        showScreen('play');
        syncMatchChatVisibility();
        if (opts.startTimer === false) {
            stopMyTimer();
        } else {
            startMyTimer(opts.turnMsRemaining);
        }
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

    /** Color a digit vs the secret that side was guessing toward. */
    function digitCellHtml(arr, index, targetSecret) {
        const d = arr?.length ? String(arr[index] ?? '') : '';
        if (!d) return '<div class="single-num center"></div>';
        if (!state.highlightGuesses || !targetSecret) {
            return `<div class="single-num center">${d}</div>`;
        }
        const secret = String(targetSecret);
        let cls = '';
        if (secret[index] === d) cls = ' digit-exact';
        else if (secret.includes(d)) cls = ' digit-present';
        return `<div class="single-num center${cls}">${d}</div>`;
    }

    function singleRound(left, right, leftTarget, rightTarget) {
        const cell = (arr, i) => (arr.length ? String(arr[i] ?? '') : '');
        return `<div class="singleGuess">
            <div class="player-one-con player-con">
                <div class="player-one-name-con player-name-con poppins-medium center p1-guess-con guess-con">
                    ${digitCellHtml(left, 0, leftTarget)}
                    ${digitCellHtml(left, 1, leftTarget)}
                    ${digitCellHtml(left, 2, leftTarget)}
                    ${digitCellHtml(left, 3, leftTarget)}
                </div>
                <div class="player-one-n poppins-medium center p1-number n-o">${cell(left, 4)}</div>
                <div class="player-one-n poppins-medium center p1-order n-o">${cell(left, 5)}</div>
            </div>
            <div class="player-two-con player-con">
                <div class="player-one-name-con player-name-con poppins-medium center p2-guess-con guess-con">
                    ${digitCellHtml(right, 0, rightTarget)}
                    ${digitCellHtml(right, 1, rightTarget)}
                    ${digitCellHtml(right, 2, rightTarget)}
                    ${digitCellHtml(right, 3, rightTarget)}
                </div>
                <div class="player-two-n poppins-medium center p2-number n-o">${cell(right, 4)}</div>
                <div class="player-two-n poppins-medium center p2-order n-o">${cell(right, 5)}</div>
            </div>
        </div>`;
    }

    function youOnLeft() {
        return !state.spectating && state.playerName === 'Player Two';
    }

    function setNameLabel(el, text, { you = false, secret = false } = {}) {
        if (!el) return;
        el.textContent = text;
        el.classList.toggle('you-label', Boolean(you) && !secret);
        el.classList.toggle('secret-reveal', Boolean(secret));
    }

    function opponentSecretForSeat() {
        if (state.playerName === 'Player Two') return state.reviewP1Secret;
        return state.reviewP2Secret;
    }

    function applyBoardLabels(opts = {}) {
        if (state.spectating) {
            const reveal =
                Boolean(state.reviewP1Secret || state.reviewP2Secret) &&
                (state.gameEnded || state.highlightGuesses);
            if (reveal && state.reviewP1Secret) {
                setNameLabel(els.p1Label, state.reviewP1Secret, { secret: true });
            } else {
                setNameLabel(els.p1Label, opts.p1Name || 'Player One');
            }
            if (reveal && state.reviewP2Secret) {
                setNameLabel(els.p2Label, state.reviewP2Secret, { secret: true });
            } else {
                setNameLabel(els.p2Label, opts.p2Name || 'Player Two');
            }
            return;
        }
        const opp =
            state.vsAI
                ? 'AI'
                : opts.oppName || state.opponentName || 'Opponent';
        setNameLabel(els.p1Label, 'You', { you: true });
        const oppSecret = opponentSecretForSeat();
        if (state.gameEnded && oppSecret) {
            setNameLabel(els.p2Label, oppSecret, { secret: true });
        } else {
            setNameLabel(els.p2Label, opp);
        }
    }

    function renderResults(playerOneHistory, playerTwoHistory) {
        state.lastP1History = playerOneHistory || [];
        state.lastP2History = playerTwoHistory || [];
        const swap = youOnLeft();
        const leftHist = swap ? state.lastP2History : state.lastP1History;
        const rightHist = swap ? state.lastP1History : state.lastP2History;
        // P1 guesses at P2's secret; P2 guesses at P1's secret
        const leftTarget = swap ? state.reviewP1Secret : state.reviewP2Secret;
        const rightTarget = swap ? state.reviewP2Secret : state.reviewP1Secret;
        const maxRounds = Math.max(leftHist.length, rightHist.length);
        let html = '';
        for (let i = 0; i < maxRounds; i++) {
            html += singleRound(
                leftHist[i] || [],
                rightHist[i] || [],
                leftTarget,
                rightTarget
            );
        }
        els.historyBoard.innerHTML = html;
        els.historyBoard.scrollTop = els.historyBoard.scrollHeight;
    }

    function refreshHistoryHighlights() {
        if (!state.lastP1History.length && !state.lastP2History.length) return;
        renderResults(state.lastP1History, state.lastP2History);
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
        state.user = user || null;
        els.sessionLoading?.classList.add('hide');
        // Play is always available (guest or logged in)
        els.playPanel?.classList.remove('hide');
        if (state.user) {
            els.authPanel?.classList.add('hide');
            els.profileChip?.classList.remove('hide');
            els.profileChipMobile?.classList.remove('hide');
            els.btnLogout?.classList.remove('hide');
            els.btnLogoutMobile?.classList.remove('hide');
            els.lobbyHero?.classList.add('hide');
            els.lobbyMe?.classList.remove('hide');
            els.navFriendsPeek?.classList.remove('hide');
            if (els.profileName) els.profileName.textContent = state.user.display_name;
            if (els.profileNameMobile)
                els.profileNameMobile.textContent = state.user.display_name;
            if (els.lobbyMeName) els.lobbyMeName.textContent = state.user.display_name;
            syncProfileElo(state.user.elo);
            warmFriendsCache();
            if (state.screen === 'play') applyBoardLabels();
        } else {
            els.authPanel?.classList.remove('hide');
            els.profileChip?.classList.add('hide');
            els.profileChipMobile?.classList.add('hide');
            els.btnLogout?.classList.add('hide');
            els.btnLogoutMobile?.classList.add('hide');
            els.lobbyHero?.classList.remove('hide');
            els.lobbyMe?.classList.add('hide');
            els.navFriendsPeek?.classList.add('hide');
            if (els.lobbyFriendsList) els.lobbyFriendsList.innerHTML = '';
            queryClient?.clear();
            updateFriendsBadge(0);
        }
    }

    function openProfile() {
        showScreen('profile');
        if (!state.user) {
            els.profileGuest?.classList.remove('hide');
            els.profileForm?.classList.add('hide');
            return;
        }
        els.profileGuest?.classList.add('hide');
        els.profileForm?.classList.remove('hide');
        if (els.profileDisplayName) {
            els.profileDisplayName.value = state.user.display_name || '';
        }
        if (els.profileTelegramHint) {
            const tg = state.user.username
                ? `@${state.user.username}`
                : state.user.telegram_id
                  ? `Telegram #${state.user.telegram_id}`
                  : 'Telegram linked';
            els.profileTelegramHint.textContent = `Login account: ${tg} (unchanged)`;
        }
    }

    async function saveProfile(e) {
        e?.preventDefault?.();
        if (!state.user) {
            showToast('Log in first', 'info');
            return;
        }
        const display_name = (els.profileDisplayName?.value || '').trim();
        if (display_name.length < 2) {
            showToast('Name must be at least 2 characters', 'error');
            return;
        }
        if (els.btnProfileSave) {
            els.btnProfileSave.disabled = true;
            els.btnProfileSave.classList.add('is-loading');
        }
        try {
            const res = await fetch('/api/me', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ display_name }),
            });
            const data = await res.json();
            if (!res.ok || !data.user) {
                showToast(data.error || 'Could not save', 'error');
                return;
            }
            setLoggedInUI({
                ...state.user,
                ...data.user,
            });
            socket.emit('sessionHello', { sessionId });
            showToast('Profile saved', 'info');
        } catch {
            showToast('Network error', 'error');
        } finally {
            if (els.btnProfileSave) {
                els.btnProfileSave.disabled = false;
                els.btnProfileSave.classList.remove('is-loading');
            }
        }
    }

    function requireAuth(message = 'Log in with Telegram first') {
        if (state.user) return true;
        showToast(message, 'info');
        return false;
    }

    function presenceLabel(online) {
        return online
            ? '<span class="friends-presence is-online">Online</span>'
            : '<span class="friends-presence is-offline">Offline</span>';
    }

    function friendDisplayName(friend) {
        if (!friend) return 'Player';
        if (friend.username) return `@${friend.username}`;
        return friend.display_name || 'Player';
    }

    function emptyFriendsData() {
        return { accepted: [], pendingIn: [], pendingOut: [] };
    }

    function getFriendsData() {
        return queryClient?.getQueryData(FRIENDS_QUERY_KEY) || emptyFriendsData();
    }

    function updateFriendsBadge(countOverride) {
        const badge = els.friendsBadge;
        if (!badge) return;
        const data = getFriendsData();
        const count =
            typeof countOverride === 'number'
                ? countOverride
                : (data.pendingIn || []).length;
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.classList.remove('hide');
        } else {
            badge.textContent = '0';
            badge.classList.add('hide');
        }
    }

    async function fetchFriendsPayload() {
        const res = await fetch('/api/friends', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Failed to load friends');
        }
        return {
            accepted: data.accepted || [],
            pendingIn: data.pendingIn || [],
            pendingOut: data.pendingOut || [],
        };
    }

    async function ensureFriendsLoaded({ force = false } = {}) {
        if (!queryClient || !state.user) return emptyFriendsData();
        const data = await queryClient.fetchQuery(
            FRIENDS_QUERY_KEY,
            fetchFriendsPayload,
            { force }
        );
        updateFriendsBadge();
        return data;
    }

    function warmFriendsCache() {
        if (!state.user || !queryClient) return;
        void ensureFriendsLoaded()
            .then(() => renderLobbyFriends(getFriendsData().accepted || []))
            .catch(() => {
                /* ignore warm errors */
            });
    }

    function renderLobbyFriends(list) {
        if (!els.lobbyFriendsList) return;
        if (!state.user) {
            els.lobbyFriendsList.innerHTML = '';
            return;
        }
        if (!list.length) {
            els.lobbyFriendsList.innerHTML =
                '<p class="friends-empty">No friends yet — open Friends to add some</p>';
            return;
        }
        const sorted = [...list].sort((a, b) => {
            const ao = a.online ? 1 : 0;
            const bo = b.online ? 1 : 0;
            if (bo !== ao) return bo - ao;
            return friendDisplayName(a.friend).localeCompare(
                friendDisplayName(b.friend)
            );
        });
        // Sidebar peek — presence only (invite stays on Friends tab)
        els.lobbyFriendsList.innerHTML = sorted
            .map((item) => {
                const fid = item.friend?.id || '';
                return `<div class="friends-row" data-friend-user-id="${escapeHtml(
                    fid
                )}">
                <div class="friends-row-main">
                    <span class="font-medium truncate text-sm">${escapeHtml(
                        friendDisplayName(item.friend)
                    )}</span>
                    ${presenceLabel(item.online)}
                </div>
            </div>`;
            })
            .join('');
    }

    function renderFriendsFromCache() {
        const data = getFriendsData();
        renderFriendsPending(data);
        renderFriendsAccepted(data.accepted || []);
        renderLobbyFriends(data.accepted || []);
        updateFriendsBadge();
    }

    async function openFriends() {
        if (!requireAuth('Log in with Telegram to use Friends')) return;
        showScreen('friends');
        const cached = queryClient?.getQueryData(FRIENDS_QUERY_KEY);
        if (cached) {
            renderFriendsFromCache();
        } else if (els.friendsPending) {
            els.friendsPending.innerHTML =
                '<p class="friends-empty">Loading…</p>';
            els.friendsAccepted.innerHTML =
                '<p class="friends-empty">Loading…</p>';
        }
        try {
            // Always refetch on open so Online/Offline matches presence
            await ensureFriendsLoaded({ force: true });
            renderFriendsFromCache();
        } catch (err) {
            if (!cached) {
                els.friendsPending.innerHTML = `<p class="friends-empty">${
                    err.message || 'Network error'
                }</p>`;
                els.friendsAccepted.innerHTML = '';
            }
        }
    }

    async function refreshFriendsLists({ force = true } = {}) {
        try {
            await ensureFriendsLoaded({ force });
            if (state.screen === 'friends') renderFriendsFromCache();
            else {
                renderLobbyFriends(getFriendsData().accepted || []);
                updateFriendsBadge();
            }
        } catch (err) {
            if (state.screen === 'friends') {
                els.friendsPending.innerHTML = `<p class="friends-empty">${
                    err.message || 'Network error'
                }</p>`;
                els.friendsAccepted.innerHTML = '';
            }
        }
    }

    function patchFriendsCache(updater) {
        if (!queryClient) return;
        queryClient.setQueryData(FRIENDS_QUERY_KEY, (prev) => {
            const base = prev || emptyFriendsData();
            return updater({
                accepted: [...(base.accepted || [])],
                pendingIn: [...(base.pendingIn || [])],
                pendingOut: [...(base.pendingOut || [])],
            });
        });
        if (state.screen === 'friends') renderFriendsFromCache();
        else {
            renderLobbyFriends(getFriendsData().accepted || []);
            updateFriendsBadge();
        }
    }

    function renderFriendsPending(data) {
        const incoming = data.pendingIn || [];
        const outgoing = data.pendingOut || [];
        if (!incoming.length && !outgoing.length) {
            els.friendsPending.innerHTML =
                '<p class="friends-empty">No pending requests</p>';
            return;
        }
        const parts = [];
        for (const item of incoming) {
            parts.push(`<div class="friends-row" data-friendship-id="${escapeHtml(
                item.id
            )}">
                <div class="friends-row-main">
                    <span class="font-medium truncate">${escapeHtml(
                        friendDisplayName(item.friend)
                    )}</span>
                    <span class="text-sm text-muted">Wants to be friends</span>
                </div>
                <div class="friends-row-actions">
                    <button type="button" class="friends-btn" data-friend-accept="${escapeHtml(
                        item.id
                    )}">Accept</button>
                    <button type="button" class="friends-btn secondary" data-friend-decline="${escapeHtml(
                        item.id
                    )}">Decline</button>
                </div>
            </div>`);
        }
        for (const item of outgoing) {
            parts.push(`<div class="friends-row">
                <div class="friends-row-main">
                    <span class="font-medium truncate">${escapeHtml(
                        friendDisplayName(item.friend)
                    )}</span>
                    <span class="text-sm text-muted">Request sent</span>
                </div>
                <div class="friends-row-actions">
                    <button type="button" class="friends-btn secondary" data-friend-cancel="${escapeHtml(
                        item.id
                    )}">Cancel</button>
                </div>
            </div>`);
        }
        els.friendsPending.innerHTML = parts.join('');
    }

    function renderFriendsAccepted(list) {
        if (!list.length) {
            els.friendsAccepted.innerHTML =
                '<p class="friends-empty">No friends yet — search above</p>';
            return;
        }
        els.friendsAccepted.innerHTML = list
            .map((item) => {
                const fid = item.friend?.id || '';
                return `<div class="friends-row" data-friend-user-id="${escapeHtml(
                    fid
                )}">
                <div class="friends-row-main">
                    <span class="font-medium truncate">${escapeHtml(
                        friendDisplayName(item.friend)
                    )}</span>
                    ${presenceLabel(item.online)}
                </div>
                <div class="friends-row-actions">
                    <button type="button" class="friends-btn play" data-friend-invite="${escapeHtml(
                        fid
                    )}">Invite</button>
                    <button type="button" class="friends-btn secondary" data-friend-remove="${escapeHtml(
                        item.id
                    )}">Remove</button>
                </div>
            </div>`;
            })
            .join('');
    }

    async function searchFriends() {
        const q = (els.friendsSearchInput?.value || '').trim();
        if (q.length < 2) {
            showToast('Type at least 2 characters', 'info');
            return;
        }
        els.friendsSearchResults.innerHTML =
            '<p class="friends-empty">Searching…</p>';
        try {
            const res = await fetch(
                `/api/friends/search?q=${encodeURIComponent(q)}`,
                { credentials: 'include' }
            );
            const data = await res.json();
            if (!res.ok) {
                els.friendsSearchResults.innerHTML = `<p class="friends-empty">${
                    data.error || 'Failed'
                }</p>`;
                return;
            }
            if (!data.users?.length) {
                els.friendsSearchResults.innerHTML =
                    '<p class="friends-empty">No users found</p>';
                return;
            }
            els.friendsSearchResults.innerHTML = data.users
                .map(
                    (u) => `<div class="friends-row">
                <div class="friends-row-main">
                    <span class="font-medium truncate">${escapeHtml(
                        friendDisplayName(u)
                    )}</span>
                    ${presenceLabel(u.online)}
                </div>
                <div class="friends-row-actions">
                    <button type="button" class="friends-btn" data-friend-add="${escapeHtml(
                        u.id
                    )}">Add</button>
                </div>
            </div>`
                )
                .join('');
        } catch {
            els.friendsSearchResults.innerHTML =
                '<p class="friends-empty">Network error</p>';
        }
    }

    function hideFriendInviteBar() {
        state.pendingFriendInvite = null;
        els.friendInviteBar?.classList.add('hide');
    }

    function showFriendInviteBar(invite) {
        state.pendingFriendInvite = invite;
        if (els.friendInviteText) {
            els.friendInviteText.textContent = `${
                invite.fromName || 'A friend'
            } invited you to play`;
        }
        els.friendInviteBar?.classList.remove('hide');
    }

    function showHistoryList() {
        state.historyDetailId = null;
        els.historyListPanel?.classList.remove('hide');
        els.historyDetailPanel?.classList.add('hide');
        if (els.btnHistoryBack) els.btnHistoryBack.textContent = 'Back';
    }

    function renderHistoryDetailBoard(detail) {
        const board = els.historyDetailBoard;
        if (!board) return;
        state.highlightGuesses = Boolean(
            detail.playerOneSecret || detail.playerTwoSecret
        );
        state.reviewP1Secret = detail.playerOneSecret || null;
        state.reviewP2Secret = detail.playerTwoSecret || null;
        state.lastP1History = detail.playerOneHistory || [];
        state.lastP2History = detail.playerTwoHistory || [];

        if (els.histP1Label) {
            if (detail.playerOneSecret) {
                setNameLabel(els.histP1Label, detail.playerOneSecret, {
                    secret: true,
                });
            } else {
                setNameLabel(els.histP1Label, detail.playerOneName || 'You');
            }
        }
        if (els.histP2Label) {
            if (detail.playerTwoSecret) {
                setNameLabel(els.histP2Label, detail.playerTwoSecret, {
                    secret: true,
                });
            } else {
                setNameLabel(els.histP2Label, detail.playerTwoName || 'Opponent');
            }
        }

        const leftHist = state.lastP1History;
        const rightHist = state.lastP2History;
        const leftTarget = state.reviewP2Secret;
        const rightTarget = state.reviewP1Secret;
        const maxRounds = Math.max(leftHist.length, rightHist.length);
        let html = '';
        for (let i = 0; i < maxRounds; i++) {
            html += singleRound(
                leftHist[i] || [],
                rightHist[i] || [],
                leftTarget,
                rightTarget
            );
        }
        board.innerHTML = html || '<p class="friends-empty">No moves recorded</p>';
    }

    async function openHistoryDetail(id) {
        if (!id) return;
        try {
            const res = await fetch(`/api/history/${encodeURIComponent(id)}`, {
                credentials: 'include',
            });
            const data = await res.json();
            if (!res.ok || !data.game) {
                showToast(data.error || 'Could not open game', 'error');
                return;
            }
            const g = data.game;
            state.historyDetailId = id;
            els.historyListPanel?.classList.add('hide');
            els.historyDetailPanel?.classList.remove('hide');
            if (els.historyDetailTitle) {
                els.historyDetailTitle.textContent =
                    g.result_label || 'Game review';
            }
            if (els.historyDetailMeta) {
                const when = g.finished_at
                    ? new Date(g.finished_at).toLocaleString()
                    : '';
                const kind =
                    g.kind === 'cup'
                        ? `Cup ${g.cup_code || ''}`.trim()
                        : g.mode === 'ai'
                          ? 'vs AI'
                          : 'PvP';
                els.historyDetailMeta.textContent = `${kind} · vs ${
                    g.opponent || 'Opponent'
                }${when ? ` · ${when}` : ''}`;
            }
            if (els.btnHistoryBack) els.btnHistoryBack.textContent = 'Back to list';
            renderHistoryDetailBoard(g);
        } catch {
            showToast('Network error', 'error');
        }
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
        if (!requireAuth('Log in with Telegram to view match history')) return;
        showHistoryList();
        els.historyList.innerHTML =
            '<p class="status-line poppins-regular">Loading…</p>';
        showScreen('history');
        try {
            const res = await fetch('/api/history', { credentials: 'include' });
            const data = await res.json();
            if (!res.ok) {
                els.historyList.innerHTML = `<p class="status-line">${
                    data.error || 'Failed'
                }</p>`;
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
                        g.kind === 'cup'
                            ? 'Cup'
                            : g.elo_delta === 0
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
                    const label =
                        g.result_label ||
                        (g.result === 'win'
                            ? 'You won'
                            : g.result === 'loss'
                              ? 'You lost'
                              : 'Unknown');
                    const when = g.finished_at
                        ? new Date(g.finished_at).toLocaleString()
                        : '';
                    const modeLabel =
                        g.kind === 'cup'
                            ? 'Cup'
                            : g.mode === 'ai'
                              ? 'AI'
                              : 'PvP';
                    return `<button type="button" class="history-row ${resultClass}" data-history-id="${escapeHtml(
                        g.id
                    )}">
                        <div class="history-row-main">
                            <span class="poppins-semibold">${escapeHtml(
                                label
                            )}</span>
                            <span class="poppins-regular">vs ${escapeHtml(
                                g.opponent || 'Opponent'
                            )}${
                                g.opponent_elo != null
                                    ? ` (${g.opponent_elo})`
                                    : ''
                            }</span>
                        </div>
                        <div class="history-row-meta poppins-regular">
                            <span>${modeLabel}</span>
                            <span class="elo-delta">${escapeHtml(
                                String(delta)
                            )}${g.kind === 'cup' ? '' : ' Elo'}</span>
                            <span>${escapeHtml(when)}</span>
                        </div>
                    </button>`;
                })
                .join('');
        } catch {
            els.historyList.innerHTML =
                '<p class="status-line">Network error</p>';
        }
    }

    // ——— UI events ———

    els.btnCreate.addEventListener('click', () => {
        state.vsAI = false;
        socket.emit('createRoom', { sessionId });
    });

    els.btnVsAi.addEventListener('click', () => {
        state.vsAI = true;
        socket.emit('playVsAI', { sessionId });
    });

    els.btnJoin.addEventListener('click', () => {
        state.vsAI = false;
        const code = els.joinCodeInput.value.trim().toUpperCase();
        if (!code) {
            showToast('Enter a room code', 'error');
            return;
        }
        socket.emit('joinRoom', { code, sessionId });
    });

    els.btnHistoryBack?.addEventListener('click', () => {
        if (state.historyDetailId) {
            showHistoryList();
            openHistory();
            return;
        }
        showScreen('lobby');
    });
    els.historyList?.addEventListener('click', (e) => {
        const row = e.target.closest('[data-history-id]');
        if (!row) return;
        openHistoryDetail(row.getAttribute('data-history-id'));
    });
    els.btnFriendsBack?.addEventListener('click', () => showScreen('lobby'));
    els.btnFriendsSearch?.addEventListener('click', () => searchFriends());
    els.friendsSearchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchFriends();
    });
    function inviteFriendToPlay(userId) {
        if (!userId) return;
        if (inLivePlay() || inSetupMatch() || state.cupId) {
            showToast('Leave your current game or cup first', 'info');
            return;
        }
        socket.emit('friendPlayInvite', { userId, sessionId });
    }

    const friendsClickRoot = document.getElementById('screen-friends');
    friendsClickRoot?.addEventListener('click', async (e) => {
        const add = e.target.closest('[data-friend-add]');
        if (add) {
            const userId = add.getAttribute('data-friend-add');
            const res = await fetch('/api/friends/request', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(data.error || 'Could not send request', 'error');
                return;
            }
            showToast('Friend request sent', 'info');
            els.friendsSearchResults.innerHTML = '';
            await refreshFriendsLists();
            return;
        }
        const accept = e.target.closest('[data-friend-accept]');
        if (accept) {
            const friendshipId = accept.getAttribute('data-friend-accept');
            const res = await fetch('/api/friends/respond', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ friendshipId, accept: true }),
            });
            const data = await res.json();
            if (!res.ok) showToast(data.error || 'Failed', 'error');
            else showToast('Friend added', 'info');
            await refreshFriendsLists();
            return;
        }
        const decline = e.target.closest('[data-friend-decline]');
        if (decline) {
            const friendshipId = decline.getAttribute('data-friend-decline');
            await fetch('/api/friends/respond', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ friendshipId, accept: false }),
            });
            await refreshFriendsLists();
            return;
        }
        const cancel = e.target.closest('[data-friend-cancel]');
        if (cancel) {
            const id = cancel.getAttribute('data-friend-cancel');
            await fetch(`/api/friends/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            await refreshFriendsLists();
            return;
        }
        const remove = e.target.closest('[data-friend-remove]');
        if (remove) {
            const id = remove.getAttribute('data-friend-remove');
            await fetch(`/api/friends/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            showToast('Removed', 'info');
            await refreshFriendsLists();
            return;
        }
        const invite = e.target.closest('[data-friend-invite]');
        if (invite) {
            inviteFriendToPlay(invite.getAttribute('data-friend-invite'));
        }
    });
    els.btnFriendInviteAccept?.addEventListener('click', () => {
        const invite = state.pendingFriendInvite;
        if (!invite?.roomId) return;
        hideFriendInviteBar();
        socket.emit('friendPlayRespond', {
            roomId: invite.roomId,
            accept: true,
            sessionId,
        });
    });
    els.btnFriendInviteDecline?.addEventListener('click', () => {
        const invite = state.pendingFriendInvite;
        hideFriendInviteBar();
        if (!invite?.roomId) return;
        socket.emit('friendPlayRespond', {
            roomId: invite.roomId,
            accept: false,
            sessionId,
        });
    });
    els.btnCupsBack?.addEventListener('click', () => {
        if (state.cupId) {
            showToast('Leave the cup first', 'info');
            return;
        }
        showScreen('lobby');
    });
    els.btnCupCreate?.addEventListener('click', () => {
        socket.emit('cupCreate', { sessionId });
    });
    els.btnCupJoin?.addEventListener('click', () => {
        const code = (els.cupJoinInput?.value || '').trim().toUpperCase();
        if (!code) {
            showToast('Enter a cup code', 'error');
            return;
        }
        socket.emit('cupJoin', { code, sessionId });
    });
    els.cupJoinInput?.addEventListener('input', () => {
        els.cupJoinInput.value = els.cupJoinInput.value
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 6);
    });
    els.cupJoinInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') els.btnCupJoin?.click();
    });
    els.btnCupCopy?.addEventListener('click', async () => {
        const code = state.cupId;
        if (!code) return;
        try {
            await navigator.clipboard.writeText(buildShareLink({ cup: code }));
            showToast('Cup invite link copied', 'info');
        } catch {
            showToast('Could not copy — select the code manually', 'error');
        }
    });
    els.btnCupStart?.addEventListener('click', () => {
        socket.emit('cupStart', { sessionId });
    });
    els.btnCupLeave?.addEventListener('click', () => leaveCup());
    els.btnSpectateBack?.addEventListener('click', () => exitSpectate());
    els.navPlay?.addEventListener('click', () => goNavPlay());
    els.navCups?.addEventListener('click', () => goNavCups());
    els.navFriends?.addEventListener('click', () => goNavFriends());
    els.navHistory?.addEventListener('click', () => goNavHistory());
    els.navRules?.addEventListener('click', () => showScreen('rules'));
    els.navProfile?.addEventListener('click', () => openProfile());
    els.btnRulesBack?.addEventListener('click', () => goNavPlay());
    els.profileChip?.addEventListener('click', () => openProfile());
    els.profileChipMobile?.addEventListener('click', () => openProfile());
    els.profileForm?.addEventListener('submit', (e) => saveProfile(e));
    els.navBrand?.addEventListener('click', (e) => {
        e.preventDefault();
        goNavPlay();
    });
    els.btnTheme?.addEventListener('click', () => toggleTheme());
    els.btnThemeMobile?.addEventListener('click', () => toggleTheme());

    els.digitTracker?.addEventListener('click', (e) => {
        if (state.spectating) return;
        const chip = e.target.closest('.digit-chip');
        if (chip && els.digitTracker.contains(chip)) cycleDigitChip(chip);
    });

    buildDigitTracker();

    els.matchChatInput?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (e.shiftKey) return;
        e.preventDefault();
        sendMatchChat();
    });

    async function doLogout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        } catch {
            /* ignore */
        }
        queryClient?.clear();
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
            await navigator.clipboard.writeText(buildShareLink({ room: code }));
            showToast('Room invite link copied', 'info');
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
        // While waiting: allow up to 3 digits to brainstorm; 4th only on your turn (auto-submits)
        const maxLen = state.canAddGuess ? 4 : 3;
        const prev = els.guessInput.dataset.last || '';
        const rawDigits = String(els.guessInput.value).replace(/\D/g, '');
        const next = filterDigitInput(els.guessInput.value, prev, maxLen);
        els.guessInput.value = next;
        els.guessInput.dataset.last = next;
        if (!state.canAddGuess && rawDigits.length > 3 && next.length === 3) {
            showToast('Wait for opponent — then add the 4th digit', 'info');
        }
        if (state.canAddGuess && next.length === 4) {
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

    socket.on('cupCreated', (payload) => {
        renderCupLobby(payload);
        showToast('Cup created — share the code', 'info');
    });

    socket.on('cupJoined', (payload) => {
        renderCupLobby(payload);
        showToast('Joined cup', 'info');
    });

    socket.on('cupLobbyUpdate', (payload) => {
        if (!payload?.code) return;
        if (state.cupId && state.cupId !== payload.code) return;
        renderCupLobby(payload);
    });

    socket.on('cupStarted', (payload) => {
        renderCupLobby(payload, { forceScreen: false });
        showToast('Cup started — check your match!', 'info');
    });

    socket.on('cupBracketUpdate', (payload) => {
        if (!payload?.code) return;
        if (state.cupId && state.cupId !== payload.code) return;
        renderCupLobby(payload, {
            forceScreen: state.screen === 'cupLobby' || !state.roomId,
        });
    });

    socket.on('cupMatchAssigned', (msg) => {
        if (!msg?.roomId) return;
        state.cupId = msg.cupCode || state.cupId;
        state.cupMatchId = msg.matchId || null;
        state.cupStatus = 'running';
        state.roomId = msg.roomId;
        state.playerName = msg.playerName;
        state.vsAI = false;
        state.opponentName = msg.opponentName || null;
        state.secret = null;
        state.secretLocked = false;
        state.gameEnded = false;
        clearEndBanner();
        els.historyBoard.innerHTML = '';
        const label = msg.label || 'Cup match';
        const vs = msg.opponentName ? ` vs ${msg.opponentName}` : '';
        goToSecretScreen(`${label}${vs} — set your secret number`);
        showToast(`${label} — set your secret`, 'info');
    });

    socket.on('cupWaiting', (msg) => {
        if (msg?.message) showToast(msg.message, 'info');
        if (state.screen === 'play' && state.gameEnded) {
            // stay on end banner until they tap Back to cup
            return;
        }
        if (state.spectating) return;
        if (!state.roomId || state.gameEnded) {
            returnToCupHub();
        }
    });

    socket.on('cupSpectateStart', (snapshot) => {
        enterSpectate(snapshot);
    });

    socket.on('cupMatchUpdate', (msg) => {
        if (!state.spectating) return;
        if (!msg?.matchId || msg.matchId !== state.spectateMatchId) return;
        if (msg.status === 'done') {
            if (msg.playerOneSecret) state.reviewP1Secret = msg.playerOneSecret;
            if (msg.playerTwoSecret) state.reviewP2Secret = msg.playerTwoSecret;
            state.highlightGuesses = true;
            markSpectateMatchEnded({
                winnerName: msg.winnerName || null,
                label: msg.label || 'Match',
            });
        } else if (els.playEloLine) {
            els.playEloLine.textContent = 'Live view · read only';
            els.playEloLine.classList.remove('hide');
        }
        applyBoardLabels({
            p1Name: msg.playerOneName || 'Player One',
            p2Name: msg.playerTwoName || 'Player Two',
        });
        renderResults(msg.playerOneHistory || [], msg.playerTwoHistory || []);
    });

    socket.on('cupFinished', (payload) => {
        renderCupLobby(payload, { forceScreen: !state.roomId || state.gameEnded });
        syncSpectateFromCupPayload(payload);
        const name = payload?.championName || 'Champion';
        showToast(`${name} wins the cup!`, 'info');
        if (els.btnCupLeave) {
            els.btnCupLeave.classList.remove('hide');
            els.btnCupLeave.textContent = 'Exit cup';
        }
    });

    socket.on('cupLeft', () => {
        if (state.intentionalCupLeave) {
            state.intentionalCupLeave = false;
            return;
        }
        clearCupState();
        showScreen('cups');
        showToast('You left the cup', 'info');
    });

    socket.on('authed', (msg) => {
        setLoggedInUI({
            ...(state.user || {}),
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
        state.opponentName = 'AI';
        state.gameEnded = false;
        const eng = msg.engine === 'neural' ? 'trained model' : 'heuristic AI';
        const eloBit = msg.aiElo != null ? ` · ${msg.aiElo} Elo` : '';
        goToSecretScreen(`vs AI (${eng}${eloBit}) — set your secret number`);
    });

    socket.on('opponentJoined', (msg) => {
        if (msg?.opponentName) state.opponentName = msg.opponentName;
        const name = state.opponentName || 'Opponent';
        if (msg?.message) showToast(msg.message, 'info');
        goToSecretScreen(`${name} joined — set your secret number`);
    });

    socket.on('roomJoined', (msg) => {
        state.roomId = msg.roomId;
        state.playerName = msg.playerName;
        state.vsAI = false;
        if (msg?.opponentName) state.opponentName = msg.opponentName;
        const vs = state.opponentName ? ` vs ${state.opponentName}` : '';
        goToSecretScreen(`Joined${vs} — set your secret number`);
    });

    socket.on('rematchStarted', (msg) => {
        hideRematchInvite();
        clearEndBanner();
        state.roomId = msg.roomId;
        state.playerName = msg.playerName;
        state.vsAI = false;
        if (msg?.opponentName) state.opponentName = msg.opponentName;
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
        enterPlay({ turnMsRemaining: msg.turnMsRemaining });
    });

    socket.on('historyUpdate', (msg) => {
        if (state.spectating) return;
        if (msg.roomId !== state.roomId || state.gameEnded) return;
        state.canAddGuess =
            msg.canAddGuess != null ? !!msg.canAddGuess : !!msg.historiesAreEqual;
        renderResults(msg.playerOneHistory, msg.playerTwoHistory);

        if (state.canAddGuess) {
            els.playStatus.textContent = 'Your turn';
            startMyTimer(msg.turnMsRemaining);
            // Keep brainstormed digits; 4th digit will submit
            if ((els.guessInput.value || '').length === 4) {
                submitGuess(els.guessInput.value);
            } else {
                els.guessInput.focus();
            }
        } else {
            els.playStatus.textContent = 'Waiting for opponent…';
            stopMyTimer();
            // Cap any leftover 4th digit if somehow present
            if ((els.guessInput.value || '').length > 3) {
                const capped = filterDigitInput(els.guessInput.value, '', 3);
                els.guessInput.value = capped;
                els.guessInput.dataset.last = capped;
            }
        }
    });

    socket.on('gamewin', (msg) => {
        if (msg.roomId !== state.roomId) return;
        if (state.gameEnded) return;
        stopAllTimers();
        if (msg.vsAI != null) state.vsAI = !!msg.vsAI;
        if (msg.playerOneHistory || msg.playerTwoHistory) {
            state.lastP1History = msg.playerOneHistory || state.lastP1History;
            state.lastP2History = msg.playerTwoHistory || state.lastP2History;
        }
        state.reviewP1Secret = msg.playerOneSecret || state.reviewP1Secret;
        state.reviewP2Secret = msg.playerTwoSecret || state.reviewP2Secret;
        if (msg.cupId) {
            state.cupId = msg.cupId;
            state.cupMatchId = msg.cupMatchId || state.cupMatchId;
            state.cupStatus = 'running';
            // Match room is deleted server-side; persist cup only for reconnect
            const keptRoom = state.roomId;
            state.roomId = null;
            persistPlayState();
            state.roomId = keptRoom;
        } else {
            clearPlayState();
        }
        const winnerName = msg.winner === 'playerTwo' ? 'Player Two' : 'Player One';
        const didWin = winnerName === state.playerName;
        let eloLine = state.vsAI ? 'vs AI · rating unchanged' : '';
        if (msg.cupId || msg.elo?.cup) {
            eloLine = didWin ? 'Advanced in cup · Elo unchanged' : 'Out of cup · Elo unchanged';
        } else if (msg.elo && state.playerName === 'Player One' && msg.elo.playerOneDelta != null) {
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
            text: msg.cupId
                ? didWin
                    ? 'You advanced!'
                    : 'Cup run over'
                : didWin
                  ? 'Victory!'
                  : 'Defeat — try again',
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

    function sameUserId(a, b) {
        if (a == null || b == null) return false;
        return String(a) === String(b);
    }

    socket.on('friendsPresence', (msg) => {
        if (!msg?.userId) return;
        const online = Boolean(msg.online);
        const uid = String(msg.userId);
        patchFriendsCache((data) => {
            for (const list of [data.accepted, data.pendingIn, data.pendingOut]) {
                for (const item of list) {
                    if (sameUserId(item.friend?.id, uid)) item.online = online;
                }
            }
            return data;
        });
        if (state.screen !== 'friends') return;
        const row = els.friendsAccepted?.querySelector(
            `[data-friend-user-id="${CSS.escape(uid)}"]`
        );
        if (!row) return;
        const chip = row.querySelector('.friends-presence');
        if (!chip) return;
        chip.classList.toggle('is-online', online);
        chip.classList.toggle('is-offline', !online);
        chip.textContent = online ? 'Online' : 'Offline';
    });

    socket.on('friendRequestReceived', (msg) => {
        if (!msg?.friendshipId || !msg.from?.id) return;
        const already = getFriendsData().pendingIn.some(
            (p) => p.id === msg.friendshipId
        );
        if (!already) {
            patchFriendsCache((data) => {
                data.pendingIn.unshift({
                    id: msg.friendshipId,
                    status: 'pending',
                    direction: 'in',
                    friend: {
                        id: msg.from.id,
                        display_name: msg.from.display_name,
                        username: msg.from.username || null,
                    },
                    online: false,
                });
                return data;
            });
        } else {
            updateFriendsBadge();
        }
        if (state.screen !== 'friends') {
            showToast(
                `${friendDisplayName(msg.from)} sent a friend request`,
                'info'
            );
        }
    });

    socket.on('friendRequestResolved', (msg) => {
        if (!msg?.friendshipId) return;
        const status = msg.status;
        patchFriendsCache((data) => {
            const pull = (list) =>
                list.filter((item) => item.id !== msg.friendshipId);

            if (status === 'accepted') {
                data.pendingIn = pull(data.pendingIn);
                data.pendingOut = pull(data.pendingOut);
                const friend =
                    msg.friend ||
                    (msg.friendId
                        ? { id: msg.friendId, display_name: 'Friend' }
                        : null);
                // Skip if payload points at self (accepter also gets this event).
                if (
                    friend?.id &&
                    !sameUserId(friend.id, state.user?.id) &&
                    !data.accepted.some((a) => sameUserId(a.friend?.id, friend.id))
                ) {
                    data.accepted.unshift({
                        id: msg.friendshipId,
                        status: 'accepted',
                        direction: 'out',
                        friend,
                        online: false,
                    });
                }
                return data;
            }

            // declined / removed / cancelled
            data.pendingIn = pull(data.pendingIn);
            data.pendingOut = pull(data.pendingOut);
            if (status === 'removed' && msg.friendId) {
                data.accepted = data.accepted.filter(
                    (a) =>
                        !sameUserId(a.friend?.id, msg.friendId) &&
                        a.id !== msg.friendshipId
                );
            } else {
                data.accepted = pull(data.accepted);
            }
            return data;
        });
        if (status === 'accepted') {
            void refreshFriendsLists({ force: true });
        }
    });

    socket.on('friendPlayInvite', (msg) => {
        if (!msg?.roomId) return;
        showFriendInviteBar(msg);
        showToast(
            `${msg.fromName || 'A friend'} invited you to play`,
            'info'
        );
    });

    socket.on('friendPlayInviteResult', (msg) => {
        if (!msg) return;
        if (msg.ok) {
            showToast(msg.message || 'Invite sent…', 'info');
            return;
        }
        showToast(msg.message || 'Could not invite', 'error');
        if (msg.reason === 'declined' && msg.roomId && state.roomId === msg.roomId) {
            state.intentionalLeave = true;
            resetToLobby({ message: 'Friend declined', type: 'info' });
        }
    });

    socket.on('chatMessage', (msg) => {
        if (!msg || msg.roomId !== state.roomId) return;
        if (state.vsAI || state.spectating) return;
        const isMe = msg.sessionId && msg.sessionId === sessionId;
        appendChatMessage({
            from: isMe ? 'You' : msg.from || 'Opponent',
            text: msg.text,
            isMe,
            playSound: !isMe,
        });
    });

    socket.on('sessionRestored', (msg) => {
        applySessionRestored(msg);
        tryConsumeInviteLink(msg);
    });

    function normalizeInviteCode(raw) {
        return String(raw || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 6);
    }

    function readInviteFromUrl() {
        const params = new URLSearchParams(location.search);
        const cup = normalizeInviteCode(params.get('cup'));
        const room = normalizeInviteCode(params.get('room'));
        if (!cup && !room) return null;
        return { cup: cup || null, room: room || null };
    }

    function clearInviteFromUrl() {
        const url = new URL(location.href);
        if (!url.searchParams.has('cup') && !url.searchParams.has('room')) return;
        url.searchParams.delete('cup');
        url.searchParams.delete('room');
        const next = `${url.pathname}${url.search}${url.hash}`;
        history.replaceState({}, '', next);
    }

    function buildShareLink({ cup = null, room = null } = {}) {
        const url = new URL(location.origin + location.pathname);
        if (cup) url.searchParams.set('cup', normalizeInviteCode(cup));
        else if (room) url.searchParams.set('room', normalizeInviteCode(room));
        return url.toString();
    }

    let pendingInvite = readInviteFromUrl();

    function tryConsumeInviteLink(restored = null) {
        if (!pendingInvite) return;
        const invite = pendingInvite;
        pendingInvite = null;
        clearInviteFromUrl();

        // Prefer an already-restored session over joining a second place.
        if (restored?.cup || restored?.room || state.cupId || state.roomId) {
            return;
        }

        if (invite.cup) {
            if (els.cupJoinInput) els.cupJoinInput.value = invite.cup;
            socket.emit('cupJoin', { code: invite.cup, sessionId });
            showToast(`Joining cup ${invite.cup}…`, 'info');
            return;
        }

        if (invite.room) {
            els.joinCodeInput.value = invite.room;
            state.vsAI = false;
            socket.emit('joinRoom', { code: invite.room, sessionId });
            showToast(`Joining room ${invite.room}…`, 'info');
        }
    }

    function emitSessionHello() {
        socket.emit('sessionHello', {
            sessionId,
            playState: readPlayState(),
        });
    }

    socket.on('connect', () => {
        emitSessionHello();
    });

    // In case connect already fired before listener
    if (socket.connected) emitSessionHello();

    loadConfigAndMe();
})();
