"use client";

import { useState } from "react";

export default function Home() {
  const [loading, setLoading] = useState(true);

  function prepareOperationalPanel(frame: HTMLIFrameElement) {
    const document = frame.contentDocument;
    const frameWindow = frame.contentWindow;
    if (!document) {
      setLoading(false);
      return;
    }

    document.title = "K.A - Gestão de Paradas";
    document.documentElement.classList.add("ka-app-shell");
    document.body.classList.add("ka-app-layout");

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
      credit.childNodes.forEach((node) => {
        if (node.nodeType === 3 && node.textContent?.includes("Dev.")) {
          node.textContent = " · Planejamento e execução";
        }
      });
    }

    const header = document.querySelector("header");
    if (header) {
      const sidebarFooter = document.createElement("div");
      sidebarFooter.className = "ka-sidebar-footer";
      sidebarFooter.innerHTML = `
        <span class="ka-status-dot" aria-hidden="true"></span>
        <div><strong>Sistema operacional</strong><small>Base online compartilhada</small></div>
      `;
      header.appendChild(sidebarFooter);
    }

    const tabs = document.querySelector<HTMLElement>(".tabs");
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
        ["showTab('report'", "▤", "Relatório da Parada"],
      ];

      tabs.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => {
        const action = button.getAttribute("onclick") ?? "";
        const item = navItems.find(([match]) => action.includes(match));
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

    const overlay = document.createElement("button");
    overlay.type = "button";
    overlay.className = "ka-menu-overlay";
    overlay.setAttribute("aria-label", "Fechar menu principal");
    document.body.prepend(overlay);

    const closeMenu = () => {
      document.body.classList.remove("ka-menu-open");
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", "Abrir menu principal");
    };

    menuButton.addEventListener("click", () => {
      const isOpen = document.body.classList.toggle("ka-menu-open");
      menuButton.setAttribute("aria-expanded", String(isOpen));
      menuButton.setAttribute("aria-label", isOpen ? "Fechar menu principal" : "Abrir menu principal");
    });
    overlay.addEventListener("click", closeMenu);
    tabs?.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(".tab") && (frameWindow?.innerWidth ?? 0) <= 920) closeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });

    const activityEditor = document.getElementById("view-inserir");
    const activityForm = document.getElementById("formCard");
    const activityGrid = activityForm?.querySelector<HTMLElement>(".form-grid");
    const activityTitle = document.getElementById("formTitle");
    const closeActivityEditor = () => {
      document.body.classList.remove("ka-activity-editor-open");
      const goToActivitiesList = (frameWindow as Window & {
        goToActivitiesList?: () => void;
      } | null)?.goToActivitiesList;
      goToActivitiesList?.();
    };

    if (activityEditor && activityForm && activityGrid) {
      activityEditor.setAttribute("role", "dialog");
      activityEditor.setAttribute("aria-modal", "true");
      activityEditor.setAttribute("aria-labelledby", "formTitle");
      activityForm.classList.add("ka-activity-editor-card");

      const titleBar = activityTitle?.parentElement;
      titleBar?.classList.add("ka-activity-editor-title");
      const resetButton = titleBar?.querySelector<HTMLButtonElement>('button[onclick="resetForm()"]');
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

      const hint = activityForm.querySelector<HTMLElement>(".hint");
      if (hint) {
        hint.classList.add("ka-editor-hint");
        hint.textContent = "Cadastre ou ajuste a atividade. Os campos de avanço também podem ser atualizados diretamente na tabela.";
      }

      const addGroup = (beforeFieldId: string, label: string) => {
        const field = document.getElementById(beforeFieldId)?.parentElement;
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

      activityGrid.querySelectorAll<HTMLElement>(":scope > div").forEach((field) => {
        if (!field.classList.contains("ka-editor-group")) field.classList.add("ka-editor-field");
      });
      ["atividade", "obs", "acao"].forEach((id) => {
        document.getElementById(id)?.parentElement?.classList.add("ka-editor-wide");
      });

      const actionBar = Array.from(activityGrid.children).find((element) =>
        element.querySelector('button[onclick="saveActivity(false)"]'),
      ) as HTMLElement | undefined;
      if (actionBar) {
        actionBar.classList.add("ka-editor-actions");
        const saveButton = actionBar.querySelector<HTMLButtonElement>('button[onclick="saveActivity(false)"]');
        const saveAnotherButton = actionBar.querySelector<HTMLButtonElement>('button[onclick="saveActivity(true)"]');
        const cancelButton = actionBar.querySelector<HTMLButtonElement>('button[onclick="goToActivitiesList()"]');
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
      const syncActivityEditorState = () => {
        const isOpen = activityEditor.classList.contains("active");
        document.body.classList.toggle("ka-activity-editor-open", isOpen);
        if (isOpen && !activityEditorWasOpen) {
          frameWindow?.setTimeout(() => {
            (document.getElementById("atividade") ?? document.getElementById("disciplina"))?.focus();
          }, 80);
        }
        activityEditorWasOpen = isOpen;
      };
      const syncAfterNavigation = () => frameWindow?.setTimeout(syncActivityEditorState, 0);
      document.addEventListener("click", syncAfterNavigation);
      document.addEventListener("dblclick", syncAfterNavigation);
      syncActivityEditorState();

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && activityEditor.classList.contains("active")) closeActivityEditor();
      });
    }

    const customStyle = document.createElement("style");
    customStyle.dataset.kaApp = "true";
    customStyle.textContent = `
      :root {
        --ka-sidebar: 244px;
        --ka-sidebar-dark: #062f22;
        --ka-sidebar-mid: #075f3d;
        --ka-surface: #f4f7f6;
      }
      html.ka-app-shell { background: var(--ka-surface); }
      body.ka-app-layout {
        min-height: 100vh;
        background:
          radial-gradient(circle at 92% 4%, rgba(0,133,66,.08), transparent 24rem),
          var(--ka-surface);
      }
      body.ka-app-layout > header {
        align-items: stretch;
        background: linear-gradient(165deg, var(--ka-sidebar-dark) 0%, var(--ka-sidebar-mid) 70%, #007c49 100%);
        border: 0;
        bottom: 0;
        box-shadow: 10px 0 34px rgba(6,47,34,.14);
        display: block;
        left: 0;
        overflow: hidden;
        padding: 25px 19px;
        position: fixed;
        top: 0;
        width: var(--ka-sidebar);
        z-index: 1000;
      }
      body.ka-app-layout > header > div:first-child {
        border-bottom: 1px solid rgba(255,255,255,.12);
        padding: 0 5px 20px;
      }
      body.ka-app-layout > header h1 {
        color: #fff;
        font-size: 28px;
        font-weight: 950;
        letter-spacing: .08em;
        line-height: 1;
        margin: 0;
      }
      .ka-brand-subtitle {
        color: #fdd500;
        display: block;
        font-size: 14px;
        font-weight: 850;
        letter-spacing: .02em;
        margin-top: 7px;
      }
      body.ka-app-layout > header .header-credit {
        color: rgba(255,255,255,.66);
        font-size: 10px;
        line-height: 1.45;
        margin-top: 13px;
        text-align: left;
      }
      body.ka-app-layout > header .header-credit strong {
        color: rgba(255,255,255,.92);
        display: inline;
        font-size: 10px;
        letter-spacing: .02em;
      }
      body.ka-app-layout > header #lastUpdateStamp {
        color: rgba(255,255,255,.58) !important;
        margin-top: 8px !important;
      }
      header::after {
        content: "K.A";
        position: absolute;
        right: -12px;
        bottom: 58px;
        color: rgba(255,255,255,.035);
        font: 950 76px/1 Arial, sans-serif;
        letter-spacing: .02em;
        pointer-events: none;
        transform: rotate(-90deg);
      }
      body.ka-app-layout > .wrap {
        margin: 0 0 0 var(--ka-sidebar);
        max-width: none;
        min-height: 100vh;
        padding: 18px 24px 48px;
        width: auto;
      }
      body.ka-app-layout .tabs {
        align-content: flex-start;
        bottom: 94px;
        display: flex;
        flex-direction: column;
        flex-wrap: nowrap;
        gap: 5px;
        left: 0;
        margin: 0;
        overflow-y: auto;
        padding: 14px 13px 20px;
        position: fixed;
        scrollbar-color: rgba(255,255,255,.22) transparent;
        top: 158px;
        width: var(--ka-sidebar);
        z-index: 1002;
      }
      .ka-nav-title {
        color: rgba(255,255,255,.46);
        font-size: 9px;
        font-weight: 900;
        letter-spacing: .13em;
        padding: 4px 10px 8px;
        text-transform: uppercase;
      }
      body.ka-app-layout .tabs .tab {
        align-items: center;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 10px;
        box-shadow: none;
        color: rgba(255,255,255,.76);
        display: flex;
        flex: 0 0 auto;
        gap: 11px;
        justify-content: flex-start;
        min-height: 43px;
        padding: 9px 10px;
        text-align: left;
        text-transform: none;
        width: 100%;
      }
      body.ka-app-layout .tabs .tab:hover {
        background: rgba(255,255,255,.08);
        color: #fff;
      }
      body.ka-app-layout .tabs .tab.active {
        background: #fff;
        border-color: rgba(255,255,255,.7);
        box-shadow: 0 8px 20px rgba(0,22,14,.2);
        color: #06442e;
      }
      .ka-nav-icon {
        align-items: center;
        background: rgba(255,255,255,.1);
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 8px;
        display: inline-flex;
        flex: 0 0 28px;
        font-size: 17px;
        font-weight: 900;
        height: 28px;
        justify-content: center;
      }
      .tab.active .ka-nav-icon {
        background: #e8f5ee;
        border-color: #c7e6d3;
        color: #007642;
      }
      .ka-nav-label {
        font-size: 11px;
        font-weight: 820;
        letter-spacing: .01em;
      }
      .ka-sidebar-footer {
        align-items: center;
        border-top: 1px solid rgba(255,255,255,.1);
        bottom: 0;
        display: flex;
        gap: 9px;
        left: 0;
        padding: 17px 19px;
        position: absolute;
        width: 100%;
      }
      .ka-sidebar-footer strong,
      .ka-sidebar-footer small { display: block; }
      .ka-sidebar-footer strong { color: #fff; font-size: 10px; }
      .ka-sidebar-footer small { color: rgba(255,255,255,.5); font-size: 9px; margin-top: 2px; }
      .ka-status-dot {
        background: #58d68d;
        border: 3px solid rgba(88,214,141,.16);
        border-radius: 50%;
        box-shadow: 0 0 0 3px rgba(88,214,141,.09);
        height: 9px;
        width: 9px;
      }
      body.ka-app-layout .toolbar {
        align-items: center;
        background: rgba(255,255,255,.94);
        border: 1px solid #e2e9e6;
        border-radius: 13px;
        box-shadow: 0 5px 18px rgba(26,68,50,.06);
        display: flex;
        gap: 7px;
        margin: 0 0 13px;
        padding: 9px;
      }
      body.ka-app-layout .toolbar button {
        border-radius: 8px;
        font-size: 9px;
        min-height: 34px;
        padding: 7px 10px;
      }
      body.ka-app-layout #pcmAdminBar {
        border-radius: 11px;
        margin: 0 0 13px;
      }
      body.ka-app-layout .card { box-shadow: 0 5px 18px rgba(24,63,47,.055); }
      .ka-menu-toggle,
      .ka-menu-overlay,
      .ka-mobile-title { display: none; }

      @media (max-width: 1120px) and (min-width: 921px) {
        :root { --ka-sidebar: 218px; }
        body.ka-app-layout > header { padding-left: 16px; padding-right: 16px; }
        body.ka-app-layout .tabs { padding-left: 10px; padding-right: 10px; }
      }

      @media (max-width: 920px) {
        body.ka-app-layout > header,
        body.ka-app-layout .tabs {
          transform: translateX(-105%);
          transition: transform .22s ease;
        }
        body.ka-app-layout.ka-menu-open > header,
        body.ka-app-layout.ka-menu-open .tabs { transform: translateX(0); }
        body.ka-app-layout > header { width: 268px; z-index: 1102; }
        body.ka-app-layout .tabs { width: 268px; z-index: 1103; }
        body.ka-app-layout > .wrap {
          margin-left: 0;
          padding: 68px 14px 38px;
        }
        .ka-mobile-title {
          align-items: center;
          backdrop-filter: blur(14px);
          background: rgba(255,255,255,.94);
          border-bottom: 1px solid #e2e9e6;
          display: flex;
          gap: 8px;
          height: 58px;
          left: 0;
          padding: 0 14px 0 70px;
          position: fixed;
          right: 0;
          top: 0;
          z-index: 1050;
        }
        .ka-mobile-title strong {
          color: #07402e;
          font-size: 17px;
          letter-spacing: .06em;
        }
        .ka-mobile-title span {
          border-left: 1px solid #dbe5e0;
          color: #64746c;
          font-size: 11px;
          font-weight: 750;
          padding-left: 8px;
        }
        .ka-menu-toggle {
          align-items: center;
          background: #073f2d;
          border: 0;
          border-radius: 10px;
          box-shadow: 0 8px 22px rgba(6,47,34,.2);
          display: flex;
          flex-direction: column;
          gap: 4px;
          height: 42px;
          justify-content: center;
          left: 14px;
          padding: 0;
          position: fixed;
          top: 8px;
          width: 44px;
          z-index: 1200;
        }
        .ka-menu-toggle span {
          background: #fff;
          border-radius: 2px;
          height: 2px;
          transition: transform .2s ease, opacity .2s ease;
          width: 18px;
        }
        .ka-menu-open .ka-menu-toggle { left: 207px; }
        .ka-menu-open .ka-menu-toggle span:nth-child(1) { transform: translateY(6px) rotate(45deg); }
        .ka-menu-open .ka-menu-toggle span:nth-child(2) { opacity: 0; }
        .ka-menu-open .ka-menu-toggle span:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }
        .ka-menu-overlay {
          background: rgba(4,25,18,.48) !important;
          border: 0;
          border-radius: 0;
          bottom: 0;
          box-shadow: none;
          display: block;
          left: 0;
          opacity: 0;
          padding: 0;
          pointer-events: none;
          position: fixed;
          right: 0;
          top: 0;
          transition: opacity .2s ease;
          z-index: 1080;
        }
        .ka-menu-overlay:hover { background: rgba(4,25,18,.48) !important; }
        .ka-menu-open .ka-menu-overlay { opacity: 1; pointer-events: auto; }
        body.ka-app-layout .toolbar {
          flex-wrap: nowrap;
          overflow-x: auto;
          padding: 8px;
          scrollbar-width: thin;
        }
        body.ka-app-layout .toolbar button { flex: 0 0 auto; }
      }

      @media (max-width: 560px) {
        body.ka-app-layout > .wrap { padding-left: 9px; padding-right: 9px; }
        body.ka-app-layout .card { border-radius: 11px; padding: 11px; }
        body.ka-app-layout .toolbar { border-radius: 11px; }
        body.ka-app-layout .section-title { align-items: flex-start; flex-direction: column; }
        body.ka-app-layout .section-title > div { width: 100%; }
      }

      @media (prefers-reduced-motion: reduce) {
        body.ka-app-layout > header,
        body.ka-app-layout .tabs,
        .ka-menu-toggle span,
        .ka-menu-overlay { transition: none; }
      }

      @media print {
        body.ka-app-layout > .wrap { margin-left: 0 !important; padding: 0 !important; }
        .ka-menu-toggle, .ka-menu-overlay, .ka-mobile-title, .ka-sidebar-footer { display: none !important; }
      }

      body.presentation-mode > header,
      body.meeting-mode > header,
      body.presentation-mode .ka-menu-toggle,
      body.meeting-mode .ka-menu-toggle,
      body.presentation-mode .ka-mobile-title,
      body.meeting-mode .ka-mobile-title { display: none !important; }
      body.presentation-mode > .wrap,
      body.meeting-mode > .wrap { margin-left: 0; padding-top: 18px; }
      body.presentation-mode .ka-menu-overlay,
      body.meeting-mode .ka-menu-overlay { display: none !important; }
      body.ka-app-layout .tabs .tab:focus-visible,
      .ka-menu-toggle:focus-visible {
        outline: 3px solid #fdd500;
        outline-offset: 2px;
      }

      .ka-activity-editor-overlay {
        background: rgba(6, 35, 27, .38);
        border: 0;
        border-radius: 0;
        cursor: default;
        display: none;
        inset: 0;
        padding: 0;
        position: fixed;
        width: 100%;
        z-index: 2100;
      }
      body.ka-activity-editor-open {
        overflow: hidden;
      }
      body.ka-activity-editor-open .ka-activity-editor-overlay {
        display: block;
      }
      body.ka-activity-editor-open #view-atividades {
        display: block !important;
      }
      body.ka-activity-editor-open #view-inserir {
        background: #f4f7f6;
        bottom: 0;
        box-shadow: -18px 0 50px rgba(6, 47, 34, .22);
        display: block !important;
        overflow: hidden;
        padding: 0;
        position: fixed;
        right: 0;
        top: 0;
        width: min(610px, calc(100vw - var(--ka-sidebar)));
        z-index: 2200;
      }
      body.ka-activity-editor-open #formCard.ka-activity-editor-card {
        border: 0;
        border-radius: 0;
        box-shadow: none;
        height: 100dvh;
        margin: 0;
        overflow-y: auto;
        padding: 0;
      }
      body.ka-activity-editor-open .ka-activity-editor-title {
        align-items: center;
        background: #fff;
        border-bottom: 1px solid #dce6e2;
        display: flex;
        flex-direction: row;
        gap: 12px;
        justify-content: space-between;
        margin: 0;
        padding: 13px 16px;
        position: sticky;
        top: 0;
        z-index: 4;
      }
      body.ka-activity-editor-open .ka-activity-editor-title h2 {
        font-size: 17px;
        line-height: 1.15;
        margin: 0;
      }
      .ka-editor-heading-actions {
        align-items: center;
        display: flex;
        flex: 0 0 auto;
        gap: 6px;
        width: auto !important;
      }
      .ka-editor-close {
        align-items: center;
        background: #edf3f0;
        border: 0;
        border-radius: 9px;
        color: #163c31;
        display: inline-flex;
        font-size: 22px;
        height: 34px;
        justify-content: center;
        line-height: 1;
        padding: 0;
        width: 34px;
      }
      body.ka-activity-editor-open .ka-editor-hint {
        background: #edf7f2;
        border-color: #cfe4da;
        font-size: 11px;
        line-height: 1.35;
        margin: 10px 16px 0 !important;
        padding: 8px 10px;
      }
      body.ka-activity-editor-open #formCard .form-grid {
        display: grid;
        gap: 8px 10px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        padding: 10px 16px 16px;
      }
      body.ka-activity-editor-open .ka-editor-group {
        border-top: 1px solid #dce6e2;
        color: #087348;
        font-size: 10px;
        font-weight: 900;
        grid-column: 1 / -1;
        letter-spacing: .08em;
        margin-top: 3px;
        padding-top: 9px;
        text-transform: uppercase;
      }
      body.ka-activity-editor-open .ka-editor-group:first-child {
        border-top: 0;
        margin-top: 0;
        padding-top: 0;
      }
      body.ka-activity-editor-open .ka-editor-field {
        min-width: 0;
      }
      body.ka-activity-editor-open .ka-editor-wide,
      body.ka-activity-editor-open .ka-editor-actions {
        grid-column: 1 / -1 !important;
      }
      body.ka-activity-editor-open #formCard label {
        font-size: 10px;
        line-height: 1.2;
        margin-bottom: 3px;
      }
      body.ka-activity-editor-open #formCard input,
      body.ka-activity-editor-open #formCard select,
      body.ka-activity-editor-open #formCard textarea {
        font-size: 12px;
        min-height: 34px;
        min-width: 0;
        padding: 6px 8px;
        width: 100%;
      }
      body.ka-activity-editor-open #formCard textarea {
        min-height: 48px;
        resize: vertical;
      }
      body.ka-activity-editor-open .ka-editor-actions {
        align-items: center !important;
        background: rgba(255,255,255,.97);
        border-top: 1px solid #dce6e2;
        bottom: 0;
        display: flex !important;
        gap: 7px !important;
        margin: 3px -16px -16px;
        padding: 11px 16px;
        position: sticky;
        z-index: 3;
      }
      body.ka-activity-editor-open .ka-editor-actions button {
        font-size: 11px;
        min-height: 34px;
        padding: 7px 10px;
      }

      @media (max-width: 920px) {
        body.ka-activity-editor-open #view-inserir {
          width: 100vw;
        }
      }

      @media (max-width: 520px) {
        body.ka-activity-editor-open .ka-activity-editor-title {
          padding: 11px 12px;
        }
        body.ka-activity-editor-open .ka-activity-editor-title h2 {
          font-size: 15px;
        }
        body.ka-activity-editor-open .ka-editor-hint {
          margin-left: 12px !important;
          margin-right: 12px !important;
        }
        body.ka-activity-editor-open .ka-editor-heading-actions > button[onclick="resetForm()"] {
          display: none;
        }
        body.ka-activity-editor-open #formCard .form-grid {
          grid-template-columns: minmax(0, 1fr);
          padding-left: 12px;
          padding-right: 12px;
        }
        body.ka-activity-editor-open .ka-editor-field,
        body.ka-activity-editor-open .ka-editor-group,
        body.ka-activity-editor-open .ka-editor-actions {
          grid-column: 1 !important;
        }
        body.ka-activity-editor-open .ka-editor-actions {
          display: grid !important;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          margin-left: -12px;
          margin-right: -12px;
          padding-left: 12px;
          padding-right: 12px;
        }
        body.ka-activity-editor-open .ka-editor-actions button {
          min-width: 0;
          white-space: nowrap;
        }
        body.ka-activity-editor-open .ka-editor-actions button:first-child {
          grid-column: 1 / -1;
        }
      }
    `;
    document.head.appendChild(customStyle);
    setLoading(false);
  }

  return (
    <main className="operational-shell">
      {loading && (
        <div className="loading-panel" role="status" aria-live="polite">
          <span className="loading-mark">P</span>
          <div>
            <strong>K.<span>A</span></strong>
            <small>Gestão de Paradas · Carregando centro de controle...</small>
          </div>
        </div>
      )}
      <iframe
        className={loading ? "operational-frame is-loading" : "operational-frame"}
        src="/para360-operacional.html"
        title="K.A - Gestão de Paradas"
        onLoad={(event) => prepareOperationalPanel(event.currentTarget)}
        allow="clipboard-read; clipboard-write"
      />
    </main>
  );
}
