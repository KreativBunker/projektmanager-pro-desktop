(function () {
  const bodyEl = document.getElementById('body');
  const footerEl = document.getElementById('footer');
  document.getElementById('btnClose').addEventListener('click', () => window.callerPopup.close());

  let current = null;       // aktuelle Anrufdaten
  let interacted = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Erste Interaktion -> Auto-Ausblenden abbrechen.
  function markInteracted() {
    if (interacted) return;
    interacted = true;
    window.callerPopup.keepOpen();
  }

  function setStatus(msg, kind) {
    const el = document.getElementById('callStatus');
    if (el) { el.textContent = msg || ''; el.className = 'status' + (kind ? ' ' + kind : ''); }
  }

  function render(data) {
    current = data || {};
    interacted = false;
    const phoneNumber = current.phoneNumber || '';
    const displayName = current.displayName || '';
    const lookup = current.lookup || { found: false, matches: [] };
    const matches = lookup.matches || [];
    const m = lookup.found && matches[0] ? matches[0] : null;

    bodyEl.classList.toggle('unknown', !m);

    let html = '';
    if (m) {
      html += '<div class="name">' + esc(m.name || displayName || 'Kontakt') + '</div>';
      if (m.firma) html += '<div class="firma">' + esc(m.firma) + '</div>';
      html += '<div class="meta">Nummer: <span class="num">' + esc(phoneNumber || m.phone || '') + '</span></div>';
      if (m.contact_name) html += '<span class="contact-tag">Ansprechpartner: ' + esc(m.contact_name) + '</span>';

      const projects = m.projects || [];
      if (projects.length) {
        const sel = current.matchedProject;
        // Standard "— kein Projekt —": Zuordnung erfolgt bewusst. Ohne Auswahl
        // erscheint der Anruf nur im globalen Aktivitäten-Panel; mit Auswahl
        // zusätzlich im Projekt-Feed.
        html += '<div class="field"><label>Projekt (optional)</label><select id="projSelect">';
        html += '<option value="">— kein Projekt —</option>';
        projects.forEach((p) => {
          const selected = (sel != null && String(sel) === String(p.id)) ? ' selected' : '';
          html += '<option value="' + esc(p.id) + '"' + selected + '>' + esc(p.title || ('Projekt #' + p.id)) + '</option>';
        });
        html += '</select></div>';
      } else {
        html += '<div class="field"><label>Projekt</label><div style="font-size:12px;color:#86868b;">Kein aktives Projekt – Anruf erscheint im Aktivitäten-Panel und kann dort später zugeordnet werden.</div></div>';
      }
    } else {
      html += '<div class="name">' + esc(displayName || 'Unbekannter Anrufer') + '</div>';
      html += '<div class="firma">Kein Kontakt gefunden</div>';
      html += '<div class="meta">Nummer: <span class="num">' + esc(phoneNumber) + '</span></div>';
      html += '<div class="field"><label>Name (optional)</label><input type="text" id="nameInput" placeholder="Name des Anrufers"></div>';
    }

    html += '<div class="field"><label>Anliegen / Notiz</label><textarea id="noteInput" placeholder="Was wollte der Anrufer?"></textarea></div>';
    html += '<div class="status" id="callStatus"></div>';
    bodyEl.innerHTML = html;

    // Footer
    if (m) {
      footerEl.innerHTML =
        '<button class="btn btn-secondary" id="btnCustomer">Kunde öffnen</button>' +
        '<button class="btn btn-primary" id="btnSave">Speichern</button>';
      const c = document.getElementById('btnCustomer');
      if (c) c.addEventListener('click', () => { if (m.customer_url) window.callerPopup.openUrl(m.customer_url); });
    } else {
      footerEl.innerHTML =
        '<button class="btn btn-secondary" id="btnCreate">Kunde anlegen</button>' +
        '<button class="btn btn-primary" id="btnSave">Speichern</button>';
      const cr = document.getElementById('btnCreate');
      if (cr) cr.addEventListener('click', () => { if (current.createCustomerUrl) window.callerPopup.openUrl(current.createCustomerUrl); });
    }

    // Interaktion erkennen (Auto-Hide abbrechen)
    bodyEl.querySelectorAll('input, textarea, select').forEach((el) => {
      el.addEventListener('focus', markInteracted);
      el.addEventListener('input', markInteracted);
    });

    const saveBtn = document.getElementById('btnSave');
    if (saveBtn) saveBtn.addEventListener('click', () => onSave(m));
  }

  async function onSave(m) {
    markInteracted();
    if (!current || !current.callId) {
      setStatus('Kein Anruf-Datensatz vorhanden.', 'err');
      return;
    }
    const noteEl = document.getElementById('noteInput');
    const note = noteEl ? noteEl.value.trim() : '';

    const payload = { call_id: current.callId, note: note };
    if (m) {
      payload.matched_user_id = m.customer_id;
      const ps = document.getElementById('projSelect');
      if (ps && ps.value) payload.matched_project_id = parseInt(ps.value, 10);
    } else {
      const ni = document.getElementById('nameInput');
      payload.manual_name = ni ? ni.value.trim() : '';
    }

    const btn = document.getElementById('btnSave');
    if (btn) { btn.disabled = true; btn.textContent = 'Speichere…'; }
    setStatus('', '');

    const res = await window.callerPopup.saveNote(payload);
    if (res && res.ok) {
      setStatus('Gespeichert ✓', 'ok');
      if (btn) btn.textContent = 'Gespeichert';
      setTimeout(() => window.callerPopup.close(), 1200);
    } else {
      setStatus('Speichern fehlgeschlagen.' + (res && res.error ? ' (' + res.error + ')' : ''), 'err');
      if (btn) { btn.disabled = false; btn.textContent = 'Speichern'; }
    }
  }

  window.callerPopup.onData(render);
})();
