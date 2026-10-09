/** Legal ATP codes: 4 distinct digits from 1–9 (3024). */

const DIGITS = '123456789';

function buildLegalCodes() {
    const codes = [];
    function rec(prefix) {
        if (prefix.length === 4) {
            codes.push(prefix);
            return;
        }
        for (const d of DIGITS) {
            if (!prefix.includes(d)) rec(prefix + d);
        }
    }
    rec('');
    return codes;
}

export const LEGAL_CODES = buildLegalCodes();
export const CODE_TO_INDEX = Object.fromEntries(LEGAL_CODES.map((c, i) => [c, i]));
export const NUM_ACTIONS = LEGAL_CODES.length;

export function validateNumber(input) {
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

export function scoreGuess(guess, answer) {
    const g = String(guess);
    const a = String(answer);
    let n = 0;
    let o = 0;
    for (let i = 0; i < g.length; i++) {
        if (a.includes(g[i])) {
            n++;
            if (a[i] === g[i]) o++;
        }
    }
    return [n, o];
}

export function filterPossibles(possibles, guess, n, o) {
    return possibles.filter((c) => {
        const [cn, co] = scoreGuess(guess, c);
        return cn === n && co === o;
    });
}

export function randomCode() {
    return LEGAL_CODES[Math.floor(Math.random() * LEGAL_CODES.length)];
}
