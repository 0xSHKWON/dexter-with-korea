import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Props {
  size?: number;
}

/**
 * Minimal 3D mark — a slowly rotating icosahedron with an accent wireframe.
 * Replaces the old flat ◆ diamond on the chat empty state.
 */
export default function ThreeLogo({ size = 104 }: Props): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.z = 4.2;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return; // no WebGL — leave the empty state without a mark rather than crash
    }
    renderer.setPixelRatio(dpr);
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const geo = new THREE.IcosahedronGeometry(1.25, 0);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0x1c2230,
        metalness: 0.35,
        roughness: 0.45,
        flatShading: true,
      }),
    );
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x58a6ff, transparent: true, opacity: 0.85 }),
    );
    const group = new THREE.Group();
    group.add(mesh, edges);
    scene.add(group);

    const key = new THREE.DirectionalLight(0x9ecbff, 1.1);
    key.position.set(2, 3, 4);
    scene.add(key, new THREE.AmbientLight(0x4a6b9a, 0.6));

    let raf = 0;
    const animate = (): void => {
      raf = requestAnimationFrame(animate);
      group.rotation.y += 0.006;
      group.rotation.x += 0.0026;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      geo.dispose();
      (mesh.material as THREE.Material).dispose();
      edges.geometry.dispose();
      (edges.material as THREE.Material).dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [size]);

  return <div className="three-logo" ref={mountRef} style={{ width: size, height: size }} />;
}
