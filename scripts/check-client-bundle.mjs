#!/usr/bin/env node
/**
 * 离线校验 client bundle（不启动 DSH）。
 *
 * 检查项（对应官方插件指南 §9.4）：
 *  1. package.json 的 dsh.client.platform === "web"
 *  2. exports["./client"] 指向存在的 lib/client.js
 *  3. lib/client.js 以 __ModuleLoader__ banner 开头、以 return module.exports; 结尾
 *  4. banner 内 id 与插件包名一致（否则运行时 embedded id mismatch）
 *  5. bundle 内 require 的外部模块都在白名单内（react 等平台 seed）
 *  6. lib/index.js 存在且导出 apply
 *  7. cordis.patch.yml 含本插件 insert 行
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const ok = [];

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const pkgName = pkg.name;
const API = 'dsh-file-review';

function check(cond, message) {
  if (cond) ok.push(message);
  else fail.push(message);
}

// 1. platform
check(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform 为 "web"');

// 2. exports["./client"]
const clientExport = pkg.exports?.['./client'];
const clientPath = typeof clientExport === 'string' ? clientExport : clientExport?.default;
check(typeof clientPath === 'string', 'package.json exports["./client"] 存在');
const clientFile = clientPath ? resolve(root, clientPath) : null;
check(clientFile !== null && existsSync(clientFile), `client bundle 存在：${clientPath ?? '(缺失)'}`);

// 3-4. banner / footer / id
if (clientFile && existsSync(clientFile)) {
  const code = readFileSync(clientFile, 'utf8');
  const head = code.slice(0, 400);
  const bannerRe = /window\.__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/;
  const m = head.match(bannerRe);
  check(m !== null, 'bundle 以 window.__ModuleLoader__.load({ id: ... }) banner 开头');
  if (m) check(m[1] === pkgName, `bundle banner id 与包名一致（${m[1]} === ${pkgName}）`);
  const tail = code
    .replace(/\/\/# sourceMappingURL=.*$/m, '')
    .trimEnd()
    .slice(-220);
  check(/return module\.exports;\s*\}\s*\}\s*\);?$/.test(tail), 'bundle 以 return module.exports; } }); 结尾');

  // 5. require 白名单
  const allowed = new Set([
    'react',
    'react/jsx-runtime',
    ...(pkg.dsh?.client?.external ?? []),
  ]);
  const requires = new Set();
  for (const match of code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) requires.add(match[1]);
  // 允许相对路径（打包内联模块）
  const external = [...requires].filter((id) => !id.startsWith('.') && !id.startsWith('/'));
  const banned = external.filter((id) => !allowed.has(id));
  check(banned.length === 0, `bundle 外部 require 均在白名单内${banned.length ? `（越界：${banned.join(', ')}）` : ''}`);
}

// 6. host half
const hostFile = resolve(root, pkg.main ?? 'lib/index.js');
check(existsSync(hostFile), `Host 半存在：${pkg.main ?? 'lib/index.js'}`);
if (existsSync(hostFile)) {
  const host = readFileSync(hostFile, 'utf8');
  check(/export\s+(async\s+)?function\s+apply\s*\(/.test(host), 'lib/index.js 导出 apply()');
  check(new RegExp(`export\\s+const\\s+name\\s*=\\s*["']${API}["']`).test(host) || /name\s*=\s*["']dsh-file-review["']/.test(host), `Host 半 name 为 ${API}`);
}

// 7. cordis patch
const patchFile = resolve(root, pkg.dsh?.bundle?.patch ?? 'cordis.patch.yml');
check(existsSync(patchFile), 'cordis.patch.yml 存在');
if (existsSync(patchFile)) {
  const patch = readFileSync(patchFile, 'utf8');
  check(patch.includes('dsh-file-review'), 'cordis.patch.yml 含 dsh-file-review insert');
}

for (const line of ok) console.log(`  ok   ${line}`);
for (const line of fail) console.log(`  FAIL ${line}`);
if (fail.length) {
  console.error(`\nclient bundle 校验失败：${fail.length} 项`);
  process.exit(1);
}
console.log(`\nclient bundle 校验通过：${ok.length} 项`);
