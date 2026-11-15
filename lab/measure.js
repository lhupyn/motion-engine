// Facts about the face that a picture can't settle: where the lids are and how much of the teeth shows. Both read
// the avatar's geometry, so they work on any ARKit rig; they judge nothing.

import * as THREE from 'three';

// Four sample points per teeth triangle, as barycentric weights.
const SAMPLES = [
  [1 / 3, 1 / 3, 1 / 3],
  [2 / 3, 1 / 6, 1 / 6],
  [1 / 6, 2 / 3, 1 / 6],
  [1 / 6, 1 / 6, 2 / 3],
];

// A teeth point counts as hidden when the face is this much (m) closer to the camera than it.
const MARGIN = 0.0005;

// The lid vertices move more than this share of the largest blink delta; the rest of the face stays put.
const MOVING = 0.3;

// A vertex in the world, with the pose and morphs it has right now.
const worldOf = (mesh, index, target = new THREE.Vector3()) =>
  mesh.getVertexPosition(index, target).applyMatrix4(mesh.matrixWorld);

// The left eye's lid vertices in the face mesh: the upper lid is the vertex a blink pulls down the most, the lower
// lid the resting vertex nearest to where that upper lid lands, skipping vertices the blink moves.
function findLids(face) {
  const geometry = face.geometry;
  const base = geometry.attributes.position;
  const blink = geometry.morphAttributes.position[face.morphTargetDictionary.eyeBlinkLeft];
  const size = (i) => Math.hypot(blink.getX(i), blink.getY(i), blink.getZ(i));

  let upper = 0;
  let deepest = 0;
  let largest = 0;
  for (let i = 0; i < blink.count; i++) {
    largest = Math.max(largest, size(i));
    if (-blink.getY(i) > deepest) {
      deepest = -blink.getY(i);
      upper = i;
    }
  }
  const closed = new THREE.Vector3(
    base.getX(upper) + blink.getX(upper),
    base.getY(upper) + blink.getY(upper),
    base.getZ(upper) + blink.getZ(upper),
  );

  let lower = 0;
  let nearest = Infinity;
  const at = new THREE.Vector3();
  for (let i = 0; i < base.count; i++) {
    if (size(i) > MOVING * largest) continue;
    const distance = at.fromBufferAttribute(base, i).distanceTo(closed);
    if (distance < nearest) {
      nearest = distance;
      lower = i;
    }
  }
  return { upper, lower };
}

// The teeth's surface sample points, split into an upper and a lower row by their resting height.
function sampleTeeth(teeth) {
  const position = teeth.geometry.attributes.position;
  const index = teeth.geometry.index ? [...teeth.geometry.index.array] : [...Array(position.count).keys()];
  let sum = 0;
  for (let i = 0; i < position.count; i++) sum += position.getY(i);
  const middle = sum / position.count;

  const rows = { upper: [], lower: [] };
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    const height = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
    for (const weights of SAMPLES) rows[height >= middle ? 'upper' : 'lower'].push([a, b, c, weights]);
  }
  return rows;
}

// The face as it looks right now (skinned and morphed), frozen into a plain mesh that is cheap to raycast.
function snapshotOf(face) {
  const count = face.geometry.attributes.position.count;
  const positions = new Float32Array(count * 3);
  const point = new THREE.Vector3();
  for (let i = 0; i < count; i++) worldOf(face, i, point).toArray(positions, i * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(face.geometry.index);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

/**
 * @param {any} head - TalkingHead with its avatar loaded
 * @returns {{
 *   lids: () => {upper: number, lower: number},
 *   teeth: () => {upper: number, lower: number} | null
 * }}
 */
export function createMeasure(head) {
  const meshes = [];
  head.scene.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  const blinkers = meshes.filter((mesh) => mesh.morphTargetDictionary?.eyeBlinkLeft !== undefined);
  const face = blinkers.find((mesh) => /Head/.test(mesh.name)) ?? blinkers[0];
  if (!face) throw new Error('the avatar has no mesh with an eyeBlinkLeft morph');
  const teeth = meshes.find((mesh) => /Teeth/i.test(mesh.name));

  const leftLid = findLids(face);
  const teethRows = teeth ? sampleTeeth(teeth) : null;

  return {
    /** Height (m) of the left eye's upper and lower lid relative to the eye bone, as posed right now. */
    lids() {
      head.scene.updateMatrixWorld(true);
      const eye = head.armature.getObjectByName('LeftEye').getWorldPosition(new THREE.Vector3()).y;
      return { upper: worldOf(face, leftLid.upper).y - eye, lower: worldOf(face, leftLid.lower).y - eye };
    },

    /** How many teeth sample points the camera sees, per row; null if the avatar has no teeth mesh. */
    teeth() {
      if (!teeth) return null;
      head.scene.updateMatrixWorld(true);
      const snapshot = snapshotOf(face);
      const camera = head.camera.getWorldPosition(new THREE.Vector3());
      const raycaster = new THREE.Raycaster();
      const vertices = new Map();
      const vertex = (i) => {
        if (!vertices.has(i)) vertices.set(i, worldOf(teeth, i));
        return vertices.get(i);
      };

      const visible = {};
      for (const [row, samples] of Object.entries(teethRows)) {
        visible[row] = 0;
        for (const [a, b, c, [wa, wb, wc]] of samples) {
          const point = vertex(a)
            .clone()
            .multiplyScalar(wa)
            .addScaledVector(vertex(b), wb)
            .addScaledVector(vertex(c), wc);
          const direction = point.sub(camera);
          const distance = direction.length();
          raycaster.set(camera, direction.normalize());
          raycaster.far = distance - MARGIN;
          if (!raycaster.intersectObject(snapshot, false).length) visible[row]++;
        }
      }
      snapshot.geometry.dispose();
      snapshot.material.dispose();
      return visible;
    },
  };
}
