// ==================================================
// Clip Inbox
// URLクリップをブラウザ内 IndexedDB に保存するアプリ。
// 役割：
// - IndexedDB：クリップデータの保存場所
// - app.js：保存、表示、検索、JSONバックアップ、Private表示などの処理を書く場所
// ==================================================

const DB_NAME = "clipInboxDb";
const STORE_NAME = "clips";

// ==================================================
// Supabase設定
// ==================================================
// Daily Coreと同じSupabaseプロジェクトのURLとPublishable/anon keyを入れる。
// 注意：service_role / secret key は絶対にここへ入れない。
const SUPABASE_URL = "https://hopbmcqdthszulqegqlq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_AWDBKP4edc2ToZUQJFi8wQ_3dCQ_b0k";
const SUPABASE_TABLE_NAME = "clip_items";

let db;
let supabaseClient = null;
let currentUser = null;
let currentFilter = "all";
let selectedClipId = null;
let selectedClipUrl = null;
let privateMode = false;
let currentSort = "desc";
let currentLabel = "all";
let lastRediscoveryClipId = null;

const DEFAULT_PRIVATE_PASSCODE = "0908";

// Supabaseが未設定の間は旧IndexedDBで動かす。設定後はログインしてクラウド保存に切り替わる。
function isSupabaseConfigured() {
  return (
    SUPABASE_URL &&
    SUPABASE_PUBLISHABLE_KEY &&
    !SUPABASE_URL.includes("YOUR_PROJECT_ID") &&
    !SUPABASE_PUBLISHABLE_KEY.includes("YOUR_SUPABASE") &&
    window.supabase
  );
}

function shouldUseSupabase() {
  return !!(supabaseClient && currentUser);
}

function initializeSupabaseClient() {
  if (!isSupabaseConfigured()) {
    return;
  }

  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );
}

function setSyncStatus(message) {
  const element = document.getElementById("syncStatusText");

  if (!element) {
    return;
  }

  element.textContent = message;
}

async function refreshAuthState() {
  if (!supabaseClient) {
    setSyncStatus("保存先：この端末のみ（Supabase未設定）");
    return;
  }

  const { data, error } = await supabaseClient.auth.getUser();

  if (error || !data?.user) {
    currentUser = null;
    setSyncStatus("保存先：Supabase / 未ログイン");
  } else {
    currentUser = data.user;
    setSyncStatus(`保存先：Supabase / ログイン中 ${currentUser.email || ""}`);
  }

  updateAuthPanel();
}

function updateAuthPanel() {
  const signedInOnlyIds = ["signOutButton", "importLocalToCloudButton"];
  const signedOutOnlyIds = ["signInButton"];

  signedInOnlyIds.forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.classList.toggle("hidden", !currentUser);
    }
  });

  signedOutOnlyIds.forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.classList.toggle("hidden", !!currentUser || !supabaseClient);
    }
  });
}

async function signInToSupabase() {
  if (!supabaseClient) {
    alert("Supabase設定がまだ入っていません。app.js の SUPABASE_URL と SUPABASE_PUBLISHABLE_KEY を設定してください。");
    return;
  }

  const email = document.getElementById("authEmailInput").value.trim();
  const password = document.getElementById("authPasswordInput").value;

  if (!email || !password) {
    alert("メールアドレスとパスワードを入力して");
    return;
  }

  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    alert(`ログイン失敗：${error.message}`);
    return;
  }

  document.getElementById("authPasswordInput").value = "";
  await refreshAuthState();
  await refreshApp();
}

async function signOutFromSupabase() {
  if (!supabaseClient) {
    return;
  }

  await supabaseClient.auth.signOut();
  currentUser = null;
  await refreshAuthState();
  await refreshApp();
}

