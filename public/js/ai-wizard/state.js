// public/js/ai-wizard/state.js
// Lightweight state container cho wizard
// Dùng cho AI Content Creator wizard flow

(function (global) {
    'use strict';

    class WizardState {
        constructor(initial = {}) {
            this._s = { ...initial };
            this._subs = new Set();
        }
        get() { return { ...this._s }; }
        getRaw(key) { return this._s[key]; }
        set(patch) {
            this._s = { ...this._s, ...patch };
            this._subs.forEach((fn) => { try { fn(this._s); } catch (e) { console.error('[WizardState] subscriber error:', e); } });
        }
        subscribe(fn) {
            this._subs.add(fn);
            return () => this._subs.delete(fn);
        }
        reset(initial = {}) {
            this._s = { ...initial };
            this._subs.forEach((fn) => fn(this._s));
        }
    }

    global.WizardState = WizardState;
})(window);
