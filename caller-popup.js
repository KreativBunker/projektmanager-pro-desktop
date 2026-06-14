(function () {
  const bodyEl = document.getElementById('body');
  const footerEl = document.getElementById('footer');
  document.getElementById('btnClose').addEventListener('click', () => window.callerPopup.close());

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function render(data) {
    const phoneNumber = data && data.phoneNumber ? data.phoneNumber : '';
    const displayName = data && data.displayName ? data.displayName : '';
    const lookup = (data && data.lookup) || { found: false, matches: [] };
    const matches = lookup.matches || [];
    const m = lookup.found && matches[0] ? matches[0] : null;

    bodyEl.classList.toggle('unknown', !m);

    if (m) {
      const name = m.name || displayName || 'Kontakt';
      let html = '';
      html += '<div class="name">' + esc(name) + '</div>';
      if (m.firma) html += '<div class="firma">' + esc(m.firma) + '</div>';
      html += '<div class="meta">Nummer: <span class="num">' + esc(phoneNumber || m.phone || '') + '</span></div>';
      if (m.contact_name) html += '<span class="contact-tag">Ansprechpartner: ' + esc(m.contact_name) + '</span>';

      const projects = m.projects || [];
      if (projects.length) {
        html += '<div class="projects"><div class="head">Projekte</div>';
        projects.slice(0, 4).forEach((p) => {
          html += '<button class="project" data-url="' + esc(p.url) + '">' + esc(p.title || ('Projekt #' + p.id)) + '</button>';
        });
        html += '</div>';
      }
      if (matches.length > 1) {
        html += '<div class="more">+ ' + (matches.length - 1) + ' weitere(r) Treffer</div>';
      }
      bodyEl.innerHTML = html;

      // Footer: Kunde öffnen + Schließen
      footerEl.innerHTML =
        '<button class="btn btn-primary" id="btnCustomer">Kunde öffnen</button>' +
        '<button class="btn btn-secondary" id="btnDismiss">Schließen</button>';
      document.getElementById('btnCustomer').addEventListener('click', () => {
        if (m.customer_url) window.callerPopup.openUrl(m.customer_url);
      });
    } else {
      let html = '';
      html += '<div class="name">' + esc(displayName || 'Unbekannter Anrufer') + '</div>';
      html += '<div class="firma">Kein Kontakt gefunden</div>';
      html += '<div class="meta">Nummer: <span class="num">' + esc(phoneNumber) + '</span></div>';
      bodyEl.innerHTML = html;

      footerEl.innerHTML =
        '<button class="btn btn-secondary" id="btnDismiss">Schließen</button>';
    }

    // Projekt-Buttons verdrahten
    bodyEl.querySelectorAll('.project').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url');
        if (url) window.callerPopup.openUrl(url);
      });
    });

    const dismiss = document.getElementById('btnDismiss');
    if (dismiss) dismiss.addEventListener('click', () => window.callerPopup.close());
  }

  window.callerPopup.onData(render);
})();
