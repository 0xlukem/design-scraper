import * as THREE from 'three';

// The low-flying pieces cross the WebGL canvas boundary. Bake the actual meshes
// once so their airborne and resting poses can share the page-wide paint surface.
export function renderTokenStamps(renderer, litScene, meshes) {
  const size = 96;
  const target = new THREE.WebGLRenderTarget(size, size, { colorSpace: THREE.SRGBColorSpace });
  const scene = new THREE.Scene();
  scene.environment = litScene.environment;
  scene.environmentIntensity = litScene.environmentIntensity;
  litScene.children.filter(child => child.isLight).forEach(light => scene.add(light.clone()));
  const camera = new THREE.OrthographicCamera(-.86, .86, .86, -.86, .1, 10);
  camera.position.set(.36, .72, 3);
  camera.lookAt(0, 0, 0);
  const previous = renderer.getRenderTarget();
  try {
    return meshes.map((mesh, i) => {
      const piece = mesh.clone();
      piece.rotation.set(-.65 - i * .13, .2, [.16, -.09, .08][i]);
      scene.add(piece);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      scene.remove(piece);
      const pixels = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
      let left = size, right = 0, top = size, bottom = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (!pixels[(y * size + x) * 4 + 3]) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      if (right < left || bottom < top) return null;
      const canvas = document.createElement('canvas');
      canvas.width = right - left + 1; canvas.height = bottom - top + 1;
      const ctx = canvas.getContext('2d'), data = ctx.createImageData(canvas.width, canvas.height);
      for (let row = 0; row < canvas.height; row++) {
        const start = ((bottom - row) * size + left) * 4;
        data.data.set(pixels.subarray(start, start + canvas.width * 4), row * canvas.width * 4);
      }
      ctx.putImageData(data, 0, 0);
      return { url: canvas.toDataURL(), width: canvas.width * .65, height: canvas.height * .65 };
    }).filter(Boolean);
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
  }
}
