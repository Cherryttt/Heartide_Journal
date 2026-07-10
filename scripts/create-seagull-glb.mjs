import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';


if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.onloadend = null;
      this.onerror = null;
    }
    async readAsArrayBuffer(blob) {
      try {
        this.result = await blob.arrayBuffer();
        this.onloadend?.({ target: this });
      } catch (error) {
        this.onerror?.(error);
      }
    }
  };
}

const rootDir = path.resolve(process.cwd());
const outDir = path.join(rootDir, 'public', 'models');
fs.mkdirSync(outDir, { recursive: true });

const scene = new THREE.Group();
scene.name = 'SeagullCompanion';

const mat = {
  porcelain: new THREE.MeshStandardMaterial({ color: '#fff8ec', roughness: 0.72, metalness: 0.02 }),
  belly: new THREE.MeshStandardMaterial({ color: '#f4ead8', roughness: 0.84, metalness: 0.01 }),
  wing: new THREE.MeshStandardMaterial({ color: '#fffdf5', roughness: 0.76, metalness: 0.01 }),
  wingTip: new THREE.MeshStandardMaterial({ color: '#dfe7ec', roughness: 0.84, metalness: 0.01 }),
  coral: new THREE.MeshStandardMaterial({ color: '#ef9b59', roughness: 0.58, metalness: 0.02 }),
  eye: new THREE.MeshBasicMaterial({ color: '#263238' }),
  blush: new THREE.MeshStandardMaterial({ color: '#ffd8bb', roughness: 0.9, transparent: true, opacity: 0.58 }),
  shadow: new THREE.MeshBasicMaterial({ color: '#2e6677', transparent: true, opacity: 0.13, depthWrite: false }),
};

const add = (parent, name, geometry, material, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
};

const sphere = (segments = 32, rings = 18) => new THREE.SphereGeometry(1, segments, rings);
const capsule = (radius, length) => new THREE.CapsuleGeometry(radius, length, 8, 18);

add(scene, 'SoftShadow', new THREE.CircleGeometry(1, 48), mat.shadow, [0, -0.35, -0.05], [0.66, 0.2, 1], [-Math.PI / 2, 0, 0]);
add(scene, 'Body', sphere(40, 24), mat.porcelain, [0, -0.02, 0], [0.42, 0.29, 0.38], [0.06, 0, 0]);
add(scene, 'Belly', sphere(28, 14), mat.belly, [0, -0.12, 0.21], [0.29, 0.14, 0.19], [0.18, 0, 0]);

const head = new THREE.Group();
head.name = 'Head';
head.position.set(0, 0.29, 0.1);
scene.add(head);
add(head, 'HeadRound', sphere(34, 20), mat.porcelain, [0, 0, 0], [0.2, 0.18, 0.18]);
add(head, 'Beak', new THREE.ConeGeometry(0.055, 0.18, 18), mat.coral, [0, -0.012, 0.185], [1, 1.2, 1], [Math.PI / 2, 0, 0]);
add(head, 'LeftEye', sphere(12, 8), mat.eye, [0.066, 0.045, 0.155], [0.018, 0.018, 0.011]);
add(head, 'RightEye', sphere(12, 8), mat.eye, [-0.066, 0.045, 0.155], [0.018, 0.018, 0.011]);
add(head, 'LeftEyeSpark', sphere(8, 6), new THREE.MeshBasicMaterial({ color: '#fffaf0' }), [0.071, 0.052, 0.166], [0.005, 0.005, 0.003]);
add(head, 'RightEyeSpark', sphere(8, 6), new THREE.MeshBasicMaterial({ color: '#fffaf0' }), [-0.071, 0.052, 0.166], [0.005, 0.005, 0.003]);
add(head, 'LeftBlush', sphere(16, 8), mat.blush, [0.115, -0.015, 0.12], [0.03, 0.014, 0.006]);
add(head, 'RightBlush', sphere(16, 8), mat.blush, [-0.115, -0.015, 0.12], [0.03, 0.014, 0.006]);

const leftWing = new THREE.Group();
leftWing.name = 'LeftWing';
leftWing.position.set(0.24, 0.015, -0.02);
scene.add(leftWing);
add(leftWing, 'LeftWingMain', sphere(36, 12), mat.wing, [0.28, 0.005, 0], [0.5, 0.075, 0.16], [0.06, 0.08, -0.13]);
add(leftWing, 'LeftWingTip', sphere(28, 8), mat.wingTip, [0.62, -0.015, -0.035], [0.31, 0.045, 0.095], [0.03, 0.08, -0.25]);
add(leftWing, 'LeftFeatherGlow', sphere(20, 8), mat.porcelain, [0.38, 0.035, 0.09], [0.22, 0.026, 0.07], [0.1, 0.08, -0.2]);

const rightWing = new THREE.Group();
rightWing.name = 'RightWing';
rightWing.position.set(-0.24, 0.015, -0.02);
scene.add(rightWing);
add(rightWing, 'RightWingMain', sphere(36, 12), mat.wing, [-0.28, 0.005, 0], [0.5, 0.075, 0.16], [0.06, -0.08, 0.13]);
add(rightWing, 'RightWingTip', sphere(28, 8), mat.wingTip, [-0.62, -0.015, -0.035], [0.31, 0.045, 0.095], [0.03, -0.08, 0.25]);
add(rightWing, 'RightFeatherGlow', sphere(20, 8), mat.porcelain, [-0.38, 0.035, 0.09], [0.22, 0.026, 0.07], [0.1, -0.08, 0.2]);

add(scene, 'Tail', new THREE.ConeGeometry(0.13, 0.24, 3), mat.wing, [0, -0.03, -0.35], [0.8, 1, 1], [-Math.PI / 2, 0, 0]);
add(scene, 'LeftLeg', capsule(0.012, 0.13), mat.coral, [0.08, -0.28, 0.08], [1, 1, 1], [0.24, 0, 0.08]);
add(scene, 'RightLeg', capsule(0.012, 0.13), mat.coral, [-0.08, -0.28, 0.08], [1, 1, 1], [0.24, 0, -0.08]);
add(scene, 'LeftFoot', capsule(0.008, 0.08), mat.coral, [0.1, -0.35, 0.14], [1, 1, 1], [Math.PI / 2, 0, 1.25]);
add(scene, 'RightFoot', capsule(0.008, 0.08), mat.coral, [-0.1, -0.35, 0.14], [1, 1, 1], [Math.PI / 2, 0, -1.25]);

scene.traverse((object) => {
  if (object.isMesh) {
    object.castShadow = false;
    object.receiveShadow = false;
  }
});

const exporter = new GLTFExporter();
const arrayBuffer = await new Promise((resolve, reject) => {
  exporter.parse(scene, resolve, reject, {
    binary: true,
    onlyVisible: true,
    trs: false,
  });
});

const outPath = path.join(outDir, 'Seagull.glb');
fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
console.log(`Wrote ${outPath} (${fs.statSync(outPath).size} bytes)`);