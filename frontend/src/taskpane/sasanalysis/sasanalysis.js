(function(){
  // 简单静态页：内容由 JS 注入到容器，保持与 otherdocuments 一样的加载方式
  function insertSasAnalysisHTML(container){
    if (!container) return;
    container.innerHTML = `
      <div class="sasanalysis-wrapper" style="padding:16px;">
        <h3 class="ms-font-l">SAS Analysis</h3>
      </div>
    `;
  }

  window.initSasAnalysisPage = function initSasAnalysisPage(cfg){
    const container = cfg && cfg.container ? cfg.container : document.getElementById('sasanalysis-container');
    insertSasAnalysisHTML(container);
  };
})();


