const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.AUTOAMBIENCE_PORT || 18765);
const WANT_NOTE = '想做的事.txt';
const PRESENCE_STATE_NOTE = '状态标签.md';
const CURRENT_TASK_NOTE = '现在做.txt';
const RESEARCH_NOTE = '工作规划.md';
const MANUAL_CONFIG = '手动配置.json';
const MARKERS_FILE = path.join(__dirname, '时间表棋子位置.json');
const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i;

function manualConfig() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, MANUAL_CONFIG), 'utf8'));
}

function visibleLines(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => {
    const visible = line.replace(/%%.*?%%|<!--.*?-->/g, '').trimEnd();
    if (visible.includes('%%') || visible.includes('<!--')) {
      throw new Error(`未闭合的行内注释：${path.relative(ROOT, file)}`);
    }
    return visible;
  }).filter(line => line.trim());
}

function stateData(){
  const file=path.join(ROOT,PRESENCE_STATE_NOTE),raw=fs.readFileSync(file,'utf8'),newline=raw.includes('\r\n')?'\r\n':'\n',lines=raw.split(/\r?\n/),items=[];
  lines.forEach((line,lineIndex)=>{
    if(!line.trim() || /^\s*-\s+\[[ xX]\]\s*$/.test(line))return;
    const match=/^(\s*-\s+\[)([ xX])(\]\s+)(.*)$/.exec(line);
    if(!match)throw Error('状态标签每行须写为 - [x] 词语 或 - [ ] 词语');
    const label=match[4].replace(/%%.*?%%|<!--.*?-->/g,'').trim();
    if(label.includes('%%')||label.includes('<!--'))throw Error('状态标签包含未闭合注释');
    items.push({index:items.length,lineIndex,label,selected:match[2].toLowerCase()==='x'});
  });
  return {file,lines,newline,items};
}
function sendState(res){
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(stateData().items.map(({index,label,selected})=>({index,label,selected}))));
}
async function updateState(req,res){
  try{
    if(req.headers.origin&&req.headers.origin!=='http://'+HOST+':'+PORT){res.writeHead(403);return res.end('Forbidden')}
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw Error('请求过长')}
    const input=JSON.parse(raw),state=stateData(),item=state.items[input.index];
    if(!item||item.label!==input.label||typeof input.selected!=='boolean'){res.writeHead(409);return res.end('状态词已变化，请重开菜单')}
    const match=/^(\s*-\s+\[)([ xX])(\]\s+)(.*)$/.exec(state.lines[item.lineIndex]);
    state.lines[item.lineIndex]=match[1]+(input.selected?'x':' ')+match[3]+match[4];
    fs.writeFileSync(state.file,state.lines.join(state.newline),'utf8');sendState(res);
  }catch(error){console.error(error);if(!res.headersSent)res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end(error.message)}
}
function markerData() {
  const data = JSON.parse(fs.readFileSync(MARKERS_FILE, 'utf8'));
  if (!data || !Array.isArray(data.markers)) throw new Error('时间表棋子位置.json 格式无效');
  return data.markers;
}
function sendMarkers(res, markers) {
  res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(markers));
}
async function updateMarkers(req, res) {
  try {
    if (req.headers.origin && req.headers.origin !== 'http://' + HOST + ':' + PORT) {
      res.writeHead(403); return res.end('Forbidden');
    }
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) throw new Error('请求过长');
    }
    const input = JSON.parse(raw);
    const markers = markerData();
    const validCoordinate = value => Number.isFinite(value) && value >= -3 && value <= 3;
    if (input.op === 'add') {
      if (markers.length >= 60 || !validCoordinate(input.u) || !validCoordinate(input.v)) {
        throw new Error('棋子数量或位置无效');
      }
      markers.push({id:crypto.randomUUID(), u:input.u, v:input.v});
    } else if (input.op === 'move') {
      const marker = markers.find(item => item.id === input.id);
      if (!marker || !validCoordinate(input.u) || !validCoordinate(input.v)) {
        throw new Error('棋子或位置无效');
      }
      marker.u = input.u;
      marker.v = input.v;
    } else if (input.op === 'delete') {
      const index = markers.findIndex(item => item.id === input.id);
      if (index < 0) throw new Error('棋子不存在');
      markers.splice(index, 1);
    } else {
      throw new Error('未知棋子操作');
    }
    fs.writeFileSync(MARKERS_FILE, JSON.stringify({markers}, null, 2) + '\n', 'utf8');
    sendMarkers(res, markers);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(400, {'Content-Type':'text/plain; charset=utf-8'});
    res.end(error.message);
  }
}
function html(value) {
  return value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function deadlineFiles() {
  return fs.readdirSync(ROOT, {withFileTypes:true})
    .filter(item => item.isFile() && /^DDL-\d{4}-\d{2}\.md$/i.test(item.name))
    .map(item => item.name)
    .sort((a, b) => a.localeCompare(b, 'zh-CN', {numeric:true}));
}
function deadlineDate(raw, monthFile) {
  let year, month, day;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    [, year, month, day] = match;
  } else {
    match = /^(\d{1,2})([\/-])(\d{1,2})(?:\2(\d{4}))?$/.exec(raw);
    if (!match) throw new Error(`DDL 日期格式无效：${raw}`);
    month = match[1];
    day = match[3];
    year = match[4] || monthFile.slice(0, 4);
  }
  const y = Number(year), m = Number(month), d = Number(day);
  const valid = m >= 1 && m <= 12 && d >= 1 && d <= 31 &&
    new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) ===
      `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const normalized = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!valid || normalized.slice(0, 7) !== monthFile.slice(0, 7)) {
    throw new Error(`DDL 日期与月文件不符或不存在：${monthFile} / ${raw}`);
  }
  return normalized;
}
function localDay() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return {
    key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    ordinal: Math.floor(Date.UTC(year, month - 1, day) / 86400000),
  };
}

function backgroundWallpaper() {
  const sourceValue = manualConfig()['背景壁纸来源'];
  if (typeof sourceValue !== 'string' || !sourceValue.trim()) {
    throw new Error('手动配置.json 中的“背景壁纸来源”必须是图片文件或文件夹路径');
  }
  const source = path.resolve(ROOT, sourceValue);
  if (!fs.existsSync(source)) throw new Error('找不到背景壁纸来源：' + sourceValue);
  const sourceStat = fs.statSync(source);
  if (sourceStat.isFile()) {
    if (!IMAGE_FILE.test(source)) throw new Error('背景壁纸来源文件不是支持的图片：' + sourceValue);
    return {file:source, version:`file:${sourceStat.mtimeMs}:${sourceStat.size}`};
  }
  if (!sourceStat.isDirectory()) throw new Error('背景壁纸来源必须是图片文件或文件夹：' + sourceValue);
  const names = fs.readdirSync(source, {withFileTypes:true})
    .filter(item => item.isFile() && IMAGE_FILE.test(item.name))
    .map(item => item.name)
    .sort((a, b) => {
      const ah = crypto.createHash('sha256').update(a).digest('hex');
      const bh = crypto.createHash('sha256').update(b).digest('hex');
      return ah.localeCompare(bh);
    });
  if (!names.length) throw new Error('背景壁纸来源文件夹里没有可用图片：' + sourceValue);
  const day = localDay();
  const file = path.join(source, names[day.ordinal % names.length]);
  const fileStat = fs.statSync(file);
  return {file, version:`folder:${day.key}:${sourceStat.mtimeMs}:${names.join('|')}:${fileStat.mtimeMs}:${fileStat.size}`};
}
function selectedImage(configKey, folderName) {
  const name = manualConfig()[configKey];
  if (typeof name !== 'string' || !name || name !== path.basename(name) ||
      !IMAGE_FILE.test(name)) {
    throw new Error('手动配置.json 中的“' + configKey + '”必须是该文件夹中的图片文件名');
  }
  const folder = path.join(ROOT, folderName);
  const file = path.resolve(folder, name);
  if (!file.startsWith(folder + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error('找不到图片：' + folderName + '/' + name);
  }
  return file;
}
function revisionFiles() {
  return [
    path.join(__dirname, 'index.html'), path.join(__dirname, 'style.css'), path.join(__dirname, 'presence-state-selector.js'), path.join(__dirname, 'schedule-markers.js'), path.join(__dirname, 'yellow-pawn.png'), path.join(__dirname, 'WindowFocus.cs'), path.join(__dirname, 'note-opener.ps1'), path.join(__dirname, 'current-task-editor.ps1'),
    path.join(ROOT, WANT_NOTE), path.join(ROOT, PRESENCE_STATE_NOTE),
    path.join(ROOT, CURRENT_TASK_NOTE),
    path.join(ROOT, RESEARCH_NOTE), path.join(ROOT, MANUAL_CONFIG),
    selectedImage('左侧照片', '照片'), selectedImage('时间表照片', '时间表'),
    ROOT,
    ...deadlineFiles().map(name => path.join(ROOT, name)),
  ];
}
function revision() {
  const stamp = revisionFiles().map(file => {
    const stat = fs.statSync(file);
    return `${path.relative(ROOT, file)}:${stat.mtimeMs}:${stat.size}`;
  }).join('|');
  const background = backgroundWallpaper();
  return crypto.createHash('sha256').update(stamp + '|' + background.version).digest('hex').slice(0, 16);
}

function deadlineLinkFile() {
  const files = deadlineFiles();
  if (!files.length) throw new Error('没有可打开的 DDL 月文件');
  const current = 'DDL-' + localDay().key.slice(0, 7) + '.md';
  return files.find(name => name >= current) || files[files.length - 1];
}
function render() {
  let page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const currentDoing = visibleLines(path.join(ROOT, CURRENT_TASK_NOTE)).join('\n');
  const want = visibleLines(path.join(ROOT, WANT_NOTE)).join('\n');
  const state = stateData().items.filter(item=>item.selected).map(item=>item.label);
  const researchSections = [[]];
  for (const line of visibleLines(path.join(ROOT, RESEARCH_NOTE))) {
    if (/^-{3,}$/.test(line.trim())) {
      if (researchSections[researchSections.length - 1].length) researchSections.push([]);
    } else {
      researchSections[researchSections.length - 1].push(line);
    }
  }
  const research = researchSections.filter(lines => lines.length).map(lines =>
    '<div class="research-source"><pre class="md-lines">' +
    html(lines.join('\n')) + '</pre></div>'
  ).join('');  const deadlines = deadlineFiles().flatMap(name => {
    const month = name.slice(4, 11);
    const items = [];
    let current = null;
    for (const line of visibleLines(path.join(ROOT, name))) {
      const match = /^- \[([ xX])\] (\S+)\s+(.+)$/.exec(line);
      if (match) {
        current = {date:deadlineDate(match[2], month), title:match[3], content:[], done:match[1].toLowerCase() === 'x'};
        items.push(current);
      } else if (current) {
        current.content.push(line.trim());
      } else {
        throw new Error('DDL 条目应以“- [ ] 日期 事项”开头：' + name);
      }
    }
    return items.filter(item => !item.done).map(item => ({...item, content:item.content.join('\n')}));
  }).sort((a, b) => a.date.localeCompare(b.date)).map(item =>
    '<li><time datetime="' + item.date + '">' + item.date.slice(5).replace('-', '.') +
    '</time><div><strong>' + html(item.title) + '</strong><pre class="md-lines">' +
    html(item.content) + '</pre></div></li>'
  ).join('');
  page = page.replace('<!-- CURRENT -->', html(currentDoing))
    .replace('<!-- WANT -->', `<pre class="md-lines">${html(want)}</pre>`)
    .replace('<!-- STATE -->', state.map(word => `<span>${html(word)}</span>`).join(''))
    .replace('<!-- RESEARCH -->', research)
    .replace('<!-- DEADLINES -->', deadlines)
    .replace('__PHOTO_SRC__', '/_selected-photo')
    .replace('__SCHEDULE_SRC__', '/_selected-schedule')
    .replace('__BACKGROUND_SRC__', '/_background-wallpaper?version=' + encodeURIComponent(backgroundWallpaper().version));
  const current = JSON.stringify(revision());
  const live = `<script>const version=${current};setInterval(async()=>{try{const r=await fetch('/_version',{cache:'no-store'});if(r.ok&&(await r.text())!==version&&!window.autoAmbienceStateMenuOpen)location.reload()}catch{}},3000)</script>`;
  return page.replace('</body>', `${live}\n</body>`);
}

const MIME = {'.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const STATIC_FILES = new Map([
  ['/style.css', 'style.css'],
  ['/presence-state-selector.js', 'presence-state-selector.js'],
  ['/schedule-markers.js', 'schedule-markers.js'],
]);
let lastGoodPage = null;
let lastGoodVersion = null;
let lastRenderError = null;

function refreshRenderedPage() {
  try {
    const page = render();
    const version = revision();
    lastGoodPage = page;
    lastGoodVersion = version;
    if (lastRenderError) console.log('内容已恢复有效，发布新版本');
    lastRenderError = null;
    return true;
  } catch (error) {
    const message = String(error.message || error);
    if (message !== lastRenderError) {
      console.error('内容暂时无法解析，继续显示上一份有效桌面：' + message);
      lastRenderError = message;
    }
    return false;
  }
}

http.createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, `http://${HOST}:${PORT}`).pathname);
    res.setHeader('Cache-Control', 'no-store');
    if (pathname === '/_markers' && req.method === 'GET') return sendMarkers(res, markerData());
    if (pathname === '/_markers' && req.method === 'POST') return updateMarkers(req, res);
    if (pathname === '/_health') {
      res.setHeader('X-AutoAmbience', '1');
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      return res.end(JSON.stringify({app:'AutoAmbience', port:PORT}));
    }
    if (pathname === '/_pawn') {
      res.writeHead(200, {'Content-Type':'image/png'});
      return fs.createReadStream(path.join(__dirname, 'yellow-pawn.png')).pipe(res);
    }
    if (pathname === '/_state' && req.method === 'GET') return sendState(res);
    if (pathname === '/_state' && req.method === 'POST') return updateState(req,res);
    if (pathname === '/_version') {
      refreshRenderedPage();
      res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8'});
      return res.end(lastGoodVersion || 'waiting-for-valid-content');
    }
    if (pathname === '/') {
      refreshRenderedPage();
      if (!lastGoodPage) throw new Error(lastRenderError || '还没有可显示的有效内容');
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      return res.end(lastGoodPage);
    }
    if (pathname === '/_selected-photo' || pathname === '/_selected-schedule') {
      const file = pathname === '/_selected-photo' ?
        selectedImage('左侧照片', '照片') : selectedImage('时间表照片', '时间表');
      res.writeHead(200, {'Content-Type':MIME[path.extname(file).toLowerCase()]});
      return fs.createReadStream(file).pipe(res);
    }
    if (pathname === '/_background-wallpaper') {
      const background = backgroundWallpaper();
      res.writeHead(200, {'Content-Type':MIME[path.extname(background.file).toLowerCase()]});
      return fs.createReadStream(background.file).pipe(res);
    }
    if (pathname.startsWith('/_open-note/') && req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && origin !== 'http://' + HOST + ':' + PORT) {
        res.writeHead(403); return res.end('Forbidden');
      }
      const key = pathname.slice('/_open-note/'.length);
      const noteFiles = {
        doing: CURRENT_TASK_NOTE,
        want: WANT_NOTE,
        state: PRESENCE_STATE_NOTE,
        research: RESEARCH_NOTE,
      };
      const name = key === 'ddl' ? deadlineLinkFile() : noteFiles[key];
      if (!name) {
        res.writeHead(404); return res.end('Not found');
      }
      const file = path.join(ROOT, name);
      if (!fs.existsSync(file)) {
        res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
        return res.end('文件不存在：' + name);
      }
      const opener = key === 'doing' ? 'current-task-editor.ps1' : 'note-opener.ps1';
      const child = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
          '-WindowStyle', 'Hidden', '-File', path.join(__dirname, opener),
          '-TargetPath', file],
        {windowsHide:true, stdio:['ignore', 'ignore', 'pipe']});
      let errorText = '';
      child.stderr.on('data', chunk => { errorText += chunk; });
      child.once('error', error => {
        console.error('打开文件失败：' + name, error);
        if (!res.headersSent) res.writeHead(500, {'Content-Type':'text/plain; charset=utf-8'});
        res.end('无法启动默认编辑器：' + error.message);
      });
      child.once('close', code => {
        if (res.writableEnded) return;
        if (code !== 0) {
          console.error('打开文件失败：' + name, errorText);
          res.writeHead(500, {'Content-Type':'text/plain; charset=utf-8'});
          return res.end(errorText || '默认编辑器启动失败');
        }
        res.writeHead(204); res.end();
      });
      return;
    }
    const staticName = STATIC_FILES.get(pathname);
    if (staticName) {
      res.writeHead(200, {'Content-Type':MIME[path.extname(staticName).toLowerCase()]});
      return fs.createReadStream(path.join(__dirname, staticName)).pipe(res);
    }
    res.writeHead(404); return res.end('Not found');
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, {'Content-Type':'text/plain; charset=utf-8'});
    res.end(String(error.message));
  }
}).listen(PORT, HOST, () => console.log(`AutoAmbience: http://${HOST}:${PORT}/`));




















