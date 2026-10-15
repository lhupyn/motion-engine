export type State = {
    speaker: 'avatar' | 'user';
    text: string;
    /**
     * - The line before; omitted on the first
     */
    previous?: {
        speaker: 'avatar' | 'user';
        text: string;
    };
};
export type ChoiceQuestion = {
    type: 'choice';
    instructions: string;
    criteria: Record<string, string>;
};
export type NoulQuestion = {
    type: 'noul';
    instructions: string;
    criteria: {
        true: string;
        false: string;
    };
};
export type Questions = Record<string, ChoiceQuestion | NoulQuestion>;
export type Answers = {
    expression?: {
        choice: string;
        confidence?: number;
    };
    head?: {
        choice: string;
        confidence?: number;
    };
    hands?: {
        choice: string;
        confidence?: number;
    };
    /**
     * - 0–1, how likely the line is intelligible
     */
    clear?: {
        noul: number;
    };
};
export type ClassifyResult = {
    answers: Answers;
    model?: string | null;
    /**
     * - As the provider returns it, e.g. { input_tokens, cost }
     */
    usage?: object | null;
    ms?: number;
};
export type Classify = (state: State, questions: Questions, options?: {
    signal?: AbortSignal;
}) => Promise<ClassifyResult>;
/**
 * @param {object} options
 * @param {string} [options.apiKey] - Not needed by a server without auth
 * @param {'openrouter'|'typesafe'} [options.provider='openrouter']
 * @param {string} [options.model] - Default: Jev on the provider
 * @param {string} [options.url] - e.g. your own proxy or a self-hosted decision model
 * @returns {Classify}
 */
export declare function systemOne({ apiKey, provider, model, url }: {
    apiKey?: string;
    provider?: 'openrouter' | 'typesafe';
    model?: string;
    url?: string;
}): Classify;
export declare const ask: {
    /**
     * @param {string} instructions
     * @param {Record<string, string>} options - Option name → what it means
     * @returns {ChoiceQuestion}
     */
    choice: (instructions: string, options: Record<string, string>) => ChoiceQuestion;
    /**
     * @param {string} instructions
     * @param {string} whenTrue
     * @param {string} whenFalse
     * @returns {NoulQuestion}
     */
    noul: (instructions: string, whenTrue: string, whenFalse: string) => NoulQuestion;
};
