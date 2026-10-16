import { Face } from './face.js';
import { Body } from './body.js';
import { systemOne } from './systemone.js';
export type Classify = import('./systemone.js').Classify;
export type Options = {
    /**
     * - Decides the reactions, e.g. systemOne({ apiKey }); without it feed() does nothing
     */
    classify?: Classify | null;
    face?: import('./face.js').FaceOptions;
    body?: import('./body.js').BodyOptions;
    /**
     * - Thresholds and timings
     */
    director?: import('./director.js').DirectorOptions;
    /**
     * - Classify unfinished text after this many ms without fragments
     */
    pause?: number;
};
export type Decision = {
    speaker: 'avatar' | 'user';
    text: string;
    actions: import('./director.js').Action[];
    /**
     * - The classifier's raw answers
     */
    answers?: import('./systemone.js').Answers;
    model?: string | null;
    /**
     * - As the provider returns it, e.g. { input_tokens, cost }
     */
    usage?: object | null;
    ms?: number;
    /**
     * - Why the line wasn't sent, or why its answer was dropped
     */
    skipped?: string;
    /**
     * - The request failed
     */
    error?: string;
};
/** @typedef {import('./systemone.js').Classify} Classify */
/**
 * @typedef {object} Options
 * @property {Classify|null} [classify] - Decides the reactions, e.g. systemOne({ apiKey }); without it feed() does nothing
 * @property {import('./face.js').FaceOptions} [face]
 * @property {import('./body.js').BodyOptions} [body]
 * @property {import('./director.js').DirectorOptions} [director] - Thresholds and timings
 * @property {number} [pause=800] - Classify unfinished text after this many ms without fragments
 */
/**
 * One per sentence, passed to onDecision.
 * @typedef {object} Decision
 * @property {'avatar'|'user'} speaker
 * @property {string} text
 * @property {import('./director.js').Action[]} actions
 * @property {import('./systemone.js').Answers} [answers] - The classifier's raw answers
 * @property {string|null} [model]
 * @property {object|null} [usage] - As the provider returns it, e.g. { input_tokens, cost }
 * @property {number} [ms]
 * @property {string} [skipped] - Why the line wasn't sent, or why its answer was dropped
 * @property {string} [error] - The request failed
 */
export declare class MotionEngine {
    face: Face;
    body: Body;
    /** @type {((decision: Decision) => void) | null} */
    onDecision: ((decision: Decision) => void) | null;
    /**
     * @param {object} head - TalkingHead instance, after showAvatar()
     * @param {Options} [options]
     */
    constructor(head: object, { classify, face, body, director, pause, ...rest }?: Options);
    /**
     * Set or replace the classifier, e.g. once the visitor provides a key.
     * @param {Classify|null} classify
     */
    useClassifier(classify: Classify | null): void;
    /**
     * The person's line as context only: the avatar's next line is classified
     * knowing what it answers, with no call and no reaction for this one. Like a
     * final from the person, it also ends a cut-off avatar turn.
     * @param {string} text
     */
    context(text: string): void;
    /**
     * Feed transcript text as it arrives. Each sentence is one classifier call. Lines
     * from the person are not classified while the avatar is speaking: the
     * reaction would come too late.
     *
     * @param {string} text
     * @param {object} [options]
     * @param {'avatar'|'user'} [options.speaker='avatar']
     * @param {boolean} [options.final=false] - Last fragment of the turn; may repeat the whole turn or be empty
     */
    feed(text: string, { speaker, final }?: {
        speaker?: 'avatar' | 'user';
        final?: boolean;
    }): void;
    /** The person cut the avatar off: drop the avatar's pending text and calls. Reactions to the person keep going. */
    interrupt(): void;
    /** Unhook from the avatar and stop everything; the engine can't be used afterwards. */
    dispose(): void;
}
export { systemOne };
