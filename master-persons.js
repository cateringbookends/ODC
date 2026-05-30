const headNameInput = document.querySelector("#headName");
const personNameInput = document.querySelector("#personName");
const addPersonButton = document.querySelector("#addPerson");
const masterList = document.querySelector("#masterList");
const masterForm = document.querySelector("#masterPersonsForm");

let heads = getMasterPersons();

function makeId(name) {
  return `head-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || Date.now()}`;
}

// Built entirely with DOM nodes + textContent so head/person names can never
// inject HTML (previously interpolated straight into innerHTML).
function renderMasterList() {
  masterList.innerHTML = "";

  heads.forEach((head) => {
    const group = document.createElement("section");
    group.className = "master-group";

    const header = document.createElement("div");
    header.className = "master-group-header";
    const title = document.createElement("h2");
    title.textContent = head.name;
    const removeHead = document.createElement("button");
    removeHead.type = "button";
    removeHead.className = "remove-master-head";
    removeHead.dataset.headId = head.id;
    removeHead.setAttribute("aria-label", `Remove ${head.name}`);
    removeHead.textContent = "Remove Head";
    removeHead.addEventListener("click", () => {
      heads = heads.filter((h) => h.id !== head.id);
      saveMasterPersons(heads);
      renderMasterList();
    });
    header.append(title, removeHead);

    const ul = document.createElement("ul");
    if (!head.persons.length) {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = "No persons added";
      li.append(span);
      ul.append(li);
    } else {
      head.persons.forEach((person) => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.textContent = person;
        const removePerson = document.createElement("button");
        removePerson.type = "button";
        removePerson.className = "remove-master-person";
        removePerson.dataset.headId = head.id;
        removePerson.dataset.person = person;
        removePerson.setAttribute("aria-label", `Remove ${person}`);
        removePerson.textContent = "Remove";
        removePerson.addEventListener("click", () => {
          const h = heads.find((item) => item.id === head.id);
          if (h) h.persons = h.persons.filter((p) => p !== person);
          saveMasterPersons(heads);
          renderMasterList();
        });
        li.append(span, removePerson);
        ul.append(li);
      });
    }

    group.append(header, ul);
    masterList.append(group);
  });
}

function addPerson() {
  const headName = headNameInput.value.trim();
  const personName = personNameInput.value.trim();
  if (!headName || !personName) return;

  let head = heads.find((item) => item.name.toLowerCase() === headName.toLowerCase());
  if (!head) {
    head = { id: makeId(headName), name: headName, persons: [] };
    heads.push(head);
  }
  if (!head.persons.some((person) => person.toLowerCase() === personName.toLowerCase())) {
    head.persons.push(personName);
  }

  saveMasterPersons(heads);
  personNameInput.value = "";
  renderMasterList();
}

addPersonButton.addEventListener("click", addPerson);
personNameInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addPerson(); } });
if (masterForm) masterForm.addEventListener("submit", (e) => e.preventDefault());

function init() {
  heads = getMasterPersons();
  renderMasterList();
}

ODC.ready.then(init);
ODC.registerSync(() => { heads = getMasterPersons(); renderMasterList(); });
