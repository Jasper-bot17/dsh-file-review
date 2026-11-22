import { defineConfig } from 'tsdown';

/** 插件包名 = 客户端 bundle id = /plugins/<id>/client.js 的 id */
const PLUGIN_ID = 'dsh-file-review';

/**
 * 只打包 Client 半（浏览器侧），Host 半由 tsc 直接输出 ESM。
 * 平台 seed 模块（react 等）必须外部化，运行时由宿主 __ModuleLoader__ 注入。
 */
export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  // CJS 默认按 Node 处理；这里显式让 rolldown 以浏览器为目标解析依赖
  platform: 'neutral',
  inputOptions: { platform: 'browser' },
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  codeSplitting: false,
  deps: { neverBundle: ['react', 'react/jsx-runtime'] },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
});
