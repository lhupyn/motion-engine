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
};
/**
 * @typedef {object} Expression
 * @property {string} [description] - When to use it; without one the classifier never picks it
 * @property {string} [facs] - Provenance note, unused at runtime
 * @property {'mood'|'beat'} [kind='mood'] - A mood holds until replaced; a beat plays once on top
 * @property {Record<string, number>} [aus] - AU → level; a trailing _L/_R makes it one-sided
 * @property {{in?: number, hold?: number, out?: number}} [envelope] - Beats only, ms
 * @property {Record<string, number>} [offset] - Beats only: AU → ms it starts later and ends earlier
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
 */
export declare class Face {
    adapter: import("./adapter.js").TalkingHeadAdapter;
    facs: FacsCatalog;
    fade: number;
    _moods: any[];
    _beats: any[];
    _driven: Set<any>;
    _sum: Map<any, any>;
    _spare: Set<any>;
    /**
     * @param {import('./adapter.js').TalkingHeadAdapter} adapter
     * @param {FaceOptions} [options]
     */
    constructor(adapter: import('./adapter.js').TalkingHeadAdapter, { facs, fade }?: FaceOptions);
    /** @returns {string[]} */
    get names(): string[];
    /**
     * The held expression shown or fading in, or null.
     * @returns {string|null}
     */
    get current(): string | null;
    /**
     * @param {string} name
     * @returns {{name: string, kind: 'mood'|'beat', vs: Record<string, number>, envelope: ?object, offsets: Record<string, number>}|null}
     */
    resolve(name: string): {
        name: string;
        kind: 'mood' | 'beat';
        vs: Record<string, number>;
        envelope: object | null;
        offsets: Record<string, number>;
    } | null;
    /**
     * A mood replaces the held expression (neutral just fades it out); a beat plays once on top.
     * @param {string} name
     * @returns {boolean} false if the name isn't in the catalog
     */
    play(name: string): boolean;
    reset(): void;
    /** @param {number} dt - ms since the last frame */
    update(dt: number): void;
    _offsets(offset: any): {};
    _ausToVs(aus: any): {};
}
/**
 * @param {FacsCatalog} facs
 * Recipes that break the catalog's per-avatar calibration: an AU above its
 * `au_limits` level, or a combination from `avoid`.
 * @returns {string[]} One message per problem
 */
export declare function auViolations({ au_map: map, au_limits: limits, avoid, expressions }: FacsCatalog): string[];
