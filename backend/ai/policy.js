/**
 * Load exported weights.json (from Colab export_weights.py) and pick a guess.
 * Falls back to heuristic (random among possibles) if weights missing.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    LEGAL_CODES,
    CODE_TO_INDEX,
    NUM_ACTIONS,
    filterPossibles,
} from './codes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEIGHTS_PATH = join(__dirname, 'weights.json');

const MAX_GUESSES = 20;
const HIST_WIDTH = 6;
const OBS_DIM = NUM_ACTIONS + MAX_GUESSES * HIST_WIDTH;
const HIDDEN = 256;

let weights = null;
let legalCodes = LEGAL_CODES;
let engine = 'heuristic';

function relu(x) {
    return x > 0 ? x : 0;
}

function matVec(weight, bias, x) {
    // weight: [out][in], y = W @ x + b
    const out = weight.length;
    const y = new Float64Array(out);
    for (let i = 0; i < out; i++) {
        let s = bias[i];
        const row = weight[i];
        for (let j = 0; j < x.length; j++) s += row[j] * x[j];
        y[i] = s;
    }
    return y;
}

function encodeObs(history, possibles) {
    const obs = new Float64Array(OBS_DIM);
    for (const c of possibles) {
        const idx = CODE_TO_INDEX[c];
        if (idx !== undefined) obs[idx] = 1;
    }
    const histBase = NUM_ACTIONS;
    for (let i = 0; i < Math.min(history.length, MAX_GUESSES); i++) {
        const [guess, n, o] = history[i];
        const base = histBase + i * HIST_WIDTH;
        for (let j = 0; j < 4; j++) obs[base + j] = Number(guess[j]) / 9;
        obs[base + 4] = n / 4;
        obs[base + 5] = o / 4;
    }
    return obs;
}

function argmaxMasked(logits, possibles) {
    let best = -Infinity;
    let bestCode = possibles[0];
    for (const c of possibles) {
        const idx = CODE_TO_INDEX[c];
        const v = logits[idx];
        if (v > best) {
            best = v;
            bestCode = c;
        }
    }
    return bestCode;
}

function forwardPolicy(obs, possibles) {
    const sd = weights.state_dict;
    let h = matVec(sd['shared.0.weight'], sd['shared.0.bias'], obs);
    for (let i = 0; i < h.length; i++) h[i] = relu(h[i]);
    h = matVec(sd['shared.2.weight'], sd['shared.2.bias'], h);
    for (let i = 0; i < h.length; i++) h[i] = relu(h[i]);
    const logits = matVec(sd['policy.weight'], sd['policy.bias'], h);
    return argmaxMasked(logits, possibles);
}

export function loadWeights() {
    if (!existsSync(WEIGHTS_PATH)) {
        engine = 'heuristic';
        console.log('[ai] weights.json not found — using heuristic bot');
        return false;
    }
    try {
        const raw = JSON.parse(readFileSync(WEIGHTS_PATH, 'utf8'));
        if (raw.format !== 'atp-actor-critic-v1') {
            throw new Error('unexpected weights format');
        }
        weights = raw;
        if (Array.isArray(raw.legal_codes) && raw.legal_codes.length === NUM_ACTIONS) {
            legalCodes = raw.legal_codes;
        }
        engine = 'neural';
        console.log('[ai] loaded weights.json — neural policy active');
        return true;
    } catch (err) {
        engine = 'heuristic';
        console.warn('[ai] failed to load weights, using heuristic:', err.message);
        return false;
    }
}

export function getAiEngine() {
    return engine;
}

/** history: Array<[guessStr, n, o]> */
export function pickGuess(history, possibles) {
    const pool = possibles.length ? possibles : legalCodes;
    if (engine === 'neural' && weights) {
        try {
            const obs = encodeObs(history, pool);
            return forwardPolicy(obs, pool);
        } catch (err) {
            console.warn('[ai] neural pick failed, heuristic fallback:', err.message);
        }
    }
    return pool[Math.floor(Math.random() * pool.length)];
}

export function createAiBrain() {
    return {
        possibles: [...LEGAL_CODES],
        history: /** @type {[string, number, number][]} */ ([]),
        observe(guess, n, o) {
            this.history.push([guess, n, o]);
            this.possibles = filterPossibles(this.possibles, guess, n, o);
        },
        act() {
            return pickGuess(this.history, this.possibles);
        },
    };
}

// Eager load on import
loadWeights();
