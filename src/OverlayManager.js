/**
 * OverlayManager — Manages poseDelta oscillation overlays for TalkingHead bones.
 *
 * Handles sinusoidal oscillations and custom effects (e.g., jump arc)
 * applied as poseDelta offsets during the render loop.
 *
 * @module OverlayManager
 */

export class OverlayManager {
    /**
     * @param {object} head - TalkingHead instance
     */
    constructor(head) {
        this.head = head;
        this.overlay = null;
    }

    /** Whether an overlay is currently active */
    get active() {
        return this.overlay !== null;
    }

    /**
     * Start an overlay with the given bone definitions and duration.
     *
     * @param {object} bones - Dictionary of bone oscillation configs
     * @param {number} duration - Total overlay duration in ms
     */
    start(bones, duration) {
        this.overlay = {
            bones,
            startTime: performance.now(),
            duration,
        };
    }

    /**
     * Frame update — apply oscillation values to poseDelta.
     * Call this from the TalkingHead render loop.
     *
     * @param {number} _dt - Delta time (unused, timing is absolute)
     */
    update(_dt) {
        if (!this.overlay) return;

        const elapsed = performance.now() - this.overlay.startTime;
        if (elapsed > this.overlay.duration) {
            this.clear();
            return;
        }

        const time = elapsed / 1000;
        // Fade in/out envelope (300ms ramps)
        const fadeIn = Math.min(elapsed / 300, 1);
        const fadeOut = Math.min((this.overlay.duration - elapsed) / 300, 1);
        const envelope = fadeIn * fadeOut;

        for (const [boneName, osc] of Object.entries(this.overlay.bones)) {
            // Custom jump overlay — smooth vertical arc via position delta
            if (osc.custom === 'jump') {
                const posKey = `${boneName}.position`;
                if (this.head.poseDelta?.props?.[posKey]) {
                    const progress = elapsed / this.overlay.duration;
                    const arc = Math.sin(progress * Math.PI);
                    this.head.poseDelta.props[posKey].y = arc * 0.12;
                }
                continue;
            }

            // Standard sinusoidal oscillation via quaternion delta
            const key = `${boneName}.quaternion`;
            if (this.head.poseDelta?.props?.[key]) {
                this.head.poseDelta.props[key].x = Math.sin(time * osc.freq) * osc.amp[0] * envelope;
                this.head.poseDelta.props[key].y = Math.sin(time * osc.freq) * osc.amp[1] * envelope;
                this.head.poseDelta.props[key].z = Math.sin(time * osc.freq + (osc.phase || 0)) * osc.amp[2] * envelope;
            }
        }
    }

    /**
     * Clear the overlay and reset all affected poseDelta values to zero.
     */
    clear() {
        if (!this.overlay) return;
        for (const [boneName, osc] of Object.entries(this.overlay.bones)) {
            if (osc.custom === 'jump') {
                const posKey = `${boneName}.position`;
                if (this.head.poseDelta?.props?.[posKey]) {
                    this.head.poseDelta.props[posKey].y = 0;
                }
                continue;
            }
            const key = `${boneName}.quaternion`;
            if (this.head.poseDelta?.props?.[key]) {
                this.head.poseDelta.props[key].x = 0;
                this.head.poseDelta.props[key].y = 0;
                this.head.poseDelta.props[key].z = 0;
            }
        }
        this.overlay = null;
    }
}