// ==================================================
// 初期化：画面読み込み後にDBを開き、各ボタンへイベントを登録する
// ==================================================
window.addEventListener("load", async () => {
  db = await openDatabase();
  initializeSupabaseClient();
  await refreshAuthState();

  // 設定・JSONバックアップ関連
  on("privateModeOffButton", "click", turnOffPrivateMode);
  on("pasteJsonButton", "click", importClipsFromPaste);
  on("refreshButton", "click", refreshWithAnimation);
  on("resetAllButton", "click", resetAllData);
  on("signInButton", "click", signInToSupabase);
  on("signOutButton", "click", signOutFromSupabase);
  on("importLocalToCloudButton", "click", importLocalIndexedDbToSupabase);

  on("sortSelect", "change", (event) => {
    currentSort = event.target.value;
    renderClips();
  });

  on("labelSelect", "change", (event) => {
    currentLabel = event.target.value;
    renderClips();
  });

  on("saveButton", "click", saveClip);
  on("searchInput", "input", renderClips);
  on("exportButton", "click", exportClips);
  on("copyJsonButton", "click", copyJsonToClipboard);

  // JSON出力パネル関連
  // スマホで巨大JSONを prompt に出すと1行地獄になるため、
  // textarea表示・全選択・ファイル保存・共有を用意する。
  on("selectJsonButton", "click", selectJsonText);
  on("downloadJsonButton", "click", downloadJsonFromOutput);
  on("shareJsonButton", "click", shareJsonFile);
  on("closeJsonOutputButton", "click", () => {
    document.getElementById("jsonOutputPanel").classList.add("hidden");
  });

  on("storageCheckButton", "click", checkStorage);

  on("importButton", "click", () => {
    document.getElementById("importInput").click();
  });

  on("importInput", "change", importClips);
  on("rediscoverButton", "click", rediscoverRandomClip);
  on("privateModeButton", "click", togglePrivateMode);
  on("changePasscodeButton", "click", changePrivatePasscode);

  on("settingsButton", "click", () => {
    document.getElementById("settingsPanel").classList.remove("hidden");
  });

  on("closeSettingsButton", "click", () => {
    document.getElementById("settingsPanel").classList.add("hidden");
  });

  on("searchToggleButton", "click", () => {
    document.getElementById("searchPanel").classList.toggle("hidden");
  });

  on("addToggleButton", "click", () => {
    document.getElementById("addPanel").classList.remove("hidden");
  });

  on("closeAddButton", "click", () => {
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

  await refreshApp();
});

// ==================================================
// 共通ヘルパー：存在する要素にだけイベントを登録する
// ==================================================
function on(id, eventName, handler) {
  const element = document.getElementById(id);

  if (!element) {
    return;
  }

  element.addEventListener(eventName, handler);
}

async function refreshApp() {
  await renderTagOptions();
  await renderClips();
}

// 更新ボタン用：回転アニメーションを見せながら再描画する
async function refreshWithAnimation() {
  const refreshButton = document.getElementById("refreshButton");

  if (!refreshButton) {
    await refreshApp();
    return;
  }

  // 連打防止。更新中に何度押しても処理を増やさない。
  if (refreshButton.classList.contains("refreshing")) {
    return;
  }

  refreshButton.classList.add("refreshing");
  refreshButton.disabled = true;

  try {
    await refreshApp();

    // 更新が一瞬で終わると回転が見えないので、最低限だけ表示する。
    await wait(450);
  } finally {
    refreshButton.classList.remove("refreshing");
    refreshButton.disabled = false;
  }
}

// 指定ミリ秒だけ待つ
function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ==================================================
// 保存操作：Supabase設定済み＆ログイン済みならクラウド、未設定ならIndexedDB
// ==================================================
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

function addClipToIndexedDb(clip) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(clip);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getAllClipsFromIndexedDb() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getClipByIdFromIndexedDb(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(Number(id));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function updateClipInIndexedDb(clip) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(clip);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function hardDeleteClipFromIndexedDb(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(Number(id));

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function rowToClip(row) {
  return {
    id: row.id,
    url: row.url || "",
    title: row.title || createTitleFromUrl(row.url || ""),
    thumbnailUrl: row.thumbnail_url || createThumbnailUrl(row.url || ""),
    reason: row.reason || "",
    tags: row.tags || "",
    status: row.status || "未整理",
    isPrivate: !!row.is_private,
    isFavorite: !!row.is_favorite,
    isDeleted: !!row.deleted_at,
    deletedAt: row.deleted_at || null,
    watchStatus: row.watch_status || "あとで見る",
    watchCount: row.watch_count || 0,
    lastWatchedAt: row.last_watched_at || null,
    watchDueType: row.watch_due_type || "none",
    watchDueAt: row.watch_due_at || null,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || null
  };
}

function clipToRow(clip) {
  const row = {
    url: clip.url || "",
    duplicate_key: createDuplicateKey(clip.url || ""),
    title: clip.title || createTitleFromUrl(clip.url || ""),
    thumbnail_url: clip.thumbnailUrl || createThumbnailUrl(clip.url || ""),
    reason: clip.reason || "",
    tags: normalizeTags(clip.tags || ""),
    status: clip.status || "未整理",
    is_private: !!clip.isPrivate,
    is_favorite: !!clip.isFavorite,
    watch_status: clip.watchStatus || "あとで見る",
    watch_count: clip.watchCount || 0,
    last_watched_at: clip.lastWatchedAt || null,
    watch_due_type: clip.watchDueType || "none",
    watch_due_at: clip.watchDueAt || null,
    deleted_at: clip.isDeleted ? (clip.deletedAt || new Date().toISOString()) : null,
    updated_at: new Date().toISOString()
  };

  if (currentUser) {
    row.user_id = currentUser.id;
  }

  if (clip.createdAt) {
    row.created_at = clip.createdAt;
  }

  return row;
}

async function addClip(clip) {
  if (!shouldUseSupabase()) {
    return addClipToIndexedDb(clip);
  }

  const { error } = await supabaseClient
    .from(SUPABASE_TABLE_NAME)
    .insert(clipToRow(clip));

  if (error) {
    alert(`保存失敗：${error.message}`);
    throw error;
  }
}

async function getAllClips() {
  if (!shouldUseSupabase()) {
    return getAllClipsFromIndexedDb();
  }

  const { data, error } = await supabaseClient
    .from(SUPABASE_TABLE_NAME)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    alert(`取得失敗：${error.message}`);
    throw error;
  }

  return (data || []).map(rowToClip);
}

async function getClipById(id) {
  if (!shouldUseSupabase()) {
    return getClipByIdFromIndexedDb(id);
  }

  const { data, error } = await supabaseClient
    .from(SUPABASE_TABLE_NAME)
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    alert(`取得失敗：${error.message}`);
    throw error;
  }

  return rowToClip(data);
}

async function updateClip(clip) {
  if (!shouldUseSupabase()) {
    return updateClipInIndexedDb(clip);
  }

  const { error } = await supabaseClient
    .from(SUPABASE_TABLE_NAME)
    .update(clipToRow(clip))
    .eq("id", clip.id);

  if (error) {
    alert(`更新失敗：${error.message}`);
    throw error;
  }
}

async function hardDeleteClip(id) {
  if (!shouldUseSupabase()) {
    return hardDeleteClipFromIndexedDb(id);
  }

  const { error } = await supabaseClient
    .from(SUPABASE_TABLE_NAME)
    .delete()
    .eq("id", id);

  if (error) {
    alert(`完全削除失敗：${error.message}`);
    throw error;
  }
}

async function importLocalIndexedDbToSupabase() {
  if (!shouldUseSupabase()) {
    alert("Supabaseにログインしてから実行して");
    return;
  }

  const localClips = await getAllClipsFromIndexedDb();

  if (localClips.length === 0) {
    alert("この端末のIndexedDBに移行するクリップがありません");
    return;
  }

  const ok = confirm(`${localClips.length}件のローカルClipをSupabaseへ移行します。重複URLはスキップします。`);

  if (!ok) {
    return;
  }

  const cloudClips = await getAllClips();
  const existingKeys = new Set(cloudClips.map((clip) => createDuplicateKey(clip.url)));
  let importedCount = 0;
  let skippedCount = 0;

  for (const clip of localClips) {
    const duplicateKey = createDuplicateKey(clip.url);

    if (existingKeys.has(duplicateKey)) {
      skippedCount++;
      continue;
    }

    const normalized = createImportedClip(clip);
    await addClip(normalized);
    existingKeys.add(duplicateKey);
    importedCount++;
  }

  await refreshApp();
  alert(`移行完了\n追加：${importedCount}件\n重複スキップ：${skippedCount}件`);
}

// ==================================================
// 新規保存
// ==================================================
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

  // 同じURLが通常一覧にある場合は重複保存しない。
  // ゴミ箱にあるものは再保存できるように、!clip.isDeleted を条件にしている。
  const duplicateKey = createDuplicateKey(url);

  const exists = allClips.some((clip) => {
    return createDuplicateKey(clip.url) === duplicateKey && !clip.isDeleted;
  });

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
    isFavorite: false,
    isDeleted: false,
    deletedAt: null,
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

  await refreshApp();
}

// ==================================================
// 一覧表示・検索・フィルター・並び替え
// ==================================================
async function renderClips() {
  const listElement = document.getElementById("clipList");
  const keyword = document.getElementById("searchInput").value.trim().toLowerCase();

  document.getElementById("privateModeLabel").classList.toggle("hidden", !privateMode);
  document.getElementById("privateFilterButton").classList.toggle("hidden", !privateMode);

  let clips = await getAllClips();

  renderTodayPick(clips);

  if (currentFilter !== "trash") {
    clips = clips.filter((clip) => !clip.isDeleted);
  }

  if (currentFilter === "trash") {
    clips = clips.filter((clip) => clip.isDeleted);
  }

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
    clips = clips.filter((clip) => clip.watchDueAt && new Date(clip.watchDueAt) < now);
  }

  if (currentFilter === "private") {
    clips = clips.filter((clip) => clip.isPrivate);
  }

  if (currentFilter === "tagless") {
    clips = clips.filter((clip) => getTagArray(clip.tags).length === 0);
  }

  if (currentFilter === "favorite") {
    clips = clips.filter((clip) => clip.isFavorite);
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
      <a href="${escapeHtml(clip.url)}" target="_blank" rel="noopener noreferrer" onclick="countOnly(${clip.id}, true)">
        <img class="thumbnail" src="${clip.thumbnailUrl}" alt="thumbnail">
      </a>

      <div class="clip-body">
        <div class="clip-main-row">
          <div>
            <div class="clip-title">
              ${clip.isFavorite ? '<span class="favorite-badge">★</span> ' : ""}${escapeHtml(clip.title)}
              ${clip.isPrivate && privateMode ? '<span class="private-badge">非表示</span>' : ""}
              ${clip.isDeleted ? '<span class="private-badge">ゴミ箱</span>' : ""}
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

// ==================================================
// タグ処理
// ==================================================
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

  clips
    .filter((clip) => !clip.isDeleted)
    .forEach((clip) => {
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

// ==================================================
// 視聴回数・あとで見る期限
// ==================================================
function openAndCount(id, url) {
  countOnly(id, true);
  window.open(url, "_blank");
}

async function countOnly(id, shouldRender = false) {
  const clip = await getClipById(id);

  if (!clip) {
    return;
  }

  clip.watchCount = (clip.watchCount || 0) + 1;
  clip.lastWatchedAt = new Date().toISOString();
  clip.watchStatus = "視聴済み";

  await updateClip(clip);

  if (shouldRender) {
    await renderClips();
  }
}

async function markWatched(id) {
  await countOnly(id, true);
}

async function setWatchDue(id) {
  const clip = await getClipById(id);

  const choice = prompt(
    "見る期限を入力：today / 3days / week / month / none",
    clip.watchDueType || "none"
  );

  if (choice === null) {
    return;
  }

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

// ==================================================
// 編集・削除・復元
// ==================================================
async function editClip(id) {
  const clip = await getClipById(id);

  const newReason = prompt(
    "保存理由を編集します。空欄なら未整理になります。",
    clip.reason || ""
  );

  if (newReason === null) {
    return;
  }

  const newTags = prompt(
    "タグを編集します。複数ならカンマ区切り。例：音楽, 創作, 勉強",
    clip.tags || ""
  );

  if (newTags === null) {
    return;
  }

  clip.reason = newReason;
  clip.tags = normalizeTags(newTags);
  clip.status = newReason.trim() === "" ? "未整理" : "整理済み";

  await updateClip(clip);
  await refreshApp();
}

async function deleteClip(id) {
  const ok = confirm("ゴミ箱に移動する？");

  if (!ok) {
    return;
  }

  const clip = await getClipById(id);

  clip.isDeleted = true;
  clip.deletedAt = new Date().toISOString();

  await updateClip(clip);
  await refreshApp();
}

async function actionRestoreClip() {
  if (selectedClipId === null) {
    return;
  }

  const id = selectedClipId;
  closeActionSheet();

  const clip = await getClipById(id);
  clip.isDeleted = false;
  clip.deletedAt = null;

  await updateClip(clip);
  await refreshApp();
}

async function actionHardDeleteClip() {
  if (selectedClipId === null) {
    return;
  }

  const ok = confirm("完全に削除します。戻せません。");

  if (!ok) {
    return;
  }

  const id = selectedClipId;
  closeActionSheet();

  await hardDeleteClip(id);
  await refreshApp();
}

async function actionCopyUrl() {
  if (selectedClipId === null) {
    return;
  }

  const clip = await getClipById(selectedClipId);

  try {
    await navigator.clipboard.writeText(clip.url);
    alert("URLをコピーしました");
  } catch {
    prompt("手動でコピー", clip.url);
  }
}

async function actionEditTitle() {
  if (selectedClipId === null) {
    return;
  }

  const id = selectedClipId;
  closeActionSheet();

  const clip = await getClipById(id);
  const newTitle = prompt("タイトルを編集", clip.title || "");

  if (newTitle === null) {
    return;
  }

  clip.title = newTitle.trim() || clip.title;

  await updateClip(clip);
  await renderClips();
}

async function actionToggleFavorite() {
  if (selectedClipId === null) {
    return;
  }

  const id = selectedClipId;
  closeActionSheet();

  const clip = await getClipById(id);
  clip.isFavorite = !clip.isFavorite;

  await updateClip(clip);
  await refreshApp();
}

// ==================================================
// URL解析・サムネイル・タイトル取得
// ==================================================
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

// URL重複判定用のキーを作る。
// YouTubeはURL形式や再生開始時間が違っても、動画IDが同じなら同じクリップ扱いにする。
function createDuplicateKey(url) {
  const youtubeId = extractYouTubeId(url);

  if (youtubeId) {
    return `youtube:${youtubeId}`;
  }

  try {
    const parsedUrl = new URL(url);

    // ページ内アンカーは重複判定には使わない。
    parsedUrl.hash = "";

    // 末尾スラッシュの差だけなら同じURLとして扱う。
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/$/, "");

    return parsedUrl.toString();
  } catch {
    return String(url).trim();
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

// ==================================================
// JSON読み込み・書き出し・バックアップ
// ==================================================
function createImportedClip(clip) {
  return {
    url: clip.url || "",
    title: clip.title || createTitleFromUrl(clip.url || ""),
    thumbnailUrl: clip.thumbnailUrl || createThumbnailUrl(clip.url || ""),
    reason: clip.reason || "",
    tags: normalizeTags(clip.tags || ""),
    status: clip.status || "未整理",
    isPrivate: clip.isPrivate || false,
    isFavorite: clip.isFavorite || false,
    isDeleted: clip.isDeleted || false,
    deletedAt: clip.deletedAt || null,
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

  const ok = confirm(`${clips.length}件を読み込みます。重複URLはスキップします。`);

  if (!ok) {
    return;
  }

  const existingClips = await getAllClips();
  const existingUrls = new Set(
    existingClips.map((clip) => createDuplicateKey(clip.url))
  );

  let importedCount = 0;
  let skippedCount = 0;

  for (const clip of clips) {
    const duplicateKey = createDuplicateKey(clip.url);

    if (existingUrls.has(duplicateKey)) {
      skippedCount++;
      continue;
    }

    await addClip(createImportedClip(clip));
    existingUrls.add(duplicateKey);
    importedCount++;
  }

  await refreshApp();

  alert(`${completeMessage}\n追加：${importedCount}件\n重複スキップ：${skippedCount}件`);
}

async function createClipsJson() {
  const clips = await getAllClips();
  return JSON.stringify(clips, null, 2);
}

function getJsonFileName() {
  return `clip-inbox-${new Date().toISOString().slice(0, 10)}.json`;
}

function downloadJsonText(json) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = getJsonFileName();
  link.click();

  URL.revokeObjectURL(url);
}

function showJsonOutput(json, message) {
  const panel = document.getElementById("jsonOutputPanel");
  const area = document.getElementById("jsonOutputArea");
  const messageElement = document.getElementById("jsonOutputMessage");

  // HTML側のJSON出力パネルがまだ無い場合に落ちないようにする。
  // ただしスマホのprompt地獄を避けるため、巨大JSONのprompt表示はしない。
  if (!panel || !area || !messageElement) {
    alert(`${message}\nJSON出力パネルがHTML側にないため、ファイル保存も試してください。`);
    return;
  }

  area.value = json;
  messageElement.textContent = message;
  panel.classList.remove("hidden");

  selectJsonText();
}

function selectJsonText() {
  const area = document.getElementById("jsonOutputArea");

  if (!area) {
    return;
  }

  area.focus();
  area.select();
  area.setSelectionRange(0, area.value.length);
}

async function exportClips() {
  const json = await createClipsJson();

  // ファイルとして保存する従来の動き。
  downloadJsonText(json);
}

async function copyJsonToClipboard() {
  const json = await createClipsJson();

  try {
    await navigator.clipboard.writeText(json);
    showJsonOutput(
      json,
      "JSONをコピーしました。必要なら下の欄から再コピーできます。"
    );
  } catch {
    showJsonOutput(
      json,
      "自動コピーできませんでした。下の欄を全選択してコピーしてください。"
    );
  }
}

function downloadJsonFromOutput() {
  const area = document.getElementById("jsonOutputArea");
  const json = area ? area.value : "";

  if (!json) {
    alert("保存するJSONがありません");
    return;
  }

  downloadJsonText(json);
}

async function shareJsonFile() {
  const area = document.getElementById("jsonOutputArea");
  const json = area ? area.value : "";

  if (!json) {
    alert("共有するJSONがありません");
    return;
  }

  const file = new File([json], getJsonFileName(), {
    type: "application/json"
  });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({
      files: [file],
      title: "Clip Inbox JSON Backup"
    });
    return;
  }

  alert("このブラウザではファイル共有に対応していません。ファイル保存を使ってください。");
}

async function importClips(event) {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

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

  if (!text) {
    return;
  }

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

async function resetAllData() {
  const ok1 = confirm("全データを削除します。JSONバックアップ済みですか？");
  if (!ok1) {
    return;
  }

  const ok2 = confirm("本当に削除します。この操作は戻せません。");
  if (!ok2) {
    return;
  }

  if (shouldUseSupabase()) {
    const { error } = await supabaseClient
      .from(SUPABASE_TABLE_NAME)
      .delete()
      .eq("user_id", currentUser.id);

    if (error) {
      alert(`全削除失敗：${error.message}`);
      return;
    }

    await refreshApp();
    alert("Supabase上の全データを削除しました");
    return;
  }

  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);

  store.clear();

  transaction.oncomplete = async () => {
    await refreshApp();
    alert("この端末の全データを削除しました");
  };
}

// ==================================================
// Privateモード
// ==================================================
function getPrivatePasscode() {
  return localStorage.getItem("privatePasscode") || DEFAULT_PRIVATE_PASSCODE;
}

function changePrivatePasscode() {
  const current = prompt("現在のパスコードを入力");

  if (current === null) {
    return;
  }

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
  if (selectedClipId === null) {
    return;
  }

  const id = selectedClipId;
  closeActionSheet();

  const clip = await getClipById(id);
  clip.isPrivate = !clip.isPrivate;

  await updateClip(clip);
  await renderClips();
}

// ==================================================
// 掘り返し・今日の1本
// ==================================================
function isStaleClip(clip) {
  if ((clip.watchCount || 0) > 0) {
    return false;
  }

  const createdAt = new Date(clip.createdAt);
  const now = new Date();
  const diffDays = (now - createdAt) / (1000 * 60 * 60 * 24);

  return diffDays >= 7;
}

function pickRediscoveryClip(clips, shouldAvoidLast = false) {
  const visibleClips = clips.filter((clip) => {
    if (clip.isDeleted) {
      return false;
    }

    if (!privateMode && clip.isPrivate) {
      return false;
    }

    return true;
  });

  if (visibleClips.length === 0) {
    return null;
  }

  const scoredClips = visibleClips.map((clip) => {
    let score = 0;

    const days = getDaysSince(clip.createdAt);
    const watchCount = clip.watchCount || 0;
    const hasReason = !!clip.reason;
    const hasTags = getTagArray(clip.tags).length > 0;

    // 未視聴を強めに優先する。
    if (watchCount === 0) {
      score += 30;
    }

    // 保存から日数が経っているほど少し優先する。
    score += Math.min(days, 30);

    // 理由やタグがあるものは「昔の自分の意図」が残っているので優先する。
    if (hasReason) {
      score += 12;
    }

    if (hasTags) {
      score += 5;
    }

    // お気に入りは、再発見価値が高いので少し優先する。
    if (clip.isFavorite) {
      score += 18;
    }

    // 最近見たものは少し下げる。
    if (clip.lastWatchedAt && getDaysSince(clip.lastWatchedAt) <= 3) {
      score -= 20;
    }

    // 掘り返しボタンで連続再抽選したとき、直前と同じものが出にくいようにする。
    if (shouldAvoidLast && clip.id === lastRediscoveryClipId) {
      score -= 100;
    }

    return {
      clip,
      score
    };
  });

  scoredClips.sort((a, b) => b.score - a.score);

  // 上位5件からランダムにして、毎回まったく同じになりすぎないようにする。
  const topClips = scoredClips.slice(0, Math.min(5, scoredClips.length));
  const picked = topClips[Math.floor(Math.random() * topClips.length)].clip;

  lastRediscoveryClipId = picked.id;

  return picked;
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

    <a href="${escapeHtml(clip.url)}" target="_blank" rel="noopener noreferrer" onclick="countOnly(${clip.id}, true)">
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
  const section = document.getElementById("todayPickSection");
  const clip = pickRediscoveryClip(clips, true);

  if (!clip) {
    alert("掘り返せるクリップがまだありません");
    return;
  }

  // ボタンを押した手応えを出すため、一瞬だけ薄くしてから中身を差し替える。
  section.classList.add("rerolling");

  await wait(120);

  section.classList.remove("hidden");
  section.innerHTML = `
    <div class="today-pick-label">今日の1本</div>

    <a href="${escapeHtml(clip.url)}" target="_blank" rel="noopener noreferrer" onclick="countOnly(${clip.id}, true)">
      <img class="thumbnail" src="${clip.thumbnailUrl}" alt="thumbnail">
    </a>

    <div class="today-pick-title">${escapeHtml(clip.title)}</div>

    <div class="today-pick-reason">
      ${escapeHtml(clip.reason || "理由未入力")}
      ・保存から${getDaysSince(clip.createdAt)}日
    </div>
  `;

  section.classList.remove("rerolling");
}

// ==================================================
// 三点メニュー
// ==================================================
async function openActionSheet(id, url) {
  selectedClipId = id;
  selectedClipUrl = url;

  const actionSheet = document.getElementById("actionSheet");
  const clip = await getClipById(id);

  actionSheet.classList.toggle("trash-mode", !!clip?.isDeleted);
  actionSheet.classList.remove("hidden");
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

  countOnly(id, true);
  window.open(url, "_blank");
}

async function actionMarkWatched() {
  if (selectedClipId === null) {
    return;
  }

  const id = selectedClipId;
  closeActionSheet();
  await markWatched(id);
}

async function actionSetWatchDue() {
  if (selectedClipId === null) {
    return;
  }

  const id = selectedClipId;
  closeActionSheet();
  await setWatchDue(id);
}

async function actionEditClip() {
  if (selectedClipId === null) {
    return;
  }

  const id = selectedClipId;
  closeActionSheet();
  await editClip(id);
}

async function actionDeleteClip() {
  if (selectedClipId === null) {
    return;
  }

  const id = selectedClipId;
  closeActionSheet();
  await deleteClip(id);
}

async function actionShowDetail() {
  if (selectedClipId === null) {
    return;
  }

  const clip = await getClipById(selectedClipId);

  const detailModal = document.getElementById("detailModal");

  // HTML側に詳細モーダルがない場合でも落ちないようにする。
  if (!detailModal) {
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

お気に入り
${clip.isFavorite ? "はい" : "いいえ"}

削除状態
${clip.isDeleted ? "ゴミ箱" : "通常"}

URL
${clip.url}`
    );
    return;
  }

  document.getElementById("detailTitle").textContent =
    clip.title || "タイトルなし";
  document.getElementById("detailReason").textContent =
    clip.reason || "なし";
  document.getElementById("detailTags").textContent =
    clip.tags || "なし";
  document.getElementById("detailWatchCount").textContent =
    `${clip.watchCount || 0}回`;
  document.getElementById("detailCreatedAt").textContent =
    formatDate(clip.createdAt);
  document.getElementById("detailFavorite").textContent =
    clip.isFavorite ? "はい" : "いいえ";
  document.getElementById("detailDeleted").textContent =
    clip.isDeleted ? "ゴミ箱" : "通常";
  document.getElementById("detailUrl").textContent =
    clip.url;

  detailModal.classList.remove("hidden");
}

function closeDetailModal() {
  const detailModal = document.getElementById("detailModal");

  if (!detailModal) {
    return;
  }

  detailModal.classList.add("hidden");
}

// ==================================================
// 表示用ユーティリティ
// ==================================================
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