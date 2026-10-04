// Centre sugar pile: render-only GLB, cell-shaded. Gameplay still uses env.food[0] disc.
import { cloneMapProp } from './race-map-assets.js';
import { applyCelShading } from './cel-shade.js';
import { groundAt } from './sim/senses.js';

export function placeSugarPile(root, env) {
  const food = env?.food?.[0];
  const mesh = cloneMapProp('sugar_pile');
  if (!food || !mesh) return null;
  applyCelShading(mesh);
  mesh.name = 'SugarPile';
  mesh.position.set(food.x, food.y, groundAt([food.x, food.y], env) + 0.008);
  mesh.rotation.z = 0.18;
  mesh.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.userData.laserIgnore = true;
    if (o.name !== 'CelOutline') return;
    o.renderOrder = 1;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -2;
    }
  });
  root.add(mesh);
  return mesh;
}
