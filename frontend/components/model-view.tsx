"use client";

import { useEffect, useRef, useState } from "react";
import type * as THREE from "three";

type Part = { key: string; label: string; count: number; visible: boolean };

/** What a 3D file is, by its name: a BIM model (IFC) or a mesh (glTF, OBJ, STL). */
export function modelKind(name: string): "ifc" | "gltf" | "obj" | "stl" | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext === "ifc" ? "ifc" : ext === "glb" || ext === "gltf" ? "gltf" : ext === "obj" ? "obj" : ext === "stl" ? "stl" : null;
}

/** IFC's names for things, read plainly: IFCWALLSTANDARDCASE → Wall standard case. */
function ifcWords(code: string): string {
  const bare = code.replace(/^IFC/i, "").toLowerCase();
  const known: Record<string, string> = {
    wall: "Walls", wallstandardcase: "Walls", slab: "Slabs", beam: "Beams", column: "Columns", door: "Doors", window: "Windows",
    stair: "Stairs", stairflight: "Stair flights", railing: "Railings", roof: "Roofs", covering: "Coverings", plate: "Plates",
    member: "Members", furnishingelement: "Furniture", flowsegment: "Pipes & ducts", flowterminal: "Terminals",
    flowfitting: "Fittings", buildingelementproxy: "Other elements", space: "Spaces", opening: "Openings",
    footing: "Footings", pile: "Piles", curtainwall: "Curtain walls", ramp: "Ramps", site: "Site",
  };
  return known[bare] ?? bare.charAt(0).toUpperCase() + bare.slice(1);
}

/**
 * A 3D model in the page (owner: "mostly BIM, so do IFC, and glTF/OBJ/STL"): turned with the mouse, zoomed with the
 * wheel or the bar, moved with the right button; its parts (an IFC's kinds of element, a mesh's objects) shown or
 * hidden. Read in the browser: IFC by web-ifc (its WebAssembly served by the app), the meshes by three.js. Spaces and
 * openings start hidden, as BIM viewers do.
 */
