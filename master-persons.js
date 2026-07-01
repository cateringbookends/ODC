const headNameInput = document.querySelector("#headName");
const personNameInput = document.querySelector("#personName");
const personCodeInput = document.querySelector("#personCode");
const personDepartmentInput = document.querySelector("#personDepartment");
const personLocationInput = document.querySelector("#personLocation");
const personEmailInput = document.querySelector("#personEmail");
const addPersonButton = document.querySelector("#addPerson");
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const masterList = document.querySelector("#masterList");
const masterSearch = document.querySelector("#masterSearch");
const masterForm = document.querySelector("#masterPersonsForm");
const departmentFilter = document.querySelector("#masterDepartmentFilter");
const departmentFilterControl = document.querySelector("#departmentFilterControl");
const selectAllDepartmentsButton = document.querySelector("#selectAllDepartments");
const clearDepartmentsButton = document.querySelector("#clearDepartments");
let masterStatusEl = null;

let heads = getMasterPersons();
let departmentFilterInitialized = false;
let masterViewReady = false;
let masterDataVersion = 0;
let lastRenderKey = "";
let renderFrame = 0;
let renderToken = 0;
let preparedHeads = [];
let showAllMasterPersons = false;
const expandedHeads = new Set();

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function makeId(name) {
  return `head-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || Date.now()}`;
}

function isHeadPost(post) {
  return /\bhead\b/i.test(post || "");
}

function sortHeadsByPost(a, b) {
  const aHead = isHeadPost(a.name);
  const bHead = isHeadPost(b.name);
  if (aHead !== bHead) return aHead ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function sortPersonsByName(a, b) {
  const aName = a.name || a.personName || String(a);
  const bName = b.name || b.personName || String(b);
  return aName.localeCompare(bName);
}

function findOrCreateHead(postName) {
  const cleanPost = postName.trim();
  let head = heads.find((item) => item.name.toLowerCase() === cleanPost.toLowerCase());
  if (!head) {
    head = { id: makeId(cleanPost), name: cleanPost, persons: [] };
    heads.push(head);
    heads.sort(sortHeadsByPost);
  }
  return head;
}

function allPersons() {
  return heads.flatMap((head) => (head.persons || []).map((person) => ({ head, person })));
}

function getDepartments() {
  return [...new Set(allPersons()
    .map(({ person }) => String(person.department || "").trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function selectedDepartments() {
  if (!departmentFilter) return [];
  return [...departmentFilter.selectedOptions].map((option) => option.value);
}

function departmentSummary() {
  const selected = selectedDepartments();
  const total = departmentFilter?.options.length || 0;
  if (!selected.length || selected.length === total) return "All departments";
  if (selected.length === 1) return selected[0];
  return `${selected.length} departments selected`;
}

function renderDepartmentControl() {
  if (!departmentFilterControl) return;
  departmentFilterControl.innerHTML = `
    <button type="button" class="department-filter-trigger" aria-haspopup="listbox" aria-expanded="false">
      <span></span>
    </button>
    <div class="department-filter-menu" hidden>
      <input type="search" class="department-filter-search" placeholder="Search department">
      <div class="department-filter-list" role="listbox" aria-multiselectable="true"></div>
    </div>
  `;

  const trigger = departmentFilterControl.querySelector(".department-filter-trigger");
  const triggerText = trigger.querySelector("span");
  const menu = departmentFilterControl.querySelector(".department-filter-menu");
  const search = departmentFilterControl.querySelector(".department-filter-search");
  const list = departmentFilterControl.querySelector(".department-filter-list");

  function syncLabel() {
    triggerText.textContent = departmentSummary();
  }

  function close() {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }

  function renderOptions() {
    const query = search.value.trim().toLowerCase();
    list.innerHTML = "";
    [...departmentFilter.options]
      .filter((option) => option.value.toLowerCase().includes(query))
      .forEach((option) => {
        const item = document.createElement("label");
        item.className = "department-filter-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = option.selected;
        checkbox.addEventListener("change", () => {
          option.selected = checkbox.checked;
          syncLabel();
          scheduleRenderMasterList();
        });
        const text = document.createElement("span");
        text.textContent = option.value;
        item.append(checkbox, text);
        list.append(item);
      });
    if (!list.children.length) {
      const empty = document.createElement("p");
      empty.className = "department-filter-empty";
      empty.textContent = "No department found";
      list.append(empty);
    }
  }

  trigger.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    trigger.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) {
      search.value = "";
      renderOptions();
      search.focus();
    }
  });
  search.addEventListener("input", renderOptions);
  departmentFilterControl.dataset.ready = "true";
  departmentFilterControl.refresh = () => {
    syncLabel();
    if (!menu.hidden) renderOptions();
  };
  departmentFilterControl.close = close;
  syncLabel();
}

function populateDepartmentFilter() {
  if (!departmentFilter) return;
  const previousSelection = new Set(selectedDepartments());
  const departments = getDepartments();
  departmentFilter.innerHTML = "";

  departments.forEach((department) => {
    const option = document.createElement("option");
    option.value = department;
    option.textContent = department;
    departmentFilter.append(option);
  });

  const nextSelection = departmentFilterInitialized
    ? previousSelection
    : new Set(departments.includes("ODC") ? ["ODC"] : departments);

  [...departmentFilter.options].forEach((option) => {
    option.selected = nextSelection.has(option.value);
  });
  departmentFilterInitialized = true;
  if (!departmentFilterControl?.dataset.ready) renderDepartmentControl();
  departmentFilterControl?.refresh?.();
}

function prepareMasterView() {
  preparedHeads = [...heads].sort(sortHeadsByPost).map((head) => ({
    head,
    persons: [...(head.persons || [])].sort(sortPersonsByName).map((person) => ({
      person,
      index: head.persons.indexOf(person),
      department: String(person.department || "").trim(),
      searchText: [
        head.name,
        person.name,
        person.personName,
        person.code,
        person.designation,
        person.department,
        person.location,
        person.email,
      ].filter(Boolean).join(" ").toLowerCase()
    }))
  }));
  masterDataVersion += 1;
  lastRenderKey = "";
}

function scheduleRenderMasterList() {
  if (renderFrame) cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    renderMasterList();
  });
}

