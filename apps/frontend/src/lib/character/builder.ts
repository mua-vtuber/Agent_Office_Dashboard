import { Container, Sprite } from "pixi.js";
import { generateTraits } from "./generator";
import { buildColorMap, swapPalette } from "./palette";

/* ---------- Auto-discovery via import.meta.glob ---------- */

const bodyModules = import.meta.glob("./parts/body/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const hairModules = import.meta.glob("./parts/hair/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const costumeModules = import.meta.glob("./parts/costume/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const accessoryModules = import.meta.glob("./parts/accessory/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const bodyPaths: string[] = Object.values(bodyModules);
const hairPaths: string[] = Object.values(hairModules);
const costumePaths: string[] = Object.values(costumeModules);
const accessoryPaths: string[] = Object.values(accessoryModules);

/* ---------- Helper: add a layer if parts exist ---------- */

async function addLayer(
  container: Container,
  paths: string[],
  index: number,
  colors: number[],
): Promise<void> {
  if (paths.length === 0 || index < 0 || index >= paths.length) return;
  const colorMap = buildColorMap(colors);
  const texture = await swapPalette(paths[index]!, colorMap);
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5, 0.5);
  container.addChild(sprite);
}

/* ---------- Cache ---------- */

const cache = new Map<string, Container>();

export function getCachedCharacter(agentId: string): Container | undefined {
  return cache.get(agentId);
}

export function clearCharacterCache(): void {
  for (const [, c] of cache) c.destroy({ children: true });
  cache.clear();
}

/* ---------- Builder ---------- */

/**
 * Build a deterministic character Container for the given agent_id.
 * Returns cached container on repeat calls.
 * Parts directories that contain no SVGs are simply skipped.
 *
 * @param size — final pixel diameter of the character. The only size control point.
 */
export async function buildCharacter(
  agentId: string,
  size?: number,
): Promise<Container> {
  const cached = cache.get(agentId);
  if (cached && !cached.destroyed) return cached;
  // Evict destroyed entry
  if (cached) cache.delete(agentId);

  const traits = generateTraits(agentId, {
    body: bodyPaths.length,
    hair: hairPaths.length,
    costume: costumePaths.length,
    accessory: accessoryPaths.length,
  });

  const container = new Container();

  // Layer 1: body
  await addLayer(container, bodyPaths, traits.bodyIndex, [traits.skinColor]);

  // Layer 2: costume
  await addLayer(container, costumePaths, traits.costumeIndex, traits.costumeColors);

  // Layer 3: hair
  await addLayer(container, hairPaths, traits.hairIndex, [traits.hairColor]);

  // Layer 4: accessory (index -1 = none, addLayer handles it)
  await addLayer(container, accessoryPaths, traits.accessoryIndex, traits.accessoryColors);

  // Resize all sprites to final pixel size directly
  if (size != null) {
    for (const child of container.children) {
      const s = child as Sprite;
      s.width = size;
      s.height = size;
    }
  }

  cache.set(agentId, container);
  return container;
}
