(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const paths = {
    dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    atividades:'M8 5h13 M8 12h13 M8 19h13 M3 5h.01 M3 12h.01 M3 19h.01',
    curvas:'M3 3v18h18 M6 17l5-6 4 2 5-8',
    avanco:'M4 16v5h5L21 9l-5-5L4 16z M13 7l5 5',
    reuniao:'M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0z M7 10h9 M7 14h5',
    contatos:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M15 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    report:'M14 2H5v20h14V7z M14 2v6h5 M8 12h8 M8 16h8',
    inserir:'M12 4v16 M4 12h16',
    filter:'M3 4h18L14 12v7l-4 2v-9z',
    print:'M6 9V3h12v6 M6 18H3V9h18v9h-3 M6 14h12v8H6z',
    shield:'M12 2l9 4v6c0 6-9 10-9 10S3 18 3 12V6z M8 12l3 3 5-6',
  };
  function icon(name) {
    return '<svg class="ka-pro-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.dashboard)+'"/></svg>';
  }
  const names = {dashboard:'Visão geral',atividades:'Atividades',curvas:'Curva S',avanco:'Avanço em campo',reuniao:'Plano de ação',contatos:'Contatos',report:'Relatório da parada',inserir:'Nova atividade'};
  function viewName() { return document.querySelector('.view.active')?.id.replace('view-','') || 'dashboard'; }
  function goTo(view) {
    const button = [...document.querySelectorAll('.tabs .tab')].find(b => (b.getAttribute('onclick')||'').includes("showTab('"+view+"'"));
    if (button) button.click();
  }
  function cleanHeading(node) {
    if (!node) return;
    for (const child of node.childNodes) if (child.nodeType===3) child.textContent=child.textContent.replace(/^[^\p{L}\p{N}]+/u,'');
  }
  function arrangeDashboard() {
    const board=document.querySelector('#view-dashboard .cc-dashboard');
    if(!board) return;
    const headline=board.querySelector('.cc-command-header');
    const kpis=byId('controlKpis');
    if(headline && kpis) headline.after(kpis);
    const perf=board.querySelector('.cc-performance-grid');
    const perfTitle=perf?.previousElementSibling;
    if(kpis && perf && perfTitle?.classList.contains('cc-section-heading')) {
      kpis.after(perfTitle); perfTitle.after(perf);
    }
    const hero=board.querySelector('.cc-hero-grid');
    if(perf && hero) perf.after(hero);
    const disc=board.querySelector('.cc-disc-farol-card');
    const areas=board.querySelector('.cc-area-card');
    if(disc && areas){disc.classList.add('ka-pro-disciplines');areas.after(disc);}
    const details=board.querySelector('.cc-details');
    if(details && !details.querySelector('.control-card')) details.remove();
    board.querySelectorAll('.control-card-header h3').forEach(cleanHeading);
    board.querySelectorAll('.cc-section-heading').forEach(section=>{
      if(section.textContent.includes('Controles de liberação')){
        const strong=section.querySelector('strong');if(strong)strong.textContent='Pontos de atenção';
        const small=section.querySelector('small');if(small)small.textContent='Impeditivas, caminho crítico e mudanças de escopo';
      }
    });
    const subtitle=board.querySelector('.cc-command-time small');
    if(subtitle)subtitle.textContent='Referência dos cálculos';
    const title=headline?.querySelector('h2');if(title)title.textContent='A parada, em uma visão.';
  }
  function init() {
    if(byId('kaProTopbar')) return;
    document.body.classList.add('ka-pro');
    const wrap=document.querySelector('.wrap');if(!wrap) return;
    const bar=document.createElement('div');bar.id='kaProTopbar';bar.className='ka-pro-topbar no-print';
    bar.innerHTML='<div><div class="ka-pro-breadcrumb">K.A Gestão de Paradas <span>/</span> Operação</div><h1 class="ka-pro-page-title" id="kaProPageTitle">Visão geral</h1></div><div class="ka-pro-top-actions"><button type="button" class="ka-pro-print admin-hide" id="kaProPrint">'+icon('print')+'Exportar PDF</button></div>';
    wrap.prepend(bar);
    const access=byId('pcmAdminBar');if(access)bar.querySelector('.ka-pro-top-actions').append(access);
    byId('kaProPrint').addEventListener('click',()=>{
      const view=viewName();
      const handlers={dashboard:'generateDashboardPdf',report:'printReport',reuniao:'printMeeting'};
      if(handlers[view]&&typeof window[handlers[view]]==='function')window[handlers[view]]();
      else window.print();
    });
    document.querySelectorAll('.tabs .tab').forEach(button=>{
      const action=button.getAttribute('onclick')||'';
      const view=action.match(/showTab\('([^']+)'/)?.[1] || (action.includes('openNewActivity')?'inserir':null);
      if(!view||!names[view])return;
      button.innerHTML='<span class="ka-nav-icon">'+icon(view)+'</span><span class="ka-nav-label">'+names[view]+'</span>';
      button.title=names[view];
    });
    const navTitle=document.querySelector('.ka-nav-title');if(navTitle)navTitle.textContent='Acompanhamento';
    const toolbar=document.querySelector('.toolbar');
    if(toolbar){
      const tools=document.createElement('details');tools.className='ka-pro-tools admin-hide no-print';tools.id='kaProTools';
      tools.innerHTML='<summary>'+icon('atividades')+'Importar, exportar e ferramentas da base</summary>';
      toolbar.before(tools);tools.append(toolbar);
    }
    const filters=byId('filtersCard');
    if(filters){
      const title=filters.querySelector('.section-title h2');if(title)title.textContent='Filtrar atividades';
      const grid=filters.querySelector('.filter-grid,.filters');
      if(grid){
        grid.classList.add('filter-grid');
        const order=['fDisciplina','fArea','fOM','fEquipamento','fStatus'];
        order.forEach(id=>{const field=byId(id);if(field?.parentElement)grid.append(field.parentElement);});
        const ref=byId('refTime')?.parentElement;
        if(ref){ref.classList.add('ka-filter-reference');grid.append(ref);}
        const actions=[...grid.children].find(n=>n.querySelector('button[onclick="useNow()"]'));
        if(actions){actions.classList.add('ka-filter-actions');grid.append(actions);}
      }
    }
    // Delay expensive recalculation while typing; selectors still apply immediately.
    ['fOM','fEquipamento','avBusca','avEquipamento','avOM'].forEach(id=>{
      const field=byId(id);if(!field)return;field.removeAttribute('oninput');let timer;
      field.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>id.startsWith('av')?window.avRender?.():window.renderAll?.(),220);});
    });
    const avFilters=byId('avBusca')?.parentElement?.parentElement;if(avFilters)avFilters.classList.add('ka-pro-av-filters');
    document.querySelectorAll('.ka-editor-field,.ka-filter-field,.ka-pro-av-filters>div').forEach(field=>{
      const label=field.querySelector('label'),input=field.querySelector('input[id],select[id],textarea[id]');
      if(label&&input&&!label.htmlFor)label.htmlFor=input.id;
    });
    const sharedStatus=byId('kaSharedStatus');if(sharedStatus){sharedStatus.setAttribute('role','status');sharedStatus.setAttribute('aria-live','polite');}
    const planHelp=document.querySelector('#view-reuniao .meeting-card>p.small-muted');
    if(planHelp)planHelp.textContent='Edite as ações na tabela e confira a confirmação no status online. Exporte uma cópia de segurança ao encerrar o turno.';
    const table=byId('activityTable');
    if(table){
      const help=document.createElement('div');help.className='ka-pro-table-help';
      help.innerHTML='<span>Duplo clique na atividade para editar. As descrições são exibidas por completo.</span><span>Deslize a tabela para ver as demais colunas →</span>';
      table.closest('.table-wrap')?.after(help);
    }
    arrangeDashboard();
    const health=document.createElement('details');health.id='kaProHealth';health.className='ka-pro-health admin-hide no-print';
    health.innerHTML='<summary>Cópia de segurança</summary><p id="kaProHealthText">Exporte uma cópia dos dados ao encerrar o turno. A atualização visual mantém o funcionamento online existente.</p><button type="button" id="kaProBackup">Baixar cópia de segurança</button>';
    wrap.append(health);
    byId('kaProBackup').addEventListener('click',()=>window.exportJSON?.());
    function syncView(){
      const view=viewName();byId('kaProPageTitle').textContent=names[view]||'Gestão de paradas';
      document.querySelectorAll('.tabs .tab').forEach(b=>b.setAttribute('aria-current',b.classList.contains('active')?'page':'false'));
      const print=byId('kaProPrint');
      print.innerHTML=icon('print')+(view==='report'?'Exportar relatório PDF':'Exportar PDF');
      print.hidden=!['dashboard','report','reuniao'].includes(view);
    }
    const observer=new MutationObserver(syncView);
    document.querySelectorAll('.view').forEach(view=>observer.observe(view,{attributes:true,attributeFilter:['class']}));
    syncView();
    window.kaProfessionalUI={goTo,refresh:syncView};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