// Built entirely with DOM nodes + textContent so head/person names can never
// inject HTML (previously interpolated straight into innerHTML).
function buildMasterGroup(head, filteredPersons, query) {
  const group = document.createElement("section");
  group.className = "master-group";
  const isExpanded = query || expandedHeads.has(head.id);

  const header = document.createElement("div");
  header.className = "master-group-header";
  const titleWrap = document.createElement("div");
  titleWrap.className = "master-group-title";
  const title = document.createElement("h2");
  title.textContent = head.name;
  const count = document.createElement("span");
  count.className = "master-person-count";
  count.textContent = `${filteredPersons.length} person${filteredPersons.length === 1 ? "" : "s"}`;
  titleWrap.append(title, count);

  const actions = document.createElement("div");
  actions.className = "master-group-actions";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "secondary-button master-group-toggle";
  toggle.textContent = isExpanded ? "Hide" : "View";
  toggle.addEventListener("click", () => {
    if (expandedHeads.has(head.id)) expandedHeads.delete(head.id);
    else expandedHeads.add(head.id);
    lastRenderKey = "";
    renderMasterList();
  });
  const removeHead = document.createElement("button");
  removeHead.type = "button";
  removeHead.className = "remove-master-head";
  removeHead.dataset.headId = head.id;
  removeHead.setAttribute("aria-label", `Remove ${head.name}`);
  removeHead.textContent = "Remove Head";
  removeHead.addEventListener("click", () => {
    heads = heads.filter((h) => h.id !== head.id);
    saveMasterPersons(heads);
    prepareMasterView();
    populateDepartmentFilter();
    renderMasterList();
  });
  actions.append(toggle, removeHead);
  header.append(titleWrap, actions);
  group.append(header);

  if (!isExpanded) {
    const preview = document.createElement("div");
    preview.className = "master-group-preview";
    const names = filteredPersons.slice(0, 6).map(({ person }) => person.name || person.personName || "").filter(Boolean);
    preview.textContent = names.length ? names.join(", ") + (filteredPersons.length > names.length ? "..." : "") : "No persons added";
    group.append(preview);
    return group;
  }

  const table = document.createElement("div");
  table.className = "master-person-table";

  const tableHead = document.createElement("div");
  tableHead.className = "master-person-row master-person-row-head";
  ["Name", "Code", "Department", "Location", "Email", "Edit", "Delete"].forEach((label) => {
    const cell = document.createElement("span");
    cell.textContent = label;
    tableHead.append(cell);
  });
  table.append(tableHead);

  if (!filteredPersons.length) {
    const row = document.createElement("div");
    row.className = "master-person-row master-person-empty";
    const span = document.createElement("span");
    span.textContent = query ? "No matching persons in this group" : "No persons added";
    row.append(span);
    table.append(row);
  } else {
    filteredPersons.forEach(({ person, index }) => {
      const row = document.createElement("div");
      row.className = "master-person-row";

      const nameCell = document.createElement("div");
      nameCell.className = "master-person-name";
      const nameText = document.createElement("span");
      nameText.textContent = person.name || person.personName || String(person);
      nameCell.append(nameText);
      const meta = [person.designation].filter(Boolean).join(" | ");
      if (meta) {
        const metaText = document.createElement("small");
        metaText.textContent = meta;
        nameCell.append(metaText);
      }

      const codeCell = document.createElement("span");
      codeCell.className = "master-person-code";
      codeCell.textContent = person.code || "-";

      const departmentCell = document.createElement("span");
      departmentCell.className = "master-person-department";
      departmentCell.textContent = person.department || "-";

      const locationCell = document.createElement("span");
      locationCell.className = "master-person-location";
      locationCell.textContent = person.location || "-";

      const emailCell = document.createElement("span");
      emailCell.className = "master-person-email";
      emailCell.textContent = person.email || "-";

      const editPerson = document.createElement("button");
      editPerson.type = "button";
      editPerson.className = "edit-master-person";
      editPerson.textContent = "Edit";
      editPerson.addEventListener("click", () => {
        const h = heads.find((item) => item.id === head.id);
        if (!h) return;
        const current = h.persons[index] || {};
        const nextName = prompt("Edit name", current.name || "");
        if (nextName === null) return;
        const cleanName = nextName.trim();
        if (!cleanName) return;
        const nextCode = prompt("Edit employee code", current.code || "");
        if (nextCode === null) return;
        const nextPost = prompt("Edit post / designation", current.designation || h.name);
        if (nextPost === null) return;
        const cleanPost = nextPost.trim() || h.name;
        const nextDepartment = prompt("Edit department / unit", current.department || "");
        if (nextDepartment === null) return;
        const nextLocation = prompt("Edit location", current.location || "");
        if (nextLocation === null) return;
        let nextEmail = prompt("Edit email", current.email || "");
        if (nextEmail === null) return;
        nextEmail = nextEmail.trim();
        if (nextEmail && !EMAIL_FORMAT.test(nextEmail)) {
          alert("Enter a valid email or leave it blank.");
          return;
        }
        const updatedPerson = {
          ...current,
          name: cleanName,
          code: nextCode.trim(),
          designation: cleanPost,
          department: nextDepartment.trim(),
          location: nextLocation.trim(),
          email: nextEmail
        };
        h.persons = h.persons.filter((_, i) => i !== index);
        const targetHead = findOrCreateHead(cleanPost);
        targetHead.persons.push(updatedPerson);
        saveMasterPersons(heads);
        prepareMasterView();
        populateDepartmentFilter();
        renderMasterList();
      });

      const removePerson = document.createElement("button");
      removePerson.type = "button";
      removePerson.className = "remove-master-person";
      removePerson.dataset.headId = head.id;
      removePerson.dataset.personIndex = String(index);
      removePerson.setAttribute("aria-label", `Delete ${nameCell.textContent}`);
      removePerson.textContent = "Delete";
      removePerson.addEventListener("click", () => {
        const h = heads.find((item) => item.id === head.id);
        if (h) h.persons = h.persons.filter((_, i) => i !== index);
        saveMasterPersons(heads);
        prepareMasterView();
        populateDepartmentFilter();
        renderMasterList();
      });
      row.append(nameCell, codeCell, departmentCell, locationCell, emailCell, editPerson, removePerson);
      table.append(row);
    });
  }

  group.append(table);
  return group;
}

