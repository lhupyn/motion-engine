# Local models (open-jev)

`classify-open-jev.mjs` wraps [open-jev](https://github.com/nico-martin/open-jev) (kev-0.6b, or open-jev on DeBERTa-v3-large) as a motion-engine `classify(state, questions, { signal })`.

- **state**: open-jev takes a string: `Previous line, by the person: …\nThis line, by the avatar: …`.
- **choice**: the criteria go in open-jev's per-option descriptions (`option: description`). `descriptions: 'none'` sends option names only; `'short'` keeps the text before the first colon.
- **noul**: one statement, `<instructions> Yes: <true> No: <false>`; p(yes) becomes `{ noul }`.
- **signal**: a forward pass can't be cancelled; an abort rejects with AbortError once it ends.

DeBERTa's 512-token context doesn't hold the questions with their criteria (about 1010 tokens for the avatar's lines, 1080 for the person's; the expression question alone takes 570). Only option names fit (230 / 300).

## How it was run

On the first 40 gold lines, 2026-10-17, MacBook Pro 2015 (Intel i5, macOS 12), in Node 22 outside the repo:

```sh
npm install open-jev@0.1.2 @huggingface/transformers@4.3.1 onnxruntime-node-120@npm:onnxruntime-node@1.20.1
node --import ./ort-hook.mjs your-script.mjs
```

The model takes `{ model: 'kev-0.6b' | 'open-jev', dtype: 'q4', device: 'cpu' }`; the q4 weights are 0.38 GB and 0.48 GB.

Transformers.js 4.3 depends on onnxruntime-node 1.30, which has no binary for Intel Macs, and 1.23 needs macOS 13.3. `ort-hook.mjs` makes Transformers.js load onnxruntime-node 1.20.1 instead, sharing its `onnxruntime-common` so both use one Tensor class. With `ME_ORT=wasm` it loads onnxruntime-web instead, with the model's external weights passed explicitly; that ran about 3× slower on this machine. On Apple Silicon or Linux none of this is needed.

## Results (40 lines, director's default thresholds)

| model | right expression / hand gesture where one is needed | wrong gestures on none-only lines | p50 per line (CPU) | peak RAM |
| --- | --- | --- | --- | --- |
| kev-0.6b, full criteria | 12/18 · 9/14 | 3/13 | 19.8 s | 1.06 GB |
| kev-0.6b, names only | 12/18 · 3/14 | 0/13 | 4.4 s | 0.86 GB |
| open-jev, names only | 4/18 · 2/14 | 0/13 | 2.6 s | 0.93 GB |
| Jev 1.14 (OpenRouter) | 17/18 · 14/14 | 2/13 | 0.4 s | — |

open-jev spreads its probability over the 36 expressions, so little passes the thresholds. Neither model is a local replacement for Jev yet.
