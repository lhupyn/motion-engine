export declare class Segmenter {
    _heard: string | undefined;
    _buffer: string | undefined;
    constructor();
    reset(): void;
    get pending(): boolean;
    /**
     * @param {string} text
     * @param {boolean} [final=false] - Releases everything; if it repeats the whole turn, only the unheard part is used
     * @returns {string[]} Completed sentences
     */
    push(text: string, final?: boolean): string[];
    /** Release an unfinished sentence, e.g. after a pause in the stream. */
    flush(): any;
}
