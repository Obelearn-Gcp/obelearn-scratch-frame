# obelearn-scratch-frame

The Scratch editor ([`@scratch/scratch-gui`](https://www.npmjs.com/package/@scratch/scratch-gui)) packaged as a static page that ObeLearn opens inside a sandboxed iframe.

## Build

```sh
npm ci
npm run fetch-assets   # downloads the sprite, costume, backdrop and sound library once
npm run build          # writes the static site to build/
npm run serve          # http://localhost:4400/host.html (local test page)
```

Pushing a `v*` tag publishes a GitHub Release with the build zip and the source zip.

## Hosting

- Served by the ObeLearn frontend at `/scratch-gui/`.
- Opened with `<iframe sandbox="allow-scripts">` (no `allow-same-origin`), so the editor has an opaque origin and cannot reach ObeLearn storage, cookies or the parent page.
- The frame's requests come from origin `null`, so `/scratch-gui/` must be served with `Access-Control-Allow-Origin: *`.
- No external services: the library assets are served from this build, and the project validators are precompiled, so the page runs under `script-src 'self'` without `unsafe-eval`.

## Messages

| Direction | Message |
| --- | --- |
| parent → frame | `{ type: "scratch:load", mode: "edit" \| "player", sb3: ArrayBuffer }` |
| parent → frame | `{ type: "scratch:get-sb3", requestId: string }` |
| frame → parent | `{ type: "scratch:ready" }` |
| frame → parent | `{ type: "scratch:loaded" }` |
| frame → parent | `{ type: "scratch:changed" }` |
| frame → parent | `{ type: "scratch:sb3", requestId, sb3: ArrayBuffer, size_bytes }` |
| frame → parent | `{ type: "scratch:error", message, requestId? }` |

The frame only accepts messages from its parent on the same origin, and posts only to that origin. Projects over 100 MB are refused.

## License

AGPL-3.0-only, like `@scratch/scratch-gui`. See [LICENSE](LICENSE). The Scratch name, logo and Scratch Cat are trademarks of the Scratch Foundation, see [TRADEMARK](TRADEMARK).
