const state = { stages: [], leads: [], meta: null, selected: null, query: "" };
const loginView = document.querySelector("#loginView");
const appView = document.querySelector("#appView");
const board = document.querySelector("#board");
const summary = document.querySelector("#summary");
const metaStatus = document.querySelector("#metaStatus");
const dialog = document.querySelector("#leadDialog");
const toast = document.querySelector("#toast");

let toastTimer;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 4500);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/login") showLogin();
  if (!response.ok) throw new Error(data.error || "Не удалось выполнить запрос");
  return data;
}

function showLogin() {
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
}

function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function filteredLeads() {
  const query = state.query.trim().toLocaleLowerCase("ru");
  if (!query) return state.leads;
  return state.leads.filter((lead) => [lead.name, lead.phone, lead.email, lead.region, lead.campaignName].some((value) => String(value ?? "").toLocaleLowerCase("ru").includes(query)));
}

function leadMetaStatusHtml(lead) {
  if (lead.isTestLead) return `<span class="badge test">Тестовый лид Meta</span>`;
  const status = lead.metaAudience?.status || "idle";
  if (status === "sent") return `<span class="badge sent">✓ Передан в Meta</span>`;
  if (status === "pending") return `<span class="badge pending">Отправляется в Meta…</span>`;
  if (status === "error") return `<button class="badge error" data-meta-retry data-stop title="${escapeText(lead.metaAudience?.error || "Ошибка Meta")}">Ошибка Meta · повторить</button>`;
  return "";
}

function renderMetaStatus() {
  const source = state.meta?.sourceAudience;
  const lookalike = state.meta?.lookalike;
  if (!source || !lookalike) {
    metaStatus.innerHTML = `<span>Статус Meta загружается…</span>`;
    return;
  }
  const lookalikeText = lookalike.status === "ready"
    ? "Похожая аудитория 1% · Казахстан: готова"
    : lookalike.status === "error"
      ? `Похожая аудитория: ошибка${lookalike.error ? ` — ${escapeText(lookalike.error)}` : ""}`
      : `Похожая аудитория: накоплено ${lookalike.qualityCount}/100 качественных клиентов`;
  metaStatus.innerHTML = `
    <span><strong>Meta:</strong> передано ${source.sentCount}, ожидает ${source.pendingCount}, ошибок ${source.errorCount}</span>
    <span>•</span><span>${lookalikeText}</span>
    ${lookalike.status === "error" ? `<button data-lookalike-retry>Повторить создание</button>` : ""}`;
  metaStatus.querySelector("[data-lookalike-retry]")?.addEventListener("click", retryLookalike);
}

function render() {
  const visible = filteredLeads();
  const quality = state.leads.filter((lead) => lead.isQuality).length;
  summary.innerHTML = `
    <div><strong>${state.leads.length}</strong><span>Всего заявок</span></div>
    <div><strong>${state.leads.filter((lead) => lead.status === "new").length}</strong><span>Новых</span></div>
    <div><strong>${quality}</strong><span>Качественных</span></div>
    <div><strong>${state.leads.filter((lead) => lead.status === "sale").length}</strong><span>Продаж</span></div>`;
  renderMetaStatus();
  board.innerHTML = state.stages.map((stage) => {
    const leads = visible.filter((lead) => lead.status === stage.id);
    return `<section class="column" data-stage="${stage.id}">
      <header><h2>${escapeText(stage.label)}</h2><span>${leads.length}</span></header>
      <div class="dropzone">${leads.map(cardHtml).join("") || `<p class="empty">Перетащите заявку сюда</p>`}</div>
    </section>`;
  }).join("");
  bindCards();
}

function cardHtml(lead) {
  const answers = Object.entries(lead.answers || {}).slice(0, 2).map(([key, value]) => `<p><b>${escapeText(key)}</b><br>${escapeText(value)}</p>`).join("");
  const phone = lead.whatsappUrl
    ? `<a class="phone" href="${escapeText(lead.whatsappUrl)}" target="_blank" rel="noopener" data-stop>WhatsApp · ${escapeText(lead.phone)}</a>`
    : `<span class="phone muted">${lead.isTestLead ? "Тестовый номер — WhatsApp недоступен" : escapeText(lead.phone || "Телефон не указан")}</span>`;
  return `<article class="lead-card${lead.isQuality ? " quality" : ""}${lead.isTestLead ? " test-lead" : ""}" draggable="true" data-id="${lead.id}" tabindex="0">
    <div class="card-head"><span class="quality-star" title="Качественный клиент">${lead.isQuality ? "★" : "☆"}</span><time>${formatDate(lead.createdAt)}</time></div>
    <h3>${escapeText(lead.name || "Без имени")}</h3>
    ${phone}
    ${lead.region ? `<span class="region">${escapeText(lead.region)}</span>` : ""}
    <div class="badges">${leadMetaStatusHtml(lead)}</div>
    ${answers ? `<div class="card-answers">${answers}</div>` : ""}
    <footer><span>${escapeText(lead.manager || "Не назначен")}</span><button data-quality="${lead.isQuality ? "0" : "1"}" data-stop${lead.isTestLead ? " disabled" : ""}>${lead.isQuality ? "Снять ★" : "★ Качественный"}</button></footer>
  </article>`;
}

