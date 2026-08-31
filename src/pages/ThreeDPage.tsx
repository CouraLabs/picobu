import { BoxRenderable, RGBA } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { THREE, ThreeRenderable } from "@opentui/three";
import { useEffect, useRef } from "react";
import { useTheme } from "../hooks/useTheme";

/** Renders an animated WebGPU 3D scene (a rotating cube) inside a bordered box. */
export const ThreeDPage = () => {
  const renderer = useRenderer();
  const { theme } = useTheme();
  const boxRef = useRef<BoxRenderable>(null);

  // Holds the live scene meshes so theme changes can re-tint them without
  // tearing down the WebGPU renderable and re-initializing the GPU device.
  const sceneRef = useRef<{ material: THREE.MeshPhongMaterial } | null>(null);

  useEffect(() => {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(new THREE.Color(0.35, 0.35, 0.35), 1));

    const light = new THREE.DirectionalLight(new THREE.Color(1, 0.95, 0.9), 1.2);
    light.position.set(2.5, 2, 3);
    scene.add(light);

    // The cube itself is tinted from the active theme (base = primary, glow = accent).
    const material = new THREE.MeshPhongMaterial({
      color: new THREE.Color(theme.primary.r, theme.primary.g, theme.primary.b),
      emissive: new THREE.Color(theme.accent.r, theme.accent.g, theme.accent.b),
      emissiveIntensity: 0.12,
    });
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    scene.add(cube);
    sceneRef.current = { material };

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 3);

    const view = new ThreeRenderable(renderer, {
      width: "100%",
      height: "100%",
      scene,
      camera,
      renderer: {
        focalLength: 8,
        alpha: true,
        backgroundColor: RGBA.fromValues(0, 0, 0, 0),
      },
    });

    const rotateCube = async (deltaMs: number) => {
      cube.rotation.x += 0.6 * (deltaMs / 1000);
      cube.rotation.y += 0.4 * (deltaMs / 1000);
    };
    renderer.setFrameCallback(rotateCube);

    boxRef.current?.add(view);

    return () => {
      sceneRef.current = null;
      renderer.removeFrameCallback(rotateCube);
      view.destroy();
    };
  }, [renderer])

  // Re-tint the cube whenever the theme (or its variant) changes.
  useEffect(() => {
    const { material } = sceneRef.current ?? {};
    if (!material) return;
    material.color.setRGB(theme.primary.r, theme.primary.g, theme.primary.b);
    material.emissive.setRGB(theme.accent.r, theme.accent.g, theme.accent.b);
  }, [theme])

  return (
    <box id="3d-page" ref={boxRef} flexDirection="column" flexGrow={1} paddingX={1}>
    </box>
  );
};