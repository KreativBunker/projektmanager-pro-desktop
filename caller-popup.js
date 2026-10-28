(function () {
  const bodyEl = document.getElementById('body');
  const footerEl = document.getElementById('footer');
  document.getElementById('btnClose').addEventListener('click', () => window.callerPopup.close());

  let current = null;       // aktuelle Anrufdaten
  let interacted = false;
  let contactCustomer = null; // gewählte Firma für „Als Ansprechpartner speichern“
  let searchTimer = null;
  let searchSeq = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Erste Interaktion -> Auto-Ausblenden abbrechen. Wer den Anruf annimmt und
  // ihn dokumentiert, klickt/scrollt/tippt im Popup; ein bloßes Überfahren mit
  // der Maus zählt bewusst NICHT, damit das Popup bei Nicht-Annahme weiterhin
  // automatisch verschwindet.
  function markInteracted() {
    if (interacted) return;
    interacted = true;
    window.callerPopup.keepOpen();
  }

  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => {
    window.addEventListener(ev, markInteracted, { passive: true });
  });

  // Vom Hauptprozess gemeldete Annahme (3CX-Status) -> dauerhaft offen halten.
  function showAnswered() {
    interacted = true; // verhindert, dass irgendetwas das Popup noch ausblendet
    const banner = document.getElementById('answeredBanner');
    if (banner) banner.hidden = false;
  }
  window.callerPopup.onAnswered(showAnswered);

  function setStatus(msg, kind) {
    const el = document.getElementById('callStatus');
    if (el) { el.textContent = msg || ''; el.className = 'status' + (kind ? ' ' + kind : ''); }
  }

  // keepState: Neuaufbau innerhalb desselben Anrufs (z. B. nach dem Anlegen eines
  // Ansprechpartners) – Interaktions-/Annahme-Status und Notiz bleiben erhalten.
  function render(data, keepState) {
    current = data || {};
    contactCustomer = null;
    const prevNoteEl = document.getElementById('noteInput');
    const prevNote = keepState && prevNoteEl ? prevNoteEl.value : '';
    if (!keepState) {
      interacted = false;
      const banner = document.getElementById('answeredBanner');
      if (banner) banner.hidden = true;
    }
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
      html += renderContactSection(displayName);
    }

    // Letzter dokumentierter Anrufgrund – an der Nummer erkannt, daher auch bei
    // unbekannten Anrufern sichtbar, sofern dieselbe Nummer schon einmal mit
    // Anliegen erfasst wurde.
    const lastCall = lookup.last_call;
    if (lastCall && lastCall.note) {
      html += '<div class="last-reason">';
      html += '<div class="last-reason-label">Letzter Anrufgrund</div>';
      html += '<div class="last-reason-text">' + esc(lastCall.note) + '</div>';
      const meta = [];
      if (lastCall.date) meta.push(lastCall.date);
      if (lastCall.author) meta.push('dokumentiert von ' + lastCall.author);
      if (meta.length) html += '<div class="last-reason-meta">' + esc(meta.join(' · ')) + '</div>';
      html += '</div>';
    }

    html += '<div class="field"><label>Anliegen / Notiz</label><textarea id="noteInput" placeholder="Was wollte der Anrufer?"></textarea></div>';
    html += '<div class="status" id="callStatus"></div>';
    bodyEl.innerHTML = html;
    if (prevNote) document.getElementById('noteInput').value = prevNote;
    if (!m) bindContactSection();

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

  // ── Unbekannter Anrufer: Nummer als Ansprechpartner bei einer Firma hinterlegen ──

  // Von 3CX gelieferter Anzeigename, sofern es nicht bloß die Nummer ist.
  function nameFromDisplay(displayName) {
    const n = String(displayName || '').trim();
    return /[a-zäöüß]/i.test(n) ? n : '';
  }

  function splitName(full) {
    const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { first: '', last: '' };
    if (parts.length === 1) return { first: '', last: parts[0] };
    return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
  }

  function renderContactSection(displayName) {
    const n = splitName(nameFromDisplay(displayName));
    let html = '<details class="add-contact" id="addContact">';
    html += '<summary>Als Ansprechpartner bei einer Firma speichern</summary>';
    html += '<div class="field"><label>Firma / Kunde</label>';
    html += '<input type="text" id="ctCustomerSearch" placeholder="Firma suchen…" autocomplete="off">';
    html += '<div class="search-results" id="ctCustomerResults" hidden></div></div>';
    html += '<div class="field-row">';
    html += '<div class="field"><label>Vorname</label><input type="text" id="ctFirst" value="' + esc(n.first) + '"></div>';
    html += '<div class="field"><label>Nachname</label><input type="text" id="ctLast" value="' + esc(n.last) + '"></div>';
    html += '</div>';
    html += '<div class="field"><label>Position</label><select id="ctPosition">';
    html += '<option value="mitarbeiter">Mitarbeiter</option><option value="gf">Geschäftsführung</option></select></div>';
    html += '<button type="button" class="btn btn-primary btn-inline" id="btnAddContact">Ansprechpartner speichern</button>';
    html += '</details>';
    return html;
  }

  function bindContactSection() {
    const search = document.getElementById('ctCustomerSearch');
    const results = document.getElementById('ctCustomerResults');
    const addBtn = document.getElementById('btnAddContact');
    if (!search || !results) return;

    // Vor- und Nachname aus dem Namensfeld übernehmen, solange noch nichts eingetragen ist.
    const details = document.getElementById('addContact');
    if (details) details.addEventListener('toggle', () => {
      if (!details.open) return;
      markInteracted();
      const ni = document.getElementById('nameInput');
      const first = document.getElementById('ctFirst');
      const last = document.getElementById('ctLast');
      if (ni && ni.value.trim() && first && last && !first.value && !last.value) {
        const n = splitName(ni.value);
        first.value = n.first;
        last.value = n.last;
      }
      search.focus();
    });

    search.addEventListener('input', () => {
      contactCustomer = null;
      const term = search.value.trim();
      clearTimeout(searchTimer);
      if (term.length < 2) { results.hidden = true; results.innerHTML = ''; return; }
      searchTimer = setTimeout(async () => {
        const seq = ++searchSeq;
        const res = await window.callerPopup.searchCustomers(term);
        if (seq !== searchSeq) return;
        const list = (res && res.customers) || [];
        if (!res || !res.ok) {
          results.innerHTML = '<div class="search-none">Suche fehlgeschlagen.</div>';
        } else if (!list.length) {
          results.innerHTML = '<div class="search-none">Keine Treffer</div>';
        } else {
          results.innerHTML = list.map((c) =>
            '<div class="search-result" data-id="' + esc(c.id) + '" data-label="' + esc(c.name || c.firma || ('Kunde #' + c.id)) + '">' +
            esc(c.name || c.firma || ('Kunde #' + c.id)) + '</div>').join('');
        }
        results.hidden = false;
      }, 250);
    });

    results.addEventListener('click', (e) => {
      const item = e.target.closest('.search-result');
      if (!item) return;
      contactCustomer = { id: parseInt(item.getAttribute('data-id'), 10), name: item.getAttribute('data-label') || '' };
      search.value = contactCustomer.name;
      results.hidden = true;
      results.innerHTML = '';
    });

    if (addBtn) addBtn.addEventListener('click', async () => {
      markInteracted();
      addBtn.disabled = true;
      const match = await addContact();
      addBtn.disabled = false;
      if (!match) return;
      // Popup auf den nun bekannten Anrufer umschalten (Projektauswahl etc.).
      const lookup = Object.assign({}, current.lookup || {}, { found: true, matches: [match] });
      render(Object.assign({}, current, { lookup }), true);
      setStatus('Ansprechpartner gespeichert ✓', 'ok');
    });
  }

  function contactFormFilled() {
    const ids = ['ctCustomerSearch', 'ctFirst', 'ctLast'];
    return ids.some((id) => { const el = document.getElementById(id); return el && el.value.trim(); });
  }

  // Legt den Ansprechpartner an. Liefert den Treffer (Format wie caller-lookup) oder null.
  async function addContact() {
    if (!contactCustomer) {
      setStatus('Bitte eine Firma aus der Suche wählen.', 'err');
      return null;
    }
    const first = (document.getElementById('ctFirst') || {}).value || '';
    const last = (document.getElementById('ctLast') || {}).value || '';
    const position = (document.getElementById('ctPosition') || {}).value || 'mitarbeiter';
    if (!first.trim() && !last.trim()) {
      setStatus('Bitte den Namen des Ansprechpartners eintragen.', 'err');
      return null;
    }
    setStatus('Speichere Ansprechpartner…', '');
    const res = await window.callerPopup.addContact({
      call_id: current.callId || null,
      customer_id: contactCustomer.id,
      phone: current.phoneNumber || '',
      first_name: first.trim(),
      last_name: last.trim(),
      position: position,
    });
    if (!res || !res.ok || !res.match) {
      setStatus('Ansprechpartner konnte nicht gespeichert werden.' + (res && res.error ? ' (' + res.error + ')' : ''), 'err');
      return null;
    }
    return res.match;
  }

  async function onSave(m) {
    markInteracted();
    if (!current || !current.callId) {
      setStatus('Kein Anruf-Datensatz vorhanden.', 'err');
      return;
    }
    // Ausgefüllter, aber noch nicht gespeicherter Ansprechpartner: zuerst anlegen,
    // damit die Eingaben nicht verloren gehen.
    if (!m) {
      const details = document.getElementById('addContact');
      if (details && details.open && contactFormFilled()) {
        const match = await addContact();
        if (!match) return;
        m = match;
      }
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
