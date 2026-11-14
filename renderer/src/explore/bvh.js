// Fast raycasting (three-mesh-bvh, MIT): picking under the crosshair, label occlusion and clicks test merged
// chunk meshes with tens of thousands of triangles several times a second. A bounding-volume hierarchy is built
// lazily the first time a big mesh is ray-tested, and makes each test take microseconds instead of milliseconds.
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

let installed = false;
export function installBvh() {
  if (installed) return;
  installed = true;
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = function (raycaster, intersects) {
    const g = this.geometry;
    if (!g.boundsTree && !this.isInstancedMesh && !this.isSkinnedMesh && g.attributes.position && g.attributes.position.count > 600) {
      g.computeBoundsTree({ targetLeafSize: 10 });
    }
    return acceleratedRaycast.call(this, raycaster, intersects);
  };
}