function renderMasterList() {
  const query = normalizeText(masterSearch?.value);
  const departments = selectedDepartments();
  const renderKey = `${masterDataVersion}|${query}|${departments.join("\u001f")}|${showAllMasterPersons ? "all" : "slice"}|${[...expandedHeads].sort().join("\u001f")}`;
  if (renderKey === lastRenderKey) return;
  lastRenderKey = renderKey;
  const token = ++renderToken;

  masterList.innerHTML = "";
  let visibleGroups = 0;
  let visiblePeople = 0;
  const groupsToRender = [];

  preparedHeads.forEach(({ head, persons }) => {
    const filteredPersons = persons.filter((entry) => {
      if (departments.length && !departments.includes(entry.department)) return false;
      if (!query) return true;
      return entry.searchText.includes(query);
    });
    if (!filteredPersons.length) return;
    visibleGroups += 1;
    visiblePeople += filteredPersons.length;
    groupsToRender.push({ head, filteredPersons });
  });

  if (!visibleGroups) {
    const empty = document.createElement("p");
    empty.className = "form-status";
    empty.textContent = "No matching master persons.";
    masterList.append(empty);
    return;
  }

  const totalGroups = groupsToRender.length;
  const totalPeople = visiblePeople;
  const summary = document.createElement("div");
  summary.className = "master-list-summary";
  summary.textContent = `${totalGroups} posts | ${totalPeople} people`;
  masterList.append(summary);

  if (query && !showAllMasterPersons) {
    const initialGroups = [];
    let initialPeople = 0;
    for (const item of groupsToRender) {
      if (initialPeople >= 140) break;
      const remaining = 140 - initialPeople;
      const filteredPersons = item.filteredPersons.length > remaining
        ? item.filteredPersons.slice(0, remaining)
        : item.filteredPersons;
      initialGroups.push({ head: item.head, filteredPersons });
      initialPeople += filteredPersons.length;
    }
    if (initialGroups.length < groupsToRender.length) {
      groupsToRender.length = 0;
      groupsToRender.push(...initialGroups);
      const notice = document.createElement("div");
      notice.className = "master-list-notice";
      const text = document.createElement("span");
      text.textContent = `Showing ${initialPeople} of ${totalPeople} people across ${totalGroups} posts.`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-button";
      button.textContent = "Show All";
      button.addEventListener("click", () => {
        showAllMasterPersons = true;
        lastRenderKey = "";
        renderMasterList();
      });
      notice.append(text, button);
      masterList.append(notice);
    }
  }

  const batchSize = 8;
  let index = 0;
  function appendBatch() {
    if (token !== renderToken) return;
    const fragment = document.createDocumentFragment();
    const end = Math.min(index + batchSize, groupsToRender.length);
    for (; index < end; index += 1) {
      const item = groupsToRender[index];
      fragment.append(buildMasterGroup(item.head, item.filteredPersons, query));
    }
    masterList.append(fragment);
    if (index < groupsToRender.length) requestAnimationFrame(appendBatch);
  }
  appendBatch();
}

