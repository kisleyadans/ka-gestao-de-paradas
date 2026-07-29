(function () {
  const document = window.document;
  if (document.documentElement.dataset.kaOfflineReady === "true") return;
  document.documentElement.dataset.kaOfflineReady = "true";

  document.title = "K.A - Gestão de Paradas (Offline)";
  document.documentElement.classList.add("ka-app-shell");
  document.body.classList.add("ka-app-layout", "ka-offline-mode");

  const heading = document.querySelector("header h1");
  if (heading) {
    heading.textContent = "K.A";
    const subtitle = document.createElement("span");
    subtitle.className = "ka-brand-subtitle";
    subtitle.textContent = "Gestão de Paradas";
    heading.after(subtitle);
  }

  const credit = document.querySelector(".header-credit");
  if (credit) {
    const owner = credit.querySelector("strong");
    if (owner) owner.textContent = "Sala de Controle";
    Array.from(credit.childNodes).forEach((node) => {
      if (node.nodeType === 3 && node.textContent && node.textContent.includes("Dev.")) {
        node.textContent = " · Uso local neste computador";
      }
    });
  }

  const header = document.querySelector("header");
  if (header) {
    const sidebarFooter = document.createElement("div");
    sidebarFooter.className = "ka-sidebar-footer";
    sidebarFooter.innerHTML = '<span class="ka-status-dot" aria-hidden="true"></span><div><strong>Arquivo offline</strong><small>Dados salvos neste computador</small></div>';
    header.appendChild(sidebarFooter);
  }

  const tabs = document.querySelector(".tabs");
  if (tabs) {
    tabs.setAttribute("aria-label", "Navegação principal");
    const navItems = [
      ["showTab('dashboard'", "▦", "Dashboard"],
      ["showTab('reuniao'", "◷", "Reunião de andamento"],
      ["showTab('atividades'", "≡", "Atividades cadastradas"],
      ["openNewActivity()", "+", "Inserir atividade"],
      ["showTab('curvas'", "↗", "Curva S"],
      ["showTab('dashboardBloqueios'", "◈", "Dashboard Bloqueios"],
      ["showTab('bloqueios'", "◇", "Desbloqueios"],
      ["showTab('limpezas'", "✦", "Limpezas"],
      ["showTab('report'", "▤", "Relatório da Parada"]
    ];

    tabs.querySelectorAll(".tab").forEach((button) => {
      const action = button.getAttribute("onclick") || "";
      const item = navItems.find((entry) => action.includes(entry[0]));
      if (!item) return;
      button.textContent = "";
      const icon = document.createElement("span");
      icon.className = "ka-nav-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = item[1];
      const label = document.createElement("span");
      label.className = "ka-nav-label";
      label.textContent = item[2];
      button.append(icon, label);
    });

    const navTitle = document.createElement("div");
    navTitle.className = "ka-nav-title";
    navTitle.textContent = "Módulos da parada";
    tabs.prepend(navTitle);
  }

  const mobileTitle = document.createElement("div");
  mobileTitle.className = "ka-mobile-title";
  mobileTitle.innerHTML = "<strong>K.A</strong><span>Gestão de Paradas</span>";
  document.body.prepend(mobileTitle);

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "ka-menu-toggle";
  menuButton.setAttribute("aria-label", "Abrir menu principal");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.innerHTML = '<span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>';
  document.body.prepend(menuButton);

  const menuOverlay = document.createElement("button");
  menuOverlay.type = "button";
  menuOverlay.className = "ka-menu-overlay";
  menuOverlay.setAttribute("aria-label", "Fechar menu principal");
  document.body.prepend(menuOverlay);

  const closeMenu = function () {
    document.body.classList.remove("ka-menu-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Abrir menu principal");
  };
  menuButton.addEventListener("click", function () {
    const isOpen = document.body.classList.toggle("ka-menu-open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Fechar menu principal" : "Abrir menu principal");
  });
  menuOverlay.addEventListener("click", closeMenu);
  if (tabs) {
    tabs.addEventListener("click", function (event) {
      if (event.target.closest(".tab") && window.innerWidth <= 920) closeMenu();
    });
  }

  const activityEditor = document.getElementById("view-inserir");
  const activityForm = document.getElementById("formCard");
  const activityGrid = activityForm && activityForm.querySelector(".form-grid");
  const activityTitle = document.getElementById("formTitle");
  const closeActivityEditor = function () {
    document.body.classList.remove("ka-activity-editor-open");
    if (typeof window.goToActivitiesList === "function") window.goToActivitiesList();
  };

  if (activityEditor && activityForm && activityGrid) {
    activityEditor.setAttribute("role", "dialog");
    activityEditor.setAttribute("aria-modal", "true");
    activityEditor.setAttribute("aria-labelledby", "formTitle");
    activityForm.classList.add("ka-activity-editor-card");

    const titleBar = activityTitle && activityTitle.parentElement;
    if (titleBar) titleBar.classList.add("ka-activity-editor-title");
    const resetButton = titleBar && titleBar.querySelector('button[onclick="resetForm()"]');
    if (resetButton && titleBar) {
      resetButton.textContent = "Limpar";
      const headingActions = document.createElement("div");
      headingActions.className = "ka-editor-heading-actions";
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "ka-editor-close";
      closeButton.setAttribute("aria-label", "Fechar cadastro de atividade");
      closeButton.textContent = "×";
      closeButton.addEventListener("click", closeActivityEditor);
      headingActions.append(resetButton, closeButton);
      titleBar.appendChild(headingActions);
    }

    const hint = activityForm.querySelector(".hint");
    if (hint) {
      hint.classList.add("ka-editor-hint");
      hint.textContent = "Cadastre ou ajuste a atividade. Os campos de avanço também podem ser atualizados diretamente na tabela.";
    }

    const addGroup = function (beforeFieldId, label) {
      const input = document.getElementById(beforeFieldId);
      const field = input && input.parentElement;
      if (!field || field.parentElement !== activityGrid) return;
      const group = document.createElement("div");
      group.className = "ka-editor-group";
      group.textContent = label;
      activityGrid.insertBefore(group, field);
    };
    addGroup("disciplina", "Identificação");
    addGroup("inicio", "Planejamento");
    addGroup("inicioReal", "Execução e avanço");
    addGroup("obs", "Observações e ações");

    activityGrid.querySelectorAll(":scope > div").forEach(function (field) {
      if (!field.classList.contains("ka-editor-group")) field.classList.add("ka-editor-field");
    });
    ["atividade", "obs", "acao"].forEach(function (id) {
      const input = document.getElementById(id);
      if (input && input.parentElement) input.parentElement.classList.add("ka-editor-wide");
    });

    const actionBar = Array.from(activityGrid.children).find(function (element) {
      return element.querySelector('button[onclick="saveActivity(false)"]');
    });
    if (actionBar) {
      actionBar.classList.add("ka-editor-actions");
      const saveButton = actionBar.querySelector('button[onclick="saveActivity(false)"]');
      const saveAnotherButton = actionBar.querySelector('button[onclick="saveActivity(true)"]');
      const cancelButton = actionBar.querySelector('button[onclick="goToActivitiesList()"]');
      if (saveButton) saveButton.textContent = "Salvar atividade";
      if (saveAnotherButton) saveAnotherButton.textContent = "Salvar + nova";
      if (cancelButton) cancelButton.textContent = "Cancelar";
    }

    const activityOverlay = document.createElement("button");
    activityOverlay.type = "button";
    activityOverlay.className = "ka-activity-editor-overlay";
    activityOverlay.setAttribute("aria-label", "Fechar cadastro de atividade");
    activityOverlay.addEventListener("click", closeActivityEditor);
    document.body.prepend(activityOverlay);

    let activityEditorWasOpen = false;
    const syncActivityEditorState = function () {
      const isOpen = activityEditor.classList.contains("active");
      document.body.classList.toggle("ka-activity-editor-open", isOpen);
      if (isOpen && !activityEditorWasOpen) {
        window.setTimeout(function () {
          const target = document.getElementById("atividade") || document.getElementById("disciplina");
          if (target) target.focus();
        }, 80);
      }
      activityEditorWasOpen = isOpen;
    };
    const syncAfterNavigation = function () { window.setTimeout(syncActivityEditorState, 0); };
    document.addEventListener("click", syncAfterNavigation);
    document.addEventListener("dblclick", syncAfterNavigation);
    syncActivityEditorState();
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    closeMenu();
    if (activityEditor && activityEditor.classList.contains("active")) closeActivityEditor();
  });
})();
