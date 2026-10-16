export type Gesture = {
    /**
     * - When to use it; without one the classifier never picks it
     */
    description?: string;
    /**
     * - Frame timings, ms; [min, max] is a range
     */
    dt: number | Array<number | [number, number]>;
    rescale?: number[];
    /**
     * - Values per frame; hands use vs.gesture: [pose, duration, mirror, transitionMs]
     */
    vs: Record<string, any[]>;
    overlay?: {
        bones?: Record<string, {
            freq: number;
            amp: number[];
            phase?: number;
        }>;
        delay?: number;
        duration?: number;
    };
};
export type GestureCatalog = {
    head: Record<string, Gesture>;
    hands: Record<string, Gesture>;
    /**
     * - Arm poses: bone rotations in radians
     */
    poses?: Record<string, Record<string, {
        x: number;
        y: number;
        z: number;
    }>>;
};
export type BodyOptions = {
    /**
     * - Default: the bundled gestures.json
     */
    gestures?: GestureCatalog;
    /**
     * - Arm transition into a pose, unless the gesture frame sets its own
     */
    fadeIn?: number;
    fadeOut?: number;
    /**
     * - Arms back to the stance when a hand gesture is stopped early
     */
    cutFade?: number;
    /**
     * - Wait after a hand gesture fades out before it counts as done
     */
    settle?: number;
};
/**
 * A TalkingHead animation template, plus an optional oscillation overlay.
 * @typedef {object} Gesture
 * @property {string} [description] - When to use it; without one the classifier never picks it
 * @property {number | Array<number | [number, number]>} dt - Frame timings, ms; [min, max] is a range
 * @property {number[]} [rescale]
 * @property {Record<string, any[]>} vs - Values per frame; hands use vs.gesture: [pose, duration, mirror, transitionMs]
 * @property {{bones?: Record<string, {freq: number, amp: number[], phase?: number}>, delay?: number, duration?: number}} [overlay]
 */
/**
 * @typedef {object} GestureCatalog
 * @property {Record<string, Gesture>} head
 * @property {Record<string, Gesture>} hands
 * @property {Record<string, Record<string, {x: number, y: number, z: number}>>} [poses] - Arm poses: bone rotations in radians
 */
/**
 * @typedef {object} BodyOptions
 * @property {GestureCatalog} [gestures] - Default: the bundled gestures.json
 * @property {number} [fadeIn=800] - Arm transition into a pose, unless the gesture frame sets its own
 * @property {number} [fadeOut=800]
 * @property {number} [cutFade=100] - Arms back to the stance when a hand gesture is stopped early
 * @property {number} [settle=1000] - Wait after a hand gesture fades out before it counts as done
 */
export declare class Body {
    /** @returns {string[]} */
    get names(): string[];
    /**
     * What each channel is playing: { head, hands }, null when idle.
     * @returns {{head: string|null, hands: string|null}}
     */
    get current(): {
        head: string | null;
        hands: string | null;
    };
    /**
     * Interrupts the current gesture on its channel.
     * @param {string} name
     * @param {object} [options]
     * @param {boolean} [options.mirror=false] - Hand gestures: play it with the other hand (the left, for the catalog's
     *   one-hand gestures)
     * @returns {Promise<boolean>} true when done, false if interrupted or unknown
     */
    play(name: string, { mirror }?: {
        mirror?: boolean;
    }): Promise<boolean>;
    /** @param {'head'|'hands'} [channel] - Both when omitted */
    stop(channel?: 'head' | 'hands'): void;
}
