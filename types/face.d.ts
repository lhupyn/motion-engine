export type Expression = {
    /**
     * - When to use it; without one the classifier never picks it
     */
    description?: string;
    /**
     * - Provenance note, unused at runtime
     */
    facs?: string;
    /**
     * - A mood holds until replaced; a beat plays once on top
     */
    kind?: 'mood' | 'beat';
    /**
     * - AU → level; a trailing _L/_R makes it one-sided
     */
    aus?: Record<string, number>;
    /**
     * - Beats only, ms
     */
    envelope?: {
        in?: number;
        hold?: number;
        out?: number;
    };
    /**
     * - Beats only: AU → ms it starts later and ends earlier
     */
    offset?: Record<string, number>;
    /**
     * - Beats only: false = the director never starts it while the avatar speaks
     * (a yawn can't share the jaw with the lip-sync; a laugh can)
     */
    whileSpeaking?: boolean;
};
export type FacsCatalog = {
    /**
     * - AU → ARKit blendshape weights
     */
    au_map: Record<string, Record<string, number>>;
    expressions: Record<string, Expression>;
    au_limits?: Record<string, {
        max: number;
        beatMax?: number;
        note?: string;
    }>;
    avoid?: {
        aus: Record<string, number>;
        note?: string;
    }[];
};
export type FaceOptions = {
    /**
     * - Default: the bundled facs.json
     */
    facs?: FacsCatalog;
    /**
     * - Mood cross-fade, ms
     */
    fade?: number;
    /**
     * - While a viseme plays, mouth-opening morphs drop to this share of their value,
     * so speech doesn't open the mouth too wide or bare the teeth, and p/b/m still close the lips. 1 = off
     */
    speechMouth?: number;
    /**
     * - The same for the lip corners (smile, dimple), which over-stretch the mouth on
     * visemes. 1 = off
     */
    speechSmile?: number;
};
/**
 * @typedef {object} Expression
 * @property {string} [description] - When to use it; without one the classifier never picks it
 * @property {string} [facs] - Provenance note, unused at runtime
 * @property {'mood'|'beat'} [kind='mood'] - A mood holds until replaced; a beat plays once on top
 * @property {Record<string, number>} [aus] - AU → level; a trailing _L/_R makes it one-sided
 * @property {{in?: number, hold?: number, out?: number}} [envelope] - Beats only, ms
 * @property {Record<string, number>} [offset] - Beats only: AU → ms it starts later and ends earlier
 * @property {boolean} [whileSpeaking=true] - Beats only: false = the director never starts it while the avatar speaks
 *   (a yawn can't share the jaw with the lip-sync; a laugh can)
 */
/**
 * @typedef {object} FacsCatalog
 * @property {Record<string, Record<string, number>>} au_map - AU → ARKit blendshape weights
 * @property {Record<string, Expression>} expressions
 * @property {Record<string, {max: number, beatMax?: number, note?: string}>} [au_limits]
 * @property {{aus: Record<string, number>, note?: string}[]} [avoid]
 */
/**
 * @typedef {object} FaceOptions
 * @property {FacsCatalog} [facs] - Default: the bundled facs.json
 * @property {number} [fade=400] - Mood cross-fade, ms
 * @property {number} [speechMouth=0.3] - While a viseme plays, mouth-opening morphs drop to this share of their value,
 *   so speech doesn't open the mouth too wide or bare the teeth, and p/b/m still close the lips. 1 = off
 * @property {number} [speechSmile=0.5] - The same for the lip corners (smile, dimple), which over-stretch the mouth on
 *   visemes. 1 = off
 */
export declare class Face {
    /**
     * @param {import('./adapter.js').TalkingHeadAdapter} adapter
     * @param {FaceOptions} [options]
     */
    constructor(adapter: import('./adapter.js').TalkingHeadAdapter, { facs, fade, speechMouth, speechSmile }?: FaceOptions);
    /** @returns {string[]} */
    get names(): string[];
    /**
     * The held expression shown or fading in, or null.
     * @returns {string|null}
     */
    get current(): string | null;
    /**
     * A mood replaces the held expression (neutral just fades it out); a beat plays once on top.
     * @param {string} name
     * @returns {boolean} false if the name isn't in the catalog
     */
    play(name: string): boolean;
}
