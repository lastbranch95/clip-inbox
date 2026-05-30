const DB_NAME = "clipInboxDb";
const STORE_NAME = "clips";

let db;
let currentFilter = "all";
let selectedClipId = null;
let selectedClipUrl = null;
let privateMode = false;
let currentSort = "desc";
let currentLabel = "all";

const DEFAULT_PRIVATE_PASSCODE = "0908";

window.addEventListener("load", async () => {
  db = await openDatabase();

  document.getElementById("privateModeOffButton")
    .addEventListener("click", turnOffPrivateMode);

  document.getElementById("pasteJsonButton")
    .addEventListener("click", importClipsFromPaste);

  document.getElementById("sortSelect").addEventListener("change", (event) => {
    currentSort = event.target.value;
    renderClips();
  });

  document.getElementById("labelSelect").addEventListener("change", (event) => {
    currentLabel = event.target.value;
    renderClips();
  });

  document.getElementById("saveButton").addEventListener("click", saveClip);
  document.getElementById("searchInput").addEventListener("input", renderClips);
  document.getElementById("exportButton").addEventListener("click", exportClips);
  document.getElementById("copyJsonButton").addEventListener("click", copyJsonToClipboard);
  document.getElementById("storageCheckButton").addEventListener("click", checkStorage);

  document.getElementById("importButton").addEventListener("click", () => {
    document.getElementById("importInput").click();
  });

  document.getElementById("importInput").addEventListener("change", importClips);
  document.getElementById("rediscoverButton").addEventListener("click", rediscoverRandomClip);
  document.getElementById("privateModeButton").addEventListener("click", togglePrivateMode);
  document.getElementById("changePasscodeButton").addEventListener("click", changePrivatePasscode);

  document.getElementById("settingsButton").addEventListener("click", () => {
    document.getElementById("settingsPanel").classList.remove("hidden");
  });

  document.getElementById("closeSettingsButton").addEventListener("click", () => {
    document.getElementById("settingsPanel").classList.add("hidden");
  });

  document.getElementById("searchToggleButton").addEventListener("click", () => {
    document.getElementById("searchPanel").classList.toggle("hidden");
  });

  document.getElementById("addToggleButton").addEventListener("click", () => {
    document.getElementById("addPanel").classList.remove("hidden");
  });

  document.getElementById("closeAddButton").addEventListener("click", () => {
    document.getElementById("addPanel").classList.add("hidden");
  });

  document.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.filter;

      document.querySelectorAll(".filter-button").forEach((btn) => {
        btn.classList.remove("active");
      });

      button.classList.add("active");
      renderClips();
    });
  });

  await renderTagOptions();
  await renderClips();
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true
        });

        store.createIndex("createdAt", "createdAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function addClip(clip) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(clip);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getAllClips() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getClipById(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function updateClip(clip) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(clip);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function saveClip() {
  const url = document.getElementById("urlInput").value.trim();
  const reason = document.getElementById("reasonInput").value.trim();
  const tags = normalizeTags(document.getElementById("tagInput").value);
  const isPrivate = document.getElementById("privateInput").checked;

  if (!url) {
    alert("URLを入力して");
    return;
  }

  const allClips = await getAllClips();
  const exists = allClips.some((clip) => clip.url === url);

  if (exists) {
    alert("すでに保存済みです");
    return;
  }

  const title = await fetchTitle(url);

  const clip = {
    url,
    title,
    thumbnailUrl: createThumbnailUrl(url),
    reason,
    tags,
    status: reason ? "整理済み" : "未整理",
    isPrivate,
    watchStatus: "あとで見る",
    watchCount: 0,
    lastWatchedAt: null,
    watchDueType: "none",
    watchDueAt: null,
    createdAt: new Date().toISOString()
  };

  await addClip(clip);

  document.getElementById("urlInput").value = "";
  document.getElementById("reasonInput").value = "";
  document.getElementById("tagInput").value = "";
  document.getElementById("privateInput").checked = false;
  document.getElementById("addPanel").classList.add("hidden");

  await renderTagOptions();
  await renderClips();
}

