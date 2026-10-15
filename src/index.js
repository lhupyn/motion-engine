/**
 * motion-engine — expressive face and body for TalkingHead avatars.
 *
 *   const engine = new MotionEngine(head);
 *   engine.face.play('happy');
 *   engine.body.play('nod_yes');
 *
 * The engine hooks itself into TalkingHead's render loop; no update() wiring
 * is needed.
 *
 * @module motion-engine
 */

import { TalkingHeadAdapter } from './adapter.js';
import { Face } from './face.js';
import { Body } from './body.js';

export class MotionEngine {
  /**
   * @param {object} head - TalkingHead instance (after showAvatar())
   * @param {object} [options]
   * @param {object} [options.face] - Face options (see Face)
   * @param {object} [options.body] - Body options (see Body)
   */
  constructor(head, { face, body } = {}) {
    this.adapter = new TalkingHeadAdapter(head);
    this.face = new Face(this.adapter, face);
    this.body = new Body(this.adapter, body);
    this.adapter.onFrame((dt) => {
      this.body.update(dt);
      this.face.update(dt);
    });
  }
}

export { TalkingHeadAdapter, Face, Body };
