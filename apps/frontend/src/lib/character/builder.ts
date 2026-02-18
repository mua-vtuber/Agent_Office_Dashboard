import { Container, Sprite } from "pixi.js";
import { CHAR_W, ORIGIN_X, ORIGIN_Y } from "./types";
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
 *
 * @param agentId - unique agent identifier used as seed
 * @param scale - final container scale (default: fits AGENT_R*2 area)
 */
export async function buildCharacter(
  agentId: string,
  scale?: number,
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

  // Layer 1: body (SVG + skin color swap)
  const bodyColorMap = buildColorMap([traits.skinColor]);
  const bodyTexture = await swapPalette(
    bodyPaths[traits.bodyIndex]!,
    bodyColorMap,
  );
  const bodySprite = new Sprite(bodyTexture);
  bodySprite.width = CHAR_W;
  bodySprite.height = CHAR_W;
  bodySprite.x = -ORIGIN_X;
  bodySprite.y = -ORIGIN_Y;
  container.addChild(bodySprite);

  // Layer 2: costume (SVG + palette swap)
  const costumeColorMap = buildColorMap(traits.costumeColors);
  const costumeTexture = await swapPalette(
    costumePaths[traits.costumeIndex]!,
    costumeColorMap,
  );
  const costumeSprite = new Sprite(costumeTexture);
  costumeSprite.width = CHAR_W;
  costumeSprite.height = CHAR_W;
  costumeSprite.x = -ORIGIN_X;
  costumeSprite.y = -ORIGIN_Y;
  container.addChild(costumeSprite);

  // Layer 3: hair (SVG + hair color swap)
  const hairColorMap = buildColorMap([traits.hairColor]);
  const hairTexture = await swapPalette(
    hairPaths[traits.hairIndex]!,
    hairColorMap,
  );
  const hairSprite = new Sprite(hairTexture);
  hairSprite.width = CHAR_W;
  hairSprite.height = CHAR_W;
  hairSprite.x = -ORIGIN_X;
  hairSprite.y = -ORIGIN_Y;
  container.addChild(hairSprite);

  // Layer 4: accessory (SVG + palette swap, optional)
  if (traits.accessoryIndex >= 0) {
    const accColorMap = buildColorMap(traits.accessoryColors);
    const accTexture = await swapPalette(
      accessoryPaths[traits.accessoryIndex]!,
      accColorMap,
    );
    const accSprite = new Sprite(accTexture);
    accSprite.width = CHAR_W;
    accSprite.height = CHAR_W;
    accSprite.x = -ORIGIN_X;
    accSprite.y = -ORIGIN_Y;
    container.addChild(accSprite);
  }

  // Scale: default maps 40x40 canvas to AGENT_R*2 pixel area
  if (scale != null) {
    container.scale.set(scale);
  }

  cache.set(agentId, container);
  return container;
}
