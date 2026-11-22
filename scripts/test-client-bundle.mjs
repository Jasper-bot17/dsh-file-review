#!/usr/bin/env node
/**
 * Client bundle 离线装载测试：模拟宿主 window.__ModuleLoader__，验证
 *  ① bundle 能被求值且不抛错；② 工厂函数返回的 exports 含 name/apply/inject；
 *  ③ apply() 会把入口按钮注册到 conversation.input.left、面板注册到 shell.overlay。
 *
 * 不依赖 DSH / 浏览器。用法：node scripts/test-client-bundle.mjs（先 npm run build）
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromApp = createRequire(import.meta.url);

const code = readFileSync(resolve(root, 'lib/client.js'), 'utf8');
let captured = null;
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(spec) {
        captured = spec;
      },
    },
  },
  // vm 上下文不带浏览器全局，按 bundle 实际用到的补上
  AbortController,
  crypto: globalThis.crypto,
  Intl,
  URL,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
};
runInNewContext(code, sandbox);

const failures = [];
const ok = [];
function check(name, condition, detail = '') {
  if (condition) ok.push(name);
  else failures.push(`${name}${detail ? `  ← ${detail}` : ''}`);
}

check('bundle 调用 __ModuleLoader__.load 注册模块', captured !== null);
check('banner id 为 dsh-file-review', captured?.id === 'dsh-file-review', String(captured?.id));
check('factory 是函数', typeof captured?.factory === 'function');

const react = requireFromApp('react');
const moduleExports = captured.factory((specifier) => {
  if (specifier === 'react') return react;
  if (specifier === 'react/jsx-runtime') return requireFromApp('react/jsx-runtime');
  throw new Error(`未外部化的 require：${specifier}`);
});

check('exports.name 正确', moduleExports.name === 'dsh-file-review', String(moduleExports.name));
check('exports.apply 是函数', typeof moduleExports.apply === 'function');
check('exports.inject 声明 slots', Array.isArray(moduleExports.inject) && moduleExports.inject.includes('slots'), JSON.stringify(moduleExports.inject));

// 用假 slots 服务跑 apply，收集注册项
const registered = [];
const slotsService = {
  inject(slot, factory) {
    factory();
  },
  register(options, component) {
    registered.push({ slot: options.name, id: options.id, component });
    return () => undefined;
  },
};
const ctx = {
  get(name) {
    if (name === 'slots') return slotsService;
    throw new Error(`未知服务 ${name}`);
  },
};
moduleExports.apply(ctx);

check(
  'apply 注册了 conversation.input.left 入口',
  registered.some((item) => item.slot === 'conversation.input.left' && item.id === 'file-review-entry'),
  registered.map((item) => item.slot).join(','),
);
check(
  'apply 注册了 shell.overlay 面板',
  registered.some((item) => item.slot === 'shell.overlay' && item.id === 'file-review-panel'),
  registered.map((item) => item.slot).join(','),
);

// 入口按钮组件可被注册（组件内部用 hooks，必须在 React 渲染器里调用，这里只验类型）
const entry = registered.find((item) => item.slot === 'conversation.input.left');
if (entry) {
  check('入口按钮组件是函数', typeof entry.component === 'function');
}

// 发送通道：没有 remote 服务时不能因 cordis 属性访问而崩（回归 store.ts 的 try 包裹）
check('导出 canSendToSession', typeof moduleExports.canSendToSession === 'function');
check('无 remote 服务时 canSendToSession 不抛错', moduleExports.canSendToSession() === false, String(moduleExports.canSendToSession()));
check('导出 sendToSession', typeof moduleExports.sendToSession === 'function');
let noChannelError = null;
try {
  await moduleExports.sendToSession('s1', 'x');
} catch (error) {
  noChannelError = error;
}
check(
  '无任何通道时 sendToSession 给出可读错误',
  // 错误对象在 vm 另一个 realm 里创建，不能用 instanceof 判断
  Boolean(noChannelError) && String(noChannelError.message).includes('复制文本'),
  String(noChannelError && noChannelError.message),
);

// 输入条兜底通道：捕获 setDraft/submit 后可发送
const drafted = [];
let submitted = 0;
moduleExports.captureInputActions({
  setDraft(text) {
    drafted.push(text);
  },
  submit() {
    submitted += 1;
  },
});
check('捕获输入条动作后 canSendToSession 为 true', moduleExports.canSendToSession() === true);
await moduleExports.sendToSession('s1', '批注消息');
check('兜底通道写入草稿', drafted.length === 1 && drafted[0] === '批注消息', JSON.stringify(drafted));
check('兜底通道提交输入条', submitted === 1, String(submitted));

// 输入条 overlay 捕获通道：网页端 inputActions 从 overlay props 下发，不是 input.left
const overlayEntry = registered.find(
  (item) => item.slot === 'conversation.input.overlay' && item.id === 'file-review-capture',
);
check('apply 注册了 conversation.input.overlay 捕获通道', Boolean(overlayEntry));
if (overlayEntry) {
  const overlayDrafted = [];
  let overlaySubmitted = 0;
  const rendered = overlayEntry.component({
    sessionId: 's2',
    inputActions: {
      setDraft(text) {
        overlayDrafted.push(text);
      },
      submit() {
        overlaySubmitted += 1;
      },
    },
  });
  check('overlay 捕获组件返回 null（不渲染界面）', rendered === null);
  check('overlay 捕获后 canSendToSession 为 true', moduleExports.canSendToSession() === true);
  await moduleExports.sendToSession('s2', 'overlay 批注消息');
  check(
    'overlay 通道写入草稿并提交',
    overlayDrafted.length === 1 && overlayDrafted[0] === 'overlay 批注消息' && overlaySubmitted === 1,
    JSON.stringify({ overlayDrafted, overlaySubmitted }),
  );
  const diag = moduleExports.getSlotDiagnostics();
  check(
    '诊断记录了 overlay 收到的 props 键',
    Array.isArray(diag.overlayKeys) && diag.overlayKeys.includes('inputActions') && diag.captured === true,
    JSON.stringify(diag),
  );
}

// Remote 通道优先：绑定带 session.prompt 的 ctx 后应走 Remote，不再动输入条
const remoteRequests = [];
moduleExports.apply({
  get(name) {
    if (name === 'slots') return slotsService;
    if (name === 'remote') return undefined;
    throw new Error(`未知服务 ${name}`);
  },
  remote: {
    session: {
      async prompt(request) {
        remoteRequests.push(request);
        return { accepted: true };
      },
    },
  },
});
check('有 Remote 时 canSendToSession 为 true', moduleExports.canSendToSession() === true);
await moduleExports.sendToSession('s1', '走 Remote 的批注');
check(
  'Remote 通道收到 session/prompt 请求',
  remoteRequests.length === 1 &&
    remoteRequests[0].sessionId === 's1' &&
    remoteRequests[0].mode === 'queue' &&
    remoteRequests[0].content[0].text === '走 Remote 的批注',
  JSON.stringify(remoteRequests[0]),
);
check('Remote 成功时不改输入条草稿', drafted.length === 1, JSON.stringify(drafted));

// 发给 AI 的消息格式：每条批注前必须带行号区间 L<start>-<end>（与批注卡口径一致）
check('导出 buildAnnotationMessage', typeof moduleExports.buildAnnotationMessage === 'function');
const formatAnnotations = [
  {
    id: 'a1',
    path: 'check-plugin-modules.mjs',
    fileSha1: null,
    from: 1,
    to: 2,
    quote: "import { pathToFileURL } from 'node:url';",
    text: '这里数字不对，改成 42',
    status: 'open',
    createdAt: 0,
  },
  {
    id: 'a2',
    path: 'check-plugin-modules.mjs',
    fileSha1: null,
    from: 9,
    to: 9,
    quote: 'const x = 1;',
    text: '加一行注释',
    status: 'open',
    createdAt: 0,
  },
];
const formatMessage = moduleExports.buildAnnotationMessage({
  relPath: 'check-plugin-modules.mjs',
  version: 1,
  annotations: formatAnnotations,
  includePath: true,
  includeQuote: true,
});
check(
  '消息每条批注前带行号区间',
  formatMessage.includes('1. L1-2 【原文】') && formatMessage.includes('2. L9-9 【原文】'),
  formatMessage,
);
check(
  '消息保留文件路径/版本/意见与要求段',
  formatMessage.includes('文件：check-plugin-modules.mjs（v1）') &&
    formatMessage.includes('共 2 条批注') &&
    formatMessage.includes('【意见】这里数字不对，改成 42') &&
    formatMessage.includes('要求：只改批注涉及的内容'),
  formatMessage,
);
const formatNoQuote = moduleExports.buildAnnotationMessage({
  relPath: 'check-plugin-modules.mjs',
  version: 1,
  annotations: formatAnnotations,
  includePath: false,
  includeQuote: false,
});
check(
  '不附带原文时行号仍在',
  formatNoQuote.includes('1. L1-2 【意见】这里数字不对，改成 42') &&
    !formatNoQuote.includes('文件：check-plugin-modules.mjs'),
  formatNoQuote,
);

// 块级批注（Office/PDF/图片）：只带区域 label，不出现 L0-0，也不带【原文】
const blockPage = {
  id: 'b1',
  path: 'deck.pptx',
  fileSha1: null,
  from: 1,
  to: 1,
  quote: '第1页',
  text: '标题改小一点',
  status: 'open',
  createdAt: 0,
  block: { page: 1, label: '第1页' },
};
const blockSheet = {
  id: 'b2',
  path: 'sheet.xlsx',
  fileSha1: null,
  from: 1,
  to: 1,
  quote: '',
  text: '这里补个合计行',
  status: 'open',
  createdAt: 0,
  block: { page: 1, label: '工作表「数据」 A1:C6', sheet: '数据', range: 'A1:C6' },
};
const blockMessage = moduleExports.buildAnnotationMessage({
  relPath: 'deck.pptx',
  version: 1,
  annotations: [blockPage, blockSheet],
  includePath: true,
  includeQuote: true,
});
check(
  '块级批注用区域 label 代替行号',
  blockMessage.includes('1. 第1页 【意见】标题改小一点') &&
    blockMessage.includes('2. 工作表「数据」 A1:C6 【意见】这里补个合计行'),
  blockMessage,
);
check('块级批注不输出 L0-0 / L1-1', !blockMessage.includes('L0-0') && !blockMessage.includes('L1-1'), blockMessage);
check(
  '块级批注即使 includeQuote 也不输出【原文】',
  !blockMessage.includes('【原文】"第1页"') && !blockMessage.includes('【原文】"工作表'),
  blockMessage,
);
check(
  '块级批注保留文件路径/版本与要求段',
  blockMessage.includes('文件：deck.pptx（v1）') &&
    blockMessage.includes('共 2 条批注') &&
    blockMessage.includes('要求：只改批注涉及的内容'),
  blockMessage,
);

// xlsx DOM 表格：块批注一律不带【原文】，选中态也不改变消息格式
const sheetSelected = {
  ...blockSheet,
  id: 'b3',
  quote: '43',
  text: '这个数字改成 43',
  block: { page: 1, label: '工作表「数据」 B2', sheet: '数据', range: 'B2', selected: true },
};
const sheetSelectedMessage = moduleExports.buildAnnotationMessage({
  relPath: 'sheet.xlsx',
  version: 1,
  annotations: [sheetSelected],
  includePath: true,
  includeQuote: true,
});
check(
  '工作表选区批注也不带【原文】',
  sheetSelectedMessage.includes('1. 工作表「数据」 B2 【意见】这个数字改成 43') &&
    !sheetSelectedMessage.includes('【原文】'),
  sheetSelectedMessage,
);
const sheetWholeMessage = moduleExports.buildAnnotationMessage({
  relPath: 'sheet.xlsx',
  version: 1,
  annotations: [blockSheet],
  includePath: true,
  includeQuote: true,
});
check(
  '工作表整表批注不带【原文】',
  sheetWholeMessage.includes('1. 工作表「数据」 A1:C6 【意见】这里补个合计行') &&
    !sheetWholeMessage.includes('【原文】'),
  sheetWholeMessage,
);
const sheetEmptyQuote = {
  ...sheetSelected,
  id: 'b4',
  quote: '   ',
};
const sheetEmptyQuoteMessage = moduleExports.buildAnnotationMessage({
  relPath: 'sheet.xlsx',
  version: 1,
  annotations: [sheetEmptyQuote],
  includePath: true,
  includeQuote: true,
});
check(
  '工作表选区无摘录时回退为无【原文】',
  sheetEmptyQuoteMessage.includes('1. 工作表「数据」 B2 【意见】这个数字改成 43') &&
    !sheetEmptyQuoteMessage.includes('【原文】'),
  sheetEmptyQuoteMessage,
);

// S3 文字层批注（分页文档拖选文字）：第N页 + 【原文】 + 【意见】
const pageTextAnnotation = {
  id: 'p1',
  path: 'deck.pdf',
  fileSha1: null,
  from: 2,
  to: 2,
  quote: '目标数字：42',
  text: '改成 43',
  status: 'open',
  createdAt: 0,
  page: 2,
};
const pageTextMessage = moduleExports.buildAnnotationMessage({
  relPath: 'deck.pdf',
  version: 1,
  annotations: [pageTextAnnotation],
  includePath: true,
  includeQuote: true,
});
check(
  '文字层批注输出「第N页 【原文】+【意见】」',
  pageTextMessage.includes('1. 第2页 【原文】"目标数字：42"') && pageTextMessage.includes('【意见】改成 43'),
  pageTextMessage,
);
check('文字层批注不出现 L0-0 / L2-2', !pageTextMessage.includes('L0-0') && !pageTextMessage.includes('L2-2'), pageTextMessage);
const pageTextNoQuote = moduleExports.buildAnnotationMessage({
  relPath: 'deck.pdf',
  version: 1,
  annotations: [pageTextAnnotation],
  includePath: false,
  includeQuote: false,
});
check(
  '文字层批注不附带原文时保留页码与意见',
  pageTextNoQuote.includes('1. 第2页 【意见】改成 43') && !pageTextNoQuote.includes('【原文】'),
  pageTextNoQuote,
);

// 重启前加固：大表截断/加载全部、冻结窗格、统一错误码、加载骨架
check(
  'bundle 含大表截断条与加载全部二次确认',
  code.includes('dsh-fr-sheet-trunc') && code.includes('加载全部') && code.includes('确认加载'),
);
check('bundle 用 full=1 请求完整表格', code.includes('full: "1"'));
check(
  'bundle 含冻结窗格 sticky 与虚拟滚动占位',
  code.includes('dsh-fr-sheet-frozen') && code.includes('dsh-fr-sheet-spacer') && code.includes('dsh-fr-sheet-scroll'),
);
check(
  'bundle 表格分支用独立受高容器（preview-wrap-sheet）',
  code.includes('dsh-fr-preview-wrap-sheet'),
);
check(
  'bundle 统一三个 S2 错误码与非法实体码',
  ['ERR_ENCRYPTED_FILE', 'ERR_TOO_LARGE', 'ERR_CONVERT_TIMEOUT', 'BAD_XML_ENTITY'].every((item) =>
    code.includes(item),
  ),
);
check('bundle 含加载骨架与取消按钮', code.includes('dsh-fr-skeleton') && code.includes('取消'));

for (const name of ok) console.log(`  ok   ${name}`);
for (const name of failures) console.log(`  FAIL ${name}`);
if (failures.length) {
  console.error(`\nclient bundle 装载测试失败：${failures.length} 项`);
  process.exit(1);
}
console.log(`\nclient bundle 装载测试通过：${ok.length} 项`);
