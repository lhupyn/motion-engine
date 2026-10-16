export type Action = {
    channel: 'face' | 'head' | 'hands';
    name: string;
    confidence: number;
    applied: boolean;
    /**
     * - Why it didn't play: low confidence, already showing, avatar is speaking, already moving, cooldown, unclear transcript, not in catalog
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
