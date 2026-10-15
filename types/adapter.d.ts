export declare class TalkingHeadAdapter {
    head: any;
    constructor(head: any);
    /**
     * [public] Run fn(dt) every frame, after any update callback the app already set.
     * @returns {function} Unhooks fn; leaves the callback alone if the app replaced it since
     */
    onFrame(fn: any): Function;
    /** [appendix] Gesture templates that TalkingHead ships or the app added (not the poses registered here). */
    gestureNames(): string[];
    /** [appendix] An arm/hand pose (bone rotations) that gesture frames can use like a built-in. */
    registerPose(name: any, props: any): void;
    /** [appendix] Makes the template playable with playGesture(name) and playAnim(name). */
    registerAnim(name: any, template: any): void;
    /** [public] Plays a registered animation through the gesture system, until stopGesture(). */
    playGesture(name: any): void;
    /** [public] */
    stopGesture(ms: any): void;
    /**
     * [internal] Ends the current hand gesture for a new one: bones that the next
     * poses move stay put and go straight to their new target; the rest return to
     * the stance in ms. (A new playGesture() alone would leave them stuck.)
     * @param {Array<[string, boolean]>} next - [pose, mirror] pairs
     */
    handOver(next: Array<[string, boolean]>, ms: any): void;
    /** [internal] Play a registered animation alongside any gesture; untagged, so stopGesture() leaves it running. */
    playAnim(name: any): void;
    /** [internal] */
    stopAnim(name: any): void;
    /** [internal] Shows a morph `w` above its rest level; call it every frame while it's held. */
    setExpressionMorph(mt: any, w: any): void;
    /** [internal] Back to the rest level. */
    releaseMorph(mt: any): void;
    /** [internal] Whether TalkingHead is playing speech (audio or lip-sync) right now. */
    isSpeaking(): boolean;
    /**
     * [internal] Lets the lip-sync take the mouth back: while a viseme plays, the
     * given morphs drop to `floor` of their value (by how open the viseme is),
     * whatever drives them. Uses TalkingHead's own per-morph hooks, the ones that
     * make the eyelids follow the gaze: `limit` shapes the applied value and the
     * visemes' `onchange` re-evaluates the morphs. Installed on the current avatar
     * and in mtLimits/mtOnchange, so a reloaded avatar keeps it.
     * @param {string[]} morphs
     * @param {number} floor - 0 = gone at a full viseme, 1 = untouched
     * @returns {function} Removes it, restoring any hook it wrapped
     */
    duckMouth(morphs: string[], floor: number): Function;
    /** [internal] A morph's level with no expression, in setMood()'s precedence order. */
    restBaseline(mt: any): any;
    /** [internal] Rotation offset (Euler x, y, z) on top of a bone's pose; ignored for bones TalkingHead keeps no offset for. */
    setBoneOffset(bone: any, x: any, y: any, z: any): void;
}
