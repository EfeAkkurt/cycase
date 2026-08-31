# Asset and AI Pipeline

## Decision

Do not build a 3D office from scratch. Assemble a performant modular scene from CC0 assets, then use AI only for a missing hero prop.

### Amendment 1 — the first office was procedural (superseded)

The first implementation built the whole room from primitives, because
kenney.nl serves no direct archive URL and Quaternius distributes behind a
JavaScript modal. `docs/VISUAL_RESET.md` rejected that result: it read as a
blockout. Kept here rather than deleted, because the constraint that caused it
is still real.

### Amendment 2 — Poly Haven, fetched by API and optimised in-repo

**Status: current. This is what ships.**

The office loads CC0 models and PBR materials from
[Poly Haven](https://polyhaven.com), which — unlike the sources above —
publishes a real API rather than a download modal. `scripts/fetch-assets.mjs`
is the whole pipeline and it is reproducible: delete `public/models` and
`public/textures`, run it, get the same bytes back.

```text
api.polyhaven.com/files/<id>   ->  1k glTF plus its textures
@gltf-transform/cli optimize   ->  one .glb, WebP textures, quantized
sharp                          ->  512px WebP room materials
public/asset-manifest.json     ->  the rows in ASSET_LICENSES.md
```

Three choices worth stating:

- **`quantize`, not Draco or Meshopt.** Both need a decoder wired into
  `GLTFLoader` at runtime, and a missing decoder fails *silently* — the same
  failure class as the black-canvas bugs this project has already chased.
- **No HDRI.** A 1k Poly Haven HDRI costs ~1.5 MB and most interior captures
  inject cool daylight, straight into the colour gate. The environment is a
  generated warm two-stop ramp through `PMREMGenerator` instead: no download,
  controlled hue, the same PBR lift.
- **Per-asset texture budgets.** The plant is leaf atlases seen at three metres,
  so it gets 256px; the desk is the hero and gets 1024px.

Total shipped: 3.0 MB of models and 380 KB of textures, lazy-loaded with the
office chunk. The 8 MB GLB budget is nowhere near spent.

#### The gap this does not close

Poly Haven has no monitor and no keyboard. Sources tried, in order:

1. **kenney.nl** — the furniture-kit page exposes no archive URL; the download
   is JavaScript-driven. Third-party mirrors exist but carry exactly the
   attribution risk this document warns about.
2. **quaternius.com** — the pack page's download control is `href="#inline"`,
   a modal. No direct file.
3. **polyhaven.com** — has the desk, chair, cabinet, rack, lamp, plant and
   clutter, but no display hardware.

So the monitor shells, the keyboard and the mouse are still modelled in code,
with real bevels, vents and a two-part stand, carrying the Poly Haven
`metal_plate` PBR set rather than a flat colour. If a CC0 monitor becomes
fetchable, it drops into `MODEL_FILES` and `Monitors.tsx` without touching
anything else.

## Production Map

| Need | Source | Cost/license | Treatment |
|---|---|---|---|
| Desk, chairs, cabinets, monitors | Kenney Furniture Kit | Free, CC0 | Recolor and combine in Blender |
| Low-poly office filler | Quaternius Furniture Pack | Free, CC0 | Use only stylistically compatible pieces |
| Sci-fi screens and server props | Quaternius Sci-Fi Essentials | Free, CC0 | Simplify materials and remove weapon assets |
| Scripted colleague/NPC | Quaternius Animated Character Pack + Universal Animation Library | Free, CC0 | Use idle, walk and talk/emote only |
| Materials and HDRI | Poly Haven | Free, CC0 | Download 1K/2K versions only |
| Scene assembly and export | Blender | Free, GPL software; output belongs to creator | Export one optimized GLB |
| Original concept art | OpenAI image generation | AI-generated reference | Rebuild, do not use as the 3D scene itself |
| Optional image-to-3D | Microsoft TRELLIS.2 Space | Free queue, MIT model/code | Only for one simple prop; inspect and optimize |

Primary sources:

- Kenney Furniture Kit: https://kenney.nl/assets/furniture-kit
- Quaternius: https://quaternius.com/
- Animated character pack: https://quaternius.com/packs/ultimatedanimatedcharacter.html
- Universal animation library: https://quaternius.com/packs/universalanimationlibrary.html
- Poly Haven license: https://polyhaven.com/license
- Blender license: https://www.blender.org/about/license/
- TRELLIS.2: https://github.com/microsoft/TRELLIS.2

## What Will Be Generated

### AI Image Generation

1. Office composition reference: complete as `assets/office-concept-v1.png`.
2. Optional logo exploration. Final logo must be redrawn as SVG.
3. Optional decal sheet for fictional incident labels.

### 3D Generation

Default: no AI-generated room.

AI image-to-3D may be used only for:

- One unique desk device or alarm beacon.

Do not generate chairs, desks, monitors, walls, racks or generic office props. CC0 sources already solve these with cleaner topology and predictable licenses.

## Free Image-to-3D Route

1. Generate a clean object reference on a transparent background.
2. Upload it to the official Microsoft TRELLIS.2 Hugging Face Space.
3. Export GLB.
4. Open GLB in Blender.
5. Remove hidden/internal faces.
6. Decimate to 5,000–20,000 triangles depending on screen size.
7. Merge materials; use one 1K texture atlas.
8. Reset transforms, name objects and export GLB.
9. Run glTF Transform with Meshopt compression.
10. Record source, prompt, date and license in `ASSET_LICENSES.md` in the implementation repo.

TRELLIS.2 requires a CUDA-class GPU locally. Use its official hosted Space when available; queue availability is not guaranteed.

## Tools Not Selected

- Meshy Free: generation is free but current free accounts cannot download models. Not usable for a zero-cost pipeline.
- Hunyuan3D 2.1: community license excludes the EU, UK and South Korea and adds redistribution conditions. Avoid for this project.
- Stable Fast 3D: license is not plain OSS and requires extra commercial-use review. Avoid while a simpler route exists.
- Spline embeds: unnecessary runtime and platform dependency.
- Sketchfab random downloads: every asset has a separate license and attribution risk.

## Optimization Checklist

- One environment GLB.
- Delete cameras and lights imported from asset packs.
- Merge static meshes by material where practical.
- Maximum 2K texture for the room.
- Use WebP/KTX2 only after browser testing.
- Apply Meshopt compression.
- No rig for static office objects.
- No physics colliders.
- No invisible high-poly originals in the public build.
- Keep original source and license files outside the runtime bundle.

## Acceptance Test

The office passes only if it loads under the product performance budget, all three monitors remain readable at 1280×720, and the same gameplay remains possible when the 3D canvas is disabled.
