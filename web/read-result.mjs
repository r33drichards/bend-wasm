// Read results from an isolated Chrome launched for this local test only.
// Usage: node web/read-result.mjs 9226 /kernel/
const port = process.argv[2] ?? '9226';
const pathname = process.argv[3] ?? '/kernel/';
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find(p => p.type === 'page' && new URL(p.url).pathname === pathname);
if (!page) throw new Error('Test page not found');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const answer = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Browser result timed out')), 35000);
  ws.onmessage = ({ data }) => { const msg = JSON.parse(data); if (msg.id === 1) { clearTimeout(timer); resolve(msg); } };
});
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
  expression: `new Promise((resolve) => { const start = Date.now(); const timer = setInterval(() => { const text = document.querySelector('#result')?.textContent; if (text && text !== 'Running…') { clearInterval(timer); resolve(text); } else if (Date.now() - start > 30000) { clearInterval(timer); resolve(JSON.stringify({status:'timeout', text})); } }, 100); })`,
  awaitPromise: true, returnByValue: true
}}));
try {
  const response = await answer;
  if (response.error || response.result?.exceptionDetails) throw new Error(JSON.stringify(response));
  const report = JSON.parse(response.result.result.value);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
} finally { ws.close(); }
