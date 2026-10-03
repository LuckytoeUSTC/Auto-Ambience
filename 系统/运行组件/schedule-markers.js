const markerLayer = document.getElementById('marker-layer');
const markerAdd = document.getElementById('marker-add');
const markerTrash = document.getElementById('marker-trash');
const PAWN_W = 32;
const PAWN_H = 32;
const PAWN_ANCHOR_Y = 860 / 1069;
const NUDGE_STEP = 4;
const NUDGE_BTN = 22;
const NUDGE_EDGE = 16;
let scheduleMarkers = [];
let selectedMarkerId = null;
let saveQueue = Promise.resolve();
let lastPawnClickId = null;
let lastPawnClickTime = 0;

function bottomReservedHeight() {
  const desktop = document.querySelector('.desktop');
  return desktop ? (parseFloat(getComputedStyle(desktop).paddingBottom) || 0) : 0;
}
function boundedAnchor(x, y) {
  const centerOffset = PAWN_H * (PAWN_ANCHOR_Y - 0.5);
  const usableBottom = Math.max(0, window.innerHeight - bottomReservedHeight());
  return {
    x: Math.min(window.innerWidth, Math.max(0, x)),
    y: Math.min(usableBottom + centerOffset, Math.max(centerOffset, y))
  };
}
function relativePoint(x, y) {
  const point = boundedAnchor(x, y);
  return {u: point.x / window.innerWidth, v: point.y / window.innerHeight};
}
function markerPoint(marker) {
  return boundedAnchor(marker.u * window.innerWidth, marker.v * window.innerHeight);
}
function setPawnPosition(pawn, x, y) {
  pawn.style.left = (x - PAWN_W / 2) + 'px';
  pawn.style.top = (y - PAWN_H * PAWN_ANCHOR_Y) + 'px';
}
function saveMarker(input) {
  const task = saveQueue.then(async () => {
    const response = await fetch('/_markers', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(input)
    });
    if (!response.ok) throw new Error(await response.text());
    scheduleMarkers = await response.json();
    drawMarkers();
  });
  saveQueue = task.catch(() => {});
  return task;
}
function selectedMarker() {
  return scheduleMarkers.find(marker => marker.id === selectedMarkerId);
}
function selectMarker(id) {
  selectedMarkerId = id;
  drawMarkers();
}
function clearSelection() {
  selectedMarkerId = null;
  drawMarkers();
}
function createNudgeButton(dx, dy, cx, cy, d, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pawn-nudge';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.style.left = (cx - NUDGE_BTN / 2) + 'px';
  btn.style.top = (cy - NUDGE_BTN / 2) + 'px';
  btn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="' + d + '"/></svg>';
  btn.addEventListener('click', event => {
    event.stopPropagation();
    moveSelected(dx, dy);
  });
  markerLayer.append(btn);
}
function drawNudgeControls(marker) {
  const point = markerPoint(marker);
  const x = point.x;
  const y = point.y;
  const left = x - PAWN_W / 2;
  const top = y - PAWN_H * PAWN_ANCHOR_Y;
  const right = left + PAWN_W;
  const bottom = top + PAWN_H;
  const cy = top + PAWN_H / 2;
  createNudgeButton(0, -NUDGE_STEP, x, top - NUDGE_EDGE, 'M4 11 L8 6 L12 11', '向上移动');
  createNudgeButton(0, NUDGE_STEP, x, bottom + NUDGE_EDGE, 'M4 6 L8 11 L12 6', '向下移动');
  createNudgeButton(-NUDGE_STEP, 0, left - NUDGE_EDGE, cy, 'M11 4 L6 8 L11 12', '向左移动');
  createNudgeButton(NUDGE_STEP, 0, right + NUDGE_EDGE, cy, 'M6 4 L11 8 L6 12', '向右移动');
}
function drawMarkers() {
  markerLayer.replaceChildren();
  for (const marker of scheduleMarkers) {
    const pawn = document.createElement('button');
    pawn.type = 'button';
    pawn.className = 'pawn-marker';
    if (marker.id === selectedMarkerId) pawn.classList.add('selected');
    pawn.setAttribute('aria-label', '棋子');
    pawn.title = '单击选中；双击取消选中；箭头微调；单击桌面任意处定位；垃圾桶删除';
    const image = document.createElement('img');
    image.src = '/_pawn';
    image.alt = '';
    image.draggable = false;
    pawn.append(image);
    const point = markerPoint(marker);
    setPawnPosition(pawn, point.x, point.y);
    pawn.addEventListener('click', event => {
      event.stopPropagation();
      const now = Date.now();
      if (lastPawnClickId === marker.id && now - lastPawnClickTime < 500) {
        lastPawnClickId = null;
        lastPawnClickTime = 0;
        clearSelection();
      } else {
        lastPawnClickId = marker.id;
        lastPawnClickTime = now;
        selectMarker(marker.id);
      }
    });
    markerLayer.append(pawn);
    if (marker.id === selectedMarkerId) {
      drawNudgeControls(marker);
    }
  }
}
function addBesideTool() {
  const addBox = markerAdd.getBoundingClientRect();
  const toolbarBox = markerAdd.closest('.marker-controls').getBoundingClientRect();
  const x = Math.min(window.innerWidth - PAWN_W / 2, addBox.right + PAWN_W / 2 + 8);
  const y = toolbarBox.top + toolbarBox.height / 2 + PAWN_H * (PAWN_ANCHOR_Y - 0.5);
  const point = relativePoint(x, y);
  saveMarker({op: 'add', ...point})
    .then(() => {
      const added = scheduleMarkers[scheduleMarkers.length - 1];
      if (added) {
        selectedMarkerId = added.id;
        drawMarkers();
      }
    })
    .catch(error => console.error('添加棋子失败', error));
}
function deleteSelected() {
  if (!selectedMarkerId) return;
  const id = selectedMarkerId;
  selectedMarkerId = null;
  saveMarker({op: 'delete', id}).catch(error => {
    console.error('删除棋子失败', error);
    drawMarkers();
  });
}
function moveSelected(dx, dy) {
  const marker = selectedMarker();
  if (!marker) return;
  const current = markerPoint(marker);
  const {u, v} = relativePoint(current.x + dx, current.y + dy);
  marker.u = u;
  marker.v = v;
  drawMarkers();
  saveMarker({op: 'move', id: marker.id, u, v}).catch(error => {
    console.error('移动棋子失败', error);
    drawMarkers();
  });
}
markerAdd.addEventListener('click', event => {
  event.stopPropagation();
  addBesideTool();
});
markerTrash.addEventListener('click', event => {
  event.stopPropagation();
  deleteSelected();
});
document.addEventListener('click', event => {
  if (!selectedMarkerId) return;
  if (event.target.closest('button')) return;
  const id = selectedMarkerId;
  selectedMarkerId = null;
  saveMarker({op: 'move', id, ...relativePoint(event.clientX, event.clientY)})
    .catch(error => { console.error('放置棋子失败', error); drawMarkers(); });
});
window.addEventListener('resize', drawMarkers);
fetch('/_markers', {cache: 'no-store'})
  .then(response => { if (!response.ok) throw new Error(response.status); return response.json(); })
  .then(markers => { scheduleMarkers = markers; drawMarkers(); })
  .catch(error => console.error('读取棋子失败', error));
