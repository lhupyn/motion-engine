export type Action = {
    channel: 'face' | 'head' | 'hands';
    name: string;
    confidence: number;
    applied: boolean;
    /**
     * - Why it didn't play: low confidence, already showing, already moving, cooldown, unclear transcript, not in catalog
     */
    reason?: string;
};
export type DirectorOptions = {
    /**
     * - Default { expression: 0.45, head: 0.5, hands: 0.55 }
     */
    minConfidence?: {
        expression?: number;
        head?: number;
        hands?: number;
    };
    /**
     * - For the person's lines: below this "intelligible" score, nothing plays
     */
    minClarity?: number;
    /**
     * - Ms between gestures per channel; default { head: 2500, hands: 4000 }
     */
    cooldown?: {
        head?: number;
        hands?: number;
    };
    /**
     * - Ms after the last decision before the face relaxes to neutral
     */
    relaxAfter?: number;
};
export declare class Director {
    face: import("./face.js").Face;
    body: import("./body.js").Body;
    opt: {
        minClarity: number;
        relaxAfter: number;
        minConfidence: {
            expression: number;
            head: number;
            hands: number;
        };
        cooldown: {
            head: number;
            hands: number;
        };
    };
    busy: () => boolean;
    _lastGesture: {
        head: number;
        hands: number;
    };
    _relaxTimer: number | null;
    _questions: {};
    /**
     * @param {import('./face.js').Face} face
     * @param {import('./body.js').Body} body
     * @param {DirectorOptions} [options]
     */
    constructor(face: import('./face.js').Face, body: import('./body.js').Body, options?: DirectorOptions);
    /**
     * @param {'avatar'|'user'} speaker
     * @returns {import('./systemone.js').Questions}
     */
    questions(speaker: 'avatar' | 'user'): import('./systemone.js').Questions;
    /**
     * Play what passes the rules and report every choice with the reason it was skipped.
     * @param {import('./systemone.js').Answers} answers
     * @param {'avatar'|'user'} speaker
     * @returns {Action[]}
     */
    apply(answers: import('./systemone.js').Answers, speaker: 'avatar' | 'user'): Action[];
    /** Relax to neutral `relaxAfter` ms after the last call, never while the avatar is mid-line. */
    scheduleRelax(): void;
    dispose(): void;
}
