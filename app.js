const DB_NAME = "clipInboxDb";
const STORE_NAME = "clips";

let db;
let currentFilter = "all";

window.addEventListener("load", async () => {
  db = await openDatabase();

  document.getElementById("saveButton").addEventListener("click", saveClip);
  document.getElementById("searchInput").addEventListener("input", renderClips);

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

async function saveClip() {
  const url = document.getElementById("urlInput").value.trim();
  const reason = document.getElementById("reasonInput").value.trim();
  const tags = document.getElementById("tagInput").value.trim();

  if (!url) {
    alert("URLを入力して");
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
  createdAt: new Date().toISOString()
};

  await addClip(clip);

  document.getElementById("urlInput").value = "";
  document.getElementById("reasonInput").value = "";
  document.getElementById("tagInput").value = "";

  await renderClips();
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

async function renderClips() {
  const listElement = document.getElementById("clipList");
  const keyword = document.getElementById("searchInput").value.trim().toLowerCase();

  let clips = await getAllClips();

  clips.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (currentFilter === "unorganized") {
  clips = clips.filter((clip) => clip.status === "未整理");
}

if (currentFilter === "organized") {
  clips = clips.filter((clip) => clip.status === "整理済み");
}

  if (keyword) {
    clips = clips.filter((clip) => {
      return (
        clip.url.toLowerCase().includes(keyword) ||
        clip.title.toLowerCase().includes(keyword) ||
        clip.reason.toLowerCase().includes(keyword) ||
        clip.tags.toLowerCase().includes(keyword)
      );
    });
  }
  document.getElementById("countText").textContent = `${clips.length}件`;

  listElement.innerHTML = "";

  clips.forEach((clip) => {
    const card = document.createElement("article");
    card.className = "clip-card";

    card.innerHTML = `
      <img class="thumbnail" src="${clip.thumbnailUrl}" alt="thumbnail">

      <div class="clip-body">
        <div class="clip-title">${escapeHtml(clip.title)}</div>

        <a class="clip-url" href="${clip.url}" target="_blank">
          ${escapeHtml(clip.url)}
        </a>

        <div class="clip-meta">
          ${formatDate(clip.createdAt)} / ${escapeHtml(clip.status)} / ${escapeHtml(clip.tags)}
        </div>

        <div class="clip-reason">
          ${escapeHtml(clip.reason || "理由未入力")}
        </div>

      <div class="clip-actions">
  <button onclick="openClip('${clip.url}')">開く</button>
  <button onclick="editClip(${clip.id})">編集</button>
  <button class="delete-button" onclick="deleteClip(${clip.id})">削除</button>
</div>
    `;

    listElement.appendChild(card);
  });
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

function createTitleFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname;
  } catch {
    return url;
  }
}

function openClip(url) {
  window.open(url, "_blank");
}

function deleteClip(id) {
  const ok = confirm("削除する？");

  if (!ok) {
    return;
  }

  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);

  store.delete(id);

  transaction.oncomplete = () => renderClips();
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

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
async function editClip(id) {

  const clip = await getClipById(id);

  const newReason = prompt(
    "保存理由を編集",
    clip.reason || ""
  );

  if (newReason === null) {
    return;
  }

  const newTags = prompt(
    "タグを編集",
    clip.tags || ""
  );

  if (newTags === null) {
    return;
  }

  clip.reason = newReason;
  clip.tags = newTags;

  clip.status =
    newReason.trim() === ""
      ? "未整理"
      : "整理済み";

  await updateClip(clip);

  renderClips();
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