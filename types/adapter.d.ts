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
    /** [internal] A morph's level with no expression, in setMood()'s precedence order. */
    restBaseline(mt: any): any;
    /** [internal] Rotation offset (Euler x, y, z) on top of a bone's pose; ignored for bones TalkingHead keeps no offset for. */
    setBoneOffset(bone: any, x: any, y: any, z: any): void;
}
