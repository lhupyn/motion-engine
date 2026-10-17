// onnxruntime-node 1.30 (Transformers.js's own) ships no binary for Intel Macs.
// ME_ORT=native (default): onnxruntime-node 1.20.1, the last one that loads on
// macOS 12 Intel, installed as onnxruntime-node-120. ME_ORT=wasm: onnxruntime-web.
// Either way Transformers.js takes onnxruntime-common from the same runtime, so
// both share one Tensor class.
// Usage: node --import ./ort-hook.mjs script.mjs
import { registerHooks, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const req = createRequire(import.meta.url);
const wasm = process.env.ME_ORT === 'wasm';
const ortWeb = new URL('./node_modules/onnxruntime-web/dist/ort.node.min.mjs', import.meta.url).href;
const ortNode = wasm ? null : req.resolve('onnxruntime-node-120');
const ortNodeCommon = wasm ? null : createRequire(ortNode).resolve('onnxruntime-common');

registerHooks({
  resolve(spec, ctx, next) {
    const fromTransformers = ctx.parentURL?.includes('/@huggingface/transformers/');
    if (wasm) {
      if (spec === 'onnxruntime-node') return { url: ortWeb, format: 'module', shortCircuit: true };
      if (spec === 'onnxruntime-common' && fromTransformers) return next(spec, { ...ctx, parentURL: ortWeb });
    } else {
      if (spec === 'onnxruntime-node')
        return { url: pathToFileURL(ortNode).href, format: 'commonjs', shortCircuit: true };
      if (spec === 'onnxruntime-common' && fromTransformers)
        return { url: pathToFileURL(ortNodeCommon).href, format: 'commonjs', shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

if (wasm) {
  // Transformers.js leaves a model's external weights for onnxruntime-node to find
  // next to the model file; onnxruntime-web has to be told about them.
  const { existsSync } = await import('node:fs');
  const { basename } = await import('node:path');
  const { InferenceSession } = await import(ortWeb);
  const create = InferenceSession.create;
  InferenceSession.create = function (model, options = {}, ...rest) {
    if (typeof model === 'string' && !options.externalData) {
      const files = [`${model}_data`, ...Array.from({ length: 9 }, (_, i) => `${model}_data_${i + 1}`)].filter(
        existsSync,
      );
      if (files.length) options = { ...options, externalData: files.map((f) => ({ path: basename(f), data: f })) };
    }
    return create.call(this, model, options, ...rest);
  };
}