function bindCards() {
  document.querySelectorAll(".lead-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("[data-stop]")) return;
      openLead(card.dataset.id);
    });
    card.addEventListener("keydown", (event) => { if (event.key === "Enter") openLead(card.dataset.id); });
    card.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", card.dataset.id));
    card.querySelector("[data-quality]")?.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await patchLead(card.dataset.id, { isQuality: event.currentTarget.dataset.quality === "1" });
        showToast("Статус клиента сохранён. Отправка в Meta началась.");
        setTimeout(() => loadLeads().catch(() => {}), 2500);
      } catch (error) { showToast(error.message, true); }
    });
    card.querySelector("[data-meta-retry]")?.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        const data = await api(`/api/leads/${card.dataset.id}/meta/retry`, { method: "POST" });
        state.leads = state.leads.map((lead) => lead.id === card.dataset.id ? data.lead : lead);
        render();
        showToast("Повторная отправка в Meta началась.");
        setTimeout(() => loadLeads().catch(() => {}), 2500);
      } catch (error) { showToast(error.message, true); }
    });
  });
  document.querySelectorAll(".column").forEach((column) => {
    column.addEventListener("dragover", (event) => { event.preventDefault(); column.classList.add("drag-over"); });
    column.addEventListener("dragleave", () => column.classList.remove("drag-over"));
    column.addEventListener("drop", async (event) => {
      event.preventDefault();
      column.classList.remove("drag-over");
      const id = event.dataTransfer.getData("text/plain");
      if (id) {
        try { await patchLead(id, { status: column.dataset.stage }); }
        catch (error) { showToast(error.message, true); }
      }
    });
  });
}

async function loadLeads() {
  const [data, meta] = await Promise.all([api("/api/leads"), api("/api/meta/status")]);
  state.stages = data.stages;
  state.leads = data.leads;
  state.meta = meta;
  showApp();
  render();
}

async function retryLookalike() {
  try {
    const data = await api("/api/meta/lookalike/retry", { method: "POST" });
    state.meta = { ...state.meta, lookalike: data.lookalike };
    renderMetaStatus();
    showToast(data.lookalike.status === "ready" ? "Похожая аудитория готова." : "Статус похожей аудитории обновлён.");
  } catch (error) { showToast(error.message, true); }
}

async function patchLead(id, patch) {
  const data = await api(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  state.leads = state.leads.map((lead) => lead.id === id ? data.lead : lead);
  render();
}

function openLead(id) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead) return;
  state.selected = id;
  document.querySelector("#dialogName").textContent = lead.name || "Без имени";
  document.querySelector("#dialogStage").textContent = state.stages.find((stage) => stage.id === lead.status)?.label || lead.status;
  document.querySelector("#dialogContacts").innerHTML = [
    lead.whatsappUrl ? `<a href="${escapeText(lead.whatsappUrl)}" target="_blank" rel="noopener">WhatsApp · ${escapeText(lead.phone)}</a>` : escapeText(lead.isTestLead ? "Тестовый номер — WhatsApp недоступен" : lead.phone || ""),
    lead.email ? `<a href="mailto:${escapeText(lead.email)}">${escapeText(lead.email)}</a>` : "",
  ].filter(Boolean).join("");
  document.querySelector("#dialogAnswers").innerHTML = Object.entries(lead.answers || {}).map(([key, value]) => `<div><span>${escapeText(key)}</span><strong>${escapeText(value)}</strong></div>`).join("");
  const status = document.querySelector("#dialogStatus");
  status.innerHTML = state.stages.map((stage) => `<option value="${stage.id}">${escapeText(stage.label)}</option>`).join("");
  status.value = lead.status;
  const quality = document.querySelector("#dialogQuality");
  quality.checked = lead.isQuality;
  quality.disabled = lead.isTestLead;
  document.querySelector("#dialogMetaStatus").innerHTML = lead.isTestLead
    ? `<span class="badge test">Тестовый лид Meta не отправляется в аудиторию</span>`
    : leadMetaStatusHtml(lead) || `<span>Клиент ещё не отправлялся в Meta.</span>`;
  document.querySelector("#dialogMetaStatus [data-meta-retry]")?.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/leads/${lead.id}/meta/retry`, { method: "POST" });
      showToast("Повторная отправка в Meta началась.");
      dialog.close();
      setTimeout(() => loadLeads().catch(() => {}), 2500);
    } catch (error) { showToast(error.message, true); }
  });
  document.querySelector("#dialogManager").value = lead.manager || "";
  document.querySelector("#dialogAmount").value = lead.amount ?? "";
  document.querySelector("#dialogNotes").value = lead.notes || "";
  dialog.showModal();
}

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.querySelector("#loginError");
  error.textContent = "";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password: new FormData(event.currentTarget).get("password") }) });
    await loadLeads();
  } catch (reason) { error.textContent = reason.message; }
});

document.querySelector("#leadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selected) return;
  try {
    await patchLead(state.selected, {
      status: document.querySelector("#dialogStatus").value,
      isQuality: document.querySelector("#dialogQuality").checked,
      manager: document.querySelector("#dialogManager").value,
      amount: document.querySelector("#dialogAmount").value ? Number(document.querySelector("#dialogAmount").value) : null,
      notes: document.querySelector("#dialogNotes").value,
    });
    dialog.close();
    showToast("Карточка сохранена.");
    setTimeout(() => loadLeads().catch(() => {}), 2500);
  } catch (error) { showToast(error.message, true); }
});

document.querySelector("#search").addEventListener("input", (event) => { state.query = event.target.value; render(); });
document.querySelector("#refreshButton").addEventListener("click", loadLeads);
document.querySelector("#logoutButton").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); showLogin(); });

loadLeads().catch(() => showLogin());
setInterval(() => { if (!appView.classList.contains("hidden")) loadLeads().catch(() => {}); }, 30000);
