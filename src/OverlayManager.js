/**
 * OverlayManager — Manages poseDelta oscillation overlays for TalkingHead bones.
 *
 * Handles sinusoidal oscillations and custom effects (e.g., jump arc)
 * applied as poseDelta offsets during the render loop.
 *
 * @module OverlayManager
 */

const FADE_RAMP_MS = 300;

export class OverlayManager {
    constructor(head) {
        this.head = head;
        this.overlay = null;
        this._cache = [];
    }

    get active() {
        return this.overlay !== null;
    }

    start(bones, duration) {
        this.overlay = {
            bones,
            startTime: performance.now(),
            duration,
        };

        // Pre-calculate paths to avoid string creation in hot loop
        this._cache = Object.entries(bones).map(([boneName, osc]) => ({
            osc,
            isJump: osc.custom === 'jump',
            posKey: `${boneName}.position`,
            quatKey: `${boneName}.quaternion`
        }));
    }

    update(_dt) {
        if (!this.overlay) return;

        const elapsed = performance.now() - this.overlay.startTime;
        if (elapsed > this.overlay.duration) {
            this.clear();
            return;
        }

        const time = elapsed / 1000;
        const fadeIn = Math.min(elapsed / FADE_RAMP_MS, 1);
        const fadeOut = Math.min((this.overlay.duration - elapsed) / FADE_RAMP_MS, 1);
        const envelope = fadeIn * fadeOut;

        const props = this.head.poseDelta?.props;
        if (!props) return;

        for (let i = 0; i < this._cache.length; i++) {
            const { osc, isJump, posKey, quatKey } = this._cache[i];

            if (isJump) {
                if (props[posKey]) {
                    const progress = elapsed / this.overlay.duration;
                    props[posKey].y = Math.sin(progress * Math.PI) * 0.12;
                }
                continue;
            }

            if (props[quatKey]) {
                const p = props[quatKey];
                const s = Math.sin(time * osc.freq) * envelope;
                p.x = s * osc.amp[0];
                p.y = s * osc.amp[1];
                p.z = Math.sin(time * osc.freq + (osc.phase || 0)) * osc.amp[2] * envelope;
            }
        }
    }

    clear() {
        if (!this.overlay) return;
        const props = this.head.poseDelta?.props;
        if (props) {
            for (let i = 0; i < this._cache.length; i++) {
                const { isJump, posKey, quatKey } = this._cache[i];
                if (isJump) {
                    if (props[posKey]) props[posKey].y = 0;
                } else if (props[quatKey]) {
                    const p = props[quatKey];
                    p.x = p.y = p.z = 0;
                }
            }
        }
        this.overlay = null;
        this._cache = [];
    }
}