function addPerson() {
  const headName = headNameInput.value.trim();
  const personName = personNameInput.value.trim();
  const personCode = personCodeInput.value.trim();
  const personDepartment = personDepartmentInput.value.trim();
  const personLocation = personLocationInput.value.trim();
  const personEmail = (personEmailInput?.value || "").trim();
  if (!headName || !personName) {
    setMasterStatus("Post/designation and person name are required.", true);
    return;
  }
  if (personEmail && !EMAIL_FORMAT.test(personEmail)) {
    setMasterStatus("Enter a valid email or leave it blank.", true);
    return;
  }

  const head = findOrCreateHead(headName);
  const exists = head.persons.some((person) => String(person.name || person.personName || "").toLowerCase() === personName.toLowerCase() && String(person.code || "").toLowerCase() === personCode.toLowerCase());
  if (!exists) {
    head.persons.push({ name: personName, code: personCode, designation: headName, department: personDepartment, location: personLocation, email: personEmail });
    head.persons.sort(sortPersonsByName);
  }

  saveMasterPersons(heads);
  setMasterStatus(exists ? "Already exists. No duplicate added." : `Added ${personName} under ${headName}.`);
  personNameInput.value = "";
  personCodeInput.value = "";
  personDepartmentInput.value = "";
  personLocationInput.value = "";
  if (personEmailInput) personEmailInput.value = "";
  prepareMasterView();
  populateDepartmentFilter();
  renderMasterList();
}

function ensureMasterStatus() {
  if (masterStatusEl || !masterForm) return;
  masterStatusEl = document.createElement("p");
  masterStatusEl.className = "form-status";
  masterStatusEl.setAttribute("aria-live", "polite");
  const schedule = masterForm.querySelector(".payment-schedule");
  masterForm.insertBefore(masterStatusEl, schedule || null);
}

function setMasterStatus(message, isError = false) {
  ensureMasterStatus();
  if (!masterStatusEl) return;
  masterStatusEl.hidden = !message;
  masterStatusEl.textContent = message || "";
  masterStatusEl.classList.toggle("error", isError);
}

addPersonButton.addEventListener("click", addPerson);
personNameInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addPerson(); } });
if (masterSearch) masterSearch.addEventListener("input", scheduleRenderMasterList);
if (departmentFilter) departmentFilter.addEventListener("change", scheduleRenderMasterList);
if (selectAllDepartmentsButton) {
  selectAllDepartmentsButton.addEventListener("click", () => {
    [...departmentFilter.options].forEach((option) => { option.selected = true; });
    departmentFilterControl?.refresh?.();
    scheduleRenderMasterList();
  });
}
if (clearDepartmentsButton) {
  clearDepartmentsButton.addEventListener("click", () => {
    [...departmentFilter.options].forEach((option) => { option.selected = false; });
    departmentFilterControl?.refresh?.();
    scheduleRenderMasterList();
  });
}
if (masterForm) masterForm.addEventListener("submit", (e) => e.preventDefault());
document.addEventListener("click", (event) => {
  if (!event.target.closest(".department-filter")) departmentFilterControl?.close?.();
});

function init() {
  ensureMasterStatus();
  heads = getMasterPersons();
  prepareMasterView();
  populateDepartmentFilter();
  renderMasterList();
}

ODC.ready.then(() => {
  masterViewReady = true;
  init();
});
ODC.registerSync(() => {
  if (!masterViewReady) return;
  heads = getMasterPersons();
  prepareMasterView();
  populateDepartmentFilter();
  renderMasterList();
});