export function ModelView({ fileId, name, zoom = 1, height }: { fileId: string; name: string; zoom?: number; height: string }) {
  const box = useRef<HTMLDivElement>(null);
  const groups = useRef(new Map<string, THREE.Object3D>());
  const camera = useRef<THREE.PerspectiveCamera | null>(null);
  const draw = useRef<() => void>(() => {});
  const [parts, setParts] = useState<Part[]>([]);
  const [state, setState] = useState<"loading" | "ready" | string>("loading");

  useEffect(() => {
    let gone = false;
    let dispose = () => {};
    (async () => {
      const kind = modelKind(name);
      if (!kind) { setState("This is not a 3D model the page reads: download it to open it."); return; }
      const answer = await fetch(`/api/files/${fileId}`).catch(() => null);
      if (gone) return;
      if (!answer?.ok) { setState("The model could not be fetched: download it to open it."); return; }
      const bytes = await answer.arrayBuffer();
      const three = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (gone || !box.current) return;

      const scene = new three.Scene();
      scene.background = new three.Color("#f1f5f9");
      scene.add(new three.HemisphereLight(0xffffff, 0x8899aa, 2.2));
      const sun = new three.DirectionalLight(0xffffff, 1.6);
      sun.position.set(1, 2, 1.5);
      scene.add(sun);
      const model = new three.Group();
      scene.add(model);
      const found = new Map<string, { label: string; group: THREE.Group; count: number; hidden: boolean }>();
      const partOf = (key: string, label: string, hidden = false) => {
        let one = found.get(key);
        if (!one) {
          one = { label, group: new three.Group(), count: 0, hidden };
          one.group.visible = !hidden;
          model.add(one.group);
          found.set(key, one);
        }
        one.count++;
        return one.group;
      };

      try {
        if (kind === "ifc") {
          const { IfcAPI } = await import("web-ifc");
          const ifc = new IfcAPI();
          ifc.SetWasmPath("/vendor/web-ifc/", true);
          await ifc.Init();
          const id = ifc.OpenModel(new Uint8Array(bytes));
          const materials = new Map<string, THREE.MeshLambertMaterial>();
          ifc.StreamAllMeshes(id, (mesh) => {
            const type = ifc.GetNameFromTypeCode(ifc.GetLineType(id, mesh.expressID)) || "IFCELEMENT";
            const label = ifcWords(type);
            const target = partOf(label, label, /^IFC(SPACE|OPENINGELEMENT)$/i.test(type));
            const placed = mesh.geometries;
            for (let i = 0; i < placed.size(); i++) {
              const one = placed.get(i);
              const geometry = ifc.GetGeometry(id, one.geometryExpressID);
              const vertices = ifc.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
              const indices = ifc.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
              geometry.delete();
              // Each vertex: position then normal, six numbers.
              const positions = new Float32Array(vertices.length / 2);
              const normals = new Float32Array(vertices.length / 2);
              for (let v = 0, p = 0; v < vertices.length; v += 6, p += 3) {
                positions[p] = vertices[v]; positions[p + 1] = vertices[v + 1]; positions[p + 2] = vertices[v + 2];
                normals[p] = vertices[v + 3]; normals[p + 1] = vertices[v + 4]; normals[p + 2] = vertices[v + 5];
              }
              const shape = new three.BufferGeometry();
              shape.setAttribute("position", new three.BufferAttribute(positions, 3));
              shape.setAttribute("normal", new three.BufferAttribute(normals, 3));
              shape.setIndex(new three.BufferAttribute(indices, 1));
              const { x, y, z, w } = one.color;
              const colour = `${x.toFixed(3)}|${y.toFixed(3)}|${z.toFixed(3)}|${w.toFixed(3)}`;
              let material = materials.get(colour);
              if (!material) {
                material = new three.MeshLambertMaterial({ color: new three.Color(x, y, z), transparent: w < 1, opacity: w, side: three.DoubleSide });
                materials.set(colour, material);
              }
              const part = new three.Mesh(shape, material);
              part.applyMatrix4(new three.Matrix4().fromArray(one.flatTransformation));
              target.add(part);
            }
          });
          ifc.CloseModel(id);
        } else if (kind === "gltf") {
          const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
          const gltf = await new GLTFLoader().parseAsync(bytes, "");
          const root = gltf.scene.children.length === 1 ? gltf.scene.children[0] : gltf.scene;
          for (const child of [...root.children]) partOf(child.uuid, child.name || "Unnamed part").add(child);
          if (found.size === 0) model.add(gltf.scene);
        } else if (kind === "obj") {
          const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
          const object = new OBJLoader().parse(new TextDecoder().decode(bytes));
          for (const child of [...object.children]) partOf(child.uuid, child.name || "Unnamed part").add(child);
        } else {
          const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
          const shape = new STLLoader().parse(bytes);
          shape.computeVertexNormals();
          model.add(new three.Mesh(shape, new three.MeshLambertMaterial({ color: "#94a3b8", side: three.DoubleSide })));
        }
      } catch {
        if (!gone) setState(kind === "gltf"
          ? "The model could not be read (a .gltf with its parts in separate files is not read here; a .glb is): download it to open it."
          : "The model could not be read: download it to open it.");
        return;
      }
      if (gone || !box.current) return;

      // The view fitted to the model (web-ifc gives an IFC upright, Y up, as three.js draws).
      const bounds = new three.Box3().setFromObject(model);
      const size = bounds.getSize(new three.Vector3()).length() || 1;
      const centre = bounds.getCenter(new three.Vector3());
      const width = box.current.clientWidth || 800;
      const tall = box.current.clientHeight || 500;
      const renderer = new three.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, tall);
      box.current.appendChild(renderer.domElement);
      const view = new three.PerspectiveCamera(45, width / tall, size / 1000, size * 20);
      view.position.copy(centre).add(new three.Vector3(size * 0.6, size * 0.45, size * 0.8));
      camera.current = view;
      const controls = new OrbitControls(view, renderer.domElement);
      controls.target.copy(centre);
      controls.update();
      const render = () => renderer.render(scene, view);
      draw.current = render;
      controls.addEventListener("change", render);
      const resized = new ResizeObserver(() => {
        if (!box.current) return;
        const w = box.current.clientWidth, h = box.current.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h);
        view.aspect = w / h;
        view.updateProjectionMatrix();
        render();
      });
      resized.observe(box.current);
      groups.current = new Map([...found].map(([key, one]) => [key, one.group]));
      setParts([...found].map(([key, one]) => ({ key, label: one.label, count: one.count, visible: !one.hidden }))
        .sort((a, b) => b.count - a.count));
      setState("ready");
      render();
      dispose = () => {
        resized.disconnect();
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();
    return () => { gone = true; dispose(); };
  }, [fileId, name]);

  // The bar's zoom: the camera's own zoom over the view the model opened on.
  useEffect(() => {
    const view = camera.current;
    if (!view || state !== "ready") return;
    view.zoom = zoom;
    view.updateProjectionMatrix();
    draw.current();
  }, [zoom, state]);

  const toggle = (part: Part) => {
    const group = groups.current.get(part.key);
    if (group) group.visible = !part.visible;
    setParts((all) => all.map((one) => (one.key === part.key ? { ...one, visible: !one.visible } : one)));
    draw.current();
  };

  return (
    <div className={`relative flex w-full bg-slate-100 ${height}`}>
      <div ref={box} className="min-w-0 flex-1" />
      {state === "ready" && parts.length > 1 ? (
        <aside className="scroll-thin w-52 shrink-0 overflow-y-auto border-l border-line bg-tint-soft p-2 text-[11px]">
          <p className="stencil mb-1 text-slate-500">Parts</p>
          {parts.map((part) => (
            <label key={part.key} className="flex cursor-pointer items-center gap-1.5 py-0.5 text-slate-700">
              <input type="checkbox" checked={part.visible} onChange={() => toggle(part)} />
              <span className="truncate" title={part.label}>{part.label}</span>
              <span className="ml-auto text-slate-400 tabular-nums">{part.count}</span>
            </label>
          ))}
        </aside>
      ) : null}
      {state !== "ready" ? (
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-xs text-slate-500">
          {state === "loading" ? `Opening ${name}…` : state}
        </p>
      ) : (
        <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/80 px-2 py-0.5 text-[11px] text-slate-500">
          Drag to turn · right-drag to move · wheel to zoom
        </p>
      )}
    </div>
  );
}