async function renderClips() {
  const listElement = document.getElementById("clipList");
  const keyword = document.getElementById("searchInput").value.trim().toLowerCase();

  document.getElementById("privateModeLabel").classList.toggle("hidden", !privateMode);
  document.getElementById("privateFilterButton").classList.toggle("hidden", !privateMode);

  let clips = await getAllClips();

  renderTodayPick(clips);

  if (!privateMode) {
    clips = clips.filter((clip) => !clip.isPrivate);
  }

  const totalCount = clips.length;
  const unorganizedCount = clips.filter((clip) => clip.status === "未整理").length;

  clips.sort((a, b) => {
    if (currentSort === "asc") {
      return new Date(a.createdAt) - new Date(b.createdAt);
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  if (currentFilter === "unorganized") {
    clips = clips.filter((clip) => clip.status === "未整理");
  }

  if (currentFilter === "stale") {
    clips = clips.filter((clip) => isStaleClip(clip));
  }

  if (currentFilter === "watched") {
    clips = clips.filter((clip) => (clip.watchCount || 0) > 0);
  }

  if (currentFilter === "expired") {
    const now = new Date();

    clips = clips.filter((clip) => {
      if (!clip.watchDueAt) return false;
      return new Date(clip.watchDueAt) < now;
    });
  }

  if (currentFilter === "private") {
    clips = clips.filter((clip) => clip.isPrivate);
  }

  if (currentLabel !== "all") {
    clips = clips.filter((clip) => getTagArray(clip.tags).includes(currentLabel));
  }

  if (keyword) {
    clips = clips.filter((clip) => {
      return (
        (clip.url || "").toLowerCase().includes(keyword) ||
        (clip.title || "").toLowerCase().includes(keyword) ||
        (clip.reason || "").toLowerCase().includes(keyword) ||
        (clip.tags || "").toLowerCase().includes(keyword) ||
        (clip.watchStatus || "").toLowerCase().includes(keyword)
      );
    });
  }

  document.getElementById("countText").textContent =
    `未整理 ${unorganizedCount} / 全部 ${totalCount}`;

  listElement.innerHTML = "";

  clips.forEach((clip) => {
    const card = document.createElement("article");
    card.className = "clip-card";

    card.innerHTML = `
      <a href="${escapeHtml(clip.url)}" target="_blank" rel="noopener noreferrer" onclick="countOnly(${clip.id})">
        <img class="thumbnail" src="${clip.thumbnailUrl}" alt="thumbnail">
      </a>

      <div class="clip-body">
        <div class="clip-main-row">
          <div>
            <div class="clip-title">
              ${escapeHtml(clip.title)}
              ${clip.isPrivate && privateMode ? '<span class="private-badge">非表示</span>' : ""}
            </div>

            <div class="clip-meta">
              ${escapeHtml(getSiteName(clip.url))}・${formatDate(clip.createdAt)}・${escapeHtml(clip.status)}
              <br>
              視聴 ${clip.watchCount || 0}回・${formatLastWatched(clip.lastWatchedAt)}・${escapeHtml(clip.watchStatus || "あとで見る")}
            </div>
          </div>

          <button class="menu-button" onclick="openActionSheet(${clip.id}, '${escapeForOnclick(clip.url)}')">
            <i class="bi bi-three-dots-vertical"></i>
          </button>
        </div>

        ${
          clip.reason
            ? ""
            : `<div class="clip-reason missing-reason">⚠ 理由未入力</div>`
        }
      </div>
    `;

    listElement.appendChild(card);
  });
}

function normalizeTags(text) {
  return (text || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "")
    .join(", ");
}

function getTagArray(text) {
  return (text || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

async function renderTagOptions() {
  const select = document.getElementById("labelSelect");
  const currentValue = select.value || "all";

  const clips = await getAllClips();
  const tagSet = new Set();

  clips.forEach((clip) => {
    getTagArray(clip.tags).forEach((tag) => tagSet.add(tag));
  });

  select.innerHTML = `<option value="all">すべてのタグ</option>`;

  [...tagSet].sort().forEach((tag) => {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    select.appendChild(option);
  });

  select.value = tagSet.has(currentValue) ? currentValue : "all";
  currentLabel = select.value;
}

function openAndCount(id, url) {
  countOnly(id);
  window.open(url, "_blank");
}

async function countOnly(id) {
  const clip = await getClipById(id);

  clip.watchCount = (clip.watchCount || 0) + 1;
  clip.lastWatchedAt = new Date().toISOString();
  clip.watchStatus = "視聴済み";

  await updateClip(clip);
}

async function markWatched(id) {
  await countOnly(id);
  await renderClips();
}

async function setWatchDue(id) {
  const clip = await getClipById(id);

  const choice = prompt(
    "見る期限を入力：today / 3days / week / month / none",
    clip.watchDueType || "none"
  );

  if (choice === null) return;

  const now = new Date();
  let dueAt = null;
  let label = "あとで見る";

  if (choice === "today") {
    dueAt = now;
    label = "今日見る";
  } else if (choice === "3days") {
    dueAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    label = "3日以内";
  } else if (choice === "week") {
    dueAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    label = "今週中";
  } else if (choice === "month") {
    dueAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    label = "今月中";
  } else {
    label = "あとで見る";
  }

  clip.watchDueType = choice;
  clip.watchDueAt = dueAt ? dueAt.toISOString() : null;
  clip.watchStatus = label;

  await updateClip(clip);
  await renderClips();
}

async function editClip(id) {
  const clip = await getClipById(id);

  const newReason = prompt(
    "保存理由を編集します。空欄なら未整理になります。",
    clip.reason || ""
  );

  if (newReason === null) return;

  const newTags = prompt(
    "タグを編集します。複数ならカンマ区切り。例：音楽, 創作, 勉強",
    clip.tags || ""
  );

  if (newTags === null) return;

  clip.reason = newReason;
  clip.tags = normalizeTags(newTags);
  clip.status = newReason.trim() === "" ? "未整理" : "整理済み";

  await updateClip(clip);
  await renderTagOptions();
  await renderClips();
}

function deleteClip(id) {
  const ok = confirm("削除する？");

  if (!ok) return;

  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);

  store.delete(id);
  transaction.oncomplete = async () => {
    await renderTagOptions();
    await renderClips();
  };
}

function createThumbnailUrl(url) {
  const youtubeId = extractYouTubeId(url);

  if (youtubeId) {
    return `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
  }

  return "https://placehold.co/800x450?text=No+Thumbnail";
}

function extractYouTubeId(url) {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.hostname.includes("youtube.com")) {
      return parsedUrl.searchParams.get("v");
    }

    if (parsedUrl.hostname.includes("youtu.be")) {
      return parsedUrl.pathname.replace("/", "");
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchTitle(url) {
  try {
    const youtubeId = extractYouTubeId(url);

    if (youtubeId) {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
      );

      const data = await response.json();
      return data.title || "YouTube動画";
    }

    return createTitleFromUrl(url);
  } catch (error) {
    console.error(error);
    return createTitleFromUrl(url);
  }
}

function createTitleFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname;
  } catch {
    return url;
  }
}

function getSiteName(url) {
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname;

    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      return "YouTube";
    }

    if (host.includes("x.com") || host.includes("twitter.com")) {
      return "X";
    }

    if (host.includes("amazon")) {
      return "Amazon";
    }

    if (host.includes("note.com")) {
      return "note";
    }

    if (host.includes("qiita.com")) {
      return "Qiita";
    }

    return host.replace("www.", "");
  } catch {
    return "Web";
  }
}

function createImportedClip(clip) {
  return {
    url: clip.url || "",
    title: clip.title || createTitleFromUrl(clip.url || ""),
    thumbnailUrl: clip.thumbnailUrl || createThumbnailUrl(clip.url || ""),
    reason: clip.reason || "",
    tags: normalizeTags(clip.tags || ""),
    status: clip.status || "未整理",
    isPrivate: clip.isPrivate || false,
    watchStatus: clip.watchStatus || "あとで見る",
    watchCount: clip.watchCount || 0,
    lastWatchedAt: clip.lastWatchedAt || null,
    watchDueType: clip.watchDueType || "none",
    watchDueAt: clip.watchDueAt || null,
    createdAt: clip.createdAt || new Date().toISOString()
  };
}

async function importClipArray(clips, completeMessage) {
  if (!Array.isArray(clips)) {
    alert("JSON形式が違います。配列形式のJSONを読み込んでください。");
    return;
  }

  const ok = confirm(`${clips.length}件を読み込みます。追加保存でいい？`);

  if (!ok) return;

  for (const clip of clips) {
    await addClip(createImportedClip(clip));
  }

  await renderTagOptions();
  await renderClips();

  alert(completeMessage);
}

async function exportClips() {
  const clips = await getAllClips();
  const json = JSON.stringify(clips, null, 2);

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `clip-inbox-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

async function copyJsonToClipboard() {
  const clips = await getAllClips();
  const json = JSON.stringify(clips, null, 2);

  try {
    await navigator.clipboard.writeText(json);
    alert("JSONをコピーしました");
  } catch {
    prompt("コピーできない場合は手動でコピー", json);
  }
}

async function importClips(event) {
  const file = event.target.files[0];

  if (!file) return;

  let clips;

  try {
    const text = await file.text();
    clips = JSON.parse(text);
  } catch {
    alert("JSONとして読み込めません");
    return;
  }

  await importClipArray(clips, "読み込み完了");

  event.target.value = "";
}

async function importClipsFromPaste() {
  const text = prompt("JSONを貼り付け");

  if (!text) return;

  let clips;

  try {
    clips = JSON.parse(text);
  } catch {
    alert("JSONとして読み込めません");
    return;
  }

  await importClipArray(clips, "貼り付け読み込み完了");
}

async function checkStorage() {
  if (!navigator.storage || !navigator.storage.estimate) {
    document.getElementById("storageText").textContent =
      "このブラウザでは容量チェックに対応していません";
    return;
  }

  const estimate = await navigator.storage.estimate();

  const usageMB = estimate.usage
    ? (estimate.usage / 1024 / 1024).toFixed(2)
    : "不明";

  const quotaMB = estimate.quota
    ? (estimate.quota / 1024 / 1024).toFixed(2)
    : "不明";

  const percent =
    estimate.usage && estimate.quota
      ? ((estimate.usage / estimate.quota) * 100).toFixed(2)
      : "不明";

  document.getElementById("storageText").textContent =
    `使用量：${usageMB}MB / 上限目安：${quotaMB}MB / 使用率：${percent}%`;
}

function getPrivatePasscode() {
  return localStorage.getItem("privatePasscode") || DEFAULT_PRIVATE_PASSCODE;
}

function changePrivatePasscode() {
  const current = prompt("現在のパスコードを入力");

  if (current === null) return;

  if (current !== getPrivatePasscode()) {
    alert("現在のパスコードが違います");
    return;
  }

  const next = prompt("新しいパスコードを入力");

  if (!next) {
    alert("新しいパスコードが空です");
    return;
  }

  const confirmNext = prompt("確認のためもう一度入力");

  if (next !== confirmNext) {
    alert("新しいパスコードが一致しません");
    return;
  }

  localStorage.setItem("privatePasscode", next);
  alert("パスコードを変更しました");
}

function togglePrivateMode() {
  if (privateMode) {
    turnOffPrivateMode();
    return;
  }

  const input = prompt("パスコードを入力");

  if (input === getPrivatePasscode()) {
    privateMode = true;
    document.getElementById("privateModeButton").textContent =
      "非表示クリップを隠す";
    renderClips();
  } else {
    alert("パスコードが違います");
  }
}

function turnOffPrivateMode() {
  privateMode = false;
  currentFilter = "all";

  document.getElementById("privateModeButton").textContent =
    "非表示クリップを表示";

  document.querySelectorAll(".filter-button").forEach((btn) => {
    btn.classList.remove("active");
  });

  document.querySelector('[data-filter="all"]').classList.add("active");

  renderClips();
}

async function actionTogglePrivate() {
  if (selectedClipId === null) return;

  const id = selectedClipId;
  closeActionSheet();

  const clip = await getClipById(id);
  clip.isPrivate = !clip.isPrivate;

  await updateClip(clip);
  await renderClips();
}

function isStaleClip(clip) {
  if ((clip.watchCount || 0) > 0) {
    return false;
  }

  const createdAt = new Date(clip.createdAt);
  const now = new Date();
  const diffDays = (now - createdAt) / (1000 * 60 * 60 * 24);

  return diffDays >= 7;
}

function pickRediscoveryClip(clips) {
  const visibleClips = privateMode
    ? clips
    : clips.filter((clip) => !clip.isPrivate);

  const candidates = visibleClips.filter((clip) => {
    return (
      (clip.watchCount || 0) === 0 &&
      clip.reason &&
      getDaysSince(clip.createdAt) >= 3
    );
  });

  const pool =
    candidates.length > 0
      ? candidates
      : visibleClips.filter((clip) => (clip.watchCount || 0) === 0);

  if (pool.length === 0) {
    return null;
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

async function renderTodayPick(allClips) {
  const section = document.getElementById("todayPickSection");
  const clip = pickRediscoveryClip(allClips);

  if (!clip) {
    section.classList.add("hidden");
    section.innerHTML = "";
    return;
  }

  section.classList.remove("hidden");
  section.innerHTML = `
    <div class="today-pick-label">今日の1本</div>

    <a href="${escapeHtml(clip.url)}" target="_blank" rel="noopener noreferrer" onclick="countOnly(${clip.id})">
      <img class="thumbnail" src="${clip.thumbnailUrl}" alt="thumbnail">
    </a>

    <div class="today-pick-title">${escapeHtml(clip.title)}</div>

    <div class="today-pick-reason">
      ${escapeHtml(clip.reason || "理由未入力")}
      ・保存から${getDaysSince(clip.createdAt)}日
    </div>
  `;
}

async function rediscoverRandomClip() {
  const clips = await getAllClips();
  const clip = pickRediscoveryClip(clips);

  if (!clip) {
    alert("掘り返せるクリップがまだありません");
    return;
  }

  openActionSheet(clip.id, clip.url);
}

function openActionSheet(id, url) {
  selectedClipId = id;
  selectedClipUrl = url;
  document.getElementById("actionSheet").classList.remove("hidden");
}

function closeActionSheet() {
  selectedClipId = null;
  selectedClipUrl = null;
  document.getElementById("actionSheet").classList.add("hidden");
}

function actionOpenClip() {
  if (selectedClipId === null || !selectedClipUrl) {
    return;
  }

  const id = selectedClipId;
  const url = selectedClipUrl;

  closeActionSheet();

  countOnly(id);
  window.open(url, "_blank");
}

async function actionMarkWatched() {
  if (selectedClipId === null) return;

  const id = selectedClipId;
  closeActionSheet();
  await markWatched(id);
}

async function actionSetWatchDue() {
  if (selectedClipId === null) return;

  const id = selectedClipId;
  closeActionSheet();
  await setWatchDue(id);
}

async function actionEditClip() {
  if (selectedClipId === null) return;

  const id = selectedClipId;
  closeActionSheet();
  await editClip(id);
}

async function actionDeleteClip() {
  if (selectedClipId === null) return;

  const id = selectedClipId;
  closeActionSheet();
  deleteClip(id);
}

async function actionShowDetail() {
  if (selectedClipId === null) return;

  const clip = await getClipById(selectedClipId);

  alert(
    `タイトル
${clip.title}

理由
${clip.reason || "なし"}

タグ
${clip.tags || "なし"}

視聴回数
${clip.watchCount || 0}

保存日
${formatDate(clip.createdAt)}

URL
${clip.url}`
  );
}

function getDaysSince(isoString) {
  const date = new Date(isoString);
  const now = new Date();

  return Math.floor((now - date) / (1000 * 60 * 60 * 24));
}

function formatDate(isoString) {
  const date = new Date(isoString);

  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatLastWatched(isoString) {
  if (!isoString) {
    return "未視聴";
  }

  return `最終 ${formatDate(isoString)}`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeForOnclick(text) {
  return String(text).replaceAll("'", "\\'");
}
