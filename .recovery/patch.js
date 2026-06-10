const fs = require('fs');
const path = require('path');
const pagePath = path.join(__dirname, 'ChatModelPage.jsx');
const snippetPath = path.join(__dirname, '_chatmodel_active_layout_snippet.jsx');
const snippet = fs.readFileSync(snippetPath, 'utf8');
let s = fs.readFileSync(pagePath, 'utf8');
const start = s.indexOf('        <div className="flex h-full min-h-0 w-full overflow-hidden bg-white">');
const exportIdx = s.indexOf('\nexport default ChatModelPage');
const fragmentEnd = s.lastIndexOf('        </>', exportIdx);
if (start === -1 || fragmentEnd === -1) {
  console.error('markers not found', { start, fragmentEnd });
  process.exit(1);
}
s = s.slice(0, start) + snippet.trimEnd() + '\n';
fs.writeFileSync(pagePath, s);
console.log('OK');
